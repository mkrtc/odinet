import { PICKER_CONTROL_PORT, pickerMessage, postPickerMessage } from "./picker-protocol";
import { readElementSnapshot, type ElementSnapshot } from "./snapshot";

export type PickerState = "starting" | "picking" | "paused" | "unavailable";

export class ElementPickerClient {
  private port: chrome.runtime.Port | null = null;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private timeout: ReturnType<typeof setTimeout> | undefined;
  private visible = true;
  enabled = false;

  constructor(
    private readonly tabId: number,
    private readonly onPick: (snapshot: ElementSnapshot | null) => void,
    private readonly onState: (state: PickerState) => void,
    private readonly runtime = chrome.runtime,
  ) {}

  start(enabled = true): void {
    this.enabled = enabled;
    if (this.port) { this.configure(); return; }
    try {
      const port = this.runtime.connect({ name: PICKER_CONTROL_PORT });
      this.port = port;
      this.onState("starting");
      this.timeout = setTimeout(() => { if (this.port === port) this.failed(); }, 8000);
      port.onDisconnect.addListener(() => {
        void this.runtime.lastError;
        if (this.port === port) this.failed();
      });
      port.onMessage.addListener((value: unknown) => {
        if (this.port !== port) return;
        const message = pickerMessage(value);
        if (!message) return;
        if (message.type === "ready") {
          clearTimeout(this.timeout); this.timeout = undefined;
          this.onState(this.enabled && this.visible ? "picking" : "paused");
        } else if (message.type === "picked") {
          try { this.onPick(readElementSnapshot(message.snapshot)); }
          catch (error) { console.error("Odinet: invalid picker snapshot", error); this.failed(); }
        } else if (message.type === "cancelled") { this.enabled = false; this.onState("paused"); }
        else if (message.type === "selection-missing") this.onPick(null);
        else if (message.type === "error") this.failed();
      });
      if (!postPickerMessage(port, { type: "start", tabId: this.tabId, enabled: this.enabled && this.visible })) { this.failed(); return; }
      // Messages keep the MV3 worker alive while this panel owns the picker.
      this.heartbeat = setInterval(() => {
        if (this.port && !postPickerMessage(this.port, { type: "ping" })) this.failed();
      }, 15000);
    } catch (error) { console.error("Odinet: failed to connect page picker", error); this.failed(); }
  }

  pause(): void { this.enabled = false; this.configure(); }
  setVisible(visible: boolean): void { this.visible = visible; if (this.port) this.configure(); }
  refresh(): boolean { return this.port !== null && postPickerMessage(this.port, { type: "refresh" }); }

  restart(): void {
    const enabled = this.enabled;
    this.stop(); this.start(enabled);
  }

  private configure(): void {
    if (!this.port) return;
    if (!postPickerMessage(this.port, { type: "configure", enabled: this.enabled && this.visible })) { this.failed(); return; }
    this.onState(this.enabled && this.visible ? "picking" : "paused");
  }

  private failed(): void { this.stop(); this.onState("unavailable"); }

  stop(): void {
    const port = this.port; this.port = null; this.enabled = false;
    clearTimeout(this.timeout); this.timeout = undefined;
    clearInterval(this.heartbeat); this.heartbeat = undefined;
    try { port?.disconnect(); } catch { /* The worker may already have disconnected. */ }
  }
}
