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
    expect(noticeTexts()).toEqual([t("notice.notSyncable", "not-a-page")]);
  });

  it("pullCurrent meldet notSyncable statt nichts zu tun, wenn die Datei im Sync-Ordner liegt, aber kein Plan-Eintrag existiert", async () => {
    const plugin = makePlugin(true);
    withFakeService(plugin, { entries: [], meta: new Map(), collisions: [], ambiguousNames: [] });
    const file = new TFile("_published/Not-A-Page.canvas");
    await (plugin as unknown as { pullCurrent(f: TFile): Promise<void> }).pullCurrent(file);
    expect(noticeTexts()).toEqual([t("notice.notSyncable", "not-a-page")]);
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

// ---------------------------------------------------------------------------
// Die Gesamtreview hat die Testluecke in main.ts als die riskanteste benannt --
// genau dort lebte der eine Eintrittspunkt-Fehler, den die Umsetzung produziert hat.
// Was hier folgt, deckt die Zweige, die bis 2026-08-14 offen waren: die Sync-Ordner-
// Grenze, die Fehlerpfade (samt der Fehler-Einstufung, die der GUI-Smoke bereits
// einmal als "Forbidden" beim Nutzer landen sah) und den Schreib-Adapter, der als
// einziger Teil dieser Datei Dateien im Vault anlegt.
// ---------------------------------------------------------------------------

function fakeService(plugin: WikijsMaintainerPlugin, impl: Record<string, unknown>): void {
  (plugin as unknown as { buildService(): unknown }).buildService = () => impl as never;
}

const planWithEntry = (wikiPath: string) => ({
  entries: [{ wikiPath, state: "update" as const }],
  meta: new Map([[wikiPath, { content: "c", title: "t", description: "", tags: [], unresolved: [], skippedEmbeds: [] }]]),
  collisions: [],
  ambiguousNames: [],
});

describe("Sync-Ordner-Grenze", () => {
  it("pushCurrent lehnt eine Datei ausserhalb des Sync-Ordners ab, ohne einen Plan zu bauen", async () => {
    const plugin = makePlugin(true);
    const buildPlan = vi.fn();
    fakeService(plugin, { buildPlan });
    await (plugin as unknown as { pushCurrent(f: TFile): Promise<void> }).pushCurrent(new TFile("10_Werkstatt/Entwurf.md"));
    expect(noticeTexts()).toEqual([t("notice.outsideRoot", DEFAULT_SETTINGS.syncRoot)]);
    expect(buildPlan).not.toHaveBeenCalled();
  });

  it("pullCurrent lehnt eine Datei ausserhalb des Sync-Ordners ebenso ab", async () => {
    const plugin = makePlugin(true);
    const buildPlan = vi.fn();
    fakeService(plugin, { buildPlan });
    await (plugin as unknown as { pullCurrent(f: TFile): Promise<void> }).pullCurrent(new TFile("10_Werkstatt/Entwurf.md"));
    expect(noticeTexts()).toEqual([t("notice.outsideRoot", DEFAULT_SETTINGS.syncRoot)]);
    expect(buildPlan).not.toHaveBeenCalled();
  });
});

describe("Ergebnis-Meldungen der Einzel-Commands", () => {
  it("pushCurrent meldet das Ergebnis des Pushs", async () => {
    const plugin = makePlugin(true);
    fakeService(plugin, {
      buildPlan: () => Promise.resolve(planWithEntry("a")),
      pushOne: () => Promise.resolve({ kind: "updated" }),
    });
    await (plugin as unknown as { pushCurrent(f: TFile): Promise<void> }).pushCurrent(new TFile("_published/A.md"));
    expect(noticeTexts()).toEqual([t("notice.pushed", "a")]);
  });

  it("pullCurrent meldet das Ergebnis des Pulls", async () => {
    const plugin = makePlugin(true);
    fakeService(plugin, {
      buildPlan: () => Promise.resolve(planWithEntry("a")),
      pullOne: () => Promise.resolve({ kind: "written", vaultPath: "_published/A.md" }),
    });
    await (plugin as unknown as { pullCurrent(f: TFile): Promise<void> }).pullCurrent(new TFile("_published/A.md"));
    expect(noticeTexts()).toEqual([t("notice.pulled", "a")]);
  });
});

// Der Befund des ersten GUI-Smokes (2026-08-12) in seiner allgemeinen Form: der Client
// stuft jeden Fehler ein, und diese Einstufung muss in der Meldung ankommen. Fuer die
// drei Eintrittspunkte war das bis dahin nur an einem Ort belegt.
describe("Fehler nennen ihre Art, nicht ihren Wortlaut", () => {
  const rejected = () => Object.assign(new Error("Forbidden"), { kind: "auth" });

  it("pushCurrent uebersetzt einen abgelehnten API-Schluessel", async () => {
    const plugin = makePlugin(true);
    fakeService(plugin, {
      buildPlan: () => Promise.resolve(planWithEntry("a")),
      pushOne: () => Promise.reject(rejected()),
    });
    await (plugin as unknown as { pushCurrent(f: TFile): Promise<void> }).pushCurrent(new TFile("_published/A.md"));
    expect(noticeTexts()).toEqual([t("notice.authFailed")]);
  });

  it("pullCurrent uebersetzt einen abgelehnten API-Schluessel", async () => {
    const plugin = makePlugin(true);
    fakeService(plugin, {
      buildPlan: () => Promise.resolve(planWithEntry("a")),
      pullOne: () => Promise.reject(rejected()),
    });
    await (plugin as unknown as { pullCurrent(f: TFile): Promise<void> }).pullCurrent(new TFile("_published/A.md"));
    expect(noticeTexts()).toEqual([t("notice.authFailed")]);
  });

  it("pushAll uebersetzt einen Netzwerkfehler, statt den Lauf stumm enden zu lassen", async () => {
    const plugin = makePlugin(true);
    fakeService(plugin, {
      buildPlan: () => Promise.reject(Object.assign(new Error("socket hang up"), { kind: "network" })),
    });
    await (plugin as unknown as { pushAll(): Promise<void> }).pushAll();
    expect(noticeTexts()).toEqual([t("notice.unreachable", "socket hang up")]);
  });
});

// Der einzige Teil von main.ts, der Dateien im Vault anlegt -- und bis 2026-08-14 der
// einzige ungetestete Schreibpfad des Plugins. Der Adapter steckt in den SyncDeps, die
// buildService() zusammensetzt; er wird hier ueber genau diesen Weg geholt, damit der
// Test die echte Verdrahtung prueft und nicht eine nachgebaute.
describe("writeNote-Adapter (Pull schreibt in den Vault)", () => {
  function vaultDouble(plugin: WikijsMaintainerPlugin, existingFile: unknown = null) {
    const createdFolders: string[] = [];
    const knownFolders = new Set<string>();
    const vault = (plugin as unknown as { app: { vault: Record<string, unknown> } }).app.vault;
    vault.getFolderByPath = vi.fn((p: string) => (knownFolders.has(p) ? {} : null));
    vault.createFolder = vi.fn(async (p: string) => { createdFolders.push(p); knownFolders.add(p); });
    vault.getFileByPath = vi.fn(() => existingFile);
    vault.create = vi.fn(async () => new TFile());
    vault.modify = vi.fn(async () => undefined);
    return { createdFolders, vault };
  }

  function writeNoteOf(plugin: WikijsMaintainerPlugin): (p: string, c: string) => Promise<void> {
    const service = (plugin as unknown as { buildService(): { deps: { writeNote: (p: string, c: string) => Promise<void> } } }).buildService();
    return service.deps.writeNote;
  }

  it("legt fehlende Zwischenordner Ebene fuer Ebene an und erzeugt die Datei", async () => {
    const plugin = makePlugin(true);
    const { createdFolders, vault } = vaultDouble(plugin);
    await writeNoteOf(plugin)("_published/Netzwerk/DNS/Setup.md", "Inhalt");
    expect(createdFolders).toEqual(["_published", "_published/Netzwerk", "_published/Netzwerk/DNS"]);
    expect(vault.create).toHaveBeenCalledWith("_published/Netzwerk/DNS/Setup.md", "Inhalt");
    expect(vault.modify).not.toHaveBeenCalled();
  });

  it("ueberschreibt eine bereits vorhandene Datei, statt sie ein zweites Mal anzulegen", async () => {
    const plugin = makePlugin(true);
    const existing = new TFile("_published/A.md");
    const { vault } = vaultDouble(plugin, existing);
    await writeNoteOf(plugin)("_published/A.md", "neuer Inhalt");
    expect(vault.modify).toHaveBeenCalledWith(existing, "neuer Inhalt");
    expect(vault.create).not.toHaveBeenCalled();
  });
});

// Die beiden checkCallback-Commands duerfen ohne aktive Datei gar nicht erst in der
// Palette erscheinen -- sonst startet ein Klick eine Aktion ohne Bezugspunkt.
describe("Command-Registrierung", () => {
  it("blendet Push/Pull der aktuellen Notiz aus, solange keine Datei aktiv ist", async () => {
    const plugin = makePlugin(true);
    await plugin.onload();
    const commands = (plugin as unknown as { commands: { id: string; checkCallback?: (c: boolean) => boolean }[] }).commands;
    const ids = commands.map((c) => c.id);
    expect(ids).toContain("push-current-note");
    expect(ids).toContain("pull-current-note");
    for (const id of ["push-current-note", "pull-current-note"]) {
      const cmd = commands.find((c) => c.id === id);
      expect(cmd?.checkCallback?.(true)).toBe(false);
    }
  });
});
