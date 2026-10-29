import { describe, expect, it } from "bun:test";
import { isRussianLocale, requestCountMessageKey } from "../src/shared/localization";

interface MessageCatalog {
  [key: string]: { message: string };
}

const root = new URL("../public/_locales/", import.meta.url);

describe("localization", () => {
  it("keeps English and Russian catalogs complete", async () => {
    const en = await Bun.file(new URL("en/messages.json", root)).json() as MessageCatalog;
    const ru = await Bun.file(new URL("ru/messages.json", root)).json() as MessageCatalog;

    expect(Object.keys(ru).sort()).toEqual(Object.keys(en).sort());
    for (const catalog of [en, ru]) {
      for (const entry of Object.values(catalog)) {
        expect(entry.message.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("selects Russian plural forms and falls back to English", () => {
    expect(isRussianLocale("ru-RU")).toBe(true);
    expect(requestCountMessageKey(1, "ru-RU")).toBe("recentRequestsOne");
    expect(requestCountMessageKey(2, "ru-RU")).toBe("recentRequestsFew");
    expect(requestCountMessageKey(5, "ru-RU")).toBe("recentRequestsMany");
    expect(requestCountMessageKey(11, "ru-RU")).toBe("recentRequestsMany");
    expect(requestCountMessageKey(21, "ru-RU")).toBe("recentRequestsOne");
    expect(requestCountMessageKey(2, "de-DE")).toBe("recentRequestsMany");
  });
});
