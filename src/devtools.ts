import { PANEL_HIDDEN_EVENT, PANEL_SHOWN_EVENT } from "./element/picker-protocol";

chrome.devtools.panels.create(
  chrome.i18n.getMessage("extensionName") || "Odinet",
  "",
  "panel.html",
  (panel) => {
    if (chrome.runtime.lastError) {
      console.error("Odinet: failed to create DevTools panel", chrome.runtime.lastError.message);
      return;
    }
    let view: Window | null = null;
    const emit = (type: string): void => {
      try { view?.dispatchEvent(new Event(type)); } catch { view = null; }
    };
    panel.onShown.addListener((window) => { view = window; emit(PANEL_SHOWN_EVENT); });
    panel.onHidden.addListener(() => emit(PANEL_HIDDEN_EVENT));
  },
);
