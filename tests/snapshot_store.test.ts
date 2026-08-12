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
