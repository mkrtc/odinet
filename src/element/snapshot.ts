export interface ElementResource { url: string; kind: "image" | "background" | "media" | "frame" }
export interface ElementSnapshot {
  label: string;
  pageUrl: string;
  capturedAt: number;
  documentStartedAt: number;
  locale: string;
  resources: ElementResource[];
  samples: string[];
  visited: number;
  limited: boolean;
}

// Serialized into inspectedWindow.eval. Keep this function independent of module state.
export function collectElement(candidate: unknown): ElementSnapshot | null {
  let root = candidate as Element | null;
  if (root?.nodeType === 3) root = root.parentElement;
  if (root?.nodeType !== 1 || !root.isConnected) return null;
  const document = root.ownerDocument;
  const view = document.defaultView;
  if (!view) return null;
  const resources: ElementResource[] = [];
  const samples = new Set<string>();
  const urls = new Set<string>();
  let limited = false;
  const addSample = (input: string): void => {
    const value = input.replace(/\s+/g, " ").trim();
    if (!value || value.length > 160 || (value.length < 8 && !/\d/.test(value))) return;
    if (samples.size < 80) samples.add(value); else limited = true;
  };
  const addAggregate = (item: Element): void => {
    if (item.childElementCount > 4 || item.childNodes.length > 16 || !("innerText" in item)) return;
    for (const child of item.children) {
      if (child.childElementCount || child.childNodes.length > 16 || ["input", "textarea", "select", "script", "style", "template", "noscript"].includes(child.localName)) return;
    }
    // Only join shallow, small text fragments; never flatten an arbitrary subtree or form.
    addSample(String(item.innerText).slice(0, 1000));
  };
  const addResource = (input: string, kind: ElementResource["kind"]): void => {
    if (!input || input.length > 8192 || input.trim().startsWith("#")) return;
    try {
      const url = new URL(input, document.baseURI);
      if (!/^https?:$/.test(url.protocol)) return;
      url.hash = "";
      if (urls.has(url.href)) return;
      if (resources.length >= 300) { limited = true; return; }
      urls.add(url.href);
      resources.push({ url: url.href, kind });
      addSample(url.href);
    } catch { /* Ignore malformed or non-network resource URLs. */ }
  };
  const stack: Node[] = [root];
  let visited = 0;
  let styles = 0;
  while (stack.length && visited < 1500) {
    const node = stack.pop();
    if (!node) break;
    visited++;
    if (node.nodeType === 3) {
      // Never read form values, scripts, styles or hidden text as rendering evidence.
      const parent = node.parentElement;
      if (parent && !parent.closest("script,style,noscript,template,textarea,input,select,[hidden],[aria-hidden=true]")) {
        if (view.getComputedStyle(parent).visibility !== "hidden" && parent.getClientRects().length) {
          addSample((node.nodeValue ?? "").slice(0, 1000));
          // Number and currency often live in separate spans or text nodes.
          addAggregate(parent);
        }
      }
      continue;
    }
    if (node.nodeType !== 1 && node.nodeType !== 11) continue;
    if (node.nodeType === 1) {
      const item = node as Element;
      if (item.hasAttribute("data-odinet-picker")) continue;
      const tag = item.localName;
      if (["script", "style", "noscript", "template", "input", "textarea", "select"].includes(tag)) continue;
      if (tag === "img") addResource((item as HTMLImageElement).currentSrc || item.getAttribute("src") || "", "image");
      if (tag === "image") addResource(item.getAttribute("href") || item.getAttribute("xlink:href") || "", "image");
      if (tag === "video" || tag === "audio") {
        addResource((item as HTMLMediaElement).currentSrc, "media");
        if (tag === "video") addResource(item.getAttribute("poster") || "", "image");
      }
      if (tag === "iframe") addResource(item.getAttribute("src") || "", "frame");
      for (let i = 0; i < Math.min(item.attributes.length, 40); i++) {
        const attribute = item.attributes.item(i);
        if (!attribute) continue;
        if (["alt", "title", "aria-label", "href"].includes(attribute.name) || attribute.name.startsWith("data-")) addSample(attribute.value);
      }
      if (styles++ < 200) {
        for (const pseudo of [null, "::before", "::after"]) {
          const style = view.getComputedStyle(item, pseudo);
          if (pseudo === null && item.childElementCount > 0 && item.childElementCount <= 4 && "innerText" in item
            && style.visibility !== "hidden" && item.getClientRects().length && !item.closest("[hidden],[aria-hidden=true]")) {
            addAggregate(item);
          }
          for (const image of [style.backgroundImage, style.listStyleImage, style.content]) {
            if (image.length > 32768) { limited = true; continue; }
            for (const match of image.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/g)) addResource(match[1] ?? match[2] ?? match[3] ?? "", "background");
          }
        }
      } else limited = true;
      if (item.shadowRoot) stack.push(item.shadowRoot);
    }
    // Bound both the traversal and its queue for exceptionally wide DOM subtrees.
    for (let child = node.lastChild; child; child = child.previousSibling) {
      if (stack.length >= 1500) { limited = true; break; }
      stack.push(child);
    }
  }
  let name = root.localName + (root.id ? `#${root.id.slice(0, 240)}` : "");
  for (let i = 0; i < Math.min(root.classList.length, 3); i++) name += `.${(root.classList.item(i) ?? "").slice(0, 80)}`;
  const locale = (root.closest("[lang]")?.getAttribute("lang") || document.documentElement.lang || view.navigator.language || "en").slice(0, 64);
  return { label: name.slice(0, 240), pageUrl: document.URL, capturedAt: Date.now(), documentStartedAt: view.performance.timeOrigin, locale, resources, samples: [...samples], visited, limited: limited || stack.length > 0 };
}

export function readElementSnapshot(value: unknown): ElementSnapshot | null {
  if (value === null) return null;
  if (typeof value !== "object" || !value) throw new Error("Invalid element snapshot");
  const data = value as Record<string, unknown>;
  if (typeof data.label !== "string" || data.label.length > 240 || typeof data.pageUrl !== "string" || data.pageUrl.length > 16384
    || typeof data.capturedAt !== "number" || !Number.isFinite(data.capturedAt) || typeof data.visited !== "number" || !Number.isInteger(data.visited) || data.visited < 0 || data.visited > 1500
    || typeof data.documentStartedAt !== "number" || !Number.isFinite(data.documentStartedAt) || data.documentStartedAt > data.capturedAt
    || typeof data.locale !== "string" || !data.locale || data.locale.length > 64
    || typeof data.limited !== "boolean" || !Array.isArray(data.resources) || data.resources.length > 300 || !Array.isArray(data.samples) || data.samples.length > 80) throw new Error("Invalid element snapshot");
  const resources: ElementResource[] = data.resources.map((item: unknown) => {
    if (typeof item !== "object" || !item) throw new Error("Invalid element resource");
    const resource = item as Record<string, unknown>;
    if (typeof resource.url !== "string" || resource.url.length > 8192 || !/^https?:\/\//.test(resource.url)
      || !["image", "background", "media", "frame"].includes(String(resource.kind))) throw new Error("Invalid element resource");
    return { url: resource.url, kind: resource.kind as ElementResource["kind"] };
  });
  const samples: string[] = data.samples.map((sample: unknown) => {
    if (typeof sample !== "string" || !sample || sample.length > 160 || (sample.length < 8 && !/\d/.test(sample))) throw new Error("Invalid element text sample");
    return sample;
  });
  return { label: data.label, pageUrl: data.pageUrl, capturedAt: data.capturedAt, documentStartedAt: data.documentStartedAt, locale: data.locale, resources, samples, visited: data.visited, limited: data.limited };
}
