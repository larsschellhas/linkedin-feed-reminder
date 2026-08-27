browser.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== "close-tab") return;

  // Ziel des Buttons ist es, wirklich von LinkedIn wegzukommen – nicht nur
  // den einen Tab zu schließen, aus dem die Nachricht kam, während z. B. ein
  // zweiter, parallel offener LinkedIn-Tab munter weiterläuft. Daher werden
  // alle Tabs geschlossen, die gerade auf linkedin.com offen sind (nicht nur
  // /feed – wer LinkedIn schließen will, meint damit die ganze Seite).
  (async () => {
    const tabIds = new Set();

    try {
      const linkedInTabs = await browser.tabs.query({ url: "*://*.linkedin.com/*" });
      linkedInTabs.forEach((tab) => {
        if (tab.id !== undefined) tabIds.add(tab.id);
      });
    } catch (e) {
      // Query im Zweifel übersprungen (z. B. fehlende Rechte) – der
      // auslösende Tab wird unten trotzdem als Fallback geschlossen.
    }

    if (sender.tab?.id !== undefined) tabIds.add(sender.tab.id);

    if (tabIds.size) {
      browser.tabs.remove(Array.from(tabIds));
    }
  })();
});
