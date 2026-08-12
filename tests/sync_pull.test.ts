import { describe, expect, it, vi } from "vitest";
import { SyncService } from "../src/obsidian/sync-service";
import type { SyncEntry } from "../src/core/sync-plan";

function service() {
  const client = {
    fetchPage: vi.fn(() =>
      Promise.resolve({ id: 5, path: "netzwerk/dns", title: "DNS Setup", description: "", content: "wiki-text", updatedAt: "T9" }),
    ),
    listPages: vi.fn(() => Promise.resolve([])),
  };
  const store = { save: vi.fn(() => Promise.resolve()), loadAll: vi.fn(() => Promise.resolve([])), remove: vi.fn(() => Promise.resolve()) };
  const writeNote = vi.fn(() => Promise.resolve());
  const svc = new SyncService({
    client: client as never,
    store: store as never,
    vault: {} as never,
    syncRoot: () => "_published",
    writeNote,
  });
  return { svc, client, store, writeNote };
}

describe("SyncService.pullOne", () => {
  it("schreibt eine remote geaenderte Seite an ihren bekannten Vault-Pfad", async () => {
    const { svc, writeNote } = service();
    const entry: SyncEntry = {
      wikiPath: "netzwerk/dns",
      state: "remote-changed",
      pageId: 5,
      local: { vaultPath: "_published/Netzwerk/DNS.md", wikiPath: "netzwerk/dns", raw: "alt", transformed: "alt" },
      snapshot: { version: 1, wikiPath: "netzwerk/dns", pageId: 5, raw: "alt", pushed: "alt", remoteUpdatedAt: "T1" },
      remote: { id: 5, path: "netzwerk/dns", title: "DNS Setup", updatedAt: "T9" },
    };
    expect(await svc.pullOne(entry)).toEqual({ kind: "written", vaultPath: "_published/Netzwerk/DNS.md" });
    expect(writeNote).toHaveBeenCalledWith("_published/Netzwerk/DNS.md", "wiki-text");
  });

  it("schreibt bei remote-changed das FRISCHE updatedAt in den Snapshot, nicht das alte aus dem Snapshot-Eintrag", async () => {
    // Mutationsprobe fuer den tragenden Punkt des Tasks: der Entry traegt hier bewusst
    // ein ALTES snapshot.remoteUpdatedAt ("T1"), ungleich dem frischen page.updatedAt
    // ("T9"). Eine Implementierung, die versehentlich das alte Snapshot-Feld statt des
    // frisch geholten page.updatedAt fortschreibt, faellt NUR hier auf — die uebrigen
    // Faelle haben keinen `entry.snapshot`, dort waere der Fehler unsichtbar.
    const { svc, store } = service();
    const entry: SyncEntry = {
      wikiPath: "netzwerk/dns",
      state: "remote-changed",
      pageId: 5,
      local: { vaultPath: "_published/Netzwerk/DNS.md", wikiPath: "netzwerk/dns", raw: "alt", transformed: "alt" },
      snapshot: { version: 1, wikiPath: "netzwerk/dns", pageId: 5, raw: "alt", pushed: "alt", remoteUpdatedAt: "T1" },
      remote: { id: 5, path: "netzwerk/dns", title: "DNS Setup", updatedAt: "T9" },
    };
    await svc.pullOne(entry);
    expect(store.save).toHaveBeenCalledWith(expect.objectContaining({ remoteUpdatedAt: "T9" }));
  });

  it("legt eine im Wiki neu angelegte Seite unter dem aus Titel und Pfad gebauten Ort ab", async () => {
    const { svc, writeNote } = service();
    const entry: SyncEntry = {
      wikiPath: "netzwerk/dns",
      state: "new-remote",
      pageId: 5,
      remote: { id: 5, path: "netzwerk/dns", title: "DNS Setup", updatedAt: "T9" },
    };
    expect(await svc.pullOne(entry)).toEqual({ kind: "written", vaultPath: "_published/netzwerk/DNS Setup.md" });
    expect(writeNote).toHaveBeenCalledWith("_published/netzwerk/DNS Setup.md", "wiki-text");
  });

  it("schreibt den Snapshot mit dem neuen updatedAt fort — sonst gilt die Seite sofort wieder als geaendert", async () => {
    const { svc, store } = service();
    await svc.pullOne({
      wikiPath: "netzwerk/dns",
      state: "new-remote",
      pageId: 5,
      remote: { id: 5, path: "netzwerk/dns", title: "DNS Setup", updatedAt: "T9" },
    });
    expect(store.save).toHaveBeenCalledWith(
      expect.objectContaining({ remoteUpdatedAt: "T9", raw: "wiki-text", pushed: "wiki-text" }),
    );
  });

  it("tut nichts fuer Zustaende, die keinen Pull kennen", async () => {
    const { svc, writeNote } = service();
    expect(await svc.pullOne({ wikiPath: "a", state: "create" })).toEqual({ kind: "skipped" });
    expect(writeNote).not.toHaveBeenCalled();
  });

  it("tut nichts, wenn kein writeNote-Adapter gestellt wurde", async () => {
    const client = {
      fetchPage: vi.fn(() =>
        Promise.resolve({ id: 5, path: "a", title: "A", description: "", content: "x", updatedAt: "T9" }),
      ),
      listPages: vi.fn(() => Promise.resolve([])),
    };
    const store = { save: vi.fn(() => Promise.resolve()), loadAll: vi.fn(() => Promise.resolve([])), remove: vi.fn(() => Promise.resolve()) };
    const svc = new SyncService({
      client: client as never,
      store: store as never,
      vault: {} as never,
      syncRoot: () => "_published",
    });
    const out = await svc.pullOne({
      wikiPath: "a",
      state: "remote-changed",
      pageId: 5,
      remote: { id: 5, path: "a", title: "A", updatedAt: "T9" },
    });
    expect(out).toEqual({ kind: "skipped" });
    expect(store.save).not.toHaveBeenCalled();
  });
});
