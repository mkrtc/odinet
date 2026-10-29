export const REQUESTS_KEY = "requests";
export const MAX_REQUESTS = 200;
const MAX_TEXT_LENGTH = 4096;

export type RequestState = "pending" | "redirected" | "completed" | "failed";

export interface RequestRecord {
  id: string;
  url: string;
  method: string;
  resourceType: string;
  tabId: number;
  initiator: string | null;
  startedAt: number;
  updatedAt: number;
  finishedAt: number | null;
  state: RequestState;
  statusCode: number | null;
  error: string | null;
  redirects: string[];
}

interface EventBase {
  requestId: string;
  url: string;
  method: string;
  type: string;
  tabId: number;
  initiator: string | null;
  timeStamp: number;
}

export type RequestEvent =
  | (EventBase & { kind: "started" })
  | (EventBase & { kind: "redirected"; redirectUrl: string })
  | (EventBase & { kind: "completed"; statusCode: number })
  | (EventBase & { kind: "failed"; error: string });

function short(value: string): string {
  return value.length <= MAX_TEXT_LENGTH ? value : `${value.slice(0, MAX_TEXT_LENGTH - 1)}…`;
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function isRequestRecord(value: unknown): value is RequestRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<RequestRecord>;
  return typeof record.id === "string"
    && typeof record.url === "string"
    && typeof record.method === "string"
    && typeof record.resourceType === "string"
    && typeof record.tabId === "number"
    && (record.initiator === null || typeof record.initiator === "string")
    && typeof record.startedAt === "number"
    && typeof record.updatedAt === "number"
    && (record.finishedAt === null || typeof record.finishedAt === "number")
    && ["pending", "redirected", "completed", "failed"].includes(record.state ?? "")
    && (record.statusCode === null || typeof record.statusCode === "number")
    && (record.error === null || typeof record.error === "string")
    && Array.isArray(record.redirects)
    && record.redirects.every((url) => typeof url === "string");
}

export function readRequests(value: unknown): RequestRecord[] {
  return Array.isArray(value) ? value.filter(isRequestRecord).slice(0, MAX_REQUESTS) : [];
}

export function applyRequestEvent(records: readonly RequestRecord[], event: RequestEvent): RequestRecord[] {
  if (!isHttpUrl(event.url)) return [...records];

  const index = records.findIndex((record) => record.id === event.requestId);
  const existing = index >= 0 ? records[index] : undefined;
  const time = Number.isFinite(event.timeStamp) ? event.timeStamp : Date.now();
  const base: RequestRecord = existing ?? {
    id: event.requestId,
    url: short(event.url),
    method: short(event.method),
    resourceType: short(event.type),
    tabId: event.tabId,
    initiator: event.initiator === null ? null : short(event.initiator),
    startedAt: time,
    updatedAt: time,
    finishedAt: null,
    state: "pending",
    statusCode: null,
    error: null,
    redirects: [],
  };

  let next: RequestRecord;
  switch (event.kind) {
    case "started":
      next = { ...base, url: short(event.url), updatedAt: time, state: "pending" };
      break;
    case "redirected":
      next = {
        ...base,
        url: isHttpUrl(event.redirectUrl) ? short(event.redirectUrl) : short(event.url),
        redirects: [...base.redirects, short(event.url)].slice(-20),
        updatedAt: time,
        state: "redirected",
      };
      break;
    case "completed":
      next = {
        ...base,
        url: short(event.url),
        updatedAt: time,
        finishedAt: time,
        state: "completed",
        statusCode: event.statusCode,
      };
      break;
    case "failed":
      next = {
        ...base,
        url: short(event.url),
        updatedAt: time,
        finishedAt: time,
        state: "failed",
        error: short(event.error),
      };
      break;
  }

  const other = index >= 0 ? records.filter((record) => record.id !== event.requestId) : records;
  return [next, ...other].slice(0, MAX_REQUESTS);
}
