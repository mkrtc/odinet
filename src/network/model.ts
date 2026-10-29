export type HarEntry = Omit<chrome.devtools.network.Request, "getContent">;
export type ResourceGroup = "all" | "fetch" | "document" | "stylesheet" | "script" | "font" | "image" | "media" | "other";

export interface NetworkEntry {
  id: string;
  har: HarEntry;
  url: string;
  name: string;
  host: string;
  path: string;
  method: string;
  type: string;
  group: ResourceGroup;
  status: number;
  state: "pending" | "failed" | "completed";
  error: string | null;
  startedAt: number;
  duration: number | null;
  transferSize: number | null;
  resourceSize: number | null;
  initiator: string;
}

export function nonNegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function normalizeEntry(har: HarEntry, id: string): NetworkEntry {
  const url = har.request.url;
  let host = "";
  let path = url;
  let name = url;
  try {
    const parsed = new URL(url);
    host = parsed.host;
    path = parsed.pathname + parsed.search;
    name = parsed.pathname.split("/").filter(Boolean).at(-1) ?? parsed.host;
    if (parsed.search) name += parsed.search;
  } catch { /* Keep the original value if a URL cannot be parsed. */ }

  const mime = har.response.content.mimeType?.split(";")[0]?.toLowerCase() ?? "";
  const extra = har as HarEntry & { _resourceType?: unknown; _error?: unknown; _initiator?: { type?: unknown; url?: unknown; stack?: { callFrames?: unknown } } };
  const type = typeof extra._resourceType === "string" ? extra._resourceType : mime || "other";
  const group: ResourceGroup = ["fetch", "xhr"].includes(type) || mime.includes("json") ? "fetch"
    : type === "document" || mime.includes("html") ? "document"
    : type === "stylesheet" || mime.includes("css") ? "stylesheet"
    : type === "script" || /javascript|ecmascript/.test(mime) ? "script"
    : type === "font" || /font|woff/.test(mime) ? "font"
    : type === "image" || mime.startsWith("image/") ? "image"
    : type === "media" || /^(audio|video)\//.test(mime) ? "media" : "other";
  const bodySize = nonNegative(har.response.bodySize);
  const headerSize = nonNegative(har.response.headersSize);
  let initiator = typeof extra._initiator?.url === "string" ? extra._initiator.url
    : typeof extra._initiator?.type === "string" ? extra._initiator.type : "";
  if (Array.isArray(extra._initiator?.stack?.callFrames)) {
    const frame = extra._initiator.stack.callFrames.find((item: unknown) => typeof item === "object" && item !== null && typeof (item as { url?: unknown }).url === "string") as { url: string; lineNumber?: unknown } | undefined;
    if (frame) initiator = `${frame.url}${typeof frame.lineNumber === "number" ? `:${frame.lineNumber + 1}` : ""}`;
  }
  return {
    id, har, url, name, host, path, method: har.request.method, type, group,
    status: nonNegative(har.response.status) ?? 0,
    state: har.response.status > 0 ? "completed" : "failed",
    error: typeof extra._error === "string" ? extra._error : null,
    startedAt: Number.isFinite(Date.parse(har.startedDateTime)) ? Date.parse(har.startedDateTime) : 0,
    duration: nonNegative(har.time),
    transferSize: nonNegative(har.response._transferSize) ?? (bodySize !== null && headerSize !== null ? bodySize + headerSize : null),
    resourceSize: nonNegative(har.response.content.size),
    initiator,
  };
}

export function requestIdentity(entry: HarEntry): string {
  return JSON.stringify([entry.startedDateTime, entry.request.method, entry.request.url]);
}

export function matchesFilter(entry: NetworkEntry, text: string, group: ResourceGroup): boolean {
  if (group !== "all" && entry.group !== group) return false;
  const haystack = `${entry.url} ${entry.method} ${entry.status} ${entry.type}`.toLowerCase();
  return text.toLowerCase().trim().split(/\s+/).every((part) => haystack.includes(part));
}

export interface TimingPhase { key: string; start: number; duration: number }
export function timingPhases(entry: HarEntry): TimingPhase[] {
  let offset = 0;
  const phases: TimingPhase[] = [];
  for (const key of ["blocked", "dns", "connect", "send", "wait", "receive"] as const) {
    const duration = nonNegative(entry.timings[key]);
    if (duration === null) continue;
    phases.push({ key, start: offset, duration });
    const tls = nonNegative(entry.timings.ssl);
    if (key === "connect" && tls !== null) {
      phases.push({ key: "ssl", start: offset + Math.max(0, duration - tls), duration: Math.min(tls, duration) });
    }
    offset += duration;
  }
  return phases;
}
