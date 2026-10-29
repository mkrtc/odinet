import { describe, expect, it } from "bun:test";
import { applyRequestEvent, MAX_REQUESTS, readRequests, type RequestEvent } from "../src/shared/requests";

const start: RequestEvent = {
  kind: "started",
  requestId: "r1",
  url: "https://example.test/first",
  method: "GET",
  type: "main_frame",
  tabId: 3,
  initiator: null,
  timeStamp: 10,
};

describe("request log", () => {
  it("groups a redirect and completion into one record", () => {
    const started = applyRequestEvent([], start);
    const redirected = applyRequestEvent(started, {
      ...start, kind: "redirected", redirectUrl: "https://example.test/next", timeStamp: 20,
    });
    const completed = applyRequestEvent(redirected, {
      ...start, kind: "completed", url: "https://example.test/next", statusCode: 200, timeStamp: 30,
    });
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({
      url: "https://example.test/next", state: "completed", statusCode: 200,
      redirects: ["https://example.test/first"], finishedAt: 30,
    });
  });

  it("records a failure when the start event was missed", () => {
    const result = applyRequestEvent([], { ...start, kind: "failed", error: "net::ERR_FAILED" });
    expect(result[0]).toMatchObject({ state: "failed", error: "net::ERR_FAILED" });
  });

  it("bounds history and ignores non-HTTP URLs", () => {
    let records = applyRequestEvent([], { ...start, url: "file:///tmp/x" });
    expect(records).toHaveLength(0);
    for (let i = 0; i < MAX_REQUESTS + 10; i++) {
      records = applyRequestEvent(records, { ...start, requestId: String(i) });
    }
    expect(records).toHaveLength(MAX_REQUESTS);
    expect(records[0]?.id).toBe(String(MAX_REQUESTS + 9));
  });

  it("ignores malformed storage records", () => {
    expect(readRequests([{}, null, 12])).toEqual([]);
  });
});
