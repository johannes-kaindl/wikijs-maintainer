import { describe, expect, it, vi } from "vitest";
import { SyncService } from "../src/obsidian/sync-service";
import type { SyncEntry } from "../src/core/sync-plan";
import type { TransformResult } from "../src/core/transform";
import type { SlugCollision } from "../src/core/paths";

const meta: TransformResult = {
  content: "neu", title: "T", description: "", tags: [], unresolved: [], skippedEmbeds: [],
};

function service(clientOverrides: Record<string, unknown> = {}, storeOverrides: Record<string, unknown> = {}) {
  const client = {
    fetchUpdatedAt: vi.fn(() => Promise.resolve("T1")),
    createPage: vi.fn(() => Promise.resolve({ id: 5, updatedAt: "T2" })),
    updatePage: vi.fn(() => Promise.resolve({ updatedAt: "T2" })),
    ...clientOverrides,
  };
  const store = { save: vi.fn(() => Promise.resolve()), remove: vi.fn(() => Promise.resolve()), loadAll: vi.fn(() => Promise.resolve([])), ...storeOverrides };
  const svc = new SyncService({
    client: client as never,
    store: store as never,
    vault: {} as never,
    syncRoot: () => "_published",
  });
  return { svc, client, store };
}

const noCollisions: SlugCollision[] = [];

const entry = (over: Partial<SyncEntry>): SyncEntry => ({
  wikiPath: "a",
  state: "update",
  pageId: 5,
  local: { vaultPath: "_published/A.md", wikiPath: "a", raw: "roh", transformed: "neu" },
  snapshot: { version: 1, wikiPath: "a", pageId: 5, raw: "alt", pushed: "alt-t", remoteUpdatedAt: "T1" },
  ...over,
});

describe("SyncService.pushOne", () => {
  it("legt eine neue Seite an und schreibt den Snapshot", async () => {
    const { svc, client, store } = service();
    const out = await svc.pushOne(entry({ state: "create", pageId: undefined, snapshot: undefined }), meta, noCollisions);
    expect(out).toEqual({ kind: "created" });
    expect(client.createPage).toHaveBeenCalledTimes(1);
    expect(store.save).toHaveBeenCalledWith(expect.objectContaining({ wikiPath: "a", pageId: 5, raw: "roh", pushed: "neu", remoteUpdatedAt: "T2" }));
  });

  it("prueft vor dem Update den Drift-Guard und aktualisiert bei Gleichstand", async () => {
    const { svc, client } = service();
    const out = await svc.pushOne(entry({}), meta, noCollisions);
    expect(out).toEqual({ kind: "updated" });
    expect(client.fetchUpdatedAt).toHaveBeenCalledWith(5);
    expect(client.updatePage).toHaveBeenCalledTimes(1);
  });

  it("pusht NICHT, wenn sich das Remote-updatedAt seit dem Plan geaendert hat", async () => {
    const { svc, client } = service({ fetchUpdatedAt: vi.fn(() => Promise.resolve("T-NEU")) });
    const out = await svc.pushOne(entry({}), meta, noCollisions);
    expect(out).toEqual({ kind: "blocked", reason: "drift" });
    expect(client.updatePage).not.toHaveBeenCalled();
  });

  it("pusht NICHT auf eine fremde Seite, die zufaellig denselben Pfad belegt", async () => {
    const { svc, client } = service();
    const out = await svc.pushOne(entry({ state: "occupied", snapshot: undefined }), meta, noCollisions);
    expect(out).toEqual({ kind: "blocked", reason: "occupied" });
    expect(client.updatePage).not.toHaveBeenCalled();
    expect(client.createPage).not.toHaveBeenCalled();
  });

  it("macht nichts bei unveraendertem Stand", async () => {
    const { svc, client } = service();
    const out = await svc.pushOne(entry({ state: "unchanged" }), meta, noCollisions);
    expect(out).toEqual({ kind: "skipped", reason: "unchanged" });
    expect(client.updatePage).not.toHaveBeenCalled();
  });

  it("schreibt bei einem Fehler KEINEN Snapshot — sonst gilt ein misslungener Push als Stand", async () => {
    const { svc, store } = service({ updatePage: vi.fn(() => Promise.reject(new Error("boom"))) });
    await expect(svc.pushOne(entry({}), meta, noCollisions)).rejects.toThrow("boom");
    expect(store.save).not.toHaveBeenCalled();
  });

  it("pusht NICHT auf einen Wiki-Pfad mit Slug-Kollision — Spec § 3: Fehler in der Status-Ansicht, kein Push", async () => {
    const { svc, client } = service();
    const collisions: SlugCollision[] = [{ wikiPath: "a", vaultPaths: ["_published/A.md", "_published/A2.md"] }];
    const out = await svc.pushOne(entry({}), meta, collisions);
    expect(out).toEqual({ kind: "blocked", reason: "collision" });
    expect(client.fetchUpdatedAt).not.toHaveBeenCalled();
    expect(client.updatePage).not.toHaveBeenCalled();
    expect(client.createPage).not.toHaveBeenCalled();
  });

  it("blockiert NICHT pauschal — eine Kollision auf einem anderen Pfad laesst den Push unberuehrt", async () => {
    const { svc, client } = service();
    const collisions: SlugCollision[] = [{ wikiPath: "other", vaultPaths: ["_published/B.md", "_published/B2.md"] }];
    const out = await svc.pushOne(entry({}), meta, collisions);
    expect(out).toEqual({ kind: "updated" });
    expect(client.updatePage).toHaveBeenCalledTimes(1);
  });

  // Die restlichen SyncStates sind heute unbestimmt — dieser Task erfindet fuer sie
  // kein neues Verhalten, sondern schreibt fest, was `pushOne` tatsaechlich tut: ein
  // "sonst"-Fall in der Zustandsverzweigung faengt sie alle als "occupied" ab, weil
  // fuer keinen von ihnen ein eigener Zweig existiert (state !== "create", und
  // entweder local oder snapshot/pageId fehlt oder ist unpassend besetzt).
  //
  // "conflict" ist die Ausnahme: dafuer gibt es seit Task 13 einen eigenen Guard
  // (s. tests/conflict_choice.test.ts) — ohne gestellten Aufloeser wird ein
  // Konflikt-Eintrag IMMER blockiert, unabhaengig vom Drift-Guard.
  it("conflict: lokale UND entfernte Aenderung — ohne Aufloeser blockiert der eigene Konflikt-Guard", async () => {
    const { svc, client } = service();
    const out = await svc.pushOne(entry({ state: "conflict" }), meta, noCollisions);
    expect(out).toEqual({ kind: "blocked", reason: "drift" });
    expect(client.updatePage).not.toHaveBeenCalled();
  });

  it("remote-changed: nur entfernt geaendert, lokal unveraendert — Drift-Guard greift ganz normal", async () => {
    const { svc, client } = service({ fetchUpdatedAt: vi.fn(() => Promise.resolve("T-ANDERS")) });
    const out = await svc.pushOne(entry({ state: "remote-changed" }), meta, noCollisions);
    expect(out).toEqual({ kind: "blocked", reason: "drift" });
    expect(client.updatePage).not.toHaveBeenCalled();
  });

  // Important 3(a): remote-deleted (lokal + Snapshot da, Remote weg) hatte keinen
  // eigenen Zweig -- pageId und snapshot sind gesetzt, also lief fetchUpdatedAt(pageId)
  // auf eine geloeschte Seite und riss den Client mit sich (s. wikijs_client.test.ts).
  // Der Guard blockiert jetzt VOR jeder Netzwerk-Anfrage, mit eigenem Grund.
  it("remote-deleted: Seite im Wiki geloescht — blockiert VOR jeder Anfrage, kein sinnloser fetchUpdatedAt-Call", async () => {
    const { svc, client, store } = service();
    const out = await svc.pushOne(entry({ state: "remote-deleted" }), meta, noCollisions);
    expect(out).toEqual({ kind: "blocked", reason: "remote-deleted" });
    expect(client.fetchUpdatedAt).not.toHaveBeenCalled();
    expect(client.updatePage).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
  });

  it("new-remote: nur remote vorhanden, kein lokales Pendant — 'no-local' (kein local, also kein Push)", async () => {
    const { svc, client } = service();
    const out = await svc.pushOne(
      entry({ state: "new-remote", local: undefined, snapshot: undefined }),
      meta,
      noCollisions,
    );
    expect(out).toEqual({ kind: "blocked", reason: "no-local" });
    expect(client.updatePage).not.toHaveBeenCalled();
    expect(client.createPage).not.toHaveBeenCalled();
  });

  it("removed-locally: lokale Datei weg, Snapshot und Remote noch da — 'no-local' (kein local, also kein Push)", async () => {
    const { svc, client } = service();
    const out = await svc.pushOne(entry({ state: "removed-locally", local: undefined }), meta, noCollisions);
    expect(out).toEqual({ kind: "blocked", reason: "no-local" });
    expect(client.updatePage).not.toHaveBeenCalled();
    expect(client.createPage).not.toHaveBeenCalled();
  });

  it("stale-snapshot: weder lokal noch Remote — 'no-local' (kein local, also kein Push)", async () => {
    const { svc, client } = service();
    const out = await svc.pushOne(
      entry({ state: "stale-snapshot", local: undefined, remote: undefined }),
      meta,
      noCollisions,
    );
    expect(out).toEqual({ kind: "blocked", reason: "no-local" });
    expect(client.updatePage).not.toHaveBeenCalled();
    expect(client.createPage).not.toHaveBeenCalled();
  });
});
