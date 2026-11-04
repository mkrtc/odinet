import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { DEFAULT_BRIDGE_PORT, TOKEN_PATTERN } from "./protocol";

const configSchema = z.strictObject({ port: z.int().min(1024).max(65535), token: z.string().regex(TOKEN_PATTERN) });
export type BridgeConfig = z.infer<typeof configSchema>;
export const configPath = (): string => process.env.ODINET_MCP_CONFIG || join(homedir(), ".config", "odinet", "mcp.json");

export async function loadConfig(path = configPath()): Promise<BridgeConfig> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  try {
    await writeFile(path, JSON.stringify({ port: DEFAULT_BRIDGE_PORT, token: randomBytes(32).toString("hex") }) + "\n", { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
  }
  const text = await readFile(path, "utf8");
  if (text.length > 4096) throw new Error("Odinet MCP configuration is too large.");
  const result = configSchema.safeParse(JSON.parse(text));
  if (!result.success) throw new Error(`Invalid Odinet MCP configuration at ${path}. Expected port and a 64-character hex token.`);
  return result.data;
}
