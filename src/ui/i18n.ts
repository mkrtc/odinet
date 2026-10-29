export function t(key: string, substitutions?: string | string[]): string {
  return chrome.i18n.getMessage(key, substitutions) || key;
}

const locale = (): string => chrome.i18n.getUILanguage();
export function bytes(value: number | null): string {
  if (value === null) return "\u2014";
  if (value < 1024) return `${new Intl.NumberFormat(locale(), { maximumFractionDigits: 0 }).format(value)} B`;
  const unit = value < 1024 * 1024 ? "kB" : "MB";
  return `${new Intl.NumberFormat(locale(), { maximumFractionDigits: 1 }).format(value / (unit === "kB" ? 1024 : 1024 * 1024))} ${unit}`;
}

export function milliseconds(value: number | null): string {
  if (value === null) return "\u2014";
  const seconds = value >= 1000;
  return `${new Intl.NumberFormat(locale(), { maximumFractionDigits: seconds ? 2 : 1 }).format(seconds ? value / 1000 : value)} ${t(seconds ? "unitSeconds" : "unitMilliseconds")}`;
}
