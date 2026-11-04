import { PICKER_CONTROL_PORT, PICKER_FRAME_PORT, pickerMessage, postPickerMessage } from "./picker-protocol";

interface PickerSession {
  control: chrome.runtime.Port;
  tabId: number;
  enabled: boolean;
  frames: Set<chrome.runtime.Port>;
  selected: chrome.runtime.Port | null;
}

export class PickerBroker {
  private readonly sessions = new Map<number, PickerSession>();
  constructor(private readonly api = chrome) { api.runtime.onConnect.addListener(this.connected); }

  private configure(session: PickerSession): void {
    for (const port of session.frames) postPickerMessage(port, { type: "configure", enabled: session.enabled });
  }

  private stop(session: PickerSession): void {
    if (this.sessions.get(session.tabId) === session) this.sessions.delete(session.tabId);
    for (const port of session.frames) port.disconnect();
    session.frames.clear(); session.selected = null;
  }

  private readonly connected = (port: chrome.runtime.Port): void => {
    if (port.name === PICKER_CONTROL_PORT && port.sender?.url === this.api.runtime.getURL("panel.html")) this.controlConnected(port);
    else if (port.name === PICKER_FRAME_PORT) this.frameConnected(port);
  };

  private controlConnected(port: chrome.runtime.Port): void {
    let session: PickerSession | null = null;
    port.onDisconnect.addListener(() => { void this.api.runtime.lastError; if (session) this.stop(session); });
    port.onMessage.addListener((value: unknown) => {
      const message = pickerMessage(value);
      if (!message) return;
      if (message.type === "start" && !session) {
        if (typeof message.tabId !== "number" || !Number.isInteger(message.tabId) || message.tabId < 0 || typeof message.enabled !== "boolean") return;
        const previous = this.sessions.get(message.tabId);
        if (previous) { this.stop(previous); postPickerMessage(previous.control, { type: "error" }); }
        session = { control: port, tabId: message.tabId, enabled: message.enabled, frames: new Set(), selected: null };
        this.sessions.set(session.tabId, session);
        void this.inject(session);
      } else if (session && this.sessions.get(session.tabId) === session) {
        if (message.type === "configure" && typeof message.enabled === "boolean") {
          session.enabled = message.enabled; this.configure(session);
        } else if (message.type === "refresh") {
          if (session.selected) postPickerMessage(session.selected, { type: "refresh" });
          else postPickerMessage(session.control, { type: "selection-missing" });
        }
      }
    });
  }

  private async inject(session: PickerSession): Promise<void> {
    try {
      await this.api.scripting.executeScript({ target: { tabId: session.tabId, allFrames: true }, files: ["element-picker.js"], world: "ISOLATED" });
      if (this.sessions.get(session.tabId) === session) postPickerMessage(session.control, { type: "ready" });
    } catch (error) {
      if (this.sessions.get(session.tabId) !== session) return;
      console.error("Odinet: failed to start page element picker", error);
      this.stop(session); postPickerMessage(session.control, { type: "error" });
    }
  }

  private frameConnected(port: chrome.runtime.Port): void {
    const tabId = port.sender?.tab?.id;
    const session = tabId === undefined ? undefined : this.sessions.get(tabId);
    if (!session || session.frames.size >= 128) { port.disconnect(); return; }
    session.frames.add(port);
    postPickerMessage(port, { type: "configure", enabled: session.enabled });
    port.onDisconnect.addListener(() => {
      void this.api.runtime.lastError;
      session.frames.delete(port);
      if (session.selected === port) session.selected = null;
    });
    port.onMessage.addListener((value: unknown) => {
      if (this.sessions.get(session.tabId) !== session || !session.frames.has(port)) return;
      const message = pickerMessage(value);
      if (!message) return;
      if (message.type === "picked") {
        session.selected = port;
        for (const frame of session.frames) if (frame !== port) postPickerMessage(frame, { type: "forget" });
        postPickerMessage(session.control, { type: "picked", snapshot: message.snapshot });
      } else if (message.type === "cancelled" || message.type === "error") {
        session.enabled = false; this.configure(session);
        postPickerMessage(session.control, { type: message.type });
      }
    });
  }

  dispose(): void {
    this.api.runtime.onConnect.removeListener(this.connected);
    for (const session of this.sessions.values()) this.stop(session);
  }
}
