import { describe, expect, it } from "bun:test";
import { dataRelation, resourceRelation, SCAN_BODY_LIMIT, SCAN_REQUEST_LIMIT, scanResponseData } from "../src/element/relations";
import { readElementSnapshot, type ElementSnapshot } from "../src/element/snapshot";
import { normalizeEntry } from "../src/network/model";
import { harRequest } from "./fixtures/har";

const snapshot = (): ElementSnapshot => ({
  label: "article#product", pageUrl: "https://example.test/", capturedAt: Date.parse("2026-10-29T12:01:00Z"),
  documentStartedAt: Date.parse("2026-10-29T11:59:00Z"), visited: 12, limited: false,
  resources: [{ kind: "image", url: "https://example.test/cover.svg" }], samples: ["Odinet Field Research"],
});

describe("element request relations", () => {
  it("matches resource URLs including fragment references, without inferring global dependencies", () => {
    const image = normalizeEntry(harRequest("https://example.test/cover.svg#symbol"), "image");
    expect(resourceRelation(snapshot(), image)).toMatchObject({ kind: "resource", resource: { kind: "image" } });
    expect(resourceRelation(snapshot(), normalizeEntry(harRequest("https://example.test/global.css"), "css"))).toBeUndefined();
    expect(resourceRelation(snapshot(), { ...image, startedAt: snapshot().documentStartedAt - 1 })).toBeUndefined();
    expect(resourceRelation(snapshot(), { ...image, startedAt: snapshot().capturedAt + 1 })).toBeUndefined();
  });

  it("reports an exact JSON value and path as a possible relation, ignoring keys and partial matches", () => {
    expect(dataRelation(snapshot(), '{"data":{"a.b":[{"title":"Odinet  Field\\nResearch"}]}}')).toEqual({ kind: "data", value: "Odinet Field Research", path: '$.data["a.b"][0].title' });
    expect(dataRelation(snapshot(), '{"Odinet Field Research":true}')).toBeUndefined();
    expect(dataRelation(snapshot(), '{"title":"Odinet Field Research Extra"}')).toBeUndefined();
    expect(dataRelation(snapshot(), '<h1>Odinet Field Research</h1>')).toBeUndefined();
  });

  it("scans completed responses from this document only and tolerates unavailable bodies", async () => {
    const base = normalizeEntry(harRequest(), "match");
    const ids: string[] = [];
    const result = await scanResponseData(snapshot(), [base, { ...base, id: "missing" }, { ...base, id: "old", startedAt: 0 }, { ...base, id: "future", startedAt: snapshot().capturedAt }, { ...base, id: "pending", state: "pending" }], async (id) => {
      ids.push(id);
      if (id === "missing") throw undefined;
      return { content: '{"name":"Odinet Field Research"}', encoding: "", truncated: false };
    }, new AbortController().signal);
    expect(ids.sort()).toEqual(["match", "missing"]);
    expect(result.matches.get("match")).toMatchObject({ kind: "data", path: "$.name" });
    expect(result.checked).toBe(1);
    expect(result.unavailable).toBe(1);
  });

  it("bounds body and request budgets and skips truncated or encoded responses", async () => {
    const base = normalizeEntry(harRequest(), "base");
    let reads = 0;
    const result = await scanResponseData(snapshot(), Array.from({ length: SCAN_REQUEST_LIMIT + 10 }, (_, index) => ({ ...base, id: String(index) })), async () => {
      reads++;
      return { content: "{}", encoding: "", truncated: false };
    }, new AbortController().signal);
    expect(reads).toBe(SCAN_REQUEST_LIMIT);
    expect(result.limited).toBe(true);
    const skipped = await scanResponseData(snapshot(), [{ ...base, resourceSize: SCAN_BODY_LIMIT + 1 }], async () => { throw new Error("Must not read oversized response"); }, new AbortController().signal);
    expect(skipped.limited).toBe(true);
    expect(skipped.unavailable).toBe(0);
    for (const response of [{ content: '{"name":"Odinet Field Research"}', encoding: "base64", truncated: false }, { content: '{"name":"Odinet Field Research"}', encoding: "", truncated: true }]) {
      const skippedContent = await scanResponseData(snapshot(), [base], async () => response, new AbortController().signal);
      expect(skippedContent.matches.size).toBe(0);
      expect(skippedContent.limited).toBe(true);
    }
  });

  it("cancels an in-flight response without waiting for DevTools to return it", async () => {
    const controller = new AbortController();
    const base = normalizeEntry(harRequest(), "pending-body");
    const pending = scanResponseData(snapshot(), [base], () => new Promise(() => {}), controller.signal);
    controller.abort();
    expect((await pending).matches.size).toBe(0);
    let reads = 0;
    await scanResponseData(snapshot(), [base], async () => { reads++; return { content: "{}", encoding: "", truncated: false }; }, controller.signal);
    expect(reads).toBe(0);
  });

  it("validates page-controlled snapshot data before using it in the panel", () => {
    expect(readElementSnapshot(snapshot())).toEqual(snapshot());
    expect(readElementSnapshot(null)).toBeNull();
    expect(() => readElementSnapshot({ ...snapshot(), resources: [{ url: "javascript:alert(1)", kind: "image" }] })).toThrow();
    expect(() => readElementSnapshot({ ...snapshot(), samples: Array(81).fill("sample text") })).toThrow();
    expect(() => readElementSnapshot({ ...snapshot(), documentStartedAt: NaN })).toThrow();
    expect(() => readElementSnapshot({ ...snapshot(), visited: -1 })).toThrow();
  });
});
