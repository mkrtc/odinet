import { describe, expect, it } from "bun:test";
import { childAt, formattedJson, jsonPath, parseJsonDocument, rawValue, searchJson, walkJson } from "../src/ui/json-document";

describe("JSON inspection", () => {
  it("preserves large integers, exponent notation, escapes and duplicate keys", () => {
    const source = '{"id":900719925474099312345,"id":1e+300,"name":"\\u0041"}';
    const document = parseJsonDocument(source);
    expect(document).not.toBeNull();
    if (!document) return;
    expect(document.root.children).toHaveLength(3);
    const first = childAt(document.root, 0);
    expect(first && rawValue(document, first.node)).toBe("900719925474099312345");
    const formatted = formattedJson(source);
    expect(formatted.text).toContain('"id": 900719925474099312345');
    expect(formatted.text).toContain('"id": 1e+300');
    expect(formatted.text).toContain('"name": "\\u0041"');
    expect(formatted.limited).toBe(false);
  });

  it("creates unambiguous paths for dotted keys, quotes, arrays and prototype-like names", () => {
    const document = parseJsonDocument('{"a.b":{"quote\\\"key":[{"__proto__":42}]}}');
    expect(document).not.toBeNull();
    if (!document) return;
    const nodes = [...walkJson(document.root)];
    expect(jsonPath(nodes.at(-1)!.node)).toBe('$["a.b"]["quote\\\"key"][0].__proto__');
  });

  it("searches beyond the first array page and matches exact numeric source", async () => {
    const source = `{"items":[${Array.from({ length: 250 }, (_, index) => `{"id":${index},"name":"item-${index}"}`).join(",")}],"large":900719925474099312345}`;
    const document = parseJsonDocument(source)!;
    const result = await searchJson(document, "item-249", new AbortController().signal);
    expect(result.matches).toHaveLength(1);
    expect(jsonPath(result.matches[0]!)).toBe("$.items[249].name");
    const numbers = await searchJson(document, "900719925474099312345", new AbortController().signal);
    expect(numbers.matches).toHaveLength(1);
  });

  it("bounds search results, supports cancellation and rejects malformed JSON", async () => {
    const document = parseJsonDocument('["hit","hit","hit"]')!;
    expect(await searchJson(document, "hit", new AbortController().signal, 2)).toMatchObject({ limited: true });
    const controller = new AbortController(); controller.abort();
    expect((await searchJson(document, "hit", controller.signal)).matches).toHaveLength(0);
    expect(parseJsonDocument('{"x":1,}')).toBeNull();
    expect(parseJsonDocument('{/* comment */"x":1}')).toBeNull();
    expect(parseJsonDocument('{"x":')).toBeNull();
    expect(() => parseJsonDocument("[".repeat(10000) + "0" + "]".repeat(10000))).not.toThrow();
  });

  it("keeps source text when formatting would expand excessive nesting", () => {
    const source = "[".repeat(65) + "0" + "]".repeat(65);
    expect(formattedJson(source)).toEqual({ text: source, limited: true });
  });
});
