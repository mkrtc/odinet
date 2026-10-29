import type { NetworkEntry } from "./model";
import { bytes, milliseconds, t } from "../ui/i18n";

export interface NetworkColumn {
  id: string;
  label: string;
  width: number;
  compact?: boolean;
  value: (entry: NetworkEntry) => string;
  sort: (entry: NetworkEntry) => string | number;
}

function initiatorLabel(value: string): string {
  try { return new URL(value).pathname.split("/").at(-1) || value; } catch { return value || "\u2014"; }
}

export const NETWORK_COLUMNS: readonly NetworkColumn[] = [
  { id: "name", label: "columnName", width: 210, compact: true, value: (e) => e.name, sort: (e) => e.name },
  { id: "method", label: "columnMethod", width: 72, value: (e) => e.method, sort: (e) => e.method },
  { id: "host", label: "columnHost", width: 165, value: (e) => e.host, sort: (e) => e.host },
  { id: "path", label: "columnPath", width: 230, value: (e) => e.path, sort: (e) => e.path },
  { id: "status", label: "columnStatus", width: 74, compact: true, value: (e) => e.status ? String(e.status) : t(e.state === "pending" ? "pending" : "failed"), sort: (e) => e.status },
  { id: "type", label: "columnType", width: 100, compact: true, value: (e) => e.type, sort: (e) => e.type },
  { id: "initiator", label: "columnInitiator", width: 140, value: (e) => initiatorLabel(e.initiator), sort: (e) => e.initiator },
  { id: "size", label: "columnSize", width: 86, value: (e) => bytes(e.transferSize), sort: (e) => e.transferSize ?? -1 },
  { id: "time", label: "columnTime", width: 83, compact: true, value: (e) => milliseconds(e.duration), sort: (e) => e.duration ?? -1 },
  { id: "waterfall", label: "columnWaterfall", width: 190, value: () => "", sort: (e) => e.startedAt },
];

export function compareEntries(a: NetworkEntry, b: NetworkEntry, column: NetworkColumn | undefined, direction: number): number {
  const av = column?.sort(a) ?? a.startedAt;
  const bv = column?.sort(b) ?? b.startedAt;
  const comparison = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
  return (comparison || a.startedAt - b.startedAt || a.id.localeCompare(b.id, undefined, { numeric: true })) * direction;
}
