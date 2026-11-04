import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { startBridge } from "../src/mcp/broker";
import { loadConfig } from "../src/mcp/config";
import { BRIDGE_PROTOCOL, commandMessage, commandSchema, helloMessage, listOptions, readOptions } from "../src/mcp/protocol";
import { readNetwork, type NetworkReader } from "../src/mcp/reader";
import { normalizeEntry, type NetworkEntry } from "../src/network/model";
import { harRequest } from "./fixtures/har";

const token = "a".repeat(64);
const origin = `chrome-extension://${"a".repeat(32)}`;

function fixture() {
  const har = harRequest("https://user:pass@example.test/api?access_token=query-secret&tag=keep");
  har.request.headers = [{ name: "Authorization", value: "Bearer request-secret" }, { name: "Cookie", value: "session=cookie-secret" }];
  har.response.headers = [{ name: "Set-Cookie", value: "session=response-cookie" }];
  const entry = normalizeEntry(har, "har-1");
  let entries: readonly NetworkEntry[] = [entry];
  let body = '{"id":900719925474099312345,"token":"response-secret","data":"' + "x".repeat(1000) + '"}';
  const reader: NetworkReader = { entries: () => entries, readContent: async () => ({ content: body, encoding: "", truncated: false }) };
  return { reader, entry, setEntries(value: readonly NetworkEntry[]) { entries = value; }, setBody(value: string) { body = value; } };
}

async function peer(port: number, handler?: (command: unknown) => unknown) {
  // The DOM lib hides Bun's header-enabled overload needed to simulate an extension origin.
  const TestWebSocket = WebSocket as unknown as new (url: string, options: Bun.WebSocketOptions) => WebSocket;
  const socket = new TestWebSocket(`ws://127.0.0.1:${port}/bridge`, { protocols: [BRIDGE_PROTOCOL, `odinet.token.${token}`], headers: { Origin: origin } });
  const welcome = await new Promise<{ sessionId: string }>((resolve, reject) => {
    socket.onopen = () => socket.send(JSON.stringify({ type: "hello", tabId: 7 }));
    socket.onerror = () => reject(new Error("Test peer connection failed"));
    socket.onmessage = (event) => {
      const data = JSON.parse(String(event.data));
      if (data.type === "welcome") resolve(data);
    };
  });
  socket.onmessage = (event) => {
    const message = commandMessage.parse(JSON.parse(String(event.data)));
    if (handler) socket.send(JSON.stringify({ type: "result", id: message.id, ok: true, data: handler(message.command) }));
  };
  return { socket, id: welcome.sessionId };
}

describe("MCP network reader", () => {
  it("lists only bounded redacted metadata, supports filters and a stable cursor", async () => {
    const { reader, entry, setEntries } = fixture();
    setEntries([entry, { ...entry, id: "har-2", method: "POST", status: 403 }]);
    const first = await readNetwork(reader, { method: "list_requests", options: listOptions.parse({ limit: 1 }) });
    const text = JSON.stringify(first);
    expect(text).toContain('"nextAfter":"har-1"');
    for (const secret of ["query-secret", "user:pass", "request-secret", "cookie-secret", "response-secret"]) expect(text).not.toContain(secret);
    expect(text).not.toContain("headers"); expect(text).toContain("tag=keep");
    const second = await readNetwork(reader, { method: "list_requests", options: listOptions.parse({ after: "har-1", method: "POST", status: 403 }) });
    expect(JSON.stringify(second)).toContain('"id":"har-2"');
    expect(JSON.stringify(second)).not.toContain('"id":"har-1"');
    await expect(readNetwork(reader, { method: "list_requests", options: listOptions.parse({ after: "expired" }) })).rejects.toThrow("cursor expired");
  });

  it("redacts before paging, preserves large numbers and labels unavailable content", async () => {
    const { reader } = fixture();
    const pages: string[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const page = await readNetwork(reader, { method: "get_request", options: readOptions.parse({ requestId: "har-1", maxChars: 256, offset }) }) as { text: string; nextOffset: number | null };
      expect(page.text.length).toBeLessThanOrEqual(256); pages.push(page.text); offset = page.nextOffset;
    }
    const text = pages.join("");
    expect(text).toContain("900719925474099312345");
    for (const secret of ["query-secret", "user:pass", "request-secret", "cookie-secret", "response-secret", "response-cookie"]) expect(text).not.toContain(secret);
    const response = await readNetwork(reader, { method: "get_response", options: readOptions.parse({ requestId: "har-1" }) });
    expect(JSON.stringify(response)).not.toContain("## Request");
    reader.readContent = async () => { throw new Error("Browser body expired"); };
    expect(JSON.stringify(await readNetwork(reader, { method: "get_response", options: readOptions.parse({ requestId: "har-1" }) }))).toContain("Response body unavailable");
  });

  it("rejects stale results after clear/navigation and pending or missing requests", async () => {
    const { reader, setEntries, entry } = fixture();
    reader.readContent = async () => { setEntries([]); return { content: "old document", encoding: "", truncated: false }; };
    await expect(readNetwork(reader, { method: "get_request", options: readOptions.parse({ requestId: "har-1" }) })).rejects.toThrow("changed or was cleared");
    await expect(readNetwork(reader, { method: "get_request", options: readOptions.parse({ requestId: "har-1" }) })).rejects.toThrow("no longer recorded");
    setEntries([{ ...entry, state: "pending" }]);
    await expect(readNetwork(reader, { method: "get_request", options: readOptions.parse({ requestId: "har-1" }) })).rejects.toThrow("not completed");
  });

  it("rejects arbitrary commands and invalid limits at the protocol boundary", () => {
    for (const method of ["eval", "fetch", "clear", "reload", "get_cookies"]) expect(commandSchema.safeParse({ method, options: {} }).success).toBe(false);
    expect(listOptions.safeParse({ limit: 101 }).success).toBe(false);
    expect(readOptions.safeParse({ requestId: "har-1", maxChars: 10_000_000 }).success).toBe(false);
    expect(helloMessage.safeParse({ type: "hello", tabId: -1 }).success).toBe(false);
  });
});

describe("MCP local bridge", () => {
  it("requires loopback host, extension origin and token without exposing HTTP endpoints", async () => {
    const bridge = startBridge({ port: 0, token });
    try {
      const url = `http://127.0.0.1:${bridge.port}/bridge`;
      for (const headers of [
        {}, { Origin: "https://example.test" }, { Origin: origin, "Sec-WebSocket-Protocol": `${BRIDGE_PROTOCOL}, odinet.token.${"b".repeat(64)}` },
        { Origin: origin, Host: `attacker.test:${bridge.port}`, "Sec-WebSocket-Protocol": `${BRIDGE_PROTOCOL}, odinet.token.${token}` },
      ]) expect((await fetch(url, { headers })).status).toBe(403);
      const panel = await peer(bridge.port!, () => ({ safe: true }));
      expect(bridge.listSessions()[0]?.tabId).toBe(7);
      expect(await bridge.call(panel.id, { method: "list_requests", options: listOptions.parse({}) })).toEqual({ safe: true });
      panel.socket.close();
    } finally { bridge.stop(); }
  });

  it("bounds concurrency, times out reads and rejects work when a panel disconnects", async () => {
    const bridge = startBridge({ port: 0, token }, 40);
    try {
      const panel = await peer(bridge.port!);
      const command = { method: "list_requests" as const, options: listOptions.parse({}) };
      const pending = Array.from({ length: 4 }, () => bridge.call(panel.id, command).catch((error: Error) => error.message));
      await expect(bridge.call(panel.id, command)).rejects.toThrow("concurrent");
      expect((await Promise.all(pending)).every((message) => typeof message === "string" && message.includes("timed out"))).toBe(true);
      const cancellation = new AbortController();
      const cancelled = bridge.call(panel.id, command, cancellation.signal); cancellation.abort();
      await expect(cancelled).rejects.toThrow("cancelled");
      const disconnected = bridge.call(panel.id, command);
      panel.socket.close();
      await expect(disconnected).rejects.toThrow("disconnected");
      expect(bridge.listSessions()).toEqual([]);
      await expect(bridge.call(panel.id, command)).rejects.toThrow("No connected");
    } finally { bridge.stop(); }
  });

  it("closes malformed peers and does not route forged replies to another session", async () => {
    const bridge = startBridge({ port: 0, token }, 100);
    try {
      const one = await peer(bridge.port!);
      const two = await peer(bridge.port!);
      one.socket.onmessage = (event) => {
        const message = commandMessage.parse(JSON.parse(String(event.data)));
        two.socket.send(JSON.stringify({ type: "result", id: message.id, ok: true, data: "forged" }));
        one.socket.send("not json");
      };
      await expect(bridge.call(one.id, { method: "list_requests", options: listOptions.parse({}) })).rejects.toThrow("disconnected");
      expect(bridge.listSessions().map((session) => session.id)).toEqual([two.id]);
      two.socket.close();
    } finally { bridge.stop(); }
  });
});

describe("MCP stdio integration", () => {
  it("initializes with the official client, advertises only read tools and reads a connected panel", async () => {
    const directory = await mkdtemp(join(tmpdir(), "odinet-mcp-test-"));
    const configFile = join(directory, "config.json");
    const reserve = startBridge({ port: 0, token });
    const port = reserve.port!; reserve.stop();
    const client = new Client({ name: "odinet-test", version: "1.0.0" });
    const transport = new StdioClientTransport({ command: process.execPath, args: [join(import.meta.dir, "../scripts/mcp.ts")],
      env: { ODINET_MCP_CONFIG: configFile }, stderr: "pipe" });
    let panel: Awaited<ReturnType<typeof peer>> | undefined;
    try {
      await writeFile(configFile, JSON.stringify({ port, token }), { mode: 0o600 });
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual(["get_request", "get_response", "list_requests", "list_sessions"]);
      expect(tools.tools.every((tool) => tool.annotations?.readOnlyHint === true && tool.annotations.destructiveHint === false)).toBe(true);
      const empty = await client.callTool({ name: "list_sessions", arguments: {} });
      expect(JSON.stringify(empty)).toContain('sessions');
      panel = await peer(port, () => ({ requests: [{ id: "har-1", url: "https://example.test/api" }], redacted: true }));
      const sessions = await client.callTool({ name: "list_sessions", arguments: {} });
      expect(JSON.stringify(sessions)).toContain(panel.id);
      const result = await client.callTool({ name: "list_requests", arguments: { sessionId: panel.id, limit: 1 } });
      expect(JSON.stringify(result)).toContain("https://example.test/api");
      const missing = await client.callTool({ name: "get_request", arguments: { sessionId: crypto.randomUUID(), requestId: "har-1" } });
      expect(missing.isError).toBe(true);
      const invalid = await client.callTool({ name: "list_requests", arguments: { sessionId: panel.id, limit: 9999 } });
      expect(invalid.isError).toBe(true);
    } finally { panel?.socket.close(); await client.close(); await transport.close(); await rm(directory, { recursive: true, force: true }); }
  }, 15_000);

  it("creates a reusable owner-only token file and rejects invalid configuration", async () => {
    const directory = await mkdtemp(join(tmpdir(), "odinet-mcp-config-"));
    const path = join(directory, "mcp.json");
    try {
      const first = await loadConfig(path); const second = await loadConfig(path);
      expect(first).toEqual(second); expect(first.token).toMatch(/^[a-f0-9]{64}$/);
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      expect(await readFile(path, "utf8")).toContain(first.token);
      const setup = Bun.spawn([process.execPath, join(import.meta.dir, "../scripts/mcp.ts"), "--setup"], {
        env: { ...process.env, ODINET_MCP_CONFIG: path }, stdout: "pipe", stderr: "pipe",
      });
      const output = JSON.parse(await new Response(setup.stdout).text());
      expect(await setup.exited).toBe(0);
      expect(output.token).toBe(first.token);
      expect(output.mcpServers.odinet.command).toBe(process.execPath);
      expect(output.mcpServers.odinet.env.ODINET_MCP_CONFIG).toBe(path);
      await writeFile(path, '{"port":80,"token":"short"}');
      await expect(loadConfig(path)).rejects.toThrow("Invalid Odinet MCP configuration");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
