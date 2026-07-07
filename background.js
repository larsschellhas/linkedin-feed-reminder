browser.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === "close-tab" && sender.tab?.id !== undefined) {
    browser.tabs.remove(sender.tab.id);
  }
});
