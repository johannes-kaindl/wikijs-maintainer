import { describe, expect, it, vi } from "vitest";
import { SyncService } from "../src/obsidian/sync-service";
import type { BuiltPlan } from "../src/obsidian/sync-service";
import type { TransformResult } from "../src/core/transform";

const meta = (over: Partial<TransformResult> = {}): TransformResult => ({
  content: "neu", title: "T", description: "", tags: [], unresolved: [], skippedEmbeds: [], ...over,
});

function plan(entries: BuiltPlan["entries"], metaEntries: [string, TransformResult][]): BuiltPlan {
  return { entries, meta: new Map(metaEntries), collisions: [], ambiguousNames: [] };
}

describe("SyncService.pushAll", () => {
  it("zaehlt Anlegen, Aktualisieren und Uebersprungenes getrennt", async () => {
    const client = {
      createPage: vi.fn(() => Promise.resolve({ id: 1, updatedAt: "T2" })),
      updatePage: vi.fn(() => Promise.resolve({ updatedAt: "T2" })),
      fetchUpdatedAt: vi.fn(() => Promise.resolve("T1")),
    };
    const svc = new SyncService({ client: client as never, store: { save: vi.fn(() => Promise.resolve()) } as never, vault: {} as never, syncRoot: () => "_published" });
    const report = await svc.pushAll(plan(
      [
        { wikiPath: "a", state: "create", local: { vaultPath: "x", wikiPath: "a", raw: "r", transformed: "neu" } },
        { wikiPath: "b", state: "update", pageId: 2, local: { vaultPath: "y", wikiPath: "b", raw: "r", transformed: "neu" }, snapshot: { version: 1, wikiPath: "b", pageId: 2, raw: "alt", pushed: "alt", remoteUpdatedAt: "T1" } },
        { wikiPath: "c", state: "unchanged" },
      ],
      [["a", meta()], ["b", meta()], ["c", meta()]],
    ));
    expect(report).toMatchObject({ created: 1, updated: 1, skipped: 1, blocked: 0 });
  });

  it("laeuft nach einem Fehler weiter und sammelt ihn im Report", async () => {
    const client = {
      createPage: vi.fn(() => Promise.reject(new Error("boom"))),
      updatePage: vi.fn(() => Promise.resolve({ updatedAt: "T2" })),
      fetchUpdatedAt: vi.fn(() => Promise.resolve("T1")),
    };
    const svc = new SyncService({ client: client as never, store: { save: vi.fn(() => Promise.resolve()) } as never, vault: {} as never, syncRoot: () => "_published" });
    const report = await svc.pushAll(plan(
      [
        { wikiPath: "a", state: "create", local: { vaultPath: "x", wikiPath: "a", raw: "r", transformed: "neu" } },
        { wikiPath: "b", state: "update", pageId: 2, local: { vaultPath: "y", wikiPath: "b", raw: "r", transformed: "neu" }, snapshot: { version: 1, wikiPath: "b", pageId: 2, raw: "alt", pushed: "alt", remoteUpdatedAt: "T1" } },
      ],
      [["a", meta()], ["b", meta()]],
    ));
    expect(report.errors).toEqual([{ wikiPath: "a", message: "boom" }]);
    expect(report.updated).toBe(1);
  });

  it("summiert die Link-Befunde ueber alle gepushten Seiten", async () => {
    const client = { createPage: vi.fn(() => Promise.resolve({ id: 1, updatedAt: "T2" })), updatePage: vi.fn(), fetchUpdatedAt: vi.fn() };
    const svc = new SyncService({ client: client as never, store: { save: vi.fn(() => Promise.resolve()) } as never, vault: {} as never, syncRoot: () => "_published" });
    const report = await svc.pushAll(plan(
      [{ wikiPath: "a", state: "create", local: { vaultPath: "x", wikiPath: "a", raw: "r", transformed: "neu" } }],
      [["a", meta({ unresolved: ["X", "Y"], skippedEmbeds: ["bild.png"] })]],
    ));
    expect(report.unresolvedLinks).toBe(2);
    expect(report.skippedEmbeds).toBe(1);
  });

  it("depubliziert eine lokal entfernte Seite, wenn der Nutzer den Default waehlt", async () => {
    const client = { unpublishPage: vi.fn(() => Promise.resolve()), deletePage: vi.fn(), createPage: vi.fn(), updatePage: vi.fn(), fetchUpdatedAt: vi.fn() };
    const store = { save: vi.fn(() => Promise.resolve()), remove: vi.fn(() => Promise.resolve()) };
    const svc = new SyncService({
      client: client as never, store: store as never, vault: {} as never, syncRoot: () => "_published",
      askRemoval: vi.fn(() => Promise.resolve("unpublish" as const)),
    });
    const report = await svc.pushAll(plan(
      [{ wikiPath: "a", state: "removed-locally", pageId: 3, snapshot: { version: 1, wikiPath: "a", pageId: 3, raw: "r", pushed: "p", remoteUpdatedAt: "T1" }, remote: { id: 3, path: "a", title: "A", updatedAt: "T1" } }],
      [],
    ));
    expect(client.unpublishPage).toHaveBeenCalledWith(3);
    expect(client.deletePage).not.toHaveBeenCalled();
    expect(store.remove).toHaveBeenCalledWith("a");
    // Minor-Befund: Depublizieren/Loeschen ist die destruktivste Operation eines Laufs
    // und zaehlt deshalb NICHT als "updated" -- ein Report mit zwei Updates und drei
    // Depublizierungen soll "5 aktualisiert" nicht verschleiern koennen.
    expect(report.removed).toBe(1);
    expect(report.updated).toBe(0);
  });

  it("loescht eine lokal entfernte Seite, wenn der Nutzer das explizit waehlt", async () => {
    const client = { unpublishPage: vi.fn(), deletePage: vi.fn(() => Promise.resolve()), createPage: vi.fn(), updatePage: vi.fn(), fetchUpdatedAt: vi.fn() };
    const store = { save: vi.fn(() => Promise.resolve()), remove: vi.fn(() => Promise.resolve()) };
    const svc = new SyncService({
      client: client as never, store: store as never, vault: {} as never, syncRoot: () => "_published",
      askRemoval: vi.fn(() => Promise.resolve("delete" as const)),
    });
    const report = await svc.pushAll(plan(
      [{ wikiPath: "a", state: "removed-locally", pageId: 3 }],
      [],
    ));
    expect(client.deletePage).toHaveBeenCalledWith(3);
    expect(client.unpublishPage).not.toHaveBeenCalled();
    expect(store.remove).toHaveBeenCalledWith("a");
    expect(report.removed).toBe(1);
  });

  it("ruehrt eine lokal entfernte Seite nicht an, wenn der Nutzer 'behalten' waehlt (Esc-Aequivalent)", async () => {
    const client = { unpublishPage: vi.fn(), deletePage: vi.fn(), createPage: vi.fn(), updatePage: vi.fn(), fetchUpdatedAt: vi.fn() };
    const store = { save: vi.fn(() => Promise.resolve()), remove: vi.fn(() => Promise.resolve()) };
    const svc = new SyncService({
      client: client as never, store: store as never, vault: {} as never, syncRoot: () => "_published",
      askRemoval: vi.fn(() => Promise.resolve("keep" as const)),
    });
    const report = await svc.pushAll(plan(
      [{ wikiPath: "a", state: "removed-locally", pageId: 3 }],
      [],
    ));
    expect(client.unpublishPage).not.toHaveBeenCalled();
    expect(client.deletePage).not.toHaveBeenCalled();
    expect(store.remove).not.toHaveBeenCalled();
    expect(report.skipped).toBe(1);
  });

  it("fasst eine lokal entfernte Seite nicht an, wenn kein Aufloeser gestellt ist", async () => {
    const client = { unpublishPage: vi.fn(), deletePage: vi.fn(), createPage: vi.fn(), updatePage: vi.fn(), fetchUpdatedAt: vi.fn() };
    const svc = new SyncService({ client: client as never, store: { save: vi.fn(), remove: vi.fn() } as never, vault: {} as never, syncRoot: () => "_published" });
    await svc.pushAll(plan([{ wikiPath: "a", state: "removed-locally", pageId: 3 }], []));
    expect(client.unpublishPage).not.toHaveBeenCalled();
  });

  it("sammelt einen Fehler beim Depublizieren im Report statt zu werfen", async () => {
    const client = { unpublishPage: vi.fn(() => Promise.reject(new Error("wiki down"))), deletePage: vi.fn(), createPage: vi.fn(), updatePage: vi.fn(), fetchUpdatedAt: vi.fn() };
    const store = { save: vi.fn(() => Promise.resolve()), remove: vi.fn(() => Promise.resolve()) };
    const svc = new SyncService({
      client: client as never, store: store as never, vault: {} as never, syncRoot: () => "_published",
      askRemoval: vi.fn(() => Promise.resolve("unpublish" as const)),
    });
    const report = await svc.pushAll(plan([{ wikiPath: "a", state: "removed-locally", pageId: 3 }], []));
    expect(report.errors).toEqual([{ wikiPath: "a", message: "wiki down" }]);
    expect(store.remove).not.toHaveBeenCalled();
  });
});
