import { requestIdentity, normalizeEntry, type NetworkEntry } from "./model";

export const PANEL_REQUEST_LIMIT = 1000;
export const CONTENT_LIMIT = 2 * 1024 * 1024;
export interface ResponseContent { content: string; encoding: string; truncated: boolean }

export class DevtoolsNetworkSource {
  private entries: NetworkEntry[] = [];
  private readonly requests = new Map<string, chrome.devtools.network.Request>();
  private readonly contentCache = new Map<string, Promise<ResponseContent>>();
  private readonly snapshotEntries = new Map<string, string[]>();
  private buffered: chrome.devtools.network.Request[] | null = null;
  private snapshotTimer: ReturnType<typeof setTimeout> | undefined;
  private epoch = 0;
  private sequence = 0;
  recording = true;
  preserveLog = false;

  constructor(
    private readonly onChange: (entries: readonly NetworkEntry[]) => void,
    private readonly onError: (error: unknown) => void,
    private readonly api = chrome.devtools.network,
  ) {}

  private readonly finished = (request: chrome.devtools.network.Request): void => {
    if (!this.recording || !/^https?:\/\//i.test(request.request.url)) return;
    if (this.buffered) {
      this.buffered.push(request);
      if (this.buffered.length > PANEL_REQUEST_LIMIT) this.buffered.shift();
      return;
    }
    this.append([request]);
  };

  private readonly navigated = (): void => {
    if (!this.preserveLog && this.recording) this.synchronize();
  };

  start(): void {
    this.api.onRequestFinished.addListener(this.finished);
    this.api.onNavigated.addListener(this.navigated);
    this.synchronize();
  }

  dispose(): void {
    this.api.onRequestFinished.removeListener(this.finished);
    this.api.onNavigated.removeListener(this.navigated);
    this.reset();
  }

  private reset(): void {
    this.epoch++;
    if (this.snapshotTimer !== undefined) clearTimeout(this.snapshotTimer);
    this.buffered = null;
    this.entries = [];
    this.requests.clear();
    this.contentCache.clear();
    this.snapshotEntries.clear();
  }

  clear(): void {
    this.reset();
    this.onChange(this.entries);
  }

  private synchronize(): void {
    this.clear();
    const epoch = this.epoch;
    this.buffered = [];
    this.snapshotTimer = setTimeout(() => {
      if (epoch !== this.epoch || this.buffered === null) return;
      const buffered = this.buffered;
      this.buffered = null;
      this.append(buffered);
      this.onError(new Error("DevTools HAR snapshot timed out"));
    }, 10000);
    try {
      this.api.getHAR((log) => {
        if (epoch !== this.epoch) return;
        if (this.snapshotTimer !== undefined) clearTimeout(this.snapshotTimer);
        if (epoch !== this.epoch || this.buffered === null) return;
        const buffered = this.buffered;
        this.buffered = null;
        if (chrome.runtime.lastError) {
          this.append(buffered);
          this.onError(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!log || !Array.isArray(log.entries)) {
          this.append(buffered);
          this.onError(new Error("DevTools returned an invalid HAR snapshot"));
          return;
        }
        this.append(log.entries as chrome.devtools.network.Request[], true);
        this.append(buffered);
      });
    } catch (error) {
      if (this.snapshotTimer !== undefined) clearTimeout(this.snapshotTimer);
      const buffered = this.buffered;
      this.buffered = null;
      this.append(buffered ?? []);
      this.onError(error);
    }
  }

  private append(requests: readonly chrome.devtools.network.Request[], fromSnapshot = false): void {
    for (const request of requests) {
      if (!request?.request || typeof request.request.url !== "string" || !request.response?.content || !request.timings) {
        this.onError(new Error("DevTools returned an invalid HAR entry"));
        continue;
      }
      if (!/^https?:\/\//i.test(request.request.url)) continue;
      const key = requestIdentity(request);
      const matching = !fromSnapshot ? this.snapshotEntries.get(key)?.shift() : undefined;
      const id = matching ?? `har-${++this.sequence}`;
      const entry = normalizeEntry(request, id);
      if (fromSnapshot) {
        const ids = this.snapshotEntries.get(key) ?? [];
        ids.push(id);
        this.snapshotEntries.set(key, ids);
        const error = (request as unknown as { _error?: unknown })._error;
        if (!entry.status && !error) entry.state = "pending";
      }
      const index = matching ? this.entries.findIndex((item) => item.id === matching) : -1;
      if (index >= 0) this.entries[index] = entry;
      else this.entries.push(entry);
      this.requests.set(id, request);
      if (matching) this.contentCache.delete(id);
    }
    const removed = this.entries.splice(0, Math.max(0, this.entries.length - PANEL_REQUEST_LIMIT));
    for (const entry of removed) {
      this.requests.delete(entry.id);
      this.contentCache.delete(entry.id);
      const key = requestIdentity(entry.har);
      const pending = this.snapshotEntries.get(key)?.filter((id) => id !== entry.id);
      if (pending?.length) this.snapshotEntries.set(key, pending);
      else this.snapshotEntries.delete(key);
    }
    this.onChange([...this.entries]);
  }

  readContent(id: string): Promise<ResponseContent> {
    const cached = this.contentCache.get(id);
    if (cached) return cached;
    const request = this.requests.get(id);
    if (!request || typeof request.getContent !== "function") return Promise.reject(new Error("Response content is unavailable"));
    const content = new Promise<ResponseContent>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Response content request timed out")), 10000);
      try {
        request.getContent((body, encoding) => {
          clearTimeout(timeout);
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (typeof body !== "string") {
            reject(new Error("The browser did not return response content"));
          } else {
            resolve({ content: body.slice(0, CONTENT_LIMIT), encoding, truncated: body.length > CONTENT_LIMIT });
          }
        });
      } catch (error) { clearTimeout(timeout); reject(error); }
    });
    this.contentCache.set(id, content);
    while (this.contentCache.size > 4) {
      const oldest = this.contentCache.keys().next().value;
      if (oldest !== undefined) this.contentCache.delete(oldest);
    }
    void content.catch(() => {
      if (this.contentCache.get(id) === content) this.contentCache.delete(id);
    });
    return content;
  }
}
