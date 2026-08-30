// Muss zum STORAGE_KEY in content.js passen. Kein gemeinsames Modul, da
// MV3-Background- und Content-Scripts hier ohne Bundler separat geladen
// werden – daher die Duplizierung.
const STORAGE_KEY = "lfrSession";

// Räumt eine evtl. hinterlegte Session weg, sobald kein LinkedIn-Tab mehr
// offen ist. Ohne das würde eine Session, die nicht regulär über den
// "LinkedIn schließen"-Button oder ein Wegnavigieren beendet wurde (z. B.
// weil der Browser/PC einfach zu- bzw. neugestartet wurde), unbegrenzt in
// browser.storage.local liegen bleiben – und beim nächsten Öffnen von
// LinkedIn ggf. sofort als "fällig" gelten, sodass statt des
// Session-Start-Prompts direkt das Erinnerungs-Overlay erscheint.
async function clearSessionIfNoLinkedInTabsOpen() {
  try {
    const linkedInTabs = await browser.tabs.query({ url: "*://*.linkedin.com/*" });
    if (linkedInTabs.length === 0) {
      await browser.storage.local.remove(STORAGE_KEY);
    }
  } catch (e) {
    // storage/tabs im Zweifel nicht verfügbar -> nichts tun, nächster
    // Aufruf (nächstes Tab-Schließen bzw. nächster Browserstart) versucht es
    // erneut.
  }
}

// Deckt den Normalfall ab: letzter LinkedIn-Tab wird geschlossen (auch beim
// Schließen eines ganzen Fensters feuert dies pro Tab).
browser.tabs.onRemoved.addListener(() => {
  clearSessionIfNoLinkedInTabsOpen();
});

// Netz für den Fall, dass onRemoved gar nicht mehr feuert (Browser-Absturz,
// PC-Neustart/Abmelden ohne sauberes Schließen der Tabs). Bewusst ohne
// Tab-Prüfung und ohne Verzögerung: ein Browserstart bedeutet definitionsgemäß,
// dass zwischenzeitlich alle Tabs weg waren – auch wenn die
// Sitzungswiederherstellung gleich wieder LinkedIn-Tabs aufmacht, ist eine
// frische Intent-Abfrage hier das gewünschte Verhalten. Ein setTimeout wäre
// hier zudem unzuverlässig, da MV3-Hintergrundskripte nicht persistent sind
// und vor dem Ablauf beendet werden können.
browser.runtime.onStartup.addListener(() => {
  browser.storage.local.remove(STORAGE_KEY).catch(() => {
    // storage im Zweifel nicht verfügbar -> spätestens das nächste
    // Tab-Schließen räumt auf.
  });
});

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
