import { applyRequestEvent, readRequests, REQUESTS_KEY, type RequestEvent } from "./shared/requests";

let writeQueue: Promise<void> = Promise.resolve();

function record(event: RequestEvent): void {
  writeQueue = writeQueue.then(async () => {
    const stored = await chrome.storage.session.get(REQUESTS_KEY);
    const requests = applyRequestEvent(readRequests(stored[REQUESTS_KEY]), event);
    await chrome.storage.session.set({ [REQUESTS_KEY]: requests });
  }).catch((error: unknown) => {
    console.error("Odinet: failed to save HTTP request", error);
  });
}

function base(details: {
  requestId: string;
  url: string;
  method: string;
  type: string;
  tabId: number;
  initiator?: string;
  timeStamp: number;
}) {
  return {
    requestId: details.requestId,
    url: details.url,
    method: details.method,
    type: details.type,
    tabId: details.tabId,
    initiator: details.initiator ?? null,
    timeStamp: details.timeStamp,
  };
}

const filter = { urls: ["http://*/*", "https://*/*"] };

chrome.webRequest.onBeforeRequest.addListener((details) => {
  record({ kind: "started", ...base(details) });
}, filter);

chrome.webRequest.onBeforeRedirect.addListener((details) => {
  record({ kind: "redirected", redirectUrl: details.redirectUrl, ...base(details) });
}, filter);

chrome.webRequest.onCompleted.addListener((details) => {
  record({ kind: "completed", statusCode: details.statusCode, ...base(details) });
}, filter);

chrome.webRequest.onErrorOccurred.addListener((details) => {
  record({ kind: "failed", error: details.error, ...base(details) });
}, filter);

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (typeof message !== "object" || message === null || (message as { type?: unknown }).type !== "clear-requests") {
    return false;
  }

  const tabId = (message as { tabId?: unknown }).tabId;
  if (tabId !== undefined && (typeof tabId !== "number" || !Number.isInteger(tabId) || tabId < 0)) {
    sendResponse({ ok: false });
    return false;
  }

  writeQueue = writeQueue.then(async () => {
    if (tabId === undefined) {
      await chrome.storage.session.remove(REQUESTS_KEY);
      return;
    }
    const stored = await chrome.storage.session.get(REQUESTS_KEY);
    const requests = readRequests(stored[REQUESTS_KEY]).filter((request) => request.tabId !== tabId);
    await chrome.storage.session.set({ [REQUESTS_KEY]: requests });
  });
  writeQueue.then(
    () => sendResponse({ ok: true }),
    (error: unknown) => {
      console.error("Odinet: failed to clear the request log", error);
      sendResponse({ ok: false });
    },
  );
  writeQueue = writeQueue.catch(() => {});
  return true;
});
