import type { NetworkEntry } from "../network/model";
import type { ResponseContent } from "../network/source";
import { isContainer, jsonPath, parseJsonDocument, walkJson } from "../ui/json-document";
import type { ElementResource, ElementSnapshot } from "./snapshot";

export type ElementRelation = { kind: "resource"; resource: ElementResource } | { kind: "data"; value: string; path: string };
export interface ScanResult { matches: Map<string, ElementRelation>; checked: number; unavailable: number; limited: boolean }
export const SCAN_REQUEST_LIMIT = 60;
export const SCAN_BODY_LIMIT = 256 * 1024;
const TOTAL_BODY_LIMIT = 4 * 1024 * 1024;

export function resourceRelation(snapshot: ElementSnapshot, entry: NetworkEntry): ElementRelation | undefined {
  // A reference proves association with a URL, not which repeated request supplied it.
  if (entry.startedAt < snapshot.documentStartedAt || entry.startedAt > snapshot.capturedAt) return undefined;
  try {
    const url = new URL(entry.url); url.hash = "";
    const resource = snapshot.resources.find((item) => item.url === url.href);
    return resource ? { kind: "resource", resource } : undefined;
  } catch { return undefined; }
}

export function dataRelation(snapshot: ElementSnapshot, source: string): ElementRelation | undefined {
  const document = parseJsonDocument(source);
  if (!document) return undefined;
  const samples = new Set(snapshot.samples.map((value) => value.replace(/\s+/g, " ").trim()));
  for (const { node } of walkJson(document.root)) {
    if (isContainer(node) || typeof node.value !== "string") continue;
    const value = node.value.replace(/\s+/g, " ").trim();
    if (samples.has(value)) return { kind: "data", value, path: jsonPath(node) };
  }
  return undefined;
}

function readForScan(id: string, readContent: (id: string) => Promise<ResponseContent>, signal: AbortSignal, timeout: number): Promise<ResponseContent> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error: Error | null, value?: ResponseContent): void => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal.removeEventListener("abort", cancel);
      if (error) reject(error); else if (value) resolve(value); else reject(new Error("Response content is unavailable"));
    };
    const cancel = (): void => finish(new Error("Element data scan cancelled"));
    const timer = setTimeout(() => finish(new Error("Element data scan response timed out")), timeout);
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) { cancel(); return; }
    const failed = (error: unknown): void => finish(error instanceof Error ? error : new Error("Response content is unavailable"));
    try { void readContent(id).then((value) => finish(null, value), failed); }
    catch (error) { failed(error); }
  });
}

export async function scanResponseData(snapshot: ElementSnapshot, entries: readonly NetworkEntry[], readContent: (id: string) => Promise<ResponseContent>, signal: AbortSignal, onProgress: (checked: number) => void = () => {}): Promise<ScanResult> {
  const candidates = entries.filter((entry) => entry.group === "fetch" && entry.state === "completed" && entry.startedAt >= snapshot.documentStartedAt && entry.startedAt + (entry.duration ?? 0) <= snapshot.capturedAt)
    .sort((a, b) => b.startedAt - a.startedAt);
  const result: ScanResult = { matches: new Map(), checked: 0, unavailable: 0, limited: candidates.length > SCAN_REQUEST_LIMIT };
  let total = 0;
  const deadline = Date.now() + 10000;
  if (!snapshot.samples.length) return result;
  for (const entry of candidates.slice(0, SCAN_REQUEST_LIMIT)) {
    if (signal.aborted) break;
    if (Date.now() > deadline) { result.limited = true; break; }
    if (entry.resourceSize !== null && entry.resourceSize > SCAN_BODY_LIMIT) { result.limited = true; continue; }
    try {
      const response = await readForScan(entry.id, readContent, signal, Math.min(1500, Math.max(1, deadline - Date.now())));
      if (signal.aborted) break;
      if (response.truncated || response.encoding || response.content.length > SCAN_BODY_LIMIT) { result.limited = true; continue; }
      total += response.content.length;
      if (total > TOTAL_BODY_LIMIT) { result.limited = true; break; }
      const relation = dataRelation(snapshot, response.content);
      if (relation) result.matches.set(entry.id, relation);
      result.checked++;
    } catch { if (!signal.aborted) result.unavailable++; }
    if (signal.aborted) break;
    onProgress(result.checked);
    // Let selection changes and cancellation interrupt long scans.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return result;
}
