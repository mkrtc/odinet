chrome.devtools.panels.create(
  chrome.i18n.getMessage("extensionName") || "Odinet",
  "",
  "panel.html",
  () => {
    if (chrome.runtime.lastError) {
      console.error("Odinet: failed to create DevTools panel", chrome.runtime.lastError.message);
    }
  },
);
