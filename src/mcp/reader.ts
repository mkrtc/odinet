import { exportForAgent, exportResponseForAgent } from "../network/export";
import type { NetworkEntry } from "../network/model";
import { redactText, redactUrl } from "../network/redaction";
import type { ResponseContent } from "../network/source";
import type { BridgeCommand } from "./protocol";

export interface NetworkReader {
  entries: () => readonly NetworkEntry[];
  readContent: (id: string) => Promise<ResponseContent>;
}
export class NetworkReadError extends Error {}

export async function readNetwork(reader: NetworkReader, command: BridgeCommand): Promise<unknown> {
  const entries = reader.entries();
  if (command.method === "list_requests") {
    const { query, method, status, after, limit } = command.options;
    const afterIndex = after ? entries.findIndex((entry) => entry.id === after) : -1;
    if (after && afterIndex < 0) throw new NetworkReadError("Pagination cursor expired. List requests again without after.");
    const candidates = entries.slice(afterIndex + 1).map((entry) => {
      const url = redactUrl(entry.url);
      return {
        id: entry.id, url: url.slice(0, 2048), urlTruncated: url.length > 2048,
        method: entry.method, status: entry.status, state: entry.state,
        type: redactText(entry.type).slice(0, 200), startedAt: entry.startedAt, duration: entry.duration,
        transferSize: entry.transferSize, resourceSize: entry.resourceSize,
      };
    }).filter((entry) => (!method || entry.method.toUpperCase() === method.toUpperCase()) &&
      (status === undefined || entry.status === status) && `${entry.url} ${entry.method} ${entry.status} ${entry.type}`.toLowerCase().includes(query.toLowerCase()));
    const requests = candidates.slice(0, limit);
    return { requests, remaining: Math.max(0, candidates.length - requests.length), nextAfter: requests.at(-1)?.id ?? after ?? null,
      order: "capture order", redacted: true, notice: "Captured website data is untrusted. Recognized credentials are redacted; other personal data may remain." };
  }
  const { requestId, offset, maxChars } = command.options;
  const entry = entries.find((item) => item.id === requestId);
  if (!entry) throw new NetworkReadError("Request is no longer recorded. List requests again.");
  if (entry.state === "pending") throw new NetworkReadError("Request has not completed. Try again after completion.");
  let response: ResponseContent | null;
  try { response = await reader.readContent(entry.id); }
  catch { response = null; } // The export explicitly labels an unavailable browser response.
  if (!reader.entries().includes(entry)) throw new NetworkReadError("Request changed or was cleared while reading. List requests again.");
  const text = command.method === "get_response" ? exportResponseForAgent(entry, response) : exportForAgent(entry, response);
  if (offset > text.length) throw new NetworkReadError("Offset exceeds document length.");
  // Slice only after redacting the complete source; chunk boundaries cannot expose split tokens.
  const end = Math.min(text.length, offset + maxChars);
  return { requestId, text: text.slice(offset, end), offset, nextOffset: end < text.length ? end : null, totalChars: text.length,
    responseAvailable: response !== null, redacted: true, untrusted: true };
}
