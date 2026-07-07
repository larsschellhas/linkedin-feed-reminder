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

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
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
    const durationButtons = DURATION_OPTIONS_MINUTES.map(
      (minutes) =>
        `<button type="button" class="lfr-duration-btn${
          minutes === DEFAULT_DURATION_MINUTES ? " lfr-duration-btn-primary" : ""
        }" data-minutes="${minutes}">${minutes} min</button>`
    ).join("");

    overlay.innerHTML = `
      <div class="lfr-box">
        <div class="lfr-icon" aria-hidden="true">🎯</div>
        <p class="lfr-title">${escapeHtml(t("promptTitle"))}</p>
        <p class="lfr-subtitle">${escapeHtml(t("promptSubtitle"))}</p>
        <input class="lfr-input" type="text" placeholder="${escapeHtml(t("inputPlaceholder"))}" maxlength="200" />
        <p class="lfr-duration-question">${escapeHtml(t("durationQuestion"))}</p>
        <div class="lfr-duration-group">${durationButtons}</div>
      </div>
    `;

    const input = overlay.querySelector(".lfr-input");
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

    overlay.querySelectorAll(".lfr-duration-btn").forEach((btn) => {
      applyCooldown(btn, COOLDOWN_SECONDS);
      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        startSession(Number(btn.dataset.minutes));
      });
    });

    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const primaryBtn = overlay.querySelector(".lfr-duration-btn-primary");
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

    const intentLine = intent
      ? `<p class="lfr-intent-line">${escapeHtml(t("intentLabel").replace("{intent}", intent))}</p>`
      : "";

    const continueLabel = intent
      ? t("continueWithIntentLabel").replace("{intent}", intent)
      : t("continueDefaultLabel");

    overlay.innerHTML = `
      <div class="lfr-box">
        <div class="lfr-ring-wrap">
          <div class="lfr-ring" style="--pct: ${progressPct}"></div>
          <div class="lfr-ring-hole">
            <span class="lfr-ring-value">${elapsedMinutes}</span>
            <span class="lfr-ring-unit">min</span>
          </div>
        </div>
        <p class="lfr-title">${escapeHtml(t("reminderTitle"))}</p>
        <p class="lfr-message">${escapeHtml(t("elapsedLabel").replace("{min}", elapsedMinutes))}</p>
        <p class="lfr-subtitle">${escapeHtml(t("focusReminder"))}</p>
        ${intentLine}
        <p class="lfr-question">${escapeHtml(t("question"))}</p>
        <div class="lfr-actions lfr-actions-stacked">
          <button class="lfr-btn lfr-btn-primary" data-action="continue">${escapeHtml(continueLabel)}</button>
          <button class="lfr-btn" data-action="walk">${escapeHtml(t("walkLabel"))}</button>
          <button class="lfr-btn" data-action="coffee">${escapeHtml(t("coffeeLabel"))}</button>
        </div>
      </div>
    `;

    const continueButton = overlay.querySelector('[data-action="continue"]');
    continueButton.addEventListener("click", () => {
      overlay.remove();
      unlockPage();
      startTimer();
    });
    applyCooldown(continueButton, COOLDOWN_SECONDS);

    overlay.querySelectorAll('[data-action="walk"], [data-action="coffee"]').forEach((btn) => {
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
