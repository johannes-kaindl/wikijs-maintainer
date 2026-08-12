// Verdrahtungs-Test des Scaffolds: prueft NICHT die Kit-Logik (die hat ihre eigenen
// Tests im Kit), sondern dass dieses Repo sie ueberhaupt erreicht — vendorte Pfade
// aufloesbar, obsidian-Alias auf den Mock gebogen (PROF-OBS-08).
import { describe, expect, it } from "vitest";
import { mergeSettings } from "../src/vendor/kit/settings";
import { defineStrings, setLang, t } from "../src/vendor/kit/i18n";
import { Plugin } from "obsidian";

describe("Scaffold-Verdrahtung", () => {
  it("erreicht das vendorte mergeSettings und teilt keine Array-Referenz mit den Defaults", () => {
    const defaults = { list: ["a"], n: 1 };
    const merged = mergeSettings(defaults, null);
    merged.list.push("b");
    expect(defaults.list).toEqual(["a"]);
  });

  it("erreicht die vendorte i18n-Engine", () => {
    defineStrings({ en: { greet: "hi {0}" }, de: { greet: "hallo {0}" } });
    setLang("de");
    expect(t("greet", "Jay")).toBe("hallo Jay");
  });

  it("loest den obsidian-Import auf den Test-Mock auf", () => {
    expect(typeof Plugin).toBe("function");
  });
});
