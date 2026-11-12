// `requiredFields` ist ein kommagetrennter Einstellungstext; main.ts macht daraus die Liste, die SyncService bekommt.
// Seit der Umstellung auf `splitList` (code-kit 0.63.0) statt der eigenen Zeile split/trim/filter pinnt dieser Test
// die Randfaelle: Leerraum, leere Eintraege, nur Trennzeichen, leere Einstellung.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { App } from "obsidian";
import { makeManifest } from "./helpers/mock-types";
import { defineStrings, setLang } from "../src/vendor/kit/i18n";
import { STRINGS } from "../src/i18n/strings";
import { DEFAULT_SETTINGS } from "../src/core/settings-types";

const captured: { requiredFields?: string[] }[] = [];
vi.mock("../src/obsidian/sync-service", () => ({
  SyncService: class {
    constructor(opts: { requiredFields: string[] }) {
      captured.push(opts);
    }
  },
}));

import WikijsMaintainerPlugin from "../src/main";

beforeAll(() => {
  defineStrings(STRINGS);
  setLang("en");
});

function requiredFieldsFor(raw: string): string[] {
  const plugin = new WikijsMaintainerPlugin(new App(), makeManifest("wikijs-maintainer"));
  plugin.settings = { ...DEFAULT_SETTINGS, baseUrl: "https://wiki.example.org", apiKey: "key", requiredFields: raw };
  captured.length = 0;
  (plugin as unknown as { buildService(): unknown }).buildService();
  expect(captured).toHaveLength(1);
  return captured[0]?.requiredFields ?? [];
}

describe("requiredFields: Einstellungstext → Liste", () => {
  it.each([
    ["", []],
    [" , ,, ", []],
    ["title", ["title"]],
    ["  title ,  tags ", ["title", "tags"]],
    ["title,,tags,", ["title", "tags"]],
    ["a b, c", ["a b", "c"]],
  ])("%j → %j", (raw, expected) => {
    expect(requiredFieldsFor(raw)).toEqual(expected);
  });
});
