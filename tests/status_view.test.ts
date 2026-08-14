// Deckt die Button-Sichtbarkeitsregeln der Status-Ansicht ab, die bisher nur durch
// Code-Lesen belegt waren (Fix-Runde 1 zu Task 15, Important-Befund): Pull nur fuer
// remote-changed/new-remote (pullOne liefert fuer alles andere nur { kind: "skipped" }
// -- ein wirkungsloser Knopf ist schlimmer als keiner), Push gesperrt bei
// Slug-Kollision, Warnblock bei mehrdeutigen Namen sperrt NICHTS.
import { describe, expect, it, beforeAll, beforeEach, vi } from "vitest";
import { Notice, WorkspaceLeaf } from "obsidian";
import { defineStrings, setLang, t } from "../src/vendor/kit/i18n";
import { STRINGS } from "../src/i18n/strings";
import { WikijsStatusView } from "../src/obsidian/status-view";
import type { SyncEntry } from "../src/core/sync-plan";
import type { TransformResult } from "../src/core/transform";
import type { BuiltPlan, SyncService } from "../src/obsidian/sync-service";

beforeAll(() => {
  defineStrings(STRINGS);
  setLang("en");
});

beforeEach(() => {
  Notice.instances.length = 0;
});

function meta(): TransformResult {
  return { content: "c", title: "t", description: "d", tags: [], unresolved: [], skippedEmbeds: [] };
}

function entry(wikiPath: string, state: SyncEntry["state"]): SyncEntry {
  return { wikiPath, state };
}

/** Findet die `Setting`-Instanz einer Zeile ueber die vom Mock in `settingEl.__setting`
 *  abgelegte Rueckreferenz -- der Mock haengt jede Zeile als `.setting-item`-Div in
 *  den Container, das erlaubt eine reine DOM-Traversal ohne die View selbst
 *  instrumentieren zu muessen. */
function findRow(container: any, name: string): any {
  const rows = container.querySelectorAll(".setting-item") as any[];
  const found = rows.find((el) => el.__setting?.nameValue === name);
  if (found === undefined) throw new Error(`Zeile nicht gefunden: ${name}`);
  return found.__setting;
}

function buttonTexts(setting: any): string[] {
  return setting.components
    .filter((c: any) => typeof c.textValue === "string")
    .map((c: any) => c.textValue);
}

/** Findet den Button mit dem gegebenen Text in einer Zeile und loest seinen
 *  aufgezeichneten Klick-Callback aus (s. ButtonComponent im vendorten Mock). */
async function clickButton(setting: any, text: string): Promise<void> {
  const btn = setting.components.find((c: any) => c.textValue === text);
  if (btn === undefined) throw new Error(`Knopf nicht gefunden: ${text}`);
  await btn.clickCB();
}

function noticeTexts(): string[] {
  return Notice.instances.map((n) => String(n.message));
}

async function renderPlan(plan: BuiltPlan): Promise<any> {
  const service = {
    buildPlan: async () => plan,
    pushOne: async () => ({ kind: "updated" }) as const,
    pullOne: async () => ({ kind: "skipped" }) as const,
  } as unknown as SyncService;
  const view = new WikijsStatusView(new WorkspaceLeaf(), () => service);
  await view.onOpen();
  return view.contentEl;
}

describe("WikijsStatusView — Button-Sichtbarkeit", () => {
  it("remote-changed bekommt einen Pull-Knopf", async () => {
    const wikiPath = "a/remote-changed.md";
    const plan: BuiltPlan = {
      entries: [entry(wikiPath, "remote-changed")],
      meta: new Map(),
      collisions: [],
      ambiguousNames: [],
    };
    const container = await renderPlan(plan);
    const row = findRow(container, wikiPath);
    expect(buttonTexts(row)).toContain(t("view.pull"));
  });

  it("conflict bekommt KEINEN Pull-Knopf, aber einen Push-Knopf", async () => {
    const wikiPath = "a/conflict.md";
    const plan: BuiltPlan = {
      entries: [entry(wikiPath, "conflict")],
      meta: new Map([[wikiPath, meta()]]),
      collisions: [],
      ambiguousNames: [],
    };
    const container = await renderPlan(plan);
    const row = findRow(container, wikiPath);
    const texts = buttonTexts(row);
    expect(texts).not.toContain(t("view.pull"));
    expect(texts).toContain(t("view.push"));
  });

  it("removed-locally bekommt KEINEN Pull-Knopf", async () => {
    const wikiPath = "a/removed-locally.md";
    const plan: BuiltPlan = {
      entries: [entry(wikiPath, "removed-locally")],
      meta: new Map(),
      collisions: [],
      ambiguousNames: [],
    };
    const container = await renderPlan(plan);
    const row = findRow(container, wikiPath);
    expect(buttonTexts(row)).not.toContain(t("view.pull"));
  });

  it("ein Pfad mit Slug-Kollision bekommt KEINEN Push-Knopf", async () => {
    const wikiPath = "a/collision.md";
    const plan: BuiltPlan = {
      entries: [entry(wikiPath, "create")],
      meta: new Map([[wikiPath, meta()]]),
      collisions: [{ wikiPath, vaultPaths: ["a/collision.md", "a/Collision.md"] }],
      ambiguousNames: [],
    };
    const container = await renderPlan(plan);
    const row = findRow(container, wikiPath);
    expect(buttonTexts(row)).not.toContain(t("view.push"));
  });

  it("ein mehrdeutiger Name sperrt nichts: Knoepfe bleiben, Warnblock steht im DOM", async () => {
    const wikiPath = "a/ambiguous.md";
    const plan: BuiltPlan = {
      entries: [entry(wikiPath, "create")],
      meta: new Map([[wikiPath, meta()]]),
      collisions: [],
      ambiguousNames: [{ name: "ambiguous", vaultPaths: ["a/ambiguous.md", "b/ambiguous.md"] }],
    };
    const container = await renderPlan(plan);
    const row = findRow(container, wikiPath);
    expect(buttonTexts(row)).toContain(t("view.push"));
    const warnBoxes = container.querySelectorAll(".wikijs-ambiguous");
    expect(warnBoxes.length).toBe(1);
  });
});

// Important 1: der Klick-Handler schloss bisher `entry`/`meta`/`plan.collisions` aus dem
// letzten refresh() ein und reichte sie unveraendert an pushOne/pullOne -- der Drift-Guard
// im Dienst wird live nachgezogen, Inhalt und Kollisionsliste dagegen NICHT. Ein Klick baut
// jetzt den Plan neu und schlaegt den Eintrag ueber seinen wikiPath nach.
describe("WikijsStatusView — Push/Pull bauen den Plan beim Klick neu (Important 1)", () => {
  it("Push ruft buildPlan() ein zweites Mal auf und pusht den FRISCHEN Eintrag, nicht die Momentaufnahme aus dem Refresh", async () => {
    const wikiPath = "a/push-me.md";
    const staleMeta = meta();
    const staleEntry = entry(wikiPath, "update");
    const freshMeta: TransformResult = { ...meta(), content: "frisch" };
    const freshEntry: SyncEntry = { wikiPath, state: "update", pageId: 9 };

    const initialPlan: BuiltPlan = {
      entries: [staleEntry], meta: new Map([[wikiPath, staleMeta]]), collisions: [], ambiguousNames: [],
    };
    const freshPlan: BuiltPlan = {
      entries: [freshEntry], meta: new Map([[wikiPath, freshMeta]]), collisions: [], ambiguousNames: [],
    };

    const buildPlan = vi.fn().mockResolvedValueOnce(initialPlan).mockResolvedValue(freshPlan);
    const pushOne = vi.fn().mockResolvedValue({ kind: "updated" });
    const service = { buildPlan, pushOne, pullOne: vi.fn() } as unknown as SyncService;

    const view = new WikijsStatusView(new WorkspaceLeaf(), () => service);
    await view.onOpen();
    const row = findRow(view.contentEl, wikiPath);
    await clickButton(row, t("view.push"));

    expect(buildPlan).toHaveBeenCalledTimes(3); // 1x initialer refresh, 1x beim Klick, 1x refresh() danach
    expect(pushOne).toHaveBeenCalledTimes(1);
    expect(pushOne).toHaveBeenCalledWith(freshEntry, freshMeta, freshPlan.collisions);
    expect(pushOne).not.toHaveBeenCalledWith(staleEntry, staleMeta, initialPlan.collisions);
  });

  it("Push unterbleibt, wenn der Pfad zwischen Refresh und Klick in eine Slug-Kollision geraten ist", async () => {
    const wikiPath = "a/now-colliding.md";
    const initialPlan: BuiltPlan = {
      entries: [entry(wikiPath, "create")], meta: new Map([[wikiPath, meta()]]), collisions: [], ambiguousNames: [],
    };
    // Der Klick baut den Plan neu -- inzwischen ist eine zweite Datei auf denselben
    // Wiki-Pfad gefallen (Szenario B aus dem Befund).
    const freshPlan: BuiltPlan = {
      entries: [entry(wikiPath, "create")],
      meta: new Map([[wikiPath, meta()]]),
      collisions: [{ wikiPath, vaultPaths: ["a/now-colliding.md", "a/Now-Colliding.md"] }],
      ambiguousNames: [],
    };
    const buildPlan = vi.fn().mockResolvedValueOnce(initialPlan).mockResolvedValue(freshPlan);
    const pushOne = vi.fn().mockResolvedValue({ kind: "updated" });
    const service = { buildPlan, pushOne, pullOne: vi.fn() } as unknown as SyncService;

    const view = new WikijsStatusView(new WorkspaceLeaf(), () => service);
    await view.onOpen();
    const row = findRow(view.contentEl, wikiPath);
    await clickButton(row, t("view.push"));

    expect(pushOne).not.toHaveBeenCalled();
  });

  it("Push unterbleibt, wenn der Eintrag zwischen Refresh und Klick aus dem Plan verschwunden ist", async () => {
    const wikiPath = "a/gone.md";
    const initialPlan: BuiltPlan = {
      entries: [entry(wikiPath, "create")], meta: new Map([[wikiPath, meta()]]), collisions: [], ambiguousNames: [],
    };
    const freshPlan: BuiltPlan = { entries: [], meta: new Map(), collisions: [], ambiguousNames: [] };
    const buildPlan = vi.fn().mockResolvedValueOnce(initialPlan).mockResolvedValue(freshPlan);
    const pushOne = vi.fn().mockResolvedValue({ kind: "updated" });
    const service = { buildPlan, pushOne, pullOne: vi.fn() } as unknown as SyncService;

    const view = new WikijsStatusView(new WorkspaceLeaf(), () => service);
    await view.onOpen();
    const row = findRow(view.contentEl, wikiPath);
    await clickButton(row, t("view.push"));

    expect(pushOne).not.toHaveBeenCalled();
  });

  it("Pull baut den Plan ebenfalls neu und pullt den FRISCHEN Eintrag", async () => {
    const wikiPath = "a/pull-me.md";
    const initialPlan: BuiltPlan = {
      entries: [entry(wikiPath, "remote-changed")], meta: new Map(), collisions: [], ambiguousNames: [],
    };
    const freshEntry: SyncEntry = { wikiPath, state: "remote-changed", pageId: 3 };
    const freshPlan: BuiltPlan = { entries: [freshEntry], meta: new Map(), collisions: [], ambiguousNames: [] };
    const buildPlan = vi.fn().mockResolvedValueOnce(initialPlan).mockResolvedValue(freshPlan);
    const pullOne = vi.fn().mockResolvedValue({ kind: "written", vaultPath: "x" });
    const service = { buildPlan, pushOne: vi.fn(), pullOne } as unknown as SyncService;

    const view = new WikijsStatusView(new WorkspaceLeaf(), () => service);
    await view.onOpen();
    const row = findRow(view.contentEl, wikiPath);
    await clickButton(row, t("view.pull"));

    expect(buildPlan).toHaveBeenCalledTimes(3); // 1x initialer refresh, 1x beim Klick, 1x refresh() danach
    expect(pullOne).toHaveBeenCalledWith(freshEntry);
  });
});

// Important 2: Push/Pull in der Ansicht verschluckten Ergebnis und Fehler -- der
// Rueckgabewert wurde verworfen, eine Rejection wurde zu einer unbehandelten Promise-
// Rejection. Beide Commands zeigen an dieser Stelle laengst eine Notice; die Ansicht jetzt
// auch, ueber dasselbe geteilte Modul (src/obsidian/describe-outcome.ts).
describe("WikijsStatusView — Ergebnis und Fehler werden als Notice sichtbar (Important 2)", () => {
  it("Push zeigt das Ergebnis als Notice", async () => {
    const wikiPath = "a/notice-push.md";
    const plan: BuiltPlan = {
      entries: [entry(wikiPath, "create")], meta: new Map([[wikiPath, meta()]]), collisions: [], ambiguousNames: [],
    };
    const service = {
      buildPlan: vi.fn().mockResolvedValue(plan),
      pushOne: vi.fn().mockResolvedValue({ kind: "created" }),
      pullOne: vi.fn(),
    } as unknown as SyncService;

    const view = new WikijsStatusView(new WorkspaceLeaf(), () => service);
    await view.onOpen();
    const row = findRow(view.contentEl, wikiPath);
    await clickButton(row, t("view.push"));

    expect(noticeTexts()).toContain(t("notice.created", wikiPath));
  });

  it("Push zeigt einen Fehler als Notice, statt die Ablehnung unbehandelt zu lassen (z.B. Konflikt-Dialog abgebrochen)", async () => {
    const wikiPath = "a/notice-push-error.md";
    const plan: BuiltPlan = {
      entries: [entry(wikiPath, "create")], meta: new Map([[wikiPath, meta()]]), collisions: [], ambiguousNames: [],
    };
    const service = {
      buildPlan: vi.fn().mockResolvedValue(plan),
      pushOne: vi.fn().mockRejectedValue(new Error("wiki down")),
      pullOne: vi.fn(),
    } as unknown as SyncService;

    const view = new WikijsStatusView(new WorkspaceLeaf(), () => service);
    await view.onOpen();
    const row = findRow(view.contentEl, wikiPath);
    await clickButton(row, t("view.push"));

    expect(noticeTexts()).toContain(t("notice.error", "wiki down"));
  });

  it("Pull zeigt das Ergebnis als Notice", async () => {
    const wikiPath = "a/notice-pull.md";
    const plan: BuiltPlan = {
      entries: [entry(wikiPath, "remote-changed")], meta: new Map(), collisions: [], ambiguousNames: [],
    };
    const service = {
      buildPlan: vi.fn().mockResolvedValue(plan),
      pushOne: vi.fn(),
      pullOne: vi.fn().mockResolvedValue({ kind: "written", vaultPath: "x" }),
    } as unknown as SyncService;

    const view = new WikijsStatusView(new WorkspaceLeaf(), () => service);
    await view.onOpen();
    const row = findRow(view.contentEl, wikiPath);
    await clickButton(row, t("view.pull"));

    expect(noticeTexts()).toContain(t("notice.pulled", wikiPath));
  });

  it("Pull zeigt einen Fehler als Notice, statt die Ablehnung unbehandelt zu lassen", async () => {
    const wikiPath = "a/notice-pull-error.md";
    const plan: BuiltPlan = {
      entries: [entry(wikiPath, "remote-changed")], meta: new Map(), collisions: [], ambiguousNames: [],
    };
    const service = {
      buildPlan: vi.fn().mockResolvedValue(plan),
      pushOne: vi.fn(),
      pullOne: vi.fn().mockRejectedValue(new Error("network down")),
    } as unknown as SyncService;

    const view = new WikijsStatusView(new WorkspaceLeaf(), () => service);
    await view.onOpen();
    const row = findRow(view.contentEl, wikiPath);
    await clickButton(row, t("view.pull"));

    expect(noticeTexts()).toContain(t("notice.error", "network down"));
  });
});

// Der Klick baut den Plan neu (s. Kommentar an handlePush). Bis 2026-08-14 fuehrten
// drei Ausgaenge dieses frischen Plans zu keinem Push UND zu keiner Meldung: eine
// inzwischen entstandene Kollision, ein verschwundener Eintrag, ein fehlendes meta.
// Das erfuellte den Buchstaben von "kein Push" und rieb sich mit dem Geist von
// "nichts stillschweigend" -- derselbe Befund, den der erste GUI-Smoke schon einmal
// als "Fehler: 2" ohne Ursache geliefert hat.
describe("WikijsStatusView — kein stiller Abbruch im Klick-Handler", () => {
  /** Erster buildPlan()-Aufruf liefert den Render-Plan, jeder weitere den Klick-Plan. */
  function twoPlans(first: BuiltPlan, then: BuiltPlan, over: Record<string, unknown> = {}) {
    let calls = 0;
    return {
      buildPlan: vi.fn(async () => (calls++ === 0 ? first : then)),
      pushOne: vi.fn().mockResolvedValue({ kind: "updated" }),
      pullOne: vi.fn().mockResolvedValue({ kind: "written", vaultPath: "x" }),
      ...over,
    } as unknown as SyncService;
  }

  const planWith = (wikiPath: string, over: Partial<BuiltPlan> = {}): BuiltPlan => ({
    entries: [entry(wikiPath, "update")],
    meta: new Map([[wikiPath, meta()]]),
    collisions: [],
    ambiguousNames: [],
    ...over,
  });

  it("meldet eine zwischen Refresh und Klick entstandene Slug-Kollision", async () => {
    const wikiPath = "a/late-collision.md";
    const service = twoPlans(
      planWith(wikiPath),
      planWith(wikiPath, { collisions: [{ wikiPath, vaultPaths: ["A.md", "a.md"] }] }),
    );
    const view = new WikijsStatusView(new WorkspaceLeaf(), () => service);
    await view.onOpen();
    await clickButton(findRow(view.contentEl, wikiPath), t("view.push"));

    expect(noticeTexts()).toContain(t("notice.collision", wikiPath));
    expect(service.pushOne).not.toHaveBeenCalled();
  });

  it("meldet einen Eintrag, der beim Klick nicht mehr im Plan steht", async () => {
    const wikiPath = "a/vanished.md";
    const service = twoPlans(
      planWith(wikiPath),
      { entries: [], meta: new Map(), collisions: [], ambiguousNames: [] },
    );
    const view = new WikijsStatusView(new WorkspaceLeaf(), () => service);
    await view.onOpen();
    await clickButton(findRow(view.contentEl, wikiPath), t("view.push"));

    expect(noticeTexts()).toContain(t("notice.vanished", wikiPath));
    expect(service.pushOne).not.toHaveBeenCalled();
  });

  it("meldet einen Eintrag, dessen lokale Notiz beim Klick fehlt (kein meta)", async () => {
    const wikiPath = "a/no-meta.md";
    const service = twoPlans(planWith(wikiPath), planWith(wikiPath, { meta: new Map() }));
    const view = new WikijsStatusView(new WorkspaceLeaf(), () => service);
    await view.onOpen();
    await clickButton(findRow(view.contentEl, wikiPath), t("view.push"));

    expect(noticeTexts()).toContain(t("notice.noLocal", wikiPath));
    expect(service.pushOne).not.toHaveBeenCalled();
  });

  it("meldet auch beim Pull einen verschwundenen Eintrag", async () => {
    const wikiPath = "a/vanished-pull.md";
    const service = twoPlans(
      { entries: [entry(wikiPath, "remote-changed")], meta: new Map(), collisions: [], ambiguousNames: [] },
      { entries: [], meta: new Map(), collisions: [], ambiguousNames: [] },
    );
    const view = new WikijsStatusView(new WorkspaceLeaf(), () => service);
    await view.onOpen();
    await clickButton(findRow(view.contentEl, wikiPath), t("view.pull"));

    expect(noticeTexts()).toContain(t("notice.vanished", wikiPath));
    expect(service.pullOne).not.toHaveBeenCalled();
  });

  // Der GUI-Smoke am 2026-08-12 hat diesen Fehler in main.ts gefunden und dort behoben:
  // der Client stuft einen abgelehnten Schluessel als `kind: "auth"` ein, die Oberflaeche
  // zeigte trotzdem das nackte "Forbidden". Die Status-Ansicht las die Einstufung
  // weiterhin nicht -- derselbe Fehler, nur eine Tuer weiter.
  it("uebersetzt einen abgelehnten API-Schluessel auch hier, statt 'Forbidden' zu zeigen", async () => {
    const wikiPath = "a/auth.md";
    const rejected = Object.assign(new Error("Forbidden"), { kind: "auth" });
    const service = twoPlans(planWith(wikiPath), planWith(wikiPath), {
      pushOne: vi.fn().mockRejectedValue(rejected),
    });
    const view = new WikijsStatusView(new WorkspaceLeaf(), () => service);
    await view.onOpen();
    await clickButton(findRow(view.contentEl, wikiPath), t("view.push"));

    expect(noticeTexts()).toContain(t("notice.authFailed"));
    expect(noticeTexts()).not.toContain(t("notice.error", "Forbidden"));
  });
});

describe("WikijsStatusView — verwaister Snapshot", () => {
  const stalePlan = (wikiPath: string): BuiltPlan => ({
    entries: [entry(wikiPath, "stale-snapshot")],
    meta: new Map(),
    collisions: [],
    ambiguousNames: [],
  });

  it("bietet fuer einen verwaisten Snapshot einen Verwerfen-Knopf", async () => {
    const wikiPath = "a/stale.md";
    const container = await renderPlan(stalePlan(wikiPath));
    expect(buttonTexts(findRow(container, wikiPath))).toContain(t("view.forget"));
  });

  it("verwirft den Snapshot beim Klick und sagt es", async () => {
    const wikiPath = "a/stale-click.md";
    const service = {
      buildPlan: vi.fn().mockResolvedValue(stalePlan(wikiPath)),
      forgetSnapshot: vi.fn().mockResolvedValue({ kind: "forgotten" }),
    } as unknown as SyncService;
    const view = new WikijsStatusView(new WorkspaceLeaf(), () => service);
    await view.onOpen();
    await clickButton(findRow(view.contentEl, wikiPath), t("view.forget"));

    expect(service.forgetSnapshot).toHaveBeenCalled();
    expect(noticeTexts()).toContain(t("notice.forgotten", wikiPath));
  });

  it("gibt einem gewoehnlichen Eintrag KEINEN Verwerfen-Knopf", async () => {
    const wikiPath = "a/normal.md";
    const container = await renderPlan({
      entries: [entry(wikiPath, "update")],
      meta: new Map([[wikiPath, meta()]]),
      collisions: [],
      ambiguousNames: [],
    });
    expect(buttonTexts(findRow(container, wikiPath))).not.toContain(t("view.forget"));
  });
});

describe("WikijsStatusView — Ausgang aus 'occupied'", () => {
  const occupiedPlan = (wikiPath: string): BuiltPlan => ({
    entries: [entry(wikiPath, "occupied")],
    meta: new Map([[wikiPath, meta()]]),
    collisions: [],
    ambiguousNames: [],
  });

  it("bietet fuer einen belegten Slug einen Uebernehmen-Knopf", async () => {
    const wikiPath = "a/occupied.md";
    const container = await renderPlan(occupiedPlan(wikiPath));
    expect(buttonTexts(findRow(container, wikiPath))).toContain(t("view.adopt"));
  });

  it("meldet die gelungene Uebernahme", async () => {
    const wikiPath = "a/adopt-ok.md";
    const service = {
      buildPlan: vi.fn().mockResolvedValue(occupiedPlan(wikiPath)),
      adoptOccupied: vi.fn().mockResolvedValue({ kind: "adopted" }),
    } as unknown as SyncService;
    const view = new WikijsStatusView(new WorkspaceLeaf(), () => service);
    await view.onOpen();
    await clickButton(findRow(view.contentEl, wikiPath), t("view.adopt"));

    expect(noticeTexts()).toContain(t("notice.adopted", wikiPath));
  });

  // Der Fall, der dem Nutzer etwas sagen MUSS: die Seite drueben ist nicht unsere.
  // Ohne Meldung sieht er nur einen Knopf, der nichts tut.
  it("sagt es, wenn der Wiki-Inhalt abweicht und deshalb nichts uebernommen wurde", async () => {
    const wikiPath = "a/adopt-differs.md";
    const service = {
      buildPlan: vi.fn().mockResolvedValue(occupiedPlan(wikiPath)),
      adoptOccupied: vi.fn().mockResolvedValue({ kind: "blocked", reason: "content-differs" }),
    } as unknown as SyncService;
    const view = new WikijsStatusView(new WorkspaceLeaf(), () => service);
    await view.onOpen();
    await clickButton(findRow(view.contentEl, wikiPath), t("view.adopt"));

    expect(noticeTexts()).toContain(t("notice.contentDiffers", wikiPath));
  });

  it("gibt einem gewoehnlichen Eintrag KEINEN Uebernehmen-Knopf", async () => {
    const wikiPath = "a/plain.md";
    const container = await renderPlan({
      entries: [entry(wikiPath, "update")],
      meta: new Map([[wikiPath, meta()]]),
      collisions: [],
      ambiguousNames: [],
    });
    expect(buttonTexts(findRow(container, wikiPath))).not.toContain(t("view.adopt"));
  });
});

// Minor-Befund aus der Gesamtreview, hier mit erledigt: bei einer blockierten Zeile
// ersetzte der Kollisionshinweis die Zustandsbeschriftung, statt sie zu ergaenzen —
// der Nutzer sah, DASS blockiert ist, aber nicht mehr, was ohne die Kollision passiert waere.
describe("WikijsStatusView — Kollisionshinweis verdeckt den Zustand nicht", () => {
  it("zeigt Zustand und Kollision nebeneinander", async () => {
    const wikiPath = "a/both.md";
    const container = await renderPlan({
      entries: [entry(wikiPath, "create")],
      meta: new Map([[wikiPath, meta()]]),
      collisions: [{ wikiPath, vaultPaths: ["A.md", "a.md"] }],
      ambiguousNames: [],
    });
    const desc = String(findRow(container, wikiPath).descValue);
    expect(desc).toContain(t("status.collision"));
    expect(desc).toContain(t("status.create"));
  });
});
