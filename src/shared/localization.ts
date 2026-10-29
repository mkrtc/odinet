export type CountMessageKey = "recentRequestsOne" | "recentRequestsFew" | "recentRequestsMany";

export function isRussianLocale(locale: string): boolean {
  return /^ru(?:[-_]|$)/i.test(locale);
}

export function requestCountMessageKey(count: number, locale: string): CountMessageKey {
  const language = isRussianLocale(locale) ? "ru" : "en";
  const category = new Intl.PluralRules(language).select(count);
  if (category === "one") return "recentRequestsOne";
  if (category === "few") return "recentRequestsFew";
  return "recentRequestsMany";
}
