import { describe, expect, it } from "bun:test";
import { createNumericMatcher } from "../src/element/numeric";
import { dataRelation } from "../src/element/relations";
import { readElementSnapshot, type ElementSnapshot } from "../src/element/snapshot";

const snapshot = (samples: string[]): ElementSnapshot => ({
  label: "section#revenue", pageUrl: "https://example.test/", capturedAt: 1000, documentStartedAt: 1,
  locale: "ru-RU", visited: 10, limited: false, resources: [], samples,
});

describe("rendered number associations", () => {
  it("compares localized grouping, decimal separators and separate currency labels", () => {
    for (const [sample, source, locale] of [
      ["124\u00a0297 ₽", "124297", "ru-RU"],
      ["1\u202f234,56 ₽", "1234.56", "ru-RU"],
      ["$1,234.56", "1234.56", "en-US"],
      ["1.234,56 €", "1234.56", "de-DE"],
      ["1,234", "1234", "en-US"],
      ["1 615", "1615", "ru-RU"],
      ["179", "179", "en-US"],
    ]) {
      expect(createNumericMatcher([sample!], locale!)(source!, "total")).toMatchObject({ sample, comparison: "number" });
    }
  });

  it("finds monetary minor units only with explicit field and currency evidence", () => {
    const match = createNumericMatcher(["124 297 ₽"], "ru-RU");
    expect(match("12429700", "revenueMinor")).toMatchObject({ comparison: "minor" });
    expect(match("12429749", "total_cents")).toMatchObject({ comparison: "minor-rounded" });
    expect(match("12429794", "revenueMinor")).toMatchObject({ comparison: "minor-truncated" });
    expect(match("12429700", "id")).toBeNull();
    expect(createNumericMatcher(["124297"], "ru-RU")("12429700", "revenueMinor")).toBeNull();
    expect(createNumericMatcher(["¥124297"], "ja-JP")("12429700", "amountMinor")).toBeNull();
  });

  it("distinguishes rounding from dropping the fraction and preserves signs", () => {
    const match = createNumericMatcher(["124 297 ₽"], "ru-RU");
    expect(match("124297.49", "total")).toMatchObject({ comparison: "rounded" });
    expect(match("124297.94", "total")).toMatchObject({ comparison: "truncated" });
    expect(match("124298.01", "total")).toBeNull();
    expect(createNumericMatcher(["−124 297 ₽"], "ru-RU")("-12429794", "refundMinor")).toMatchObject({ comparison: "minor-truncated" });
  });

  it("recognizes percentage ratios only when the selected text carries a percent sign", () => {
    expect(createNumericMatcher(["76 %"], "ru-RU")("0.76", "successRate")).toMatchObject({ comparison: "percent" });
    expect(createNumericMatcher(["76,1 %"], "ru-RU")("0.7614", "successRate")).toMatchObject({ comparison: "percent" });
    expect(createNumericMatcher(["761"], "ru-RU")("7.61", "count")).toBeNull();
  });

  it("does not coerce distinct large numeric identifiers through floating point", () => {
    const match = createNumericMatcher(["900719925474099312345"], "en-US");
    expect(match("900719925474099312345", "id")).toMatchObject({ comparison: "number" });
    expect(match("900719925474099312346", "id")).toBeNull();
    expect(match("Infinity", "id")).toBeNull();
    expect(match("1e1000000", "id")).toBeNull();
  });

  it("rejects dates, arbitrary text, malformed grouping and ubiquitous small numbers", () => {
    const match = createNumericMatcher(["04.11.2026", "Orders: 124297", "12 34 ₽", "1,2,3", "12", "0", "00124"], "ru-RU");
    for (const number of ["124297", "1234", "123", "12", "0", "124"]) expect(match(number, "value")).toBeNull();
    expect(() => createNumericMatcher(["124297"], "invalid locale!")("124297", "value")).not.toThrow();
  });

  it("reports the raw monetary value, rendered sample, conversion and JSONPath", () => {
    const relation = dataRelation(snapshot(["192", "124 297 ₽"]), '{"data":{"count":192,"money":{"receivableMinor":"12429794"}}}');
    expect(relation).toMatchObject({ kind: "data", value: "12429794", sample: "124 297 ₽", comparison: "minor-truncated", path: "$.data.money.receivableMinor" });
    expect(dataRelation(snapshot(["179"]), '{"data":{"newUsers":179}}')).toMatchObject({ kind: "data", value: "179", comparison: "number", path: "$.data.newUsers" });
  });

  it("accepts short numeric DOM samples while rejecting short unrelated text", () => {
    expect(readElementSnapshot(snapshot(["179", "76%"]))).toMatchObject({ samples: ["179", "76%"] });
    expect(() => readElementSnapshot(snapshot(["OK"]))).toThrow();
  });
});
