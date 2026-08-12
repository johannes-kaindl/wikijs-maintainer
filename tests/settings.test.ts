import { describe, expect, it, vi } from "vitest";
import { App } from "obsidian";
import { DEFAULT_SETTINGS, mergeWikijsSettings, type WikijsSettings } from "../src/core/settings-types";
import { STRINGS } from "../src/i18n/strings";
import { WikijsSettingsTab } from "../src/obsidian/settings";
import type WikijsMaintainerPlugin from "../src/main";

describe("mergeWikijsSettings", () => {
  it("liefert die Defaults, wenn nichts gespeichert ist", () => {
    expect(mergeWikijsSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it("uebernimmt gespeicherte Werte und ergaenzt fehlende aus den Defaults", () => {
    const merged = mergeWikijsSettings({ baseUrl: "https://w.example" });
    expect(merged.baseUrl).toBe("https://w.example");
    expect(merged.syncRoot).toBe(DEFAULT_SETTINGS.syncRoot);
  });

  it("hat _published als Sync-Wurzel und de als Wiki-Locale (Spec)", () => {
    expect(DEFAULT_SETTINGS.syncRoot).toBe("_published");
    expect(DEFAULT_SETTINGS.locale).toBe("de");
  });
});

describe("WikijsSettingsTab", () => {
  function makeTab(settings: WikijsSettings = { ...DEFAULT_SETTINGS }) {
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    // Plugin-Doppel statt echter Plugin-Instanz: der Tab braucht nur `settings` +
    // `saveSettings` (siehe getControlValue/setControlValue in src/obsidian/settings.ts).
    const plugin = { settings, saveSettings } as unknown as WikijsMaintainerPlugin;
    const tab = new WikijsSettingsTab(new App(), plugin);
    return { tab, plugin, saveSettings };
  }

  it("definiert genau die erwarteten Felder in der erwarteten Reihenfolge", () => {
    const { tab } = makeTab();
    const keys = tab.getSettingDefinitions().map((item) => (item as { control?: { key?: string } }).control?.key);
    expect(keys).toEqual(["baseUrl", "apiKey", "syncRoot", "locale", "timeoutSec"]);
  });

  it("rendert den Sync-Ordner als folder-Control (Autocomplete), nicht als text", () => {
    const { tab } = makeTab();
    const syncRootDef = tab
      .getSettingDefinitions()
      .find((item) => (item as { control?: { key?: string } }).control?.key === "syncRoot");
    expect((syncRootDef as { control?: { type?: string } }).control?.type).toBe("folder");
  });

  it("getControlValue liest aus den Plugin-Settings", () => {
    const { tab } = makeTab({ ...DEFAULT_SETTINGS, baseUrl: "https://w.example", timeoutSec: 45 });
    expect(tab.getControlValue("baseUrl")).toBe("https://w.example");
    expect(tab.getControlValue("timeoutSec")).toBe(45);
  });

  it("setControlValue schreibt den Wert und persistiert ihn", async () => {
    const { tab, plugin, saveSettings } = makeTab();
    await tab.setControlValue("baseUrl", "https://new.example");
    expect(plugin.settings.baseUrl).toBe("https://new.example");
    expect(saveSettings).toHaveBeenCalledTimes(1);
  });
});

describe("STRINGS", () => {
  it("fuehrt DE und EN mit denselben Schluesseln", () => {
    expect(Object.keys(STRINGS.de).sort()).toEqual(Object.keys(STRINGS.en).sort());
  });

  it("hat keinen leeren Wert", () => {
    for (const lang of ["en", "de"] as const) {
      for (const [key, value] of Object.entries(STRINGS[lang])) {
        expect(value, `${lang}.${key}`).not.toBe("");
      }
    }
  });
});
