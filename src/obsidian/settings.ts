// Zweigleisige Settings — EINE Wahrheit fuer beide Renderpfade.
//
// Ab Obsidian 1.13 fragt der Host `getSettingDefinitions()` ab und ruft `display()`
// nie; nur so erscheinen die Settings in der Settings-Suche. Die `minAppVersion`
// dieses Plugins ist 1.8.7, dort gibt es die deklarative API nicht — der Host ruft
// `display()`.
//
// Deshalb ist `getSettingDefinitions()` die einzige Definition, und `display()`
// zeichnet DIESELBE Struktur mit dem Kit-Walker (klassische `Setting`-API) nach.
// Kein zweiter Definitionsbaum, der auseinanderlaufen kann.
//
// Muster wörtlich übernommen aus `koda-agent/src/obsidian/settings.ts`.

import { PluginSettingTab, type App, type SettingDefinitionItem } from "obsidian";
import { t } from "../vendor/kit/i18n";
import { renderSettingDefinitions } from "../vendor/kit-obsidian/settings_walker";
import {
  TIMEOUT_SEC_MAX,
  TIMEOUT_SEC_MIN,
  TIMEOUT_SEC_STEP,
  type WikijsSettings,
} from "../core/settings-types";
import type WikijsMaintainerPlugin from "../main";

export class WikijsSettingsTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: WikijsMaintainerPlugin,
  ) {
    super(app, plugin);
  }

  getSettingDefinitions(): SettingDefinitionItem<keyof WikijsSettings>[] {
    return [
      {
        name: t("settings.url"),
        desc: t("settings.url.desc"),
        control: { type: "text", key: "baseUrl", placeholder: "https://wiki.example.org" },
      },
      {
        name: t("settings.key"),
        desc: t("settings.key.desc"),
        control: { type: "text", key: "apiKey" },
      },
      {
        name: t("settings.root"),
        desc: t("settings.root.desc"),
        control: { type: "folder", key: "syncRoot" },
      },
      {
        name: t("settings.locale"),
        desc: t("settings.locale.desc"),
        control: { type: "text", key: "locale", placeholder: "de" },
      },
      {
        name: t("settings.timeout"),
        control: {
          type: "slider",
          key: "timeoutSec",
          min: TIMEOUT_SEC_MIN,
          max: TIMEOUT_SEC_MAX,
          step: TIMEOUT_SEC_STEP,
          displayFormat: (v: number) => t("settings.timeout.sec", v),
        },
      },
    ];
  }

  getControlValue(key: string): unknown {
    return this.plugin.settings[key as keyof WikijsSettings];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    (this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
    await this.plugin.saveSettings();
  }

  // Fallback-Pfad fuer Obsidian < 1.13: dieselbe Definition, klassisch gezeichnet.
  display(): void {
    this.containerEl.empty();
    renderSettingDefinitions(this.containerEl, this.getSettingDefinitions(), this, this.app);
  }
}
