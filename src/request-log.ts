import { readRequests, REQUESTS_KEY, type RequestRecord } from "./shared/requests";
import { isRussianLocale, requestCountMessageKey } from "./shared/localization";

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Odinet: required UI element is missing: ${selector}`);
  return element;
}

const list = requiredElement<HTMLOListElement>("#requests");
const statusMessage = requiredElement<HTMLParagraphElement>("#message");
const clearButton = requiredElement<HTMLButtonElement>("#clear");
const locale = chrome.i18n.getUILanguage();

function localized(key: string, substitution?: string): string {
  return chrome.i18n.getMessage(key, substitution) || key;
}

document.documentElement.lang = isRussianLocale(locale) ? "ru" : "en";
document.title = localized("extensionName");
requiredElement<HTMLParagraphElement>("#subtitle").textContent = localized("popupSubtitle");
clearButton.textContent = localized("clear");
list.setAttribute("aria-label", localized("requestListLabel"));
statusMessage.textContent = localized("loading");

function render(records: readonly RequestRecord[]): void {
  const fragment = document.createDocumentFragment();

  for (const record of records) {
    const item = document.createElement("li");
    const meta = document.createElement("div");
    const method = document.createElement("span");
    const state = document.createElement("span");
    const tab = document.createElement("span");
    const type = document.createElement("span");
    const url = document.createElement("div");

    meta.className = "meta";
    method.className = "method";
    method.textContent = record.method;
    state.textContent = record.state === "failed"
      ? record.error ?? localized("failed")
      : record.state === "completed" && record.statusCode !== null
        ? String(record.statusCode)
        : record.state === "redirected" ? localized("redirected") : localized("pending");
    if (record.state === "failed") state.className = "failed";
    tab.textContent = record.tabId >= 0 ? localized("tab", String(record.tabId)) : localized("noTab");
    type.textContent = record.resourceType;
    url.className = "url";
    url.textContent = record.url;
    url.title = record.url;

    meta.append(method, state, type, tab);
    item.append(meta, url);
    fragment.append(item);
  }

  list.replaceChildren(fragment);
  const count = records.length;
  statusMessage.textContent = count === 0
    ? localized("noRequests")
    : localized(requestCountMessageKey(count, locale), String(count));
}

let latestRead = 0;
async function refresh(): Promise<void> {
  const readId = ++latestRead;
  try {
    const stored = await chrome.storage.session.get(REQUESTS_KEY);
    const requests = readRequests(stored[REQUESTS_KEY]);
    if (readId === latestRead) {
      render(requests);
    }
  } catch (error) {
    if (readId === latestRead) statusMessage.textContent = localized("readError");
    console.error("Odinet: failed to read the request log", error);
  }
}

let refreshTimer: ReturnType<typeof setTimeout> | undefined;
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "session" || !(REQUESTS_KEY in changes)) return;
  if (refreshTimer !== undefined) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => { void refresh(); }, 100);
});

clearButton.addEventListener("click", async () => {
  clearButton.disabled = true;
  try {
    const result: unknown = await chrome.runtime.sendMessage({
      type: "clear-requests",
    });
    if (typeof result !== "object" || result === null || (result as { ok?: unknown }).ok !== true) {
      throw new Error("Background worker did not confirm the clear operation");
    }
    await refresh();
  } catch (error) {
    statusMessage.textContent = localized("clearError");
    console.error("Odinet: failed to clear the request log", error);
  } finally {
    clearButton.disabled = false;
  }
});

void refresh();
