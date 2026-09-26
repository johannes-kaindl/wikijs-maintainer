import { afterEach, describe, expect, it, vi } from "vitest";
import { App, Setting } from "obsidian";
import { DEFAULT_SETTINGS } from "../src/core/settings-types";
import { WikijsSettingsTab } from "../src/obsidian/settings";
import { defineStrings, setLang } from "../src/vendor/kit/i18n";
import { STRINGS } from "../src/i18n/strings";
import type WikijsMaintainerPlugin from "../src/main";

// UI-STANDARD §8 „Hilfe-Zeile (Settings)": erstes Element des Tabs, „Open documentation" auf den
// Doku-Index, `bug`-Knopf auf die Issues dieses Repos. Die Settings sind EN/DE, die Zeile also auch.
const DOCS = "https://github.com/johannes-kaindl/wikijs-maintainer/blob/main/docs/README.md";
const ISSUES = "https://github.com/johannes-kaindl/wikijs-maintainer/issues";

type Erste = { type?: string; name?: string; desc?: string; render?: (s: Setting) => unknown };

function makeTab(): WikijsSettingsTab {
  const plugin = { settings: { ...DEFAULT_SETTINGS }, saveSettings: vi.fn() } as unknown as WikijsMaintainerPlugin;
  return new WikijsSettingsTab(new App(), plugin);
}

afterEach(() => { vi.unstubAllGlobals(); setLang("en"); });

describe("Hilfe-Zeile in den Settings", () => {
  defineStrings(STRINGS);

  it("ist das ERSTE Element von getSettingDefinitions(), vor jedem Feld", () => {
    const first = makeTab().getSettingDefinitions()[0] as Erste;
    expect(first.type).not.toBe("group");
    expect(first.name).toBe("Help");
    expect(typeof first.render).toBe("function");
  });

  it("öffnet Doku-Index und Issues dieses Repos", () => {
    const open = vi.fn();
    vi.stubGlobal("window", { open });
    const first = makeTab().getSettingDefinitions()[0] as Erste;
    const setting = new Setting(undefined as never);
    first.render!(setting);
    const [docsBtn, bugBtn] = (setting as unknown as { components: Array<{ textValue?: string; iconName?: string; tooltip?: string; clickCB: () => void }> }).components;
    expect(docsBtn.textValue).toBe("Open documentation");
    expect(bugBtn.iconName).toBe("bug");
    expect(bugBtn.tooltip).toBe("Report an issue");
    docsBtn.clickCB();
    bugBtn.clickCB();
    expect(open.mock.calls.map((c) => c[0])).toEqual([DOCS, ISSUES]);
  });

  it("spricht Deutsch, wenn die Oberfläche Deutsch ist", () => {
    setLang("de");
    const first = makeTab().getSettingDefinitions()[0] as Erste;
    expect(first.name).toBe("Hilfe");
    expect(first.desc).toBe("Erste Schritte, Anleitungen und Fehlersuche");
  });
});
