import { timingSafeEqual } from "node:crypto";
import type { ServerWebSocket } from "bun";
import { BRIDGE_PROTOCOL, helloMessage, MAX_CONCURRENT_READS, MAX_WIRE_BYTES, replyMessage, type BridgeCommand } from "./protocol";
import type { BridgeConfig } from "./config";

interface SocketData { id: string }
interface Pending { resolve: (data: unknown) => void; reject: (error: Error) => void; cleanup: () => void }
interface Session {
  socket: ServerWebSocket<SocketData>;
  tabId: number | null;
  connectedAt: string;
  handshakeTimer: ReturnType<typeof setTimeout>;
  pending: Map<string, Pending>;
}

export function startBridge(config: BridgeConfig, timeoutMs = 12_000) {
  const sessions = new Map<string, Session>();
  const forget = (id: string): void => {
    const session = sessions.get(id);
    if (!session) return;
    clearTimeout(session.handshakeTimer);
    for (const pending of session.pending.values()) { pending.cleanup(); pending.reject(new Error("Odinet panel disconnected. Reconnect it and list sessions again.")); }
    sessions.delete(id);
  };
  const server = Bun.serve<SocketData>({
    hostname: "127.0.0.1", port: config.port, maxRequestBodySize: 0,
    fetch(request, server) {
      const url = new URL(request.url);
      const origin = request.headers.get("origin") || "";
      const protocols = (request.headers.get("sec-websocket-protocol") || "").split(",").map((value) => value.trim());
      const offered = protocols.find((value) => value.startsWith("odinet.token."))?.slice("odinet.token.".length) || "";
      const token = Buffer.from(offered);
      const expected = Buffer.from(config.token);
      const authorized = token.length === expected.length && timingSafeEqual(token, expected);
      if (request.headers.get("host") !== `127.0.0.1:${server.port}` || !/^chrome-extension:\/\/[a-p]{32}$/.test(origin) ||
          request.method !== "GET" || url.pathname !== "/bridge" || url.search || !protocols.includes(BRIDGE_PROTOCOL) || !authorized) {
        return new Response("Forbidden", { status: 403 });
      }
      if (sessions.size >= 16) return new Response("Too many Odinet panels", { status: 503 });
      if (server.upgrade(request, { data: { id: crypto.randomUUID() }, headers: { "Sec-WebSocket-Protocol": BRIDGE_PROTOCOL } })) return;
      return new Response("WebSocket upgrade required", { status: 426 });
    },
    websocket: {
      maxPayloadLength: MAX_WIRE_BYTES, idleTimeout: 60, sendPings: true, backpressureLimit: MAX_WIRE_BYTES,
      closeOnBackpressureLimit: true,
      open(socket) {
        const handshakeTimer = setTimeout(() => socket.close(1008, "Handshake timed out"), 5000);
        sessions.set(socket.data.id, { socket, tabId: null, connectedAt: new Date().toISOString(), handshakeTimer, pending: new Map() });
      },
      message(socket, raw) {
        const session = sessions.get(socket.data.id);
        if (!session) return;
        try {
          if (typeof raw !== "string") throw new Error("Expected text");
          const data: unknown = JSON.parse(raw);
          if (session.tabId === null) {
            const hello = helloMessage.parse(data);
            clearTimeout(session.handshakeTimer); session.tabId = hello.tabId;
            socket.send(JSON.stringify({ type: "welcome", sessionId: socket.data.id }));
            return;
          }
          const result = replyMessage.parse(data);
          const pending = session.pending.get(result.id);
          if (!pending) return; // Late results after a timeout carry no authority.
          pending.cleanup();
          if (result.ok) pending.resolve(result.data);
          else pending.reject(new Error(result.error));
        } catch { socket.close(1008, "Invalid bridge message"); forget(socket.data.id); }
      },
      close(socket) { forget(socket.data.id); },
    },
  });
  return {
    port: server.port,
    listSessions: () => [...sessions].filter(([, session]) => session.tabId !== null).map(([id, session]) => ({
      id, tabId: session.tabId, connectedAt: session.connectedAt,
    })),
    call(sessionId: string, command: BridgeCommand, signal?: AbortSignal): Promise<unknown> {
      if (signal?.aborted) return Promise.reject(new Error("MCP read cancelled."));
      const session = sessions.get(sessionId);
      if (!session || session.tabId === null) return Promise.reject(new Error("No connected Odinet session. Open Odinet DevTools and connect MCP for the desired tab."));
      if (session.pending.size >= MAX_CONCURRENT_READS) return Promise.reject(new Error("Too many concurrent reads for this panel. Retry after current reads complete."));
      return new Promise((resolve, reject) => {
        const id = crypto.randomUUID();
        const cleanup = (): void => { clearTimeout(timer); session.pending.delete(id); signal?.removeEventListener("abort", abort); };
        const abort = (): void => { cleanup(); reject(new Error("MCP read cancelled.")); };
        const timer = setTimeout(() => { cleanup(); reject(new Error("Odinet panel timed out. Check that DevTools is still open.")); }, timeoutMs);
        session.pending.set(id, { resolve, reject, cleanup });
        signal?.addEventListener("abort", abort, { once: true });
        try {
          if (session.socket.send(JSON.stringify({ type: "command", id, command })) === 0) throw new Error("Odinet bridge could not send the command.");
        } catch (error) {
          cleanup(); reject(error);
        }
      });
    },
    stop() { for (const id of [...sessions.keys()]) { sessions.get(id)?.socket.close(1001, "MCP server stopped"); forget(id); } server.stop(true); },
  };
}
export type Bridge = ReturnType<typeof startBridge>;
