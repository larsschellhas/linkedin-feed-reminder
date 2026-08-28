(function () {
  const REMINDER_CAP_MS = 5 * 60 * 1000; // harte Obergrenze: spätestens nach 5 Minuten
  const NAV_POLL_INTERVAL_MS = 1000;
  const DURATION_OPTIONS_MINUTES = [1, 5, 10];
  // Je länger die gewählte Dauer, desto mehr Bedenkzeit, bevor der Button
  // klickbar wird – gilt einheitlich für die Erstauswahl und das Verlängern.
  const DURATION_COOLDOWN_SECONDS = { 1: 5, 5: 10, 10: 30 };
  const STORAGE_KEY = "lfrSession";
  const DEEP_LINK_GRACE_MS = 1 * 60 * 1000; // Schonfrist für einen einzelnen Notification-Deep-Link, bevor er als normaler Feed gilt
  const BUBBLE_FADE_MS = 10 * 1000; // Bubble blendet in den letzten 10s vor der Erinnerung aus, statt zu alarmieren
  const SAFE_LINK_NAVIGATION_GRACE_MS = 5000; // Zeitfenster nach Safe-Link-Klick, in dem render() nichts neu aufbaut

  // Ziele, zu denen man ohne Cooldown wechseln kann: keine endlosen Feeds,
  // sondern zweckgebundene Seiten. "/in/me/" ist eine von LinkedIn selbst
  // bereitgestellte Weiterleitung auf das eigene Profil. Icons sind rein
  // dekorativ (aria-hidden) – die zugängliche Bezeichnung kommt vom Text.
  const SAFE_LINKS = [
    { url: "https://www.linkedin.com/notifications/", labelKey: "notificationsLinkLabel", icon: "🔔" },
    { url: "https://www.linkedin.com/messaging/", labelKey: "messagingLinkLabel", icon: "💬" },
    { url: "https://www.linkedin.com/in/me/", labelKey: "profileLinkLabel", icon: "👤" },
  ];

  // Vorschläge für den primären "LinkedIn schließen und ..."-Button im
  // Erinnerungs-Overlay. Jede Nachricht ist ein vollständiger Satz (inkl.
  // "LinkedIn schließen und ..."), damit Übersetzungen grammatikalisch
  // sauber bleiben, statt Fragmente sprachabhängig zusammenzusetzen. Bei
  // jeder Erinnerung wird zufällig eine ausgewählt.
  const CLOSE_SUGGESTION_KEYS = [
    "suggestionWalk",
    "suggestionCoffee",
    "suggestionWater",
    "suggestionStretch",
    "suggestionBreathe",
  ];

  // Gemeinsamer Session-Zustand, gespiegelt aus browser.storage.local (siehe
  // readSession/writeSession/clearSession). Wird tab-übergreifend über
  // storage.onChanged synchron gehalten, damit ein zweiter Feed-Tab nicht
  // einfach eine neue Session (und damit einen Reset des Timers) startet.
  // Form: { chosenDurationMinutes, reminderIntervalMs, sessionStartTime, nextReminderAt }
  let session = null;

  let overlayKind = null; // "intent" | "reminder" | null – welches Overlay gerade offen ist
  let reminderTimerId = null;
  let bubbleEl = null;
  // sessionStartTime der Session, für die DIESER Tab schon einmal onFeed
  // beobachtet hat – siehe render()/Erklärung dort. Bleibt über Verlängern
  // hinweg gültig, da sessionStartTime dabei erhalten bleibt.
  let sawFeedForSessionStart = null;
  let releaseFocusTrap = null;
  let deepLinkGrace = null; // { search, until } – Schonfrist-Ende für den aktuellen Notification-Deep-Link
  let suppressRenderUntil = 0; // epoch ms – siehe appendSafeLinks()/render()
  const activeCooldowns = new Set(); // laufende Cooldown-Intervalle, damit wir sie beim Aufräumen stoppen können

  function t(key) {
    return browser.i18n.getMessage(key) || key;
  }

  function pickCloseSuggestionLabel() {
    const key = CLOSE_SUGGESTION_KEYS[Math.floor(Math.random() * CLOSE_SUGGESTION_KEYS.length)];
    return t(key);
  }

  // Bewusst ohne URLSearchParams-Iteration: deren .keys()-Iterator hat sich
  // im Content-Script-Sandbox-Kontext als nicht for-of-fähig erwiesen
  // ("TypeError: params.keys() is not iterable"), was isFeedPage() bei
  // jedem Poll-Tick auf jeder /feed-Seite zum Absturz brachte. Ein simpler
  // String-Check auf den Query-String ist robuster und ausreichend.
  function hasHighlightedParam() {
    return /(?:^|[?&])highlighted[^=&]*=/.test(window.location.search);
  }

  // Wird bei jedem Poll-Tick neu ausgewertet und ist bewusst zustandsbehaftet
  // (deepLinkGrace), um die Schonfrist unten zu ermöglichen.
  function isFeedPage() {
    const pathname = window.location.pathname.replace(/\/$/, "");
    if (pathname !== "/feed") {
      deepLinkGrace = null;
      return false;
    }

    if (!hasHighlightedParam()) {
      deepLinkGrace = null;
      return true;
    }

    // Klickt man auf eine Benachrichtigung/Erwähnung, landet man auf
    // /feed?highlightedUpdateUrn=...&highlightedUpdateType=..., um genau
    // einen Post zu sehen – das ist kein "im Feed scrollen" und soll daher
    // nicht sofort den Intent-Prompt/Lock auslösen. Ursprünglich wurde das
    // per Scrolldistanz erkannt (ab wann man "in den normalen Feed
    // abdriftet"), das erwies sich aber als unzuverlässig, weil LinkedIns
    // eigenes Scroll-/Nachladeverhalten die Messung verfälschen kann.
    // Stattdessen: eine feste Schonfrist pro Deep-Link, danach gilt es
    // unabhängig vom Scrollstand wieder als normaler Feed-Aufenthalt – wer
    // von dort aus tatsächlich weiterscrollt, wird also spätestens nach
    // DEEP_LINK_GRACE_MS erfasst.
    const search = window.location.search;
    if (!deepLinkGrace || deepLinkGrace.search !== search) {
      deepLinkGrace = { search, until: Date.now() + DEEP_LINK_GRACE_MS };
    }
    return Date.now() >= deepLinkGrace.until;
  }

  function lockPage() {
    document.documentElement.classList.add("lfr-locked");
  }

  function unlockPage() {
    document.documentElement.classList.remove("lfr-locked");
  }

  function clearAllCooldowns() {
    activeCooldowns.forEach((intervalId) => clearInterval(intervalId));
    activeCooldowns.clear();
  }

  // Entfernt ein evtl. offenes Overlay ohne die Session selbst anzufassen –
  // z. B. wenn der Nutzer per Zurück-Button die Seite gewechselt hat,
  // während der Prompt/die Erinnerung offen war.
  function closeOverlayImmediate() {
    clearAllCooldowns();
    document.querySelectorAll(".lfr-overlay").forEach((el) => el.remove());
    unlockPage();
    if (releaseFocusTrap) {
      releaseFocusTrap();
      releaseFocusTrap = null;
    }
    overlayKind = null;
  }

  function createOverlay(className) {
    const overlay = document.createElement("div");
    overlay.className = `lfr-overlay ${className}`;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    document.documentElement.appendChild(overlay);
    lockPage();
    return overlay;
  }

  // Kleiner DOM-Helfer: baut Elemente ohne innerHTML, damit übersetzte und
  // nutzergenerierte Texte ausschließlich über textContent (automatisch
  // escaped) in die Seite gelangen.
  function createElement(tag, { className, text, attrs } = {}) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    if (attrs) {
      Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
    }
    return node;
  }

  // Hält den Tab-Fokus innerhalb des Dialogs, solange ein Overlay offen ist
  // (WCAG "no keyboard trap outside the dialog"). Gibt eine Cleanup-Funktion
  // zurück.
  function trapFocus(box) {
    function handleKeydown(e) {
      if (e.key !== "Tab") return;
      const focusables = Array.from(box.querySelectorAll("button:not([disabled]), a[href]"));
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeydown, true);
    return () => document.removeEventListener("keydown", handleKeydown, true);
  }

  // Fügt die "geh stattdessen hierhin"-Links an ein Overlay an. Kein
  // Cooldown, da diese Links LinkedIn's Feed bewusst verlassen statt dort zu
  // bleiben – die laufende Session bleibt dabei erhalten (siehe render()).
  // Im Intent-Prompt sind diese Links die primäre Antwort auf "Keine" (siehe
  // showIntentPrompt) und werden entsprechend prominenter dargestellt.
  function appendSafeLinks(box, { headingKey = "safeLinksIntro", primary = false } = {}) {
    const wrap = createElement("div", { className: `lfr-safe-links${primary ? " lfr-safe-links-primary" : ""}` });
    wrap.appendChild(createElement("p", { className: "lfr-safe-links-intro", text: t(headingKey) }));

    const list = createElement("div", { className: "lfr-safe-links-list" });
    SAFE_LINKS.forEach((link) => {
      const a = createElement("a", { className: "lfr-safe-link", attrs: { href: link.url } });
      a.appendChild(
        createElement("span", { className: "lfr-safe-link-icon", text: link.icon, attrs: { "aria-hidden": "true" } })
      );
      a.appendChild(createElement("span", { text: t(link.labelKey) }));
      a.addEventListener("click", () => {
        closeOverlayImmediate();
        // LinkedIns SPA-Router braucht manchmal einen Moment, bis
        // window.location.pathname tatsächlich von /feed wegwechselt.
        // Ohne dieses Zeitfenster würde der nächste Poll-Tick noch auf
        // /feed landen und Prompt/Erinnerung sofort wieder aufbauen, bevor
        // die Zielseite geladen hat.
        suppressRenderUntil = Date.now() + SAFE_LINK_NAVIGATION_GRACE_MS;
      });
      list.appendChild(a);
    });
    wrap.appendChild(list);

    box.appendChild(wrap);
  }

  // Buttons, die auf LinkedIn verbleiben lassen, sind erst nach ein paar
  // Sekunden Bedenkzeit klickbar (Anti-Dark-Pattern: kein reflexhaftes Klicken).
  function applyCooldown(button, seconds) {
    const originalLabel = button.textContent;
    // Endzeitpunkt statt Tick-Zähler: setInterval-Ticks können sich verzögern
    // oder aussetzen (z.B. wenn die Seite gerade lädt und der Haupt-Thread
    // blockiert ist). Wir berechnen die verbleibenden Sekunden bei jedem Tick
    // neu aus der echten Differenz zur Uhrzeit, damit sich Verzögerungen beim
    // nächsten Tick von selbst korrigieren, statt sich aufzusummieren.
    const endTime = Date.now() + seconds * 1000;
    button.disabled = true;
    button.classList.add("lfr-cooldown");
    button.textContent = `${originalLabel} (${seconds})`;

    const intervalId = setInterval(() => {
      const remaining = Math.ceil((endTime - Date.now()) / 1000);
      if (remaining <= 0) {
        clearInterval(intervalId);
        activeCooldowns.delete(intervalId);
        button.disabled = false;
        button.classList.remove("lfr-cooldown");
        button.textContent = originalLabel;
      } else {
        button.textContent = `${originalLabel} (${remaining})`;
      }
    }, 1000);

    activeCooldowns.add(intervalId);
  }

  // --- Persistenz & Tab-übergreifende Synchronisierung -------------------

  async function readSession() {
    try {
      const data = await browser.storage.local.get(STORAGE_KEY);
      return data[STORAGE_KEY] || null;
    } catch (e) {
      return null; // storage im Zweifel nicht verfügbar -> ohne Session weiterlaufen
    }
  }

  async function writeSession(next) {
    session = next;
    try {
      await browser.storage.local.set({ [STORAGE_KEY]: next });
    } catch (e) {
      // still lokal weiterarbeiten, auch wenn die Synchronisierung fehlschlägt
    }
  }

  async function clearSession() {
    session = null;
    try {
      await browser.storage.local.remove(STORAGE_KEY);
    } catch (e) {
      // no-op
    }
  }

  if (browser.storage && browser.storage.onChanged) {
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes[STORAGE_KEY]) return;
      session = changes[STORAGE_KEY].newValue || null;
      scheduleLocalTimer();
      render();
    });
  }

  // Plant den lokalen Reminder-Timer dieses Tabs anhand des gemeinsamen
  // nextReminderAt-Zeitstempels neu. Läuft in jedem Tab unabhängig, zielt
  // aber auf denselben absoluten Zeitpunkt.
  function scheduleLocalTimer() {
    clearTimeout(reminderTimerId);
    reminderTimerId = null;
    if (!session) return;
    const delay = Math.max(0, session.nextReminderAt - Date.now());
    reminderTimerId = setTimeout(() => render(), delay);
  }

  // --- Bubble (roaming-Anzeige auf anderen LinkedIn-Seiten / im Feed) ----

  function formatCountdown(ms) {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  // Reiner Status-Hinweis, kein zusätzlicher Weg zurück zum Feed: bewusst
  // nicht klickbar/fokussierbar, damit die Bubble keinen neuen Anreiz
  // schafft, LinkedIn zu öffnen. Wird von render() nur aufgerufen, solange
  // die Zeit noch nicht abgelaufen ist (siehe dort). In den letzten
  // BUBBLE_FADE_MS unterscheidet sich das Verhalten je nach Standort: im
  // Feed steht ohnehin gleich das Erinnerungs-Overlay bevor, daher ein
  // kurzer roter Warnhinweis; abseits des Feeds bleibt es beim Ausblenden
  // ohne Alarm (die Konfrontation folgt erst bei Rückkehr zum Feed).
  function showOrUpdateBubble(onFeed) {
    if (!bubbleEl || !bubbleEl.isConnected) {
      bubbleEl = createElement("div", {
        className: "lfr-bubble",
        attrs: { role: "status", "aria-live": "polite" },
      });
      document.documentElement.appendChild(bubbleEl);
    }

    const remainingMs = Math.max(0, session.nextReminderAt - Date.now());
    bubbleEl.textContent = t("bubbleRemainingLabel").replace("{time}", formatCountdown(remainingMs));

    const inWarningWindow = remainingMs <= BUBBLE_FADE_MS;
    if (inWarningWindow && onFeed) {
      bubbleEl.classList.add("lfr-bubble-warning");
      bubbleEl.style.opacity = "1";
    } else {
      bubbleEl.classList.remove("lfr-bubble-warning");
      bubbleEl.style.opacity = inWarningWindow ? String(remainingMs / BUBBLE_FADE_MS) : "1";
    }
  }

  function hideBubble() {
    if (bubbleEl) {
      bubbleEl.remove();
      bubbleEl = null;
    }
  }

  // --- Overlays ------------------------------------------------------------

  function showIntentPrompt() {
    overlayKind = "intent";
    const overlay = createOverlay("lfr-intent");
    const box = createElement("div", { className: "lfr-box" });
    overlay.setAttribute("aria-labelledby", "lfr-title");

    box.appendChild(createElement("div", { className: "lfr-icon", text: "🎯", attrs: { "aria-hidden": "true" } }));
    box.appendChild(createElement("p", { className: "lfr-title", text: t("promptTitle"), attrs: { id: "lfr-title" } }));
    box.appendChild(createElement("p", { className: "lfr-subtitle", text: t("promptSubtitle") }));

    // "Keine" ist die primäre, erwartete Antwort: die sicheren Seiten stehen
    // deshalb hier oben als vollwertige Aktionen, nicht als dezenter
    // Nebenausgang. Die eigentliche Zeitauswahl fürs Bleiben rutscht als
    // unscheinbarere sekundäre Funktion darunter.
    appendSafeLinks(box, { headingKey: "declineLabel", primary: true });

    const durationWrap = createElement("div", { className: "lfr-secondary-section" });
    durationWrap.appendChild(
      createElement("p", { className: "lfr-secondary-section-label", text: t("durationQuestion") })
    );

    const durationGroup = createElement("div", { className: "lfr-duration-group-secondary" });
    DURATION_OPTIONS_MINUTES.forEach((minutes) => {
      const btn = createElement("button", { className: "lfr-duration-btn-secondary", text: `${minutes} min` });
      btn.type = "button";
      btn.dataset.minutes = String(minutes);
      durationGroup.appendChild(btn);
    });
    durationWrap.appendChild(durationGroup);
    box.appendChild(durationWrap);

    overlay.appendChild(box);
    // Die Box bekommt den initialen Fokus, damit Screenreader den Dialog
    // sofort ankündigen (die sicheren Links und, nach Ablauf ihres
    // Cooldowns, die Dauer-Buttons sind die fokussierbaren Elemente darin).
    box.setAttribute("tabindex", "-1");
    box.focus();
    releaseFocusTrap = trapFocus(box);

    async function startSession(minutes) {
      const reminderIntervalMs = Math.min(REMINDER_CAP_MS, minutes * 60 * 1000);
      const now = Date.now();

      overlayKind = null;
      overlay.remove();
      unlockPage();
      if (releaseFocusTrap) {
        releaseFocusTrap();
        releaseFocusTrap = null;
      }

      await writeSession({
        chosenDurationMinutes: minutes,
        reminderIntervalMs,
        sessionStartTime: now,
        nextReminderAt: now + reminderIntervalMs,
      });
      scheduleLocalTimer();
      render();
    }

    durationGroup.querySelectorAll(".lfr-duration-btn-secondary").forEach((btn) => {
      applyCooldown(btn, DURATION_COOLDOWN_SECONDS[Number(btn.dataset.minutes)]);
      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        startSession(Number(btn.dataset.minutes));
      });
    });
  }

  function showReminderOverlay() {
    const activeSession = session;
    if (!activeSession) return;

    overlayKind = "reminder";
    const existing = document.querySelector(".lfr-overlay.lfr-reminder");
    if (existing) existing.remove();

    const elapsedMinutes = Math.max(1, Math.round((Date.now() - activeSession.sessionStartTime) / 60000));
    const progressPct = Math.min((elapsedMinutes / activeSession.chosenDurationMinutes) * 100, 100);

    const overlay = createOverlay("lfr-reminder");
    const box = createElement("div", { className: "lfr-box" });
    overlay.setAttribute("aria-labelledby", "lfr-title");

    const ringWrap = createElement("div", { className: "lfr-ring-wrap" });
    const ring = createElement("div", { className: "lfr-ring" });
    ring.style.setProperty("--pct", String(progressPct));
    ringWrap.appendChild(ring);

    const ringHole = createElement("div", { className: "lfr-ring-hole" });
    ringHole.appendChild(createElement("span", { className: "lfr-ring-value", text: String(elapsedMinutes) }));
    ringHole.appendChild(createElement("span", { className: "lfr-ring-unit", text: "min" }));
    ringWrap.appendChild(ringHole);
    box.appendChild(ringWrap);

    box.appendChild(createElement("p", { className: "lfr-title", text: t("reminderTitle"), attrs: { id: "lfr-title" } }));

    // Ein einziger primärer CTA statt getrennter Walk-/Kaffee-Buttons: das
    // Ziel ist, LinkedIn zu verlassen – welcher Achtsamkeitsvorschlag dabei
    // steht, ist zweitrangig und wechselt zufällig, damit er sich nicht
    // abnutzt. Kein Cooldown, da Verlassen nie erschwert werden soll (nur
    // das Verlängern unten ist bewusst zurückhaltender gestaltet).
    const actions = createElement("div", { className: "lfr-actions" });
    const closeButton = createElement("button", {
      className: "lfr-btn lfr-btn-primary",
      text: pickCloseSuggestionLabel(),
    });
    actions.appendChild(closeButton);
    box.appendChild(actions);

    closeButton.addEventListener("click", async () => {
      overlayKind = null;
      overlay.remove();
      unlockPage();
      if (releaseFocusTrap) {
        releaseFocusTrap();
        releaseFocusTrap = null;
      }
      await clearSession();
      scheduleLocalTimer();
      render();
      browser.runtime.sendMessage({ type: "close-tab" });
    });

    appendSafeLinks(box);

    // Verlängern: dezent abgesetzt, mit denselben drei Dauer-Optionen (und
    // gestaffelten Cooldowns) wie beim ursprünglichen Intent-Prompt, statt
    // stillschweigend um dieselbe Zeitspanne zu verlängern.
    const continueWrap = createElement("div", { className: "lfr-secondary-section" });
    continueWrap.appendChild(
      createElement("p", { className: "lfr-secondary-section-label", text: t("continueDefaultLabel") })
    );

    const continueGroup = createElement("div", { className: "lfr-duration-group-secondary" });
    DURATION_OPTIONS_MINUTES.forEach((minutes) => {
      const btn = createElement("button", { className: "lfr-duration-btn-secondary", text: `${minutes} min` });
      btn.type = "button";
      continueGroup.appendChild(btn);
      applyCooldown(btn, DURATION_COOLDOWN_SECONDS[minutes]);
      btn.addEventListener("click", async () => {
        if (btn.disabled) return;
        const now = Date.now();
        const reminderIntervalMs = Math.min(REMINDER_CAP_MS, minutes * 60 * 1000);

        overlayKind = null;
        overlay.remove();
        unlockPage();
        if (releaseFocusTrap) {
          releaseFocusTrap();
          releaseFocusTrap = null;
        }

        await writeSession({
          ...activeSession,
          // Budget kumuliert sich: der Ring zeigt damit weiterhin sinnvoll
          // "verstrichene Zeit gegen insgesamt selbst zugestandenes Budget",
          // statt nach dem Verlängern sofort wieder bei/über 100% zu stehen.
          chosenDurationMinutes: activeSession.chosenDurationMinutes + minutes,
          reminderIntervalMs,
          nextReminderAt: now + reminderIntervalMs,
        });
        scheduleLocalTimer();
        render();
      });
    });
    continueWrap.appendChild(continueGroup);
    box.appendChild(continueWrap);

    overlay.appendChild(box);
    releaseFocusTrap = trapFocus(box);
  }

  // Zentrale Render-Funktion: entscheidet anhand von Session-Zustand und
  // aktueller Seite, was gerade zu sehen sein soll (Intent-Prompt,
  // Erinnerungs-Overlay, roaming-Bubble oder nichts). Wird nach jeder
  // Zustandsänderung und im Poll-Takt aufgerufen; ist idempotent, erzeugt
  // also kein Overlay doppelt.
  function render() {
    const onFeed = isFeedPage();

    if (onFeed && Date.now() < suppressRenderUntil) {
      // Safe-Link wurde gerade angeklickt, die Navigation ist unterwegs,
      // aber der Pfad zeigt (noch) auf /feed -> nichts neu aufbauen, sonst
      // poppt das Overlay vor dem eigentlichen Seitenwechsel wieder auf.
      hideBubble();
      return;
    }

    // Nutzer hat die Seite verlassen (z. B. per Zurück-Button), während ein
    // Overlay offen war -> Lock aufheben, Session bleibt unangetastet.
    if ((overlayKind === "intent" || overlayKind === "reminder") && !onFeed) {
      closeOverlayImmediate();
    }

    if (!session) {
      // Falls hier noch ein Reminder-Overlay offen ist (z. B. weil die
      // Session gerade in einem anderen Tab beendet wurde), sauber
      // aufräumen, bevor evtl. ein frischer Intent-Prompt aufgebaut wird.
      if (overlayKind === "reminder") closeOverlayImmediate();
      hideBubble();
      if (onFeed && overlayKind !== "intent") showIntentPrompt();
      return;
    }

    if (overlayKind === "intent") {
      // Prompt wird gerade beantwortet (evtl. in einem anderen Tab bereits
      // eine Session entstanden) – hier nicht eingreifen.
      hideBubble();
      return;
    }

    if (onFeed) {
      // Markiert, dass DIESER Tab die aktuelle Session tatsächlich im Feed
      // erlebt hat. Nur ein Tab, der das selbst beobachtet hat, darf die
      // Session unten beenden, wenn er den Feed wieder verlässt (siehe
      // Kommentar dort) – sonst könnte ein zweiter, parallel offener
      // LinkedIn-Tab (z. B. Nachrichten/Benachrichtigungen), der die
      // Session nur passiv über den gemeinsamen Storage kennt, sie einem
      // gerade aktiven Feed-Tab mitten im Erinnerungs-Overlay wegreißen.
      sawFeedForSessionStart = session.sessionStartTime;
    }

    const due = Date.now() >= session.nextReminderAt;

    if (due) {
      if (onFeed) {
        if (overlayKind !== "reminder") showReminderOverlay();
        hideBubble();
        return;
      }

      hideBubble();
      // Die Zeit ist abgelaufen, während dieser Tab nicht im Feed war.
      // Beenden (statt bei einem späteren Feed-Besuch einfach mit der
      // alten, dann evtl. längst veralteten Erinnerung weiterzumachen) tun
      // wir das aber nur, wenn DIESER Tab selbst der Feed-Tab für die
      // laufende Session war und inzwischen weggenavigiert ist. Ein Tab,
      // der nie im Feed für diese Session war, kennt die Session nur über
      // den gemeinsamen Storage und würde sie sonst genau in dem Moment
      // beenden, in dem ein anderer, tatsächlich aktiver Feed-Tab das
      // Erinnerungs-Overlay zeigt (der ursprüngliche Bug: Erinnerung blitzt
      // kurz auf und wird sofort durch den Intent-Prompt ersetzt).
      if (sawFeedForSessionStart === session.sessionStartTime) {
        clearSession();
        scheduleLocalTimer();
      }
      return;
    }

    showOrUpdateBubble(onFeed);
  }

  // LinkedIn zeigt an manchen Nav-Menüpunkten (allen voran "Start") einen
  // roten Benachrichtigungs-Punkt ganz ohne Zahl, der rein zum Draufklicken
  // (und damit zurück in den Feed) verleiten soll, auch ohne echte neue
  // Inhalte. Badges mit echter Zahl (Nachrichten, Mitteilungen) sind dagegen
  // sinnvoll und bleiben stehen. Das eigentliche Ausblenden übernimmt eine
  // reine CSS-Regel in content.css (siehe dort) statt JS-Polling: LinkedIns
  // Ember-Nav ersetzt den Badge-Knoten bei jedem SPA-Rerender neu, wodurch
  // eine per JS gesetzte Klasse sofort wieder verloren ginge und bis zum
  // nächsten Poll-Tick (bzw. länger, falls der Tab im Hintergrund gedrosselt
  // wird) kurz aufblitzen würde. Ein struktureller CSS-Selektor matcht dagegen
  // jeden neuen Knoten automatisch, ganz ohne Nachziehen.
  //
  // Hier bleibt nur noch die a11y-Korrektur: LinkedIn hängt an den
  // Mobile-Link fälschlich "X neue Mitteilung(en)" als aria-label an, obwohl
  // dort optisch nur der bedeutungslose Bait-Punkt sitzt. Das ist rein
  // kosmetisch für Screenreader-Nutzer und nicht zeitkritisch, daher reicht
  // dafür weiterhin das Polling.
  function cleanBaitBadgeAriaLabels() {
    const affectedLinks = [];

    // Desktop: <div class="artdeco-notification-badge"><span class="notification-badge">
    //   <span class="notification-badge__no-count"> (leer) ODER
    //   <span class="notification-badge__count">1</span> (echte Zahl)
    document.querySelectorAll("nav .artdeco-notification-badge").forEach((badge) => {
      if (badge.querySelector(".notification-badge__no-count")) {
        affectedLinks.push(badge.closest("a"));
      }
    });

    // Mobile: kein eigener "no-count"-Marker, sondern ein leerer <span>
    // direkt nach dem SVG-Icon (bei echten Zählern steht dort die Zahl als
    // Textinhalt).
    document.querySelectorAll("nav a svg + span").forEach((span) => {
      if (span.children.length === 0 && span.textContent.trim() === "") {
        affectedLinks.push(span.closest("a"));
      }
    });

    affectedLinks.forEach((link) => {
      const label = link && link.getAttribute("aria-label");
      if (!label) return;
      const cleanedLabel = label.replace(/,[^,]*$/, "").trim();
      if (cleanedLabel && cleanedLabel !== label) {
        link.setAttribute("aria-label", cleanedLabel);
      }
    });
  }

  // LinkedIn ist eine SPA: Seitenwechsel innerhalb der App lösen keine neue
  // Navigation (und damit kein Neuladen des Content-Scripts) aus. render()
  // ist idempotent (legt kein Overlay doppelt an), daher reicht es, sie im
  // selben Takt wie den Notification-Bubble-Ausblender einfach neu
  // aufzurufen, statt Pfadwechsel separat zu verfolgen.
  setInterval(() => {
    render();
    cleanBaitBadgeAriaLabels();
  }, NAV_POLL_INTERVAL_MS);

  (async () => {
    session = await readSession();
    scheduleLocalTimer();
    render();
    cleanBaitBadgeAriaLabels();
  })();
})();
