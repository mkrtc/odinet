import { NETWORK_COLUMNS, compareEntries } from "./network/columns";
import { matchesFilter, timingPhases, type NetworkEntry, type ResourceGroup } from "./network/model";
import { DevtoolsNetworkSource, PANEL_REQUEST_LIMIT } from "./network/source";
import { element, required } from "./ui/dom";
import { bytes, milliseconds, t } from "./ui/i18n";
import { DETAIL_TABS, type DetailTabId } from "./ui/request-details";
import { isRussianLocale } from "./shared/localization";

const table = required<HTMLTableElement>("#network-table");
const tableBody = required<HTMLTableSectionElement>("#network-rows");
const tableHead = required<HTMLTableRowElement>("#network-columns");
const colgroup = required<HTMLTableColElement>("#column-widths");
const scroller = required<HTMLDivElement>("#table-scroll");
const workspace = required<HTMLDivElement>("#workspace");
const details = required<HTMLElement>("#request-details");
const content = required<HTMLDivElement>("#detail-content");
const tabs = required<HTMLDivElement>("#detail-tabs");
const empty = required<HTMLDivElement>("#empty-state");
const filter = required<HTMLInputElement>("#filter");
const summary = required<HTMLElement>("#summary");
const notice = required<HTMLElement>("#notice");
const recordButton = required<HTMLButtonElement>("#record");
const clearButton = required<HTMLButtonElement>("#clear");
const columnsMenu = required<HTMLDetailsElement>("#columns-menu");
const splitter = required<HTMLDivElement>("#splitter");
const tabId = chrome.devtools.inspectedWindow.tabId;

document.documentElement.lang = isRussianLocale(chrome.i18n.getUILanguage()) ? "ru" : "en";
document.title = t("extensionName");
const setTheme = (theme: string): void => { document.documentElement.dataset.theme = theme === "dark" ? "dark" : "light"; };
setTheme(chrome.devtools.panels.themeName);
chrome.devtools.panels.setThemeChangeHandler(setTheme);
for (const node of document.querySelectorAll<HTMLElement>("[data-i18n]")) node.textContent = t(node.dataset.i18n ?? "");
for (const [selector, label] of [["#clear", "clear"], ["#close-details", "closeDetails"], ["#columns-toggle", "columns"], ["#splitter", "resizeDetails"]]) {
  const node = required<HTMLElement>(selector ?? "");
  node.title = t(label ?? "");
  node.setAttribute("aria-label", t(label ?? ""));
}
table.setAttribute("aria-label", t("requestListLabel"));
required<HTMLElement>("#network-toolbar").setAttribute("aria-label", t("networkControls"));
tabs.setAttribute("aria-label", t("requestDetails"));
details.setAttribute("aria-label", t("requestDetails"));
filter.placeholder = t("filterRequests");
filter.setAttribute("aria-label", t("filterRequests"));

let entries: readonly NetworkEntry[] = [];
let visible: NetworkEntry[] = [];
let group: ResourceGroup = "all";
let sortId = "";
let sortDirection = 1;
let selectedId: string | null = null;
let activeTab: DetailTabId = "headers";
let renderedEntry: NetworkEntry | null = null;
let detailAbort = new AbortController();
let renderTimer: ReturnType<typeof setTimeout> | undefined;
const rows = new Map<string, HTMLTableRowElement>();
const renderedRows = new Map<string, NetworkEntry>();
const waterfallBars = new Map<string, { node: HTMLSpanElement; start: number; duration: number }[]>();
const hiddenColumns = new Set<string>();
const columnWidths = new Map(NETWORK_COLUMNS.map((column) => [column.id, column.width]));
const filterButtons = new Map<ResourceGroup, HTMLButtonElement>();

const source = new DevtoolsNetworkSource((next) => {
  entries = next;
  if (renderTimer === undefined) renderTimer = setTimeout(() => {
    renderTimer = undefined;
    render();
  }, 50);
}, (error) => {
  notice.hidden = false;
  notice.textContent = t("readError");
  console.error("Odinet: failed to read DevTools requests", error);
});

function selectRequest(id: string, focus = false): void {
  selectedId = id;
  workspace.classList.add("has-selection");
  details.hidden = false;
  splitter.hidden = false;
  updateColumns();
  updateSelection();
  renderDetails();
  if (focus) rows.get(id)?.focus({ preventScroll: true });
}

function closeDetails(): void {
  const previous = selectedId;
  const restoreFocus = details.contains(document.activeElement);
  selectedId = null;
  renderedEntry = null;
  detailAbort.abort();
  workspace.classList.remove("has-selection");
  details.hidden = true;
  splitter.hidden = true;
  content.replaceChildren();
  updateColumns();
  updateSelection();
  if (previous && restoreFocus) rows.get(previous)?.focus();
}

function updateSelection(): void {
  for (const [id, row] of rows) {
    row.setAttribute("aria-selected", String(id === selectedId));
    row.tabIndex = id === selectedId || (!selectedId && id === visible[0]?.id) ? 0 : -1;
  }
}

function renderDetails(): void {
  const entry = entries.find((item) => item.id === selectedId);
  if (!entry) { closeDetails(); return; }
  const tab = DETAIL_TABS.find((item) => item.id === activeTab);
  if (!tab) return;
  renderedEntry = entry;
  detailAbort.abort();
  detailAbort = new AbortController();
  content.replaceChildren(tab.render({ entry, readContent: (id) => source.readContent(id), signal: detailAbort.signal }));
  const name = required<HTMLElement>("#selected-request");
  const method = element("span", "http-method", entry.method);
  method.dataset.method = entry.method;
  name.replaceChildren(method, element("span", "selected-name", entry.name));
  name.title = entry.url;
  content.setAttribute("aria-labelledby", `detail-tab-${tab.id}`);
  for (const node of tabs.querySelectorAll<HTMLButtonElement>("button")) {
    const active = node.id === `detail-tab-${tab.id}`;
    node.setAttribute("aria-selected", String(active));
    node.tabIndex = active ? 0 : -1;
  }
}

function updateColumns(): void {
  let width = 0;
  for (const column of NETWORK_COLUMNS) {
    const hidden = hiddenColumns.has(column.id) || (selectedId !== null && !column.compact);
    for (const node of table.querySelectorAll<HTMLElement>(`[data-column="${column.id}"]`)) node.hidden = hidden;
    if (!hidden) width += columnWidths.get(column.id) ?? column.width;
  }
  table.style.width = `${width}px`;
}

for (const column of NETWORK_COLUMNS) {
  const col = element("col");
  col.dataset.column = column.id;
  col.style.width = `${column.width}px`;
  colgroup.append(col);
  const th = element("th");
  th.scope = "col";
  th.dataset.column = column.id;
  const button = element("button", "sort-button", t(column.label));
  button.type = "button";
  button.addEventListener("click", () => {
    sortDirection = sortId === column.id ? -sortDirection : 1;
    sortId = column.id;
    render();
  });
  const grip = element("span", "column-grip");
  grip.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = columnWidths.get(column.id) ?? column.width;
    grip.setPointerCapture(event.pointerId);
    const move = (next: PointerEvent): void => {
      const width = Math.min(800, Math.max(55, startWidth + next.clientX - startX));
      columnWidths.set(column.id, width);
      col.style.width = `${width}px`;
      updateColumns();
    };
    const stop = (): void => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("lostpointercapture", stop);
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("lostpointercapture", stop);
  });
  th.append(button, grip);
  tableHead.append(th);

  const label = element("label", "column-option");
  const input = element("input");
  input.type = "checkbox";
  input.checked = true;
  input.disabled = column.id === "name";
  input.addEventListener("change", () => {
    if (input.checked) hiddenColumns.delete(column.id); else hiddenColumns.add(column.id);
    updateColumns();
  });
  label.append(input, document.createTextNode(t(column.label)));
  required<HTMLElement>("#column-options").append(label);
}

tableHead.addEventListener("contextmenu", (event) => {
  event.preventDefault(); columnsMenu.open = true;
  required<HTMLElement>("#columns-toggle").focus();
});
document.addEventListener("pointerdown", (event) => {
  if (event.target instanceof Node && !columnsMenu.contains(event.target)) columnsMenu.open = false;
});

for (const id of ["all", "fetch", "document", "stylesheet", "script", "font", "image", "media", "other"] as const) {
  const button = element("button", "type-filter", t(`filter_${id}`));
  button.type = "button";
  button.setAttribute("aria-pressed", String(id === group));
  button.addEventListener("click", () => {
    group = id;
    for (const [key, item] of filterButtons) item.setAttribute("aria-pressed", String(key === group));
    scroller.scrollTop = 0;
    render();
  });
  filterButtons.set(id, button);
  required<HTMLElement>("#type-filters").append(button);
}
required<HTMLElement>("#type-filters").setAttribute("aria-label", t("resourceTypes"));

for (const tab of DETAIL_TABS) {
  const button = element("button", "detail-tab", t(tab.label));
  button.type = "button";
  button.id = `detail-tab-${tab.id}`;
  button.role = "tab";
  button.setAttribute("aria-controls", "detail-content");
  button.addEventListener("click", () => { activeTab = tab.id; renderDetails(); });
  button.addEventListener("keydown", (event) => {
    const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!direction && !["Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = DETAIL_TABS.findIndex((item) => item.id === activeTab);
    const next = DETAIL_TABS[event.key === "Home" ? 0 : event.key === "End" ? DETAIL_TABS.length - 1 : (index + direction + DETAIL_TABS.length) % DETAIL_TABS.length];
    if (next) { activeTab = next.id; renderDetails(); required<HTMLElement>(`#detail-tab-${next.id}`).focus(); }
  });
  tabs.append(button);
}

function render(): void {
  const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 25;
  const column = NETWORK_COLUMNS.find((item) => item.id === sortId);
  visible = entries.filter((entry) => matchesFilter(entry, filter.value, group)).sort((a, b) => compareEntries(a, b, column, sortDirection));
  if (selectedId && !visible.some((entry) => entry.id === selectedId)) closeDetails();
  const first = Math.min(...entries.map((entry) => entry.startedAt));
  const end = Math.max(...entries.map((entry) => entry.startedAt + (entry.duration ?? 0)));
  const span = Math.max(1, end - first);
  const fragment = document.createDocumentFragment();
  const ids = new Set(visible.map((entry) => entry.id));
  for (const [id] of rows) if (!ids.has(id)) {
    rows.delete(id); renderedRows.delete(id); waterfallBars.delete(id);
  }
  for (const entry of visible) {
    let row = rows.get(entry.id);
    if (!row) {
      row = element("tr");
      row.dataset.id = entry.id;
      row.addEventListener("click", () => selectRequest(entry.id));
      rows.set(entry.id, row);
    }
    row.classList.toggle("request-error", entry.state === "failed" || entry.status >= 400);
    if (renderedRows.get(entry.id) !== entry) {
      const cells = document.createDocumentFragment();
      for (const descriptor of NETWORK_COLUMNS) {
        const cell = element("td", `cell-${descriptor.id}`);
        cell.dataset.column = descriptor.id;
        cell.hidden = hiddenColumns.has(descriptor.id) || (selectedId !== null && !descriptor.compact);
        const value = descriptor.value(entry);
        cell.title = descriptor.id === "name" ? entry.url : descriptor.id === "initiator" ? entry.initiator : descriptor.id === "status" && entry.error ? entry.error : value;
        if (descriptor.id === "method") {
          const method = element("span", "http-method", value);
          method.dataset.method = value;
          cell.append(method);
        } else if (descriptor.id === "waterfall") {
          const track = element("div", "waterfall-track");
          const bars = [];
          for (const phase of timingPhases(entry.har).filter((item) => item.key !== "ssl")) {
            const bar = element("span", `waterfall-bar phase-${phase.key}`);
            bars.push({ node: bar, start: phase.start, duration: phase.duration });
            track.append(bar);
          }
          waterfallBars.set(entry.id, bars);
          cell.append(track);
        } else cell.textContent = value;
        cells.append(cell);
        }
      row.replaceChildren(cells);
      renderedRows.set(entry.id, entry);
    }
    const offset = entry.startedAt - first;
    for (const bar of waterfallBars.get(entry.id) ?? []) {
      bar.node.style.left = `${Math.max(0, (offset + bar.start) / span * 100)}%`;
      bar.node.style.width = `${Math.min(100, Math.max(0.4, bar.duration / span * 100))}%`;
    }
    const waterfall = row.querySelector<HTMLTableCellElement>(".cell-waterfall");
    if (waterfall) waterfall.title = `${milliseconds(entry.duration)} · ${t("startedAt")}: ${milliseconds(offset)}`;
    fragment.append(row);
  }
  tableBody.replaceChildren(fragment);
  updateSelection();
  if (selectedId && entries.find((entry) => entry.id === selectedId) !== renderedEntry) renderDetails();
  for (const th of tableHead.querySelectorAll("th")) {
    th.setAttribute("aria-sort", th.dataset.column === sortId ? sortDirection > 0 ? "ascending" : "descending" : "none");
  }
  empty.hidden = visible.length > 0;
  required<HTMLElement>("#empty-title").textContent = t(entries.length ? "noMatchingRequests" : source.recording ? "recordingActivity" : "recordingPaused");
  required<HTMLElement>("#empty-description").textContent = t(entries.length ? "changeFilters" : "reloadToCapture");
  required<HTMLButtonElement>("#reload").hidden = entries.length > 0;
  const transfer = entries.reduce((sum, entry) => sum + (entry.transferSize ?? 0), 0);
  const resources = entries.reduce((sum, entry) => sum + (entry.resourceSize ?? 0), 0);
  summary.textContent = `${t("requestCount", [String(visible.length), String(entries.length)])}  |  ${t("transferSummary", bytes(transfer))}  |  ${t("resourceSummary", bytes(resources))}`;
  if (entries.length === PANEL_REQUEST_LIMIT) summary.textContent += `  |  ${t("historyLimit", String(PANEL_REQUEST_LIMIT))}`;
  if (atBottom && !selectedId && !filter.value && !sortId) scroller.scrollTop = scroller.scrollHeight;
}

tableBody.addEventListener("keydown", (event) => {
  if (!["ArrowUp", "ArrowDown", "Home", "End", "Enter", " "].includes(event.key)) return;
  event.preventDefault();
  const index = visible.findIndex((entry) => entry.id === selectedId);
  const next = visible[event.key === "Home" ? 0 : event.key === "End" ? visible.length - 1
    : event.key === "ArrowDown" ? Math.min(visible.length - 1, index + 1) : event.key === "ArrowUp" ? Math.max(0, index - 1) : Math.max(0, index)];
  if (next) { selectRequest(next.id, true); rows.get(next.id)?.scrollIntoView({ block: "nearest" }); }
});
filter.addEventListener("input", () => { scroller.scrollTop = 0; render(); });
required<HTMLButtonElement>("#close-details").addEventListener("click", closeDetails);
required<HTMLButtonElement>("#reload").addEventListener("click", () => chrome.devtools.inspectedWindow.reload());
required<HTMLInputElement>("#preserve").addEventListener("change", (event) => { source.preserveLog = (event.currentTarget as HTMLInputElement).checked; });
function updateRecordButton(): void {
  recordButton.setAttribute("aria-pressed", String(source.recording));
  recordButton.title = t(source.recording ? "stopRecording" : "startRecording");
  recordButton.setAttribute("aria-label", recordButton.title);
}
recordButton.addEventListener("click", () => { source.recording = !source.recording; updateRecordButton(); render(); });
updateRecordButton();
clearButton.addEventListener("click", async () => {
  source.clear();
  notice.hidden = true;
  clearButton.disabled = true;
  try {
    const result: unknown = await chrome.runtime.sendMessage({ type: "clear-requests", tabId });
    if (typeof result !== "object" || result === null || !(result as { ok?: unknown }).ok) throw new Error("Background clear operation failed");
  } catch (error) {
    notice.hidden = false;
    notice.textContent = t("clearError");
    console.error("Odinet: failed to clear background requests", error);
  } finally { clearButton.disabled = false; }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") { columnsMenu.open = false; if (selectedId) { event.preventDefault(); closeDetails(); } }
  if ((event.ctrlKey || event.metaKey) && event.key === "f") { event.preventDefault(); filter.focus(); filter.select(); }
});

let splitPercent = 42;
function resizeSplit(value: number): void {
  splitPercent = Math.max(25, Math.min(75, value));
  workspace.style.setProperty("--split-size", `${splitPercent}%`);
  splitter.setAttribute("aria-valuenow", String(Math.round(splitPercent)));
}
splitter.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  splitter.setPointerCapture(event.pointerId);
  const move = (next: PointerEvent): void => {
    const bounds = workspace.getBoundingClientRect();
    resizeSplit(bounds.width <= 760 ? (next.clientY - bounds.top) / bounds.height * 100 : (next.clientX - bounds.left) / bounds.width * 100);
  };
  const stop = (): void => { splitter.removeEventListener("pointermove", move); splitter.removeEventListener("lostpointercapture", stop); };
  splitter.addEventListener("pointermove", move);
  splitter.addEventListener("lostpointercapture", stop);
});
splitter.addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  resizeSplit(event.key === "Home" ? 25 : event.key === "End" ? 75 : splitPercent + (["ArrowRight", "ArrowDown"].includes(event.key) ? 2 : -2));
});
const observer = new ResizeObserver(() => splitter.setAttribute("aria-orientation", workspace.clientWidth <= 760 ? "horizontal" : "vertical"));
observer.observe(workspace);
window.addEventListener("pagehide", () => {
  if (renderTimer !== undefined) clearTimeout(renderTimer);
  observer.disconnect(); detailAbort.abort(); source.dispose();
}, { once: true });
updateColumns();
source.start();
