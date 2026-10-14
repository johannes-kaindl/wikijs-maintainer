// "Bestand uebernehmen": ein Wiki mit Seiten und ein leerer Sync-Ordner sollen nach einem Durchlauf
// denselben Stand zeigen, alle Zeilen `unchanged`, und es darf kein einziger Schreibzugriff aufs
// Wiki stattgefunden haben (nur fetchPage/listPages).
import { describe, expect, it, vi } from "vitest";
import { SyncService, type BuiltPlan } from "../src/obsidian/sync-service";
import { planSync, type SyncEntry, type LocalPage } from "../src/core/sync-plan";
import { vaultPathToWikiPath } from "../src/core/paths";
import { extractPageMeta } from "../src/core/page-meta";
import type { Snapshot } from "../src/core/snapshot";

type Page = { id: number; path: string; title: string; description: string; content: string; updatedAt: string; tags: string[]; isPublished: boolean };
const PAGES: Page[] = [
  { id: 1, path: "netzwerk/dns", title: "DNS Setup", description: "Wie der Resolver haengt", content: "# DNS\n\nText\n", updatedAt: "T1", tags: ["netzwerk", "dns"], isPublished: true },
  { id: 2, path: "intern/privat", title: "Privat", description: "", content: "geheim\n", updatedAt: "T2", tags: [], isPublished: false },
];

function setup(pages: Page[] = PAGES, locals: LocalPage[] = []) {
  const client = {
    fetchPage: vi.fn((id: number) => Promise.resolve(pages.find((p) => p.id === id) as Page)),
    createPage: vi.fn(), updatePage: vi.fn(), unpublishPage: vi.fn(), deletePage: vi.fn(),
  };
  const saved: Snapshot[] = [];
  const store = { save: vi.fn((s: Snapshot) => { saved.push(s); return Promise.resolve(); }), loadAll: vi.fn(() => Promise.resolve([] as Snapshot[])), remove: vi.fn() };
  const written = new Map<string, string>();
  const writeNote = vi.fn((p: string, c: string) => { written.set(p, c); return Promise.resolve(); });
  const svc = new SyncService({ client: client as never, store: store as never, vault: {} as never, syncRoot: () => "_published", writeNote });
  const remotes = pages.map((p) => ({ id: p.id, path: p.path, title: p.title, updatedAt: p.updatedAt }));
  const plan: BuiltPlan = { entries: planSync({ locals, snapshots: [], remotes }), meta: new Map(), collisions: [], ambiguousNames: [] };
  return { svc, client, store, saved, written, plan, writeNote };
}

const noWrites = (client: ReturnType<typeof setup>["client"]) => {
  expect(client.createPage).not.toHaveBeenCalled();
  expect(client.updatePage).not.toHaveBeenCalled();
  expect(client.unpublishPage).not.toHaveBeenCalled();
  expect(client.deletePage).not.toHaveBeenCalled();
};

describe("SyncService.previewImport", () => {
  it("trennt neue Dateien von bestehenden Notizen, die das Wiki ueberschreiben wuerde", () => {
    const local: LocalPage = { vaultPath: "_published/netzwerk/dns.md", wikiPath: "netzwerk/dns", raw: "eigener Text", transformed: "eigener Text" };
    const { svc, plan } = setup(PAGES, [local]);
    expect(svc.previewImport(plan)).toEqual({ create: ["intern/privat"], overwrite: ["netzwerk/dns"] });
  });

  it("zaehlt Eintraege mit Slug-Kollision nicht mit", () => {
    const { svc, plan } = setup();
    expect(svc.previewImport({ ...plan, collisions: [{ wikiPath: "intern/privat", vaultPaths: ["a", "b"] }] }).create).toEqual(["netzwerk/dns"]);
  });
});

describe("SyncService.importExisting", () => {
  it("legt fuer jede Wiki-Seite eine Datei und einen Snapshot an, und schreibt NIE ins Wiki", async () => {
    const { svc, client, saved, written, plan } = setup();
    const report = await svc.importExisting(plan, "wiki-wins");
    expect(report).toMatchObject({ created: 2, overwritten: 0, skipped: 0, errors: [] });
    expect([...written.keys()].sort()).toEqual(["_published/intern/Privat.md", "_published/netzwerk/dns.md"]);
    expect(saved).toHaveLength(2);
    noWrites(client);
  });

  it("die Datei traegt Titel, Beschreibung und Tags der Wiki-Seite als Frontmatter (sonst wuerde der naechste Push sie leeren)", async () => {
    const { svc, written, plan } = setup();
    await svc.importExisting(plan, "wiki-wins");
    const meta = extractPageMeta(written.get("_published/netzwerk/dns.md") as string, "dns");
    expect(meta).toMatchObject({ title: "DNS Setup", description: "Wie der Resolver haengt", tags: ["netzwerk", "dns"], body: "# DNS\n\nText\n" });
  });

  it("eine im Wiki unveroeffentlichte Seite bekommt wiki_published: false (sonst wuerde der erste Push sie veroeffentlichen)", async () => {
    const { svc, written, plan } = setup();
    await svc.importExisting(plan, "wiki-wins");
    expect(extractPageMeta(written.get("_published/intern/Privat.md") as string, "privat").published).toBe(false);
    expect(extractPageMeta(written.get("_published/netzwerk/dns.md") as string, "dns").published).toBe(true);
  });

  it("danach plant planSync alles als unchanged — Datei und Snapshot passen zusammen", async () => {
    const { svc, saved, written, plan } = setup();
    await svc.importExisting(plan, "wiki-wins");
    const locals: LocalPage[] = [...written].map(([vaultPath, raw]) => {
      const wikiPath = vaultPathToWikiPath(vaultPath, "_published") as string;
      return { vaultPath, wikiPath, raw, transformed: raw };
    });
    const remotes = PAGES.map((p) => ({ id: p.id, path: p.path, title: p.title, updatedAt: p.updatedAt }));
    const after = planSync({ locals, snapshots: saved, remotes });
    expect(after.map((e) => e.state)).toEqual(["unchanged", "unchanged"]);
  });

  it("'wiki-wins': eine bestehende Notiz wird ersetzt, ihr Frontmatter bleibt", async () => {
    const local: LocalPage = { vaultPath: "_published/netzwerk/dns.md", wikiPath: "netzwerk/dns", raw: "---\nseitentyp: Anleitung\n---\neigener Text", transformed: "eigener Text" };
    const { svc, written, plan, client } = setup(PAGES, [local]);
    const report = await svc.importExisting(plan, "wiki-wins");
    expect(report).toMatchObject({ created: 1, overwritten: 1, skipped: 0 });
    const text = written.get("_published/netzwerk/dns.md") as string;
    expect(text.startsWith("---\nseitentyp: Anleitung\n---\n")).toBe(true);
    expect(text.endsWith("# DNS\n\nText\n")).toBe(true);
    noWrites(client);
  });

  it("'skip-existing': eine bestehende Notiz bleibt unangetastet und ohne Snapshot", async () => {
    const local: LocalPage = { vaultPath: "_published/netzwerk/dns.md", wikiPath: "netzwerk/dns", raw: "eigener Text", transformed: "eigener Text" };
    const { svc, written, saved, plan } = setup(PAGES, [local]);
    const report = await svc.importExisting(plan, "skip-existing");
    expect(report).toMatchObject({ created: 1, overwritten: 0, skipped: 1 });
    expect(written.has("_published/netzwerk/dns.md")).toBe(false);
    expect(saved.map((s) => s.wikiPath)).toEqual(["intern/privat"]);
  });

  it("ein Fehler bei einer Seite stoppt den Lauf nicht und landet im Bericht", async () => {
    const { svc, client, plan, written } = setup();
    client.fetchPage.mockImplementationOnce(() => Promise.reject(new Error("boom")));
    const report = await svc.importExisting(plan, "wiki-wins");
    // Der Plan ist nach Pfad sortiert: "intern/privat" kommt zuerst und trifft den Fehler.
    expect(report.errors).toEqual([{ wikiPath: "intern/privat", message: "boom" }]);
    expect(report.created).toBe(1);
    expect(written.size).toBe(1);
  });

  it("ohne writeNote-Adapter passiert nichts", async () => {
    const { client, plan } = setup();
    const svc = new SyncService({ client: client as never, store: { save: vi.fn() } as never, vault: {} as never, syncRoot: () => "_published" });
    expect(await svc.importExisting(plan, "wiki-wins")).toMatchObject({ created: 0, overwritten: 0, skipped: 0 });
    expect(client.fetchPage).not.toHaveBeenCalled();
  });

  it("lässt bereits gesyncte Seiten (unchanged/update/conflict) unberuehrt", async () => {
    const { svc, client } = setup();
    const entries: SyncEntry[] = [
      { wikiPath: "a", state: "unchanged", pageId: 1 }, { wikiPath: "b", state: "update", pageId: 2 },
      { wikiPath: "c", state: "conflict", pageId: 3 }, { wikiPath: "d", state: "remote-changed", pageId: 4 },
    ];
    const report = await svc.importExisting({ entries, meta: new Map(), collisions: [], ambiguousNames: [] }, "wiki-wins");
    expect(report).toMatchObject({ created: 0, overwritten: 0 });
    expect(client.fetchPage).not.toHaveBeenCalled();
  });
});
