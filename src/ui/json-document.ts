import { applyEdits, createScanner, format, getNodePath, parseTree, SyntaxKind, type Node, type ParseError } from "jsonc-parser";

export type JsonNode = Node;
export interface JsonDocument { source: string; root: JsonNode }
export interface JsonChild { node: JsonNode; key: string; index: number }

export function parseJsonDocument(source: string): JsonDocument | null {
  try {
    const errors: ParseError[] = [];
    const root = parseTree(source, errors, { disallowComments: true, allowTrailingComma: false });
    return root && errors.length === 0 ? { source, root } : null;
  } catch { return null; }
}

export function isContainer(node: JsonNode): boolean {
  return node.type === "object" || node.type === "array";
}

export function childAt(node: JsonNode, index: number): JsonChild | null {
  const child = node.children?.[index];
  if (!child) return null;
  if (node.type === "array") return { node: child, key: String(index), index };
  const key = child.children?.[0];
  const value = child.children?.[1];
  return key && value && typeof key.value === "string" ? { node: value, key: key.value, index } : null;
}

export function parentValue(node: JsonNode): JsonNode | undefined {
  return node.parent?.type === "property" ? node.parent.parent : node.parent;
}

export function jsonPath(node: JsonNode): string {
  return getNodePath(node).reduce<string>((path, segment) => typeof segment === "number" ? `${path}[${segment}]`
    : /^[A-Za-z_$][\w$]*$/.test(segment) ? `${path}.${segment}` : `${path}[${JSON.stringify(segment)}]`, "$");
}

export function rawValue(document: JsonDocument, node: JsonNode): string {
  return document.source.slice(node.offset, node.offset + node.length);
}

export function formattedJson(source: string): { text: string; limited: boolean } {
  // Bound whitespace expansion for adversarially deep or very wide JSON.
  const scanner = createScanner(source);
  let depth = 0;
  for (let token = scanner.scan(); token !== SyntaxKind.EOF; token = scanner.scan()) {
    if (token === SyntaxKind.OpenBraceToken || token === SyntaxKind.OpenBracketToken) depth++;
    if (depth > 64) return { text: source, limited: true };
    if (token === SyntaxKind.CloseBraceToken || token === SyntaxKind.CloseBracketToken) depth--;
  }
  try {
    const edits = format(source, undefined, { insertSpaces: true, tabSize: 2, eol: "\n" });
    const length = edits.reduce((size, edit) => size + edit.content.length - edit.length, source.length);
    return length > 8 * 1024 * 1024 ? { text: source, limited: true } : { text: applyEdits(source, edits), limited: false };
  } catch { return { text: source, limited: true }; }
}

export function* walkJson(root: JsonNode): Generator<{ node: JsonNode; key: string; depth: number }> {
  const stack = [{ node: root, key: "$", index: -1 }];
  while (stack.length) {
    const frame = stack[stack.length - 1];
    if (!frame) break;
    if (frame.index === -1) { frame.index++; yield { node: frame.node, key: frame.key, depth: stack.length - 1 }; }
    const child = isContainer(frame.node) ? childAt(frame.node, frame.index++) : null;
    if (child) stack.push({ node: child.node, key: child.key, index: -1 });
    else stack.pop();
  }
}

export async function searchJson(document: JsonDocument, query: string, signal: AbortSignal, limit = 500): Promise<{ matches: JsonNode[]; limited: boolean }> {
  const needle = query.trim().toLowerCase();
  if (!needle) return { matches: [], limited: false };
  const matches: JsonNode[] = [];
  let count = 0;
  for (const { node, key } of walkJson(document.root)) {
    if (signal.aborted) return { matches: [], limited: false };
    const value = typeof node.value === "string" ? node.value : isContainer(node) ? "" : rawValue(document, node);
    if (key.toLowerCase().includes(needle) || value.toLowerCase().includes(needle)) {
      if (matches.length === limit) return { matches, limited: true };
      matches.push(node);
    }
    if (++count % 1000 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return { matches, limited: false };
}
