import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { configPath, loadConfig } from "../src/mcp/config";
import { startBridge } from "../src/mcp/broker";
import { createMcpServer } from "../src/mcp/server";

let cleanup: (() => Promise<void>) | undefined;
try {
  const config = await loadConfig();
  if (process.argv.includes("--setup")) {
    // Explicit setup output is the only command that prints the pairing secret.
    console.log(JSON.stringify({ bridgeUrl: `ws://127.0.0.1:${config.port}/bridge`, token: config.token, configFile: configPath(),
      mcpServers: { odinet: { command: process.execPath, args: [import.meta.filename],
        ...(process.env.ODINET_MCP_CONFIG ? { env: { ODINET_MCP_CONFIG: configPath() } } : {}) } } }, null, 2));
  } else {
    const bridge = startBridge(config);
    cleanup = async () => { bridge.stop(); };
    const mcp = createMcpServer(bridge);
    let closed = false;
    const shutdown = async (): Promise<void> => {
      if (closed) return;
      closed = true; bridge.stop(); await mcp.close();
    };
    cleanup = shutdown;
    const stop = (): void => { void shutdown().catch(() => { console.error("Odinet MCP failed to close its stdio transport."); process.exitCode = 1; }); };
    mcp.server.onclose = stop;
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    process.stdin.once("end", stop);
    await mcp.connect(new StdioServerTransport());
    console.error(`Odinet MCP ready; browser bridge on 127.0.0.1:${bridge.port}. Pair a panel using bun run mcp:setup.`);
  }
} catch (error) {
  await cleanup?.().catch(() => { console.error("Odinet MCP startup cleanup failed."); });
  const code = error instanceof Error && "code" in error ? String(error.code) : "STARTUP_FAILED";
  console.error(`Odinet MCP failed to start (${code}). Check configuration, dependencies and whether another MCP process owns the bridge port.`);
  process.exitCode = 1;
}
