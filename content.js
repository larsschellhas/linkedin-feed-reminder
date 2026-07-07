(function () {
  const REMINDER_CAP_MS = 5 * 60 * 1000; // harte Obergrenze: spätestens nach 5 Minuten
  const NAV_POLL_INTERVAL_MS = 1000;
  const COOLDOWN_SECONDS = 10;
  const DURATION_OPTIONS_MINUTES = [1, 5, 10];
  const DEFAULT_DURATION_MINUTES = 1;

  let intent = "";
  let chosenDurationMinutes = DEFAULT_DURATION_MINUTES;
  let reminderIntervalMs = REMINDER_CAP_MS;
  let timerId = null;
  let isActive = false; // sind wir gerade auf dem Feed und der Ablauf (Prompt/Timer) läuft?
  let lastPathname = null;
  let sessionStartTime = null; // Zeitpunkt, seit dem ununterbrochen (über Snoozes hinweg) gezählt wird
  const activeCooldowns = new Set(); // laufende Cooldown-Intervalle, damit wir sie beim Aufräumen stoppen können

  function t(key) {
    return browser.i18n.getMessage(key) || key;
  }

  function isFeedPage() {
    return window.location.pathname.replace(/\/$/, "") === "/feed";
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

  function removeAllOverlays() {
    clearAllCooldowns();
    document.querySelectorAll(".lfr-overlay").forEach((el) => el.remove());
    unlockPage();
  }

  function stopEverything() {
    clearTimeout(timerId);
    timerId = null;
    intent = "";
    chosenDurationMinutes = DEFAULT_DURATION_MINUTES;
    sessionStartTime = null;
    removeAllOverlays();
  }

  function createOverlay(className) {
    const overlay = document.createElement("div");
    overlay.className = `lfr-overlay ${className}`;
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

  // Buttons, die auf LinkedIn verbleiben lassen, sind erst nach ein paar
  // Sekunden Bedenkzeit klickbar (Anti-Dark-Pattern: kein reflexhaftes Klicken).
  function applyCooldown(button, seconds) {
    const originalLabel = button.textContent;
    let remaining = seconds;
    button.disabled = true;
    button.classList.add("lfr-cooldown");
    button.textContent = `${originalLabel} (${remaining})`;

    const intervalId = setInterval(() => {
      remaining -= 1;
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

  function showIntentPrompt() {
    const overlay = createOverlay("lfr-intent");
    const box = createElement("div", { className: "lfr-box" });

    box.appendChild(createElement("div", { className: "lfr-icon", text: "🎯", attrs: { "aria-hidden": "true" } }));
    box.appendChild(createElement("p", { className: "lfr-title", text: t("promptTitle") }));
    box.appendChild(createElement("p", { className: "lfr-subtitle", text: t("promptSubtitle") }));

    const input = createElement("input", { className: "lfr-input" });
    input.type = "text";
    input.placeholder = t("inputPlaceholder");
    input.maxLength = 200;
    box.appendChild(input);

    box.appendChild(createElement("p", { className: "lfr-duration-question", text: t("durationQuestion") }));

    const durationGroup = createElement("div", { className: "lfr-duration-group" });
    DURATION_OPTIONS_MINUTES.forEach((minutes) => {
      const isPrimary = minutes === DEFAULT_DURATION_MINUTES;
      const btn = createElement("button", {
        className: `lfr-duration-btn${isPrimary ? " lfr-duration-btn-primary" : ""}`,
        text: `${minutes} min`,
      });
      btn.type = "button";
      btn.dataset.minutes = String(minutes);
      durationGroup.appendChild(btn);
    });
    box.appendChild(durationGroup);

    overlay.appendChild(box);
    input.focus();

    function startSession(minutes) {
      intent = input.value.trim();
      chosenDurationMinutes = minutes;
      reminderIntervalMs = Math.min(REMINDER_CAP_MS, minutes * 60 * 1000);
      overlay.remove();
      unlockPage();
      sessionStartTime = Date.now();
      startTimer();
    }

    durationGroup.querySelectorAll(".lfr-duration-btn").forEach((btn) => {
      applyCooldown(btn, COOLDOWN_SECONDS);
      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        startSession(Number(btn.dataset.minutes));
      });
    });

    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const primaryBtn = durationGroup.querySelector(".lfr-duration-btn-primary");
      if (primaryBtn && !primaryBtn.disabled) startSession(Number(primaryBtn.dataset.minutes));
    });
  }

  function startTimer() {
    clearTimeout(timerId);
    timerId = setTimeout(showReminder, reminderIntervalMs);
  }

  function showReminder() {
    const existing = document.querySelector(".lfr-overlay.lfr-reminder");
    if (existing) existing.remove();

    const elapsedMinutes = sessionStartTime
      ? Math.max(1, Math.round((Date.now() - sessionStartTime) / 60000))
      : chosenDurationMinutes;
    const progressPct = Math.min((elapsedMinutes / chosenDurationMinutes) * 100, 100);

    const overlay = createOverlay("lfr-reminder");
    const box = createElement("div", { className: "lfr-box" });

    const ringWrap = createElement("div", { className: "lfr-ring-wrap" });
    const ring = createElement("div", { className: "lfr-ring" });
    ring.style.setProperty("--pct", String(progressPct));
    ringWrap.appendChild(ring);

    const ringHole = createElement("div", { className: "lfr-ring-hole" });
    ringHole.appendChild(createElement("span", { className: "lfr-ring-value", text: String(elapsedMinutes) }));
    ringHole.appendChild(createElement("span", { className: "lfr-ring-unit", text: "min" }));
    ringWrap.appendChild(ringHole);
    box.appendChild(ringWrap);

    box.appendChild(createElement("p", { className: "lfr-title", text: t("reminderTitle") }));
    box.appendChild(
      createElement("p", { className: "lfr-message", text: t("elapsedLabel").replace("{min}", elapsedMinutes) })
    );
    box.appendChild(createElement("p", { className: "lfr-subtitle", text: t("focusReminder") }));

    if (intent) {
      box.appendChild(
        createElement("p", {
          className: "lfr-intent-line",
          text: t("intentLabel").replace("{intent}", intent),
        })
      );
    }

    box.appendChild(createElement("p", { className: "lfr-question", text: t("question") }));

    const continueLabel = intent
      ? t("continueWithIntentLabel").replace("{intent}", intent)
      : t("continueDefaultLabel");

    const actions = createElement("div", { className: "lfr-actions lfr-actions-stacked" });
    const continueButton = createElement("button", { className: "lfr-btn lfr-btn-primary", text: continueLabel });
    const walkButton = createElement("button", { className: "lfr-btn", text: t("walkLabel") });
    const coffeeButton = createElement("button", { className: "lfr-btn", text: t("coffeeLabel") });
    actions.appendChild(continueButton);
    actions.appendChild(walkButton);
    actions.appendChild(coffeeButton);
    box.appendChild(actions);

    overlay.appendChild(box);

    continueButton.addEventListener("click", () => {
      overlay.remove();
      unlockPage();
      startTimer();
    });
    applyCooldown(continueButton, COOLDOWN_SECONDS);

    [walkButton, coffeeButton].forEach((btn) => {
      btn.addEventListener("click", () => {
        browser.runtime.sendMessage({ type: "close-tab" });
      });
    });
  }

  function handleNavigation() {
    const pathname = window.location.pathname;
    if (pathname === lastPathname) return;
    lastPathname = pathname;

    const onFeedNow = isFeedPage();
    if (onFeedNow && !isActive) {
      isActive = true;
      showIntentPrompt();
    } else if (!onFeedNow && isActive) {
      isActive = false;
      stopEverything();
    }
  }

  // LinkedIn zeigt am "Start"-Menüpunkt regelmäßig einen roten
  // Benachrichtigungs-Punkt, der zum Draufklicken (und damit zurück in den
  // Feed) verleiten soll, auch ohne echte neue Inhalte. Wir blenden ihn aus.
  // Statt der gehashten Utility-Klassen (die sich bei jedem LinkedIn-Deploy
  // ändern können) nutzen wir die SVG-Icon-ID "home-medium" als Ankerpunkt,
  // die stabiler ist, und verstecken den direkt danebenliegenden Span.
  function hideStartNotificationBubble() {
    document.querySelectorAll("nav svg#home-medium").forEach((icon) => {
      const bubble = icon.nextElementSibling;
      if (bubble && bubble.tagName === "SPAN") {
        bubble.classList.add("lfr-hidden-bubble");
      }

      const button = icon.closest("button[aria-label]");
      if (button) {
        const cleanedLabel = button.getAttribute("aria-label").replace(/,.*$/, "").trim();
        if (cleanedLabel && cleanedLabel !== button.getAttribute("aria-label")) {
          button.setAttribute("aria-label", cleanedLabel);
        }
      }
    });
  }

  // LinkedIn ist eine SPA: Seitenwechsel innerhalb der App lösen keine neue
  // Navigation (und damit kein Neuladen des Content-Scripts) aus. Deshalb
  // pollen wir den Pfad, um Wechsel zu/von /feed zu erkennen. Denselben Takt
  // nutzen wir, um den Notification-Bubble laufend auszublenden.
  setInterval(() => {
    handleNavigation();
    hideStartNotificationBubble();
  }, NAV_POLL_INTERVAL_MS);
  handleNavigation();
  hideStartNotificationBubble();
})();
