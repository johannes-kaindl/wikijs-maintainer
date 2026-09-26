import { describe, expect, it, vi } from "vitest";
import { App, Setting } from "obsidian";
import { DEFAULT_SETTINGS, mergeWikijsSettings, type WikijsSettings } from "../src/core/settings-types";
import { STRINGS } from "../src/i18n/strings";
import { t } from "../src/vendor/kit/i18n";
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
    // Das erste Element ist die Hilfe-Zeile (Render-Hatch ohne control, tests/help-row.test.ts).
    const keys = tab.getSettingDefinitions().slice(1).map((item) => (item as { control?: { key?: string } }).control?.key);
    // Der API-Schluessel ist eine render-Hatch (Maskierung) und traegt deshalb kein `control.key`.
    expect(keys).toEqual(["baseUrl", undefined, "syncRoot", "locale", "timeoutSec"]);
  });

  // Der Schluessel stand bis Welle 11 im Klartext im Feld (Screenshot, Bildschirmfreigabe).
  // Obsidians deklarative API kennt keinen Passwort-Typ (`SettingTextControl` traegt nur
  // `type: 'text'` und `placeholder`), maskieren geht nur ueber `inputEl` einer render-Hatch.
  describe("API-Schluessel-Feld", () => {
    type Zeile = { name?: string; aliases?: string[]; control?: unknown; render?: (s: Setting) => unknown };
    function apiKeyZeile(tab: WikijsSettingsTab): Zeile {
      const zeile = (tab.getSettingDefinitions() as Zeile[]).find((d) => d.name === t("settings.key"));
      expect(zeile, "Zeile fuer den API-Schluessel nicht gefunden").toBeTruthy();
      return zeile as Zeile;
    }
    function felder(setting: Setting) {
      return (setting as unknown as { components: { inputEl?: { type?: string }; getValue(): string }[] }).components;
    }

    it("wird maskiert dargestellt", () => {
      const { tab } = makeTab({ ...DEFAULT_SETTINGS, apiKey: "geheim" });
      const zeile = apiKeyZeile(tab);
      expect(zeile.render, "ein deklaratives Control kann nicht maskieren").toBeTypeOf("function");
      expect(zeile.control).toBeUndefined();
      const setting = new Setting(undefined as never);
      zeile.render?.(setting);
      const feld = felder(setting).find((c) => c.inputEl);
      expect(feld?.inputEl?.type).toBe("password");
      expect(feld?.getValue()).toBe("geheim");
    });

    // Gegenprobe: ein gewoehnliches Textfeld bleibt `text` — der Test faellt also, wenn er nur
    // deshalb gruen waere, weil der Mock jedes Feld als password fuehrt.
    it("Gegenprobe: ein gewoehnliches addText-Feld ist nicht maskiert", () => {
      const setting = new Setting(undefined as never);
      setting.addText(() => {});
      expect(felder(setting).find((c) => c.inputEl)?.inputEl?.type).not.toBe("password");
    });

    it("speichert Eingaben ueber setControlValue", async () => {
      const { tab, plugin, saveSettings } = makeTab();
      const setting = new Setting(undefined as never);
      apiKeyZeile(tab).render?.(setting);
      const tx = (setting as unknown as { components: { onChangeCB: ((v: string) => unknown) | null }[] }).components[0];
      const handler = tx?.onChangeCB;
      expect(handler, "onChange-Handler nicht registriert").toBeTruthy();
      await handler?.("neuer-schluessel");
      expect(plugin.settings.apiKey).toBe("neuer-schluessel");
      expect(saveSettings).toHaveBeenCalled();
    });

    it("bleibt ueber Suchbegriffe auffindbar", () => {
      const aliases = apiKeyZeile(makeTab().tab).aliases ?? [];
      expect(aliases).toContain("token");
      expect(aliases).toContain("bearer");
    });
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
