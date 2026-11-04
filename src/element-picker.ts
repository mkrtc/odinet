import { PageElementPicker } from "./element/page-picker";
import { PICKER_FRAME_PORT, pickerMessage, postPickerMessage } from "./element/picker-protocol";

// This bundle is injected on demand into the extension's isolated world.
const key = Symbol.for("odinet.page-picker");
const scope = globalThis as typeof globalThis & { [key]?: { dispose: () => void } };
scope[key]?.dispose();
const port = chrome.runtime.connect({ name: PICKER_FRAME_PORT });
let disposed = false;
const picker = new PageElementPicker(
  (snapshot) => { if (!postPickerMessage(port, { type: "picked", snapshot })) dispose(); },
  () => { if (!postPickerMessage(port, { type: "cancelled" })) dispose(); },
  (error) => {
    console.error("Odinet: page element picker failed", error);
    if (!postPickerMessage(port, { type: "error" })) dispose();
  },
  chrome.i18n.getMessage("elementPickerOverlayHint"),
);
const handshake = setTimeout(() => dispose(), 5000);
function dispose(): void {
  if (disposed) return;
  disposed = true; clearTimeout(handshake); picker.dispose();
  window.removeEventListener("pagehide", dispose);
  if (scope[key]?.dispose === dispose) delete scope[key];
  try { port.disconnect(); } catch { /* The owning panel may already have disconnected. */ }
}
scope[key] = { dispose };
port.onMessage.addListener((value: unknown) => {
  const message = pickerMessage(value);
  if (!message || disposed) return;
  try {
    if (message.type === "configure" && typeof message.enabled === "boolean") {
      clearTimeout(handshake); picker.setEnabled(message.enabled);
    } else if (message.type === "refresh") picker.refresh();
    else if (message.type === "forget") picker.forget();
  } catch (error) {
    picker.dispose();
    console.error("Odinet: failed to configure page picker", error);
    if (!postPickerMessage(port, { type: "error" })) dispose();
  }
});
port.onDisconnect.addListener(() => { try { void chrome.runtime.lastError; } finally { dispose(); } });
window.addEventListener("pagehide", dispose, { once: true });
