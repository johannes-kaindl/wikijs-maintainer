// Deckt drei Minor-/Important-Befunde der finalen Review-Runde ab, die main.ts
// betreffen und bisher ungetestet waren:
//  - notice.noUrl war verwaist: der Guard fehlte in allen vier Commands
//    (Push/Pull current, Push all, Show status) -- ohne URL/Key baute der Client
//    trotzdem einen Endpunkt und der Nutzer sah einen rohen Transportfehler.
//  - "Stumme Rueckkehr": pushCurrent/pullCurrent taten sichtbar nichts, wenn die
//    aktive Datei zwar im Sync-Ordner liegt, aber keine gesyncte Seite ist
//    (z.B. ein .canvas dort).
//  - pushAll haengt jetzt eine eigene Report-Zeile fuer Depublizieren/Loeschen an.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { App, Notice, TFile } from "obsidian";
import { defineStrings, setLang, t } from "../src/vendor/kit/i18n";
import { STRINGS } from "../src/i18n/strings";
import { DEFAULT_SETTINGS } from "../src/core/settings-types";
import WikijsMaintainerPlugin from "../src/main";
import { formatReport } from "../src/obsidian/format-report";

beforeAll(() => {
  defineStrings(STRINGS);
  setLang("en");
});

beforeEach(() => {
  Notice.instances.length = 0;
});

function makePlugin(withCredentials: boolean): WikijsMaintainerPlugin {
  const app = new App();
  const plugin = new WikijsMaintainerPlugin(app, { id: "wikijs-maintainer", name: "x", version: "0.0.0" });
  plugin.settings = {
    ...DEFAULT_SETTINGS,
    baseUrl: withCredentials ? "https://wiki.example.org" : "",
    apiKey: withCredentials ? "key" : "",
  };
  return plugin;
}

function noticeTexts(): string[] {
  return Notice.instances.map((n) => String(n.message));
}

describe("Zugangsdaten-Guard (alle vier Commands)", () => {
  it("Sync-Status anzeigen: ohne URL/Key nur eine Notice, kein Leaf-Aufbau", async () => {
    const plugin = makePlugin(false);
    await (plugin as unknown as { activateStatusView(): Promise<void> }).activateStatusView();
    expect(noticeTexts()).toEqual([t("notice.noUrl")]);
  });

  it("Aktuelle Notiz pushen: ohne URL/Key nur eine Notice, kein Dienst wird gebaut", async () => {
    const plugin = makePlugin(false);
    const buildService = vi.spyOn(plugin as unknown as { buildService(): unknown }, "buildService");
    const file = new TFile("_published/A.md");
    await (plugin as unknown as { pushCurrent(f: TFile): Promise<void> }).pushCurrent(file);
    expect(noticeTexts()).toEqual([t("notice.noUrl")]);
    expect(buildService).not.toHaveBeenCalled();
  });

  it("Aktuelle Notiz pullen: ohne URL/Key nur eine Notice, kein Dienst wird gebaut", async () => {
    const plugin = makePlugin(false);
    const buildService = vi.spyOn(plugin as unknown as { buildService(): unknown }, "buildService");
    const file = new TFile("_published/A.md");
    await (plugin as unknown as { pullCurrent(f: TFile): Promise<void> }).pullCurrent(file);
    expect(noticeTexts()).toEqual([t("notice.noUrl")]);
    expect(buildService).not.toHaveBeenCalled();
  });

  it("Alle Aenderungen pushen: ohne URL/Key nur eine Notice, kein Dienst wird gebaut", async () => {
    const plugin = makePlugin(false);
    const buildService = vi.spyOn(plugin as unknown as { buildService(): unknown }, "buildService");
    await (plugin as unknown as { pushAll(): Promise<void> }).pushAll();
    expect(noticeTexts()).toEqual([t("notice.noUrl")]);
    expect(buildService).not.toHaveBeenCalled();
  });
});

describe("Stumme Rueckkehr fuer nicht-synchronisierbare Dateien", () => {
  function withFakeService(plugin: WikijsMaintainerPlugin, plan: unknown): void {
    (plugin as unknown as { buildService(): unknown }).buildService = () =>
      ({ buildPlan: () => Promise.resolve(plan) }) as never;
  }

  it("pushCurrent meldet notSyncable statt nichts zu tun, wenn die Datei im Sync-Ordner liegt, aber kein Plan-Eintrag existiert", async () => {
    const plugin = makePlugin(true);
    withFakeService(plugin, { entries: [], meta: new Map(), collisions: [], ambiguousNames: [] });
    const file = new TFile("_published/Not-A-Page.canvas");
    await (plugin as unknown as { pushCurrent(f: TFile): Promise<void> }).pushCurrent(file);
    expect(noticeTexts()).toEqual([t("notice.notSyncable", "not-a-pagecanvas")]);
  });

  it("pullCurrent meldet notSyncable statt nichts zu tun, wenn die Datei im Sync-Ordner liegt, aber kein Plan-Eintrag existiert", async () => {
    const plugin = makePlugin(true);
    withFakeService(plugin, { entries: [], meta: new Map(), collisions: [], ambiguousNames: [] });
    const file = new TFile("_published/Not-A-Page.canvas");
    await (plugin as unknown as { pullCurrent(f: TFile): Promise<void> }).pullCurrent(file);
    expect(noticeTexts()).toEqual([t("notice.notSyncable", "not-a-pagecanvas")]);
  });
});

describe("pushAll — Report-Zeile fuer Depublizieren/Loeschen", () => {
  it("zeigt eine eigene Zeile, wenn removed > 0 ist, statt es in 'aktualisiert' zu verstecken", async () => {
    const plugin = makePlugin(true);
    (plugin as unknown as { buildService(): unknown }).buildService = () =>
      ({
        buildPlan: () => Promise.resolve({ entries: [], meta: new Map(), collisions: [], ambiguousNames: [] }),
        pushAll: () =>
          Promise.resolve({
            created: 0, updated: 2, blocked: 0, skipped: 0, removed: 3,
            unresolvedLinks: 0, skippedEmbeds: 0, errors: [],
          }),
      }) as never;
    await (plugin as unknown as { pushAll(): Promise<void> }).pushAll();
    expect(noticeTexts()[0]).toContain(t("report.removed", 3));
  });

  it("laesst die Zeile weg, wenn removed 0 ist", async () => {
    const plugin = makePlugin(true);
    (plugin as unknown as { buildService(): unknown }).buildService = () =>
      ({
        buildPlan: () => Promise.resolve({ entries: [], meta: new Map(), collisions: [], ambiguousNames: [] }),
        pushAll: () =>
          Promise.resolve({
            created: 1, updated: 0, blocked: 0, skipped: 0, removed: 0,
            unresolvedLinks: 0, skippedEmbeds: 0, errors: [],
          }),
      }) as never;
    await (plugin as unknown as { pushAll(): Promise<void> }).pushAll();
    expect(noticeTexts()[0]).not.toContain("Unpublished/deleted");
  });
});

describe("Sammel-Push-Report — Fehler nennen ihre Ursache", () => {
  // Befund aus dem GUI-Smoke am 2026-08-12: die Abschluss-Meldung sagte
  // "Fehler: 2" und sonst nichts. Ohne direkten API-Zugriff war daraus nicht
  // abzuleiten, WAS fehlschlug — der Nutzer steht vor einer Zahl. Die Ursachen
  // liegen im Report bereits vor (`errors: {wikiPath, message}[]`), sie wurden
  // nur nicht gezeigt.
  it("listet je Fehler den Wiki-Pfad und die Server-Meldung", () => {
    const report = {
      created: 0, updated: 0, blocked: 0, skipped: 0, removed: 0,
      unresolvedLinks: 0, skippedEmbeds: 0,
      errors: [
        { wikiPath: "transformations-probe", message: "Depublizieren fehlgeschlagen: Page content cannot be empty." },
        { wikiPath: "test", message: "Depublizieren fehlgeschlagen: Page content cannot be empty." },
      ],
    };
    const text = formatReport(report);
    expect(text).toContain("transformations-probe");
    expect(text).toContain("Page content cannot be empty.");
    expect(text).toContain("test");
  });

  it("nennt bei sehr vielen Fehlern nicht jeden einzeln, sondern deckelt und sagt es", () => {
    const errors = Array.from({ length: 9 }, (_, i) => ({ wikiPath: `seite-${i}`, message: "kaputt" }));
    const text = formatReport({
      created: 0, updated: 0, blocked: 0, skipped: 0, removed: 0,
      unresolvedLinks: 0, skippedEmbeds: 0, errors,
    });
    expect(text).toContain("seite-0");
    expect(text).not.toContain("seite-8");
    expect(text).toContain("9");
  });

  it("bleibt bei einem fehlerfreien Lauf unveraendert knapp", () => {
    const text = formatReport({
      created: 2, updated: 1, blocked: 0, skipped: 0, removed: 0,
      unresolvedLinks: 0, skippedEmbeds: 0, errors: [],
    });
    expect(text.split("\n")).toHaveLength(1);
  });
});
