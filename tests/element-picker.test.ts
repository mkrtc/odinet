import { describe, expect, it, spyOn } from "bun:test";
import { PickerBroker } from "../src/element/picker-broker";
import { ElementPickerClient, type PickerState } from "../src/element/picker-client";
import { PICKER_CONTROL_PORT, PICKER_FRAME_PORT } from "../src/element/picker-protocol";

class Signal<T> {
  private readonly listeners = new Set<(value: T) => void>();
  addListener(listener: (value: T) => void): void { this.listeners.add(listener); }
  removeListener(listener: (value: T) => void): void { this.listeners.delete(listener); }
  emit(value: T): void { for (const listener of this.listeners) listener(value); }
}

class Port {
  readonly onMessage = new Signal<unknown>();
  readonly onDisconnect = new Signal<chrome.runtime.Port>();
  readonly sent: unknown[] = [];
  closed = false;
  constructor(readonly name: string, readonly sender: object = {}) {}
  postMessage(message: unknown): void { if (this.closed) throw new Error("Port disconnected"); this.sent.push(message); }
  disconnect(): void { if (!this.closed) { this.closed = true; this.onDisconnect.emit(this.value); } }
  get value(): chrome.runtime.Port { return this as unknown as chrome.runtime.Port; }
}

const panelURL = "chrome-extension://odinet/panel.html";
function fixture(inject: () => Promise<unknown> = async () => []) {
  const onConnect = new Signal<chrome.runtime.Port>();
  const injections: unknown[] = [];
  const api = {
    runtime: { onConnect, getURL: () => panelURL, lastError: undefined },
    scripting: { executeScript: (options: unknown) => { injections.push(options); return inject(); } },
  } as unknown as typeof chrome;
  const broker = new PickerBroker(api);
  const control = new Port(PICKER_CONTROL_PORT, { url: panelURL });
  const connect = (port: Port): void => onConnect.emit(port.value);
  const frame = (tabId = 7): Port => { const port = new Port(PICKER_FRAME_PORT, { tab: { id: tabId } }); connect(port); return port; };
  connect(control);
  return { broker, control, connect, frame, injections };
}

describe("page picker routing", () => {
  it("injects only into the inspected tab and routes picked frames to their owner", async () => {
    const { broker, control, frame, injections } = fixture();
    try {
      control.onMessage.emit({ type: "start", tabId: 7, enabled: true });
      expect(injections).toEqual([{ target: { tabId: 7, allFrames: true }, files: ["element-picker.js"], world: "ISOLATED" }]);
      const main = frame(); const child = frame(); const otherTab = frame(8);
      expect(otherTab.closed).toBe(true);
      expect(child.sent).toContainEqual({ type: "configure", enabled: true });
      child.onMessage.emit({ type: "picked", snapshot: { label: "iframe element" } });
      expect(control.sent).toContainEqual({ type: "picked", snapshot: { label: "iframe element" } });
      expect(main.sent).toContainEqual({ type: "forget" });
      control.onMessage.emit({ type: "refresh" });
      expect(child.sent.at(-1)).toEqual({ type: "refresh" });
      await Promise.resolve();
      expect(control.sent).toContainEqual({ type: "ready" });
    } finally { broker.dispose(); }
  });

  it("pauses every frame on Escape and releases all connections when its panel closes", () => {
    const { broker, control, frame } = fixture();
    try {
      control.onMessage.emit({ type: "start", tabId: 7, enabled: true });
      const main = frame(); const child = frame();
      child.onMessage.emit({ type: "cancelled" });
      expect(main.sent.at(-1)).toEqual({ type: "configure", enabled: false });
      expect(child.sent.at(-1)).toEqual({ type: "configure", enabled: false });
      expect(control.sent.at(-1)).toEqual({ type: "cancelled" });
      control.disconnect();
      expect(main.closed && child.closed).toBe(true);
      expect(frame().closed).toBe(true);
    } finally { broker.dispose(); }
  });

  it("does not activate late injections after cancellation and handles rejected access", async () => {
    let resolve: (() => void) | undefined;
    const pending = new Promise<void>((done) => { resolve = done; });
    const first = fixture(() => pending);
    first.control.onMessage.emit({ type: "start", tabId: 7, enabled: true });
    first.control.disconnect(); resolve?.();
    await Promise.resolve();
    expect(first.control.sent).not.toContainEqual({ type: "ready" });
    expect(first.frame().closed).toBe(true);
    first.broker.dispose();

    const rejected = fixture(async () => { throw new Error("Access denied"); });
    const diagnostic = spyOn(console, "error").mockImplementation(() => {});
    try {
      rejected.control.onMessage.emit({ type: "start", tabId: 7, enabled: true });
      const frame = rejected.frame();
      await Promise.resolve();
      expect(frame.closed).toBe(true);
      expect(rejected.control.sent).toContainEqual({ type: "error" });
      expect(diagnostic).toHaveBeenCalledTimes(1);
    } finally { diagnostic.mockRestore(); rejected.broker.dispose(); }
  });

  it("rejects forged controllers and invalid tab identifiers", () => {
    const { broker, control, connect, injections } = fixture();
    try {
      for (const tabId of [-1, 0.5, "7", NaN]) control.onMessage.emit({ type: "start", tabId, enabled: true });
      const forged = new Port(PICKER_CONTROL_PORT, { url: "https://example.test/" });
      connect(forged); forged.onMessage.emit({ type: "start", tabId: 7, enabled: true });
      expect(injections).toHaveLength(0);
    } finally { broker.dispose(); }
  });
});

describe("page picker panel client", () => {
  it("suspends when hidden, resumes on return and preserves an explicit pause", () => {
    const port = new Port(PICKER_CONTROL_PORT);
    const states: PickerState[] = [];
    const runtime = { connect: () => port.value, lastError: undefined } as unknown as typeof chrome.runtime;
    const client = new ElementPickerClient(7, () => {}, (state) => states.push(state), runtime);
    try {
      client.start(); port.onMessage.emit({ type: "ready" });
      client.setVisible(false);
      expect(port.sent.at(-1)).toEqual({ type: "configure", enabled: false });
      client.setVisible(true);
      expect(port.sent.at(-1)).toEqual({ type: "configure", enabled: true });
      port.onMessage.emit({ type: "cancelled" });
      client.setVisible(false); client.setVisible(true);
      expect(port.sent.at(-1)).toEqual({ type: "configure", enabled: false });
      expect(states.at(-1)).toBe("paused");
    } finally { client.stop(); }
    expect(port.closed).toBe(true);
  });

  it("ignores messages from disconnected sessions and reports an unexpected worker disconnect", () => {
    const ports = [new Port(PICKER_CONTROL_PORT), new Port(PICKER_CONTROL_PORT)];
    let index = 0;
    const runtime = { connect: () => ports[index++]!.value, lastError: undefined } as unknown as typeof chrome.runtime;
    const states: PickerState[] = [];
    const client = new ElementPickerClient(7, () => {}, (state) => states.push(state), runtime);
    try {
      client.start(); client.restart();
      ports[0]!.onMessage.emit({ type: "error" });
      expect(client.enabled).toBe(true);
      ports[1]!.onMessage.emit({ type: "ready" });
      ports[1]!.disconnect();
      expect(client.enabled).toBe(false);
      expect(states.at(-1)).toBe("unavailable");
    } finally { client.stop(); }
  });
});
