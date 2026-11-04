export const PICKER_CONTROL_PORT = "odinet-element-picker-control";
export const PICKER_FRAME_PORT = "odinet-element-picker-frame";
export const PANEL_SHOWN_EVENT = "odinet-panel-shown";
export const PANEL_HIDDEN_EVENT = "odinet-panel-hidden";

export function pickerMessage(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string" ? value as Record<string, unknown> : null;
}

export function postPickerMessage(port: chrome.runtime.Port, message: object): boolean {
  try { port.postMessage(message); return true; } catch { return false; }
}
