import { describe, expect, it } from "vitest";
import { SnapshotStore } from "../src/obsidian/snapshot-store";
import type { Snapshot } from "../src/core/snapshot";

function fakeAdapter(files: Record<string, string> = {}) {
  return {
    files,
    exists: (p: string) => Promise.resolve(p === "DIR/snapshots" || p in files),
    list: (_p: string) => Promise.resolve({ files: Object.keys(files), folders: [] }),
    read: (p: string) => Promise.resolve(files[p] ?? ""),
    write: (p: string, data: string) => {
      files[p] = data;
      return Promise.resolve();
    },
    remove: (p: string) => {
      delete files[p];
      return Promise.resolve();
    },
    mkdir: (_p: string) => Promise.resolve(),
  };
}

const snap: Snapshot = {
  version: 1, wikiPath: "netzwerk/dns-setup", pageId: 4,
  raw: "roh", pushed: "gepusht", remoteUpdatedAt: "2026-01-01T00:00:00Z",
};

describe("SnapshotStore", () => {
  it("schreibt den Snapshot unter seinen Hash-Dateinamen", async () => {
    const adapter = fakeAdapter();
    const store = new SnapshotStore(adapter as never, "DIR");
    await store.save(snap);
    const written = Object.keys(adapter.files);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatch(/^DIR\/snapshots\/[0-9a-f]{8}\.json$/);
  });

  it("liest zurueck, was es geschrieben hat", async () => {
    const adapter = fakeAdapter();
    const store = new SnapshotStore(adapter as never, "DIR");
    await store.save(snap);
    expect(await store.loadAll()).toEqual([snap]);
  });

  it("ueberspringt eine kaputte Datei, statt den ganzen Bestand zu verlieren", async () => {
    const adapter = fakeAdapter({ "DIR/snapshots/aaaaaaaa.json": "{kaputt", "DIR/snapshots/bbbbbbbb.json": JSON.stringify(snap) });
    const store = new SnapshotStore(adapter as never, "DIR");
    expect(await store.loadAll()).toEqual([snap]);
  });

  it("ignoriert Dateien, die keine .json sind", async () => {
    const adapter = fakeAdapter({ "DIR/snapshots/notizen.md": "x" });
    expect(await new SnapshotStore(adapter as never, "DIR").loadAll()).toEqual([]);
  });

  it("loescht den Snapshot zu einem Wiki-Pfad", async () => {
    const adapter = fakeAdapter();
    const store = new SnapshotStore(adapter as never, "DIR");
    await store.save(snap);
    await store.remove(snap.wikiPath);
    expect(Object.keys(adapter.files)).toEqual([]);
  });

  it("liefert eine leere Liste, wenn das Verzeichnis noch nicht existiert", async () => {
    const adapter = { ...fakeAdapter(), exists: () => Promise.resolve(false) };
    expect(await new SnapshotStore(adapter as never, "DIR").loadAll()).toEqual([]);
  });
});

// Die Snapshots sind der einzige Beleg, dass eine Wiki-Seite "unsere" ist. Unter
// `.obsidian/plugins/` reisen sie nicht mit dem Vault; derselbe Vault auf einem zweiten Rechner
// zeigte deshalb den ganzen Bestand als `occupied`. Mit einem Vault-Ordner als Speicherort reisen sie mit.
describe("SnapshotStore — Speicherort im Vault", () => {
  /** Ordnerbewusster Adapter: list() liefert nur Dateien direkt in dem Ordner. */
  function folderAdapter(files: Record<string, string> = {}) {
    const dirs = new Set<string>();
    for (const p of Object.keys(files)) dirs.add(p.slice(0, p.lastIndexOf("/")));
    return {
      files,
      dirs,
      exists: (p: string) => Promise.resolve(dirs.has(p) || p in files),
      list: (dir: string) => Promise.resolve({ files: Object.keys(files).filter((p) => p.slice(0, p.lastIndexOf("/")) === dir), folders: [] }),
      read: (p: string) => Promise.resolve(files[p] ?? ""),
      write: (p: string, data: string) => { files[p] = data; return Promise.resolve(); },
      remove: (p: string) => { delete files[p]; return Promise.resolve(); },
      mkdir: (p: string) => { dirs.add(p); return Promise.resolve(); },
    };
  }

  it("schreibt in den konfigurierten Vault-Ordner statt in den Plugin-Ordner", async () => {
    const adapter = folderAdapter();
    const store = new SnapshotStore(adapter as never, "DIR", ".wikijs-snapshots");
    await store.save(snap);
    const written = Object.keys(adapter.files);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatch(/^\.wikijs-snapshots\/[0-9a-f]{8}\.json$/);
  });

  it("normalisiert den Ordner (Leerraum, fuehrender und folgender Schraegstrich)", async () => {
    const adapter = folderAdapter();
    await new SnapshotStore(adapter as never, "DIR", "  /meta/snap/ ").save(snap);
    expect(Object.keys(adapter.files)[0]).toMatch(/^meta\/snap\/[0-9a-f]{8}\.json$/);
  });

  it("ein leerer Ordnername heisst: wie bisher der Plugin-Ordner", async () => {
    const adapter = folderAdapter();
    await new SnapshotStore(adapter as never, "DIR", "   ").save(snap);
    expect(Object.keys(adapter.files)[0]).toMatch(/^DIR\/snapshots\//);
  });

  it("uebernimmt beim ersten Laden vorhandene Snapshots aus dem Plugin-Ordner, ohne sie zu loeschen", async () => {
    const adapter = folderAdapter({ "DIR/snapshots/aaaaaaaa.json": JSON.stringify(snap) });
    const store = new SnapshotStore(adapter as never, "DIR", ".wikijs-snapshots");
    expect(await store.loadAll()).toEqual([snap]);
    expect(adapter.files[".wikijs-snapshots/aaaaaaaa.json"]).toBe(JSON.stringify(snap));
    expect(adapter.files["DIR/snapshots/aaaaaaaa.json"]).toBeDefined();
  });

  it("uebernimmt NICHT erneut, wenn der Vault-Ordner schon Snapshots hat (ein spaeterer Stand gewinnt)", async () => {
    const neuer = { ...snap, raw: "neuer" };
    const adapter = folderAdapter({
      "DIR/snapshots/aaaaaaaa.json": JSON.stringify(snap),
      ".wikijs-snapshots/aaaaaaaa.json": JSON.stringify(neuer),
    });
    const store = new SnapshotStore(adapter as never, "DIR", ".wikijs-snapshots");
    expect(await store.loadAll()).toEqual([neuer]);
  });

  it("ohne Alt-Bestand und ohne Ordner liefert loadAll eine leere Liste", async () => {
    const store = new SnapshotStore(folderAdapter() as never, "DIR", ".wikijs-snapshots");
    expect(await store.loadAll()).toEqual([]);
  });
});
