import { afterAll, describe, expect, it } from "bun:test";
import { compareEntries, NETWORK_COLUMNS } from "../src/network/columns";
import { matchesFilter, normalizeEntry, timingPhases } from "../src/network/model";
import { DevtoolsNetworkSource } from "../src/network/source";
import { harRequest } from "./fixtures/har";

const previousChrome = globalThis.chrome;
globalThis.chrome = { runtime: {} } as typeof chrome;
afterAll(() => { globalThis.chrome = previousChrome; });

function fakeApi() {
  let finish: (request: chrome.devtools.network.Request) => void = () => {};
  let navigate: (url: string) => void = () => {};
  const snapshots: ((log: { entries: chrome.devtools.network.Request[] }) => void)[] = [];
  const api = {
    onRequestFinished: { addListener: (listener: typeof finish) => { finish = listener; }, removeListener: () => {} },
    onNavigated: { addListener: (listener: typeof navigate) => { navigate = listener; }, removeListener: () => {} },
    getHAR: (callback: typeof snapshots[number]) => snapshots.push(callback),
  } as unknown as typeof chrome.devtools.network;
  return { api, snapshots, finish: (request: chrome.devtools.network.Request) => finish(request), navigate: () => navigate("https://example.test/next") };
}

describe("network data", () => {
  it("separates host, path and name, and treats unavailable measurements as unknown", () => {
    const request = harRequest();
    request.response.bodySize = -1;
    const entry = normalizeEntry(request, "r1");
    expect(entry).toMatchObject({ host: "example.test", path: "/api/items?tag=a&tag=b", name: "items?tag=a&tag=b", transferSize: null, group: "fetch" });
    expect(normalizeEntry(harRequest("invalid-url"), "r2").url).toBe("invalid-url");
    expect(matchesFilter(entry, "GET items 200", "fetch")).toBe(true);
    expect(matchesFilter(entry, "GET items", "image")).toBe(false);
  });

  it("deduplicates snapshot/event overlap without collapsing identical concurrent requests", () => {
    const fake = fakeApi();
    let current: readonly { duration: number | null }[] = [];
    const source = new DevtoolsNetworkSource((entries) => { current = entries; }, () => {}, fake.api);
    source.start();
    const pending = harRequest();
    pending.time = 20;
    fake.snapshots[0]?.({ entries: [pending, harRequest()] });
    fake.finish(harRequest());
    expect(current).toHaveLength(2);
    expect(current[0]?.duration).toBe(100);
    fake.finish(harRequest());
    expect(current).toHaveLength(2);
    fake.finish(harRequest());
    expect(current).toHaveLength(3);
    source.dispose();
  });

  it("does not add TLS time twice and sorts sizes numerically", () => {
    const request = harRequest();
    const phases = timingPhases(request);
    expect(phases.find((phase) => phase.key === "ssl")).toMatchObject({ start: 20, duration: 15 });
    expect(phases.find((phase) => phase.key === "send")?.start).toBe(35);
    const a = normalizeEntry(request, "a");
    const b = normalizeEntry(harRequest(), "b");
    b.transferSize = 1000;
    expect(compareEntries(a, b, NETWORK_COLUMNS.find((column) => column.id === "size"), 1)).toBeLessThan(0);
  });

  it("ignores a late HAR snapshot after clear and reads content on demand", async () => {
    const fake = fakeApi();
    let current: readonly { id: string }[] = [];
    const source = new DevtoolsNetworkSource((entries) => { current = entries; }, () => {}, fake.api);
    source.start();
    source.clear();
    fake.snapshots[0]?.({ entries: [harRequest()] });
    expect(current).toHaveLength(0);
    fake.finish(harRequest());
    expect(current).toHaveLength(1);
    const id = current[0]?.id;
    expect(id).toBeDefined();
    expect(await source.readContent(id ?? "")).toEqual({ content: '{"ok":true}', encoding: "", truncated: false });
    source.dispose();
  });

  it("merges events during initialization and honors preserve log and pause", () => {
    const fake = fakeApi();
    let count = 0;
    const source = new DevtoolsNetworkSource((entries) => { count = entries.length; }, () => {}, fake.api);
    source.start();
    fake.finish(harRequest());
    fake.snapshots[0]?.({ entries: [harRequest()] });
    expect(count).toBe(1);
    source.preserveLog = true;
    fake.navigate();
    expect(count).toBe(1);
    source.recording = false;
    fake.finish(harRequest());
    expect(count).toBe(1);
    source.recording = true;
    source.preserveLog = false;
    fake.navigate();
    expect(count).toBe(0);
    source.dispose();
  });
});
