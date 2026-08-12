import { describe, expect, it, vi } from "vitest";
import { SyncService } from "../src/obsidian/sync-service";
import type { SyncEntry } from "../src/core/sync-plan";
import type { TransformResult } from "../src/core/transform";

const meta: TransformResult = { content: "neu", title: "T", description: "", tags: [], unresolved: [], skippedEmbeds: [] };

const conflictEntry: SyncEntry = {
  wikiPath: "a", state: "conflict", pageId: 5,
  local: { vaultPath: "_published/A.md", wikiPath: "a", raw: "roh-neu", transformed: "neu" },
  snapshot: { version: 1, wikiPath: "a", pageId: 5, raw: "roh-alt", pushed: "alt", remoteUpdatedAt: "T1" },
  remote: { id: 5, path: "a", title: "T", updatedAt: "T-NEU" },
};

function service(choice: "local" | "remote" | "cancel") {
  const client = {
    fetchUpdatedAt: vi.fn(() => Promise.resolve("T-NEU")),
    fetchPage: vi.fn(() => Promise.resolve({ id: 5, path: "a", title: "T", description: "", content: "remote-text", updatedAt: "T-NEU" })),
    updatePage: vi.fn(() => Promise.resolve({ updatedAt: "T3" })),
  };
  const store = { save: vi.fn(() => Promise.resolve()), loadAll: vi.fn(() => Promise.resolve([])), remove: vi.fn(() => Promise.resolve()) };
  const resolveConflict = vi.fn(() => Promise.resolve(choice));
  const svc = new SyncService({
    client: client as never, store: store as never, vault: {} as never,
    syncRoot: () => "_published", resolveConflict: resolveConflict as never,
  });
  return { svc, client, store, resolveConflict };
}

describe("SyncService.pushOne bei Konflikt", () => {
  it("fragt nach und pusht die lokale Fassung, wenn der Nutzer lokal waehlt", async () => {
    const { svc, client, resolveConflict } = service("local");
    const out = await svc.pushOne(conflictEntry, meta, []);
    expect(resolveConflict).toHaveBeenCalledTimes(1);
    expect(client.updatePage).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ kind: "updated" });
  });

  it("pusht nicht, wenn der Nutzer abbricht", async () => {
    const { svc, client } = service("cancel");
    expect(await svc.pushOne(conflictEntry, meta, [])).toEqual({ kind: "blocked", reason: "drift" });
    expect(client.updatePage).not.toHaveBeenCalled();
  });

  it("blockt den Konflikt ohne Rueckfrage, wenn kein Aufloeser gestellt ist", async () => {
    const svc = new SyncService({
      client: { fetchUpdatedAt: vi.fn(() => Promise.resolve("T-NEU")), updatePage: vi.fn() } as never,
      store: { save: vi.fn(), loadAll: vi.fn(), remove: vi.fn() } as never,
      vault: {} as never, syncRoot: () => "_published",
    });
    expect(await svc.pushOne(conflictEntry, meta, [])).toEqual({ kind: "blocked", reason: "drift" });
  });

  // Der eigentliche Guard aus Step 3(a): der Drift-Guard vergleicht gegen den Snapshot,
  // nicht gegen "state === conflict". Wird die Wiki-Seite zwischenzeitlich auf den alten
  // Stand zurueckgesetzt, stimmt fetchUpdatedAt wieder mit dem Snapshot ueberein — ohne
  // eigenen Zustandsguard wuerde der Konflikt dann still durchgehen.
  it("blockt einen Konflikt auch dann, wenn der Drift-Guard NICHT anschlaegt (Wiki auf alten Stand zurueckgesetzt)", async () => {
    const client = {
      fetchUpdatedAt: vi.fn(() => Promise.resolve("T1")), // == snapshot.remoteUpdatedAt, Drift-Guard schlaegt nicht an
      fetchPage: vi.fn(() => Promise.resolve({ id: 5, path: "a", title: "T", description: "", content: "remote-text", updatedAt: "T1" })),
      updatePage: vi.fn(() => Promise.resolve({ updatedAt: "T3" })),
    };
    const svc = new SyncService({
      client: client as never,
      store: { save: vi.fn(), loadAll: vi.fn(), remove: vi.fn() } as never,
      vault: {} as never, syncRoot: () => "_published",
      // kein resolveConflict gestellt
    });
    const out = await svc.pushOne(conflictEntry, meta, []);
    expect(out).toEqual({ kind: "blocked", reason: "drift" });
    expect(client.updatePage).not.toHaveBeenCalled();
  });

  // Fix-Runde 1 (Critical): ein conflict-Eintrag mit GESTELLTEM Aufloeser muss den
  // Aufloeser auch dann rufen, wenn der Live-Vergleich keine Drift mehr sieht — genau
  // der Fall "Wiki-Seite auf den alten Stand zurueckgesetzt". Der Zustand "conflict"
  // beantwortet "wissen wir bereits, dass beide Seiten auseinanderlaufen?" — das ist
  // eine andere Frage als "hat sich currentUpdatedAt seit dem Snapshot veraendert?".
  it("fragt auch dann nach, wenn Live-updatedAt wieder mit dem Snapshot uebereinstimmt (Konflikt + Aufloeser gestellt)", async () => {
    const client = {
      fetchUpdatedAt: vi.fn(() => Promise.resolve("T1")), // == snapshot.remoteUpdatedAt, kein Drift-Signal
      fetchPage: vi.fn(() => Promise.resolve({ id: 5, path: "a", title: "T", description: "", content: "remote-text", updatedAt: "T1" })),
      updatePage: vi.fn(() => Promise.resolve({ updatedAt: "T3" })),
    };
    const store = { save: vi.fn(() => Promise.resolve()), loadAll: vi.fn(() => Promise.resolve([])), remove: vi.fn(() => Promise.resolve()) };
    const resolveConflict = vi.fn(() => Promise.resolve("cancel" as const));
    const svc = new SyncService({
      client: client as never, store: store as never, vault: {} as never,
      syncRoot: () => "_published", resolveConflict: resolveConflict as never,
    });
    const out = await svc.pushOne(conflictEntry, meta, []);
    expect(resolveConflict).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ kind: "blocked", reason: "drift" });
    expect(client.updatePage).not.toHaveBeenCalled();
  });

  it("pusht bei Antwort 'local' auch ohne Live-Drift", async () => {
    const client = {
      fetchUpdatedAt: vi.fn(() => Promise.resolve("T1")),
      fetchPage: vi.fn(() => Promise.resolve({ id: 5, path: "a", title: "T", description: "", content: "remote-text", updatedAt: "T1" })),
      updatePage: vi.fn(() => Promise.resolve({ updatedAt: "T3" })),
    };
    const store = { save: vi.fn(() => Promise.resolve()), loadAll: vi.fn(() => Promise.resolve([])), remove: vi.fn(() => Promise.resolve()) };
    const resolveConflict = vi.fn(() => Promise.resolve("local" as const));
    const svc = new SyncService({
      client: client as never, store: store as never, vault: {} as never,
      syncRoot: () => "_published", resolveConflict: resolveConflict as never,
    });
    const out = await svc.pushOne(conflictEntry, meta, []);
    expect(resolveConflict).toHaveBeenCalledTimes(1);
    expect(client.updatePage).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ kind: "updated" });
  });

  // Regression: der Dialog darf sich NICHT in den Normalfall einschleichen. Ein
  // gewoehnlicher "update"-Eintrag ohne Drift ruft den Aufloeser nicht, selbst wenn
  // einer gestellt ist — sonst waere fuer jeden Push ploetzlich eine Rueckfrage noetig.
  it("ruft den Aufloeser NICHT bei einem gewoehnlichen update-Eintrag ohne Drift", async () => {
    const updateEntry: SyncEntry = {
      wikiPath: "a", state: "update", pageId: 5,
      local: { vaultPath: "_published/A.md", wikiPath: "a", raw: "roh", transformed: "neu" },
      snapshot: { version: 1, wikiPath: "a", pageId: 5, raw: "alt", pushed: "alt-t", remoteUpdatedAt: "T1" },
    };
    const client = {
      fetchUpdatedAt: vi.fn(() => Promise.resolve("T1")), // == snapshot.remoteUpdatedAt
      fetchPage: vi.fn(() => Promise.resolve({ id: 5, path: "a", title: "T", description: "", content: "remote-text", updatedAt: "T1" })),
      updatePage: vi.fn(() => Promise.resolve({ updatedAt: "T3" })),
    };
    const store = { save: vi.fn(() => Promise.resolve()), loadAll: vi.fn(() => Promise.resolve([])), remove: vi.fn(() => Promise.resolve()) };
    const resolveConflict = vi.fn(() => Promise.resolve("local" as const));
    const svc = new SyncService({
      client: client as never, store: store as never, vault: {} as never,
      syncRoot: () => "_published", resolveConflict: resolveConflict as never,
    });
    const out = await svc.pushOne(updateEntry, meta, []);
    expect(resolveConflict).not.toHaveBeenCalled();
    expect(client.fetchPage).not.toHaveBeenCalled();
    expect(client.updatePage).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ kind: "updated" });
  });
});
