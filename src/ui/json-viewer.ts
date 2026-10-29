import { createScanner, SyntaxKind } from "jsonc-parser";
import { element } from "./dom";
import { t } from "./i18n";
import { childAt, formattedJson, isContainer, jsonPath, parentValue, rawValue, searchJson, type JsonDocument, type JsonNode } from "./json-document";

const PAGE_SIZE = 100;
const ROW_LIMIT = 2500;

function button(label: string, action: () => void, className = "json-button"): HTMLButtonElement {
  const node = element("button", className, t(label));
  node.type = "button";
  node.addEventListener("click", action);
  return node;
}

function highlightSource(source: string): HTMLElement {
  const pre = element("pre", "json-source");
  pre.tabIndex = 0;
  const scanner = createScanner(source, false);
  let end = 0;
  let tokens = 0;
  for (let token = scanner.scan(); token !== SyntaxKind.EOF && tokens < 10000; token = scanner.scan()) {
    const start = scanner.getTokenOffset();
    const length = scanner.getTokenLength();
    if (start > end) pre.append(document.createTextNode(source.slice(end, start)));
    const value = source.slice(start, start + length);
    let kind = "punctuation";
    if (token === SyntaxKind.StringLiteral) {
      let next = start + length;
      while (/\s/.test(source.charAt(next)) && next < source.length) next++;
      kind = source.charAt(next) === ":" ? "key" : "string";
    } else if (token === SyntaxKind.NumericLiteral) kind = "number";
    else if ([SyntaxKind.TrueKeyword, SyntaxKind.FalseKeyword].includes(token)) kind = "boolean";
    else if (token === SyntaxKind.NullKeyword) kind = "null";
    pre.append(element("span", `json-token-${kind}`, value));
    end = start + length;
    tokens++;
  }
  if (end < source.length) pre.append(document.createTextNode(source.slice(end)));
  return pre;
}

export function createJsonViewer(data: JsonDocument, signal: AbortSignal, initialMode: "tree" | "text" = "tree"): HTMLElement {
  const viewer = element("div", "json-viewer");
  const toolbar = element("div", "json-toolbar");
  const modes = element("div", "json-modes");
  modes.role = "group";
  modes.setAttribute("aria-label", t("jsonViewMode"));
  const search = element("input", "json-search");
  search.type = "search";
  search.placeholder = t("jsonSearch");
  search.setAttribute("aria-label", t("jsonSearch"));
  const count = element("span", "json-match-count");
  count.setAttribute("aria-live", "polite");
  const pathbar = element("div", "json-pathbar");
  const path = element("span", "json-path", "$");
  const body = element("div", "json-body");
  const status = element("div", "json-status");
  status.role = "status";
  status.hidden = true;
  const fallback = element("textarea", "json-copy-fallback");
  fallback.readOnly = true;
  fallback.setAttribute("aria-label", t("jsonCopyManual"));
  fallback.hidden = true;

  let mode = initialMode;
  let selected = data.root;
  let pretty: ReturnType<typeof formattedJson> | undefined;
  let searchAbort = new AbortController();
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let matches: JsonNode[] = [];
  let matchIndex = -1;
  let limitedMatches = false;
  const expanded = new Set<number>([data.root.offset]);
  const pages = new Map<number, number>();
  const rendered = new Map<number, { node: JsonNode; row: HTMLElement; item: HTMLElement }>();
  const initial = [{ node: data.root, depth: 0 }];
  while (initial.length) {
    const item = initial.pop();
    if (!item || item.depth > 2 || item.node.type !== "object" || (item.node.children?.length ?? 0) > 8) continue;
    expanded.add(item.node.offset);
    for (let i = 0; i < (item.node.children?.length ?? 0); i++) {
      const child = childAt(item.node, i);
      if (child) initial.push({ node: child.node, depth: item.depth + 1 });
    }
  }

  function message(text: string): void { status.hidden = !text; status.textContent = text; }
  function selectedText(): string { return formattedJson(rawValue(data, selected)).text; }
  async function copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      if (!signal.aborted) { fallback.hidden = true; message(t("jsonCopied")); }
    } catch (error) {
      if (signal.aborted) return;
      fallback.hidden = false;
      fallback.value = text;
      fallback.focus(); fallback.select();
      message(t("jsonCopyManual"));
      console.error("Odinet: clipboard write failed", error);
    }
  }

  function select(node: JsonNode, focus = false): void {
    selected = node;
    const value = jsonPath(node);
    path.textContent = value;
    path.title = value;
    for (const item of rendered.values()) {
      const active = item.node === node;
      item.item.setAttribute("aria-selected", String(active));
      item.item.tabIndex = active ? 0 : -1;
    }
    if (focus) rendered.get(node.offset)?.item.focus({ preventScroll: true });
  }

  function nodePreview(node: JsonNode): string {
    if (!isContainer(node)) return rawValue(data, node);
    const parts: string[] = [];
    for (let i = 0; i < Math.min(3, node.children?.length ?? 0); i++) {
      const child = childAt(node, i);
      if (!child) continue;
      const value = isContainer(child.node) ? child.node.type === "array" ? "[…]" : "{…}" : rawValue(data, child.node);
      parts.push(`${node.type === "object" ? `${child.key}: ` : ""}${value.slice(0, 45)}${value.length > 45 ? "…" : ""}`);
    }
    return parts.join(", ").slice(0, 140);
  }

  function tree(): HTMLElement {
    const root = element("div", "json-tree");
    root.role = "tree";
    root.setAttribute("aria-label", t("jsonTree"));
    let rows = 0;
    let limitReached = false;
    const renderNode = (node: JsonNode, key: string, depth: number, index: number, siblings: number): HTMLElement => {
      const item = element("div", "json-item");
      item.role = "treeitem";
      item.setAttribute("aria-level", String(depth + 1));
      item.setAttribute("aria-posinset", String(index + 1));
      item.setAttribute("aria-setsize", String(siblings));
      const row = element("div", "json-row");
      row.style.setProperty("--json-depth", String(depth));
      const container = isContainer(node) && (node.children?.length ?? 0) > 0;
      const open = container && expanded.has(node.offset);
      const toggle = element("span", "json-chevron", container ? open ? "▾" : "▸" : "");
      toggle.setAttribute("aria-hidden", "true");
      if (container) item.setAttribute("aria-expanded", String(open));
      if (container) toggle.addEventListener("click", (event) => { event.stopPropagation(); toggleNode(node); });
      row.append(toggle);
      if (node !== data.root) {
        const label = element("span", "json-token-key", key);
        const parent = parentValue(node);
        if (parent?.type === "array") label.className = "json-array-index";
        row.append(label, element("span", "json-colon", ": "));
      }
      if (isContainer(node)) {
        const size = node.children?.length ?? 0;
        row.append(element("span", "json-container-type", node.type === "array" ? `[${size}]` : `{${size}}`));
        if (!open && size) row.append(element("span", "json-inline-preview", nodePreview(node)));
      } else {
        const raw = rawValue(data, node);
        const value = element("span", `json-token-${node.type}`, raw.length > 240 ? `${raw.slice(0, 240)}…` : raw);
        row.append(value);
        if (raw.length > 240) row.append(button("jsonShowValue", () => { value.textContent = raw; row.classList.add("json-full-value"); }, "json-inline-button"));
      }
      row.classList.toggle("json-match", matches.includes(node));
      row.classList.toggle("json-current-match", matches[matchIndex] === node);
      item.setAttribute("aria-label", `${key} ${isContainer(node) ? node.type : rawValue(data, node).slice(0, 240)}`);
      row.addEventListener("click", () => select(node));
      row.addEventListener("dblclick", () => { if (container) toggleNode(node); });
      item.addEventListener("focus", () => select(node));
      item.append(row);
      rendered.set(node.offset, { node, row, item });
      rows++;
      if (open) {
        const children = element("div", "json-children");
        children.role = "group";
        const size = node.children?.length ?? 0;
        const page = pages.get(node.offset) ?? 0;
        for (let i = page * PAGE_SIZE; i < Math.min(size, (page + 1) * PAGE_SIZE); i++) {
          if (rows >= ROW_LIMIT || depth >= 64) { limitReached = true; break; }
          const child = childAt(node, i);
          if (child) children.append(renderNode(child.node, child.key, depth + 1, i, size));
        }
        if (size > PAGE_SIZE) {
          const pager = element("div", "json-pager");
          pager.style.paddingLeft = `${(depth + 1) * 18 + 12}px`;
          const previous = button("jsonPreviousPage", () => { pages.set(node.offset, Math.max(0, page - 1)); selected = node; render(); select(node, true); });
          const next = button("jsonNextPage", () => { pages.set(node.offset, page + 1); selected = node; render(); select(node, true); });
          previous.disabled = page === 0;
          next.disabled = (page + 1) * PAGE_SIZE >= size;
          pager.append(previous, element("span", "", t("jsonPageRange", [String(page * PAGE_SIZE + 1), String(Math.min(size, (page + 1) * PAGE_SIZE)), String(size)])), next);
          children.append(pager);
        }
        item.append(children);
      }
      return item;
    };
    root.append(renderNode(data.root, "$", 0, 0, 1));
    if (limitReached) root.append(element("p", "detail-note", t("jsonRenderLimit", String(ROW_LIMIT))));
    return root;
  }

  function toggleNode(node: JsonNode): void {
    if (expanded.has(node.offset)) expanded.delete(node.offset); else expanded.add(node.offset);
    selected = node;
    render(); select(node, true);
  }

  const treeButton = button("jsonTree", () => { mode = "tree"; render(); });
  const textButton = button("jsonText", () => { mode = "text"; render(); });
  const expand = button("jsonExpandLevel", () => {
    for (const { node } of rendered.values()) if (isContainer(node)) expanded.add(node.offset);
    render();
  });
  const collapse = button("jsonCollapse", () => { expanded.clear(); selected = data.root; render(); });
  const previous = button("jsonPreviousMatch", () => navigateMatch(-1), "json-button json-search-nav");
  const next = button("jsonNextMatch", () => navigateMatch(1), "json-button json-search-nav");
  previous.textContent = "↑"; previous.title = t("jsonPreviousMatch"); previous.setAttribute("aria-label", previous.title);
  next.textContent = "↓"; next.title = t("jsonNextMatch"); next.setAttribute("aria-label", next.title);
  modes.append(treeButton, textButton);
  toolbar.append(modes, expand, collapse, button("jsonCopyDocument", () => { pretty ??= formattedJson(data.source); void copy(pretty.text); }), search, count, previous, next);
  pathbar.append(path, button("jsonCopyValue", () => { void copy(selectedText()); }), button("jsonCopyPath", () => { void copy(jsonPath(selected)); }));
  viewer.append(toolbar, pathbar, status, fallback, body);

  function render(): void {
    const scrollTop = body.scrollTop;
    rendered.clear();
    treeButton.setAttribute("aria-pressed", String(mode === "tree"));
    textButton.setAttribute("aria-pressed", String(mode === "text"));
    expand.hidden = collapse.hidden = pathbar.hidden = mode === "text";
    body.replaceChildren();
    if (mode === "tree") {
      body.append(tree());
      if (!rendered.has(selected.offset)) selected = data.root;
      select(selected);
    } else {
      pretty ??= formattedJson(data.source);
      if (pretty.limited) body.append(element("p", "detail-note", t("jsonFormattingLimit")));
      body.append(highlightSource(pretty.text));
    }
    body.scrollTop = scrollTop;
  }

  function navigateMatch(direction: number): void {
    if (!matches.length) return;
    matchIndex = (matchIndex + direction + matches.length) % matches.length;
    const node = matches[matchIndex];
    if (!node) return;
    // Keep unrelated expansions from consuming the render budget before a match.
    expanded.clear();
    for (let current = node; ; ) {
      const parent = parentValue(current);
      if (!parent) break;
      expanded.add(parent.offset);
      const child = current.parent?.type === "property" ? current.parent : current;
      const index = parent.children?.indexOf(child) ?? 0;
      pages.set(parent.offset, Math.floor(Math.max(0, index) / PAGE_SIZE));
      current = parent;
    }
    selected = node;
    mode = "tree";
    render();
    rendered.get(node.offset)?.row.scrollIntoView({ block: "nearest" });
    count.textContent = t("jsonMatchCount", [String(matchIndex + 1), `${matches.length}${limitedMatches ? "+" : ""}`]);
  }

  async function runSearch(): Promise<void> {
    searchAbort.abort();
    searchAbort = new AbortController();
    const controller = searchAbort;
    count.textContent = search.value.trim() ? t("jsonSearching") : "";
    const result = await searchJson(data, search.value, controller.signal);
    if (controller.signal.aborted || signal.aborted) return;
    matches = result.matches; limitedMatches = result.limited; matchIndex = -1;
    previous.disabled = next.disabled = !matches.length;
    if (matches.length) navigateMatch(1);
    else { count.textContent = search.value.trim() ? t("jsonNoMatches") : ""; render(); }
  }
  search.addEventListener("input", () => {
    searchAbort.abort();
    if (searchTimer !== undefined) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { void runSearch(); }, 120);
  });
  search.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); navigateMatch(event.shiftKey ? -1 : 1); }
    if (event.key === "Escape" && search.value) {
      event.stopPropagation(); search.value = ""; void runSearch();
    }
  });
  body.addEventListener("keydown", (event) => {
    if (event.target instanceof Element && event.target.closest("button,input,textarea")) return;
    const current = rendered.get(selected.offset);
    if (!current || mode !== "tree") return;
    const list = [...rendered.values()];
    const index = list.findIndex((item) => item.node === selected);
    let target: JsonNode | undefined;
    if (event.key === "ArrowDown") target = list[Math.min(list.length - 1, index + 1)]?.node;
    else if (event.key === "ArrowUp") target = list[Math.max(0, index - 1)]?.node;
    else if (event.key === "Home") target = list[0]?.node;
    else if (event.key === "End") target = list.at(-1)?.node;
    else if (event.key === "ArrowRight" && isContainer(selected)) {
      if (!expanded.has(selected.offset)) toggleNode(selected);
      else target = list[index + 1]?.node;
    } else if (event.key === "ArrowLeft") {
      if (expanded.has(selected.offset) && isContainer(selected)) toggleNode(selected);
      else target = parentValue(selected);
    } else if ((event.key === "Enter" || event.key === " ") && isContainer(selected)) toggleNode(selected);
    else if ((event.metaKey || event.ctrlKey) && event.key === "c" && !window.getSelection()?.toString()) { void copy(selectedText()); }
    else return;
    event.preventDefault(); event.stopPropagation();
    if (target) { select(target, true); rendered.get(target.offset)?.row.scrollIntoView({ block: "nearest" }); }
  });
  viewer.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "f") {
      event.preventDefault(); event.stopPropagation(); search.focus(); search.select();
    }
  });
  signal.addEventListener("abort", () => {
    searchAbort.abort();
    if (searchTimer !== undefined) clearTimeout(searchTimer);
  }, { once: true });
  previous.disabled = next.disabled = true;
  render();
  return viewer;
}
