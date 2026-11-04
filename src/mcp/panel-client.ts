import { BRIDGE_PROTOCOL, commandMessage, MAX_CONCURRENT_READS, MAX_WIRE_BYTES, TOKEN_PATTERN, welcomeMessage } from "./protocol";
import { NetworkReadError, readNetwork, type NetworkReader } from "./reader";

export type ConnectionState = "disconnected" | "connecting" | "connected" | "retrying" | "failed";

export class PanelBridgeClient {
  private socket: WebSocket | null = null;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private handshake: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;
  private attempts = 0;
  private enabled = false;

  constructor(private readonly tabId: number, private readonly reader: NetworkReader, private readonly onState: (state: ConnectionState) => void) {}

  connect(port: number, token: string): void {
    if (!Number.isInteger(port) || port < 1024 || port > 65535 || !TOKEN_PATTERN.test(token)) throw new Error("Invalid MCP bridge configuration.");
    this.disconnect(); this.enabled = true; this.attempts = 0;
    this.open(port, token);
  }

  private open(port: number, token: string): void {
    const generation = ++this.generation;
    this.onState(this.attempts ? "retrying" : "connecting");
    let welcomed = false;
    let inflight = 0;
    let socket: WebSocket;
    try { socket = new WebSocket(`ws://127.0.0.1:${port}/bridge`, [BRIDGE_PROTOCOL, `odinet.token.${token}`]); }
    catch { this.enabled = false; this.onState("failed"); return; }
    this.socket = socket;
    const current = (): boolean => this.enabled && generation === this.generation && socket === this.socket;
    const send = (data: unknown): void => {
      if (!current() || socket.readyState !== WebSocket.OPEN) return;
      const text = JSON.stringify(data);
      if (new TextEncoder().encode(text).length > MAX_WIRE_BYTES) throw new Error("MCP result exceeds bridge limit. Request a smaller page.");
      socket.send(text);
    };
    this.handshake = setTimeout(() => { if (current() && !welcomed) socket.close(4000, "Handshake timed out"); }, 5000);
    socket.onopen = () => { if (current()) send({ type: "hello", tabId: this.tabId }); };
    socket.onmessage = (event: MessageEvent<unknown>) => {
      if (!current()) return;
      try {
        if (typeof event.data !== "string" || event.data.length > 16_384) throw new Error("Invalid MCP bridge command.");
        const raw: unknown = JSON.parse(event.data);
        if (!welcomed) {
          welcomeMessage.parse(raw); welcomed = true; this.attempts = 0; clearTimeout(this.handshake); this.onState("connected"); return;
        }
        const { id, command } = commandMessage.parse(raw);
        if (inflight >= MAX_CONCURRENT_READS) { send({ type: "result", id, ok: false, error: "Too many concurrent reads." }); return; }
        inflight++;
        void readNetwork(this.reader, command).then((data) => send({ type: "result", id, ok: true, data }))
          .catch((error: unknown) => send({ type: "result", id, ok: false, error: error instanceof NetworkReadError ? error.message : "Recorded data could not be read or exceeds the export limit. List requests again or reduce the page size." }))
          .catch(() => { if (current()) socket.close(1011, "Bridge result unavailable"); })
          .finally(() => { inflight--; });
      } catch { socket.close(1008, "Invalid MCP bridge message"); }
    };
    socket.onerror = () => { /* onclose owns retry and visible error state; browser errors contain no portable details. */ };
    socket.onclose = (event) => {
      if (!current()) return;
      clearTimeout(this.handshake); this.socket = null;
      if (event.code === 1008 || ++this.attempts > 8) { this.enabled = false; this.onState("failed"); return; }
      this.onState("retrying");
      this.retry = setTimeout(() => { if (this.enabled && generation === this.generation) this.open(port, token); }, Math.min(250 * 2 ** this.attempts, 10_000));
    };
  }

  disconnect(): void {
    this.enabled = false; this.generation++; clearTimeout(this.retry); clearTimeout(this.handshake);
    this.socket?.close(1000, "User disconnected"); this.socket = null; this.onState("disconnected");
  }
}
