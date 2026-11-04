import Decimal from "decimal.js";

// Use source strings and a private context so IDs and money never pass through Number.
const ExactDecimal = Decimal.clone({ precision: 512 });
export type NumericComparison = "number" | "rounded" | "truncated" | "minor" | "minor-rounded" | "minor-truncated" | "percent";
export interface NumericMatch { sample: string; comparison: NumericComparison; priority: number }
interface DisplayNumber { sample: string; number: Decimal; places: number; currency: boolean; percent: boolean; minorUnits: boolean }
type Groups = Map<number, Map<string, DisplayNumber>>;

function decimal(source: string): Decimal | null {
  if (source.length > 256 || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(source)) return null;
  try {
    const value = new ExactDecimal(source);
    return value.isFinite() && Math.abs(value.e) <= 300 ? value : null;
  } catch { return null; }
}

function displayNumber(sample: string, locale: string): DisplayNumber | null {
  const text = sample.replace(/[\u200e\u200f\u061c]/g, "").replace(/\u2212/g, "-").replace(/\s/g, " ").trim();
  const unit = "(?:\\p{Sc}|USD|EUR|RUB|GBP|CAD|AUD|CHF|JPY|CNY|руб\\.?)";
  const match = new RegExp(`^(?:(${unit})\\s*)?([+-]?\\d[\\d .,\u2019']*)(?:\\s*(${unit}|%))?$`, "iu").exec(text);
  if (!match) return null;
  let body = (match[2] ?? "").trim();
  const percent = match[3] === "%";
  const currency = Boolean(match[1] || (match[3] && !percent));
  if ((body.match(/\d/g)?.length ?? 0) < (percent ? 2 : 3)) return null;
  let parts: Intl.NumberFormatPart[];
  try { parts = new Intl.NumberFormat(locale).formatToParts(12345.6); }
  catch { parts = new Intl.NumberFormat("en").formatToParts(12345.6); }
  const group = parts.find((part) => part.type === "group")?.value;
  const dots = body.includes(".");
  const commas = body.includes(",");
  let separator = "";
  if (dots && commas) separator = body.lastIndexOf(".") > body.lastIndexOf(",") ? "." : ",";
  else if (dots || commas) {
    const mark = dots ? "." : ",";
    const groups = body.replace(/^[+-]/, "").split(mark);
    if (!(mark === group && groups.length > 1 && groups.slice(1).every((part) => /^\d{3}$/.test(part)))) separator = mark;
  }
  const split = separator ? body.split(separator) : [body];
  if (split.length > 2 || (separator && !/^\d{1,6}$/.test(split[1] ?? ""))) return null;
  let integer = split[0] ?? "";
  const grouping = integer.replace(/^[+-]/, "").match(/[^\d]/)?.[0];
  if (grouping) {
    const groups = integer.replace(/^[+-]/, "").split(grouping);
    if (!/^\d{1,3}$/.test(groups[0] ?? "") || !groups.slice(1).every((part) => /^\d{3}$/.test(part))) return null;
    integer = integer.split(grouping).join("");
  }
  body = integer.replace(/^\+/, "") + (separator ? `.${split[1]}` : "");
  const number = decimal(body);
  if (!number || number.isZero()) return null;
  const currencyUnit = (match[1] || match[3] || "").toUpperCase();
  const minorUnits = ["USD", "EUR", "RUB", "GBP", "CAD", "AUD", "CHF", "CNY", "РУБ", "РУБ.", "$", "€", "£", "₽", "₹"].includes(currencyUnit);
  return { sample, number, places: split[1]?.length ?? 0, currency, percent, minorUnits };
}

function groupsFor(samples: DisplayNumber[]): Groups {
  const groups: Groups = new Map();
  for (const sample of samples) {
    const values = groups.get(sample.places) ?? new Map<string, DisplayNumber>();
    // Prefer a currency-labelled sample over the same bare number from a split text node.
    const key = sample.number.toString();
    if (!values.has(key) || sample.currency) values.set(key, sample);
    groups.set(sample.places, values);
  }
  return groups;
}

function find(groups: Groups, number: Decimal, transformed?: "minor" | "percent"): NumericMatch | null {
  let best: NumericMatch | null = null;
  for (const [places, values] of groups) {
    for (const rounding of [null, ExactDecimal.ROUND_HALF_UP, ExactDecimal.ROUND_DOWN]) {
      if (rounding !== null && number.decimalPlaces() <= places) continue;
      const value = rounding === null ? number : number.toDecimalPlaces(places, rounding);
      const sample = values.get(value.toString());
      if (!sample) continue;
      const operation = rounding === null ? "number" : rounding === ExactDecimal.ROUND_HALF_UP ? "rounded" : "truncated";
      const comparison: NumericComparison = transformed === "percent" ? "percent" : transformed === "minor" ? operation === "number" ? "minor" : operation === "rounded" ? "minor-rounded" : "minor-truncated" : operation;
      const priority = (sample.currency ? 30 : sample.percent ? 10 : 20) + (rounding === null ? 2 : 0);
      if (!best || priority > best.priority) best = { sample: sample.sample, comparison, priority };
    }
  }
  return best;
}

export function createNumericMatcher(samples: readonly string[], locale: string): (source: string, key: string) => NumericMatch | null {
  const parsed = samples.map((sample) => displayNumber(sample, locale)).filter((sample): sample is DisplayNumber => sample !== null);
  const all = groupsFor(parsed);
  const money = groupsFor(parsed.filter((sample) => sample.minorUnits));
  const percentages = groupsFor(parsed.filter((sample) => sample.percent));
  return (source, key) => {
    if (!parsed.length) return null;
    const number = decimal(source);
    if (!number) return null;
    let best = find(all, number);
    // Never guess a factor of 100 for arbitrary JSON fields or unlabelled DOM values.
    if (money.size && /(?:minor|cents|kopecks)$/i.test(key)) {
      const minor = find(money, number.dividedBy(100), "minor");
      if (minor && (!best || minor.priority > best.priority)) best = minor;
    }
    const percent = percentages.size ? find(percentages, number.times(100), "percent") : null;
    if (percent && (!best || percent.priority > best.priority)) best = percent;
    return best;
  };
}
