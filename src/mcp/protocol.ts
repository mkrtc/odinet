import { z } from "zod";

export const DEFAULT_BRIDGE_PORT = 19865;
export const BRIDGE_PROTOCOL = "odinet.v1";
export const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
export const MAX_WIRE_BYTES = 1024 * 1024;
export const MAX_CONCURRENT_READS = 4;

export const listOptions = z.strictObject({
  query: z.string().max(256).default(""),
  method: z.string().max(32).optional(),
  status: z.int().min(0).max(599).optional(),
  after: z.string().max(80).optional(),
  limit: z.int().min(1).max(100).default(50),
});
export const readOptions = z.strictObject({
  requestId: z.string().min(1).max(80),
  offset: z.int().min(0).max(16 * 1024 * 1024).default(0),
  maxChars: z.int().min(256).max(32 * 1024).default(16 * 1024),
});
export const commandSchema = z.discriminatedUnion("method", [
  z.strictObject({ method: z.literal("list_requests"), options: listOptions }),
  z.strictObject({ method: z.enum(["get_request", "get_response"]), options: readOptions }),
]);
export type BridgeCommand = z.infer<typeof commandSchema>;

const id = z.string().uuid();
export const commandMessage = z.strictObject({ type: z.literal("command"), id, command: commandSchema });
export const helloMessage = z.strictObject({ type: z.literal("hello"), tabId: z.int().min(0) });
export const welcomeMessage = z.strictObject({ type: z.literal("welcome"), sessionId: id });
export const replyMessage = z.discriminatedUnion("ok", [
  z.strictObject({ type: z.literal("result"), id, ok: z.literal(true), data: z.json() }),
  z.strictObject({ type: z.literal("result"), id, ok: z.literal(false), error: z.string().max(300) }),
]);
