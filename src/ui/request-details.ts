import { nonNegative, timingPhases, type NetworkEntry } from "../network/model";
import { CONTENT_LIMIT, type ResponseContent } from "../network/source";
import { element } from "./dom";
import { bytes, milliseconds, t } from "./i18n";
import { parseJsonDocument } from "./json-document";
import { createJsonViewer } from "./json-viewer";

export type DetailTabId = "headers" | "payload" | "preview" | "response" | "initiator" | "timing" | "cookies";
type ContentReader = (id: string) => Promise<ResponseContent>;
interface DetailContext { entry: NetworkEntry; readContent: ContentReader; signal: AbortSignal }
export interface DetailTab {
  id: DetailTabId;
  label: string;
  render: (context: DetailContext) => HTMLElement;
}

function note(message: string): HTMLParagraphElement {
  return element("p", "detail-note", t(message));
}

function section(title: string, rows: readonly (readonly [string, string])[]): HTMLDetailsElement {
  const group = element("details", "detail-section");
  group.open = true;
  group.append(element("summary", "", title));
  const list = element("dl", "key-values");
  for (const [name, value] of rows) list.append(element("dt", "", name), element("dd", "", value));
  group.append(list);
  if (!rows.length) group.append(note("noData"));
  return group;
}

function headers({ entry }: DetailContext): HTMLElement {
  const view = element("div");
  const har = entry.har;
  const rows: [string, string][] = [
    [t("requestUrl"), entry.url], [t("requestMethod"), entry.method],
    [t("statusCode"), `${entry.status || t(entry.state === "pending" ? "pending" : "failed")} ${har.response.statusText}`.trim()],
    [t("protocol"), har.response.httpVersion || har.request.httpVersion || "\u2014"],
  ];
  if (har.serverIPAddress) rows.push([t("remoteAddress"), har.serverIPAddress]);
  if (entry.error) rows.push([t("networkError"), entry.error]);
  if (har.response.redirectURL) rows.push([t("redirectUrl"), har.response.redirectURL]);
  view.append(section(t("general"), rows));
  view.append(section(t("responseHeaders"), har.response.headers.map((h) => [h.name, h.value])));
  view.append(section(t("requestHeaders"), har.request.headers.map((h) => [h.name, h.value])));
  return view;
}

function payload({ entry, signal }: DetailContext): HTMLElement {
  const view = element("div");
  const request = entry.har.request;
  if (request.queryString.length) view.append(section(t("queryParameters"), request.queryString.map((p) => [p.name, p.value])));
  const data = request.postData;
  if (data?.params?.length) view.append(section(t("formData"), data.params.map((p) => [p.name, p.value ?? p.fileName ?? ""])));
  if (data?.text) {
    const group = section(t("requestPayload"), [[t("contentType"), data.mimeType]]);
    if (data.text.length > CONTENT_LIMIT) group.append(note("contentTruncated"));
    const text = data.text.slice(0, CONTENT_LIMIT);
    const json = data.text.length <= CONTENT_LIMIT ? parseJsonDocument(text) : null;
    group.append(json ? createJsonViewer(json, signal, "text") : element("pre", "source-code", text));
    view.append(group);
  }
  if (!view.childElementCount) view.append(note("noPayload"));
  return view;
}

function contentView(context: DetailContext, preview: boolean): HTMLElement {
  const view = element("div", "response-view");
  const entry = context.entry;
  if ((entry.resourceSize ?? 0) > CONTENT_LIMIT) { view.append(note("responseTooLarge")); return view; }
  view.append(note("loading"));
  void context.readContent(entry.id).then((body) => {
    if (context.signal.aborted) return;
    view.replaceChildren();
    if (body.truncated) view.append(note("contentTruncated"));
    const mime = entry.har.response.content.mimeType.split(";")[0]?.toLowerCase() ?? "";
    if (preview && /^image\/(png|jpeg|gif|webp|avif)$/.test(mime) && body.encoding === "base64" && !body.truncated) {
      const image = element("img", "image-preview");
      image.alt = entry.name;
      image.src = `data:${mime};base64,${body.content}`;
      image.addEventListener("error", () => image.replaceWith(note("previewUnavailable")), { once: true });
      view.append(image);
      return;
    }
    let text = body.content;
    if (body.encoding === "base64") {
      if (!/^text\/|json|javascript|xml|svg|x-www-form-urlencoded/.test(mime)) {
        view.append(note("binaryResponse"));
        view.append(element("pre", "source-code", text));
        return;
      }
      const binary = atob(text);
      text = new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
    }
    const json = body.truncated ? null : parseJsonDocument(text);
    if (json) { view.append(createJsonViewer(json, context.signal, preview ? "tree" : "text")); return; }
    if (preview && mime.includes("html")) view.append(note("htmlSourcePreview"));
    const code = element("pre", "source-code", text);
    view.append(code);
    if (!text) view.append(note("emptyResponse"));
  }).catch((error: unknown) => {
    if (context.signal.aborted) return;
    view.replaceChildren(note("contentUnavailable"));
    console.error("Odinet: failed to load response content", error);
  });
  return view;
}

function initiator({ entry }: DetailContext): HTMLElement {
  const view = element("div");
  const extra = entry.har as unknown as { _initiator?: { type?: unknown; url?: unknown; stack?: { callFrames?: unknown } } };
  const raw = extra._initiator;
  const rows: [string, string][] = [];
  if (typeof raw?.type === "string") rows.push([t("columnType"), raw.type]);
  if (typeof raw?.url === "string") rows.push([t("requestUrl"), raw.url]);
  view.append(section(t("tabInitiator"), rows));
  if (Array.isArray(raw?.stack?.callFrames)) {
    const frames = raw.stack.callFrames.slice(0, 100);
    const stack: [string, string][] = [];
    for (const frame of frames) {
      if (typeof frame !== "object" || frame === null) continue;
      const { functionName, url, lineNumber } = frame as Record<string, unknown>;
      stack.push([typeof functionName === "string" && functionName ? functionName : t("anonymous"),
        `${typeof url === "string" ? url : ""}${typeof lineNumber === "number" ? `:${lineNumber + 1}` : ""}`]);
    }
    if (stack.length) view.append(section(t("callStack"), stack));
  }
  return view;
}

function timing({ entry }: DetailContext): HTMLElement {
  const view = element("div");
  const date = entry.startedAt ? new Date(entry.startedAt).toLocaleString(chrome.i18n.getUILanguage()) : "\u2014";
  view.append(section(t("general"), [[t("startedAt"), date], [t("duration"), milliseconds(entry.duration)]]));
  const table = element("div", "timing-table");
  const phases = timingPhases(entry.har);
  const total = Math.max(entry.duration ?? 0, ...phases.map((phase) => phase.start + phase.duration), 1);
  for (const phase of phases) {
    const row = element("div", "timing-row");
    const track = element("div", "timing-track");
    const bar = element("div", `timing-bar phase-${phase.key}`);
    bar.style.marginLeft = `${phase.start / total * 100}%`;
    bar.style.width = `${Math.max(0.5, phase.duration / total * 100)}%`;
    track.append(bar);
    row.append(element("span", "", t(`phase_${phase.key}`)), track, element("span", "numeric", milliseconds(phase.duration)));
    table.append(row);
  }
  view.append(table);
  if (nonNegative(entry.har.timings.ssl) !== null) view.append(note("sslIncluded"));
  view.append(section(t("sizes"), [[t("transferred"), bytes(entry.transferSize)], [t("resourceSize"), bytes(entry.resourceSize)]]));
  return view;
}

function cookies({ entry }: DetailContext): HTMLElement {
  const view = element("div");
  for (const [title, items] of [["requestCookies", entry.har.request.cookies], ["responseCookies", entry.har.response.cookies]] as const) {
    const group = section(t(title), []);
    if (items.length) {
      group.querySelector(".detail-note")?.remove();
      const table = element("table", "cookie-table");
      const head = element("tr");
      for (const key of ["cookieName", "cookieValue", "columnHost", "columnPath", "cookieExpires"]) head.append(element("th", "", t(key)));
      const thead = element("thead"); thead.append(head); table.append(thead);
      const tbody = element("tbody");
      for (const cookie of items) {
        const row = element("tr");
        for (const value of [cookie.name, cookie.value, cookie.domain ?? "", cookie.path ?? "", cookie.expires ?? ""]) row.append(element("td", "", value));
        tbody.append(row);
      }
      table.append(tbody); group.append(table);
    }
    view.append(group);
  }
  return view;
}

export const DETAIL_TABS: readonly DetailTab[] = [
  { id: "headers", label: "tabHeaders", render: headers },
  { id: "payload", label: "tabPayload", render: payload },
  { id: "preview", label: "tabPreview", render: (context) => contentView(context, true) },
  { id: "response", label: "tabResponse", render: (context) => contentView(context, false) },
  { id: "initiator", label: "tabInitiator", render: initiator },
  { id: "timing", label: "tabTiming", render: timing },
  { id: "cookies", label: "tabCookies", render: cookies },
];
