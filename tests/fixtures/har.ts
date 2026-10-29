export function harRequest(url = "https://example.test/api/items?tag=a&tag=b"): chrome.devtools.network.Request {
  return {
    startedDateTime: "2026-10-29T12:00:00.000Z", time: 100,
    request: {
      method: "GET", url, httpVersion: "HTTP/2.0", cookies: [], headers: [],
      queryString: [{ name: "tag", value: "a" }, { name: "tag", value: "b" }], headersSize: -1, bodySize: 0,
    },
    response: {
      status: 200, statusText: "OK", httpVersion: "HTTP/2.0", cookies: [], headers: [],
      content: { size: 42, mimeType: "application/json" }, redirectURL: "", headersSize: 20, bodySize: 42,
    },
    cache: {}, timings: { blocked: 5, dns: 10, connect: 20, ssl: 15, send: 5, wait: 50, receive: 10 },
    getContent: ((callback?: (content: string, encoding: string) => void) => {
      if (callback) callback('{"ok":true}', "");
      else return Promise.resolve({ content: '{"ok":true}', encoding: "" });
    }) as chrome.devtools.network.Request["getContent"],
  };
}
