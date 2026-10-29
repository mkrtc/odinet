import { readRequests, REQUESTS_KEY, type RequestRecord } from "./shared/requests";

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Odinet: отсутствует элемент ${selector}`);
  return element;
}

const list = requiredElement<HTMLOListElement>("#requests");
const message = requiredElement<HTMLParagraphElement>("#message");
const clearButton = requiredElement<HTMLButtonElement>("#clear");

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
      ? record.error ?? "Ошибка"
      : record.state === "completed" && record.statusCode !== null
        ? String(record.statusCode)
        : record.state === "redirected" ? "Редирект" : "Ожидание";
    if (record.state === "failed") state.className = "failed";
    tab.textContent = record.tabId >= 0 ? `Вкладка ${record.tabId}` : "Без вкладки";
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
  const word = count % 100 >= 11 && count % 100 <= 14
    ? "запросов"
    : count % 10 === 1 ? "запрос" : count % 10 >= 2 && count % 10 <= 4 ? "запроса" : "запросов";
  message.textContent = records.length === 0
    ? "Пока нет запросов. Откройте сайт в другой вкладке."
    : `Последние ${count} ${word} · новые сверху`;
}

let latestRead = 0;
async function refresh(): Promise<void> {
  const readId = ++latestRead;
  try {
    const stored = await chrome.storage.session.get(REQUESTS_KEY);
    if (readId === latestRead) render(readRequests(stored[REQUESTS_KEY]));
  } catch (error) {
    if (readId === latestRead) message.textContent = "Не удалось прочитать журнал запросов.";
    console.error("Odinet: ошибка чтения журнала", error);
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
    const result: unknown = await chrome.runtime.sendMessage({ type: "clear-requests" });
    if (typeof result !== "object" || result === null || (result as { ok?: unknown }).ok !== true) {
      throw new Error("Фоновый обработчик не подтвердил очистку");
    }
    await refresh();
  } catch (error) {
    message.textContent = "Не удалось очистить журнал запросов.";
    console.error("Odinet: ошибка очистки журнала", error);
  } finally {
    clearButton.disabled = false;
  }
});

void refresh();
