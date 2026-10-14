import { describe, expect, it } from "vitest";
import { planSync, type LocalPage, type RemotePage } from "../src/core/sync-plan";
import type { Snapshot } from "../src/core/snapshot";

const local = (wikiPath: string, raw: string): LocalPage => ({
  vaultPath: `_published/${wikiPath}.md`,
  wikiPath,
  raw,
  transformed: `T:${raw}`,
});

const remote = (path: string, updatedAt: string, id = 1): RemotePage => ({
  id,
  path,
  title: path,
  updatedAt,
});

const snap = (wikiPath: string, raw: string, updatedAt: string, id = 1): Snapshot => ({
  version: 1,
  wikiPath,
  pageId: id,
  raw,
  pushed: `T:${raw}`,
  remoteUpdatedAt: updatedAt,
});

const stateOf = (entries: ReturnType<typeof planSync>, wikiPath: string): string =>
  entries.find((e) => e.wikiPath === wikiPath)?.state ?? "FEHLT";

describe("planSync — die Tabelle aus Spec § 3", () => {
  it("lokal neu, remote nicht vorhanden → create", () => {
    const entries = planSync({ locals: [local("a", "x")], snapshots: [], remotes: [] });
    expect(stateOf(entries, "a")).toBe("create");
  });

  it("lokal neu, remote existiert schon → occupied (nie ueberschreiben)", () => {
    const entries = planSync({ locals: [local("a", "x")], snapshots: [], remotes: [remote("a", "T1")] });
    expect(stateOf(entries, "a")).toBe("occupied");
  });

  it("lokal geaendert, remote unveraendert → update", () => {
    const entries = planSync({
      locals: [local("a", "neu")],
      snapshots: [snap("a", "alt", "T1")],
      remotes: [remote("a", "T1")],
    });
    expect(stateOf(entries, "a")).toBe("update");
  });

  it("lokal unveraendert, remote geaendert → remote-changed (Pull anbieten)", () => {
    const entries = planSync({
      locals: [local("a", "alt")],
      snapshots: [snap("a", "alt", "T1")],
      remotes: [remote("a", "T2")],
    });
    expect(stateOf(entries, "a")).toBe("remote-changed");
  });

  it("beide geaendert → conflict", () => {
    const entries = planSync({
      locals: [local("a", "neu")],
      snapshots: [snap("a", "alt", "T1")],
      remotes: [remote("a", "T2")],
    });
    expect(stateOf(entries, "a")).toBe("conflict");
  });

  it("beide unveraendert → unchanged", () => {
    const entries = planSync({
      locals: [local("a", "alt")],
      snapshots: [snap("a", "alt", "T1")],
      remotes: [remote("a", "T1")],
    });
    expect(stateOf(entries, "a")).toBe("unchanged");
  });

  it("lokal aus dem Sync-Ordner entfernt, remote existiert → removed-locally", () => {
    const entries = planSync({
      locals: [],
      snapshots: [snap("a", "alt", "T1")],
      remotes: [remote("a", "T1")],
    });
    expect(stateOf(entries, "a")).toBe("removed-locally");
  });

  it("lokal vorhanden, remote geloescht → remote-deleted", () => {
    const entries = planSync({
      locals: [local("a", "alt")],
      snapshots: [snap("a", "alt", "T1")],
      remotes: [],
    });
    expect(stateOf(entries, "a")).toBe("remote-deleted");
  });

  it("kein Snapshot, remote neu angelegt → new-remote", () => {
    const entries = planSync({ locals: [], snapshots: [], remotes: [remote("a", "T1")] });
    expect(stateOf(entries, "a")).toBe("new-remote");
  });

  it("weder lokal noch remote, nur ein Snapshot → stale-snapshot (aufraeumbar)", () => {
    const entries = planSync({ locals: [], snapshots: [snap("a", "alt", "T1")], remotes: [] });
    expect(stateOf(entries, "a")).toBe("stale-snapshot");
  });
});

describe("planSync — Ergebnisform", () => {
  it("traegt die pageId aus dem Snapshot, sonst aus der Remote-Liste", () => {
    const entries = planSync({
      locals: [local("a", "neu")],
      snapshots: [snap("a", "alt", "T1", 7)],
      remotes: [remote("a", "T1", 7)],
    });
    expect(entries[0]?.pageId).toBe(7);
  });

  it("laesst pageId undefiniert, wenn die Seite drueben noch nicht existiert", () => {
    const entries = planSync({ locals: [local("a", "x")], snapshots: [], remotes: [] });
    expect(entries[0]?.pageId).toBeUndefined();
  });

  it("sortiert stabil nach Wiki-Pfad, damit die Status-Ansicht nicht springt", () => {
    const entries = planSync({
      locals: [local("b", "x"), local("a", "x")],
      snapshots: [],
      remotes: [],
    });
    expect(entries.map((e) => e.wikiPath)).toEqual(["a", "b"]);
  });

  it("erfasst jeden Pfad genau einmal, egal aus welcher der drei Quellen er stammt", () => {
    const entries = planSync({
      locals: [local("a", "x")],
      snapshots: [snap("a", "x", "T1")],
      remotes: [remote("a", "T1")],
    });
    expect(entries).toHaveLength(1);
  });

});

// Wiki.js identifiziert eine Seite erst durch Sprache UND Pfad (`home` existierte im LGS-Wiki
// als Id 1 englisch und Id 2 deutsch nebeneinander). Auf den Pfad allein geschluesselt,
// ueberschrieb eine die andere im selben Slot, und `pageId` zeigte auf die falsche Sprache.
describe("planSync — Sprache und Pfad zusammen sind der Schluessel", () => {
  const inLocale = (locale: string, path: string, updatedAt: string, id: number): RemotePage => ({
    id, path, title: path, updatedAt, locale,
  });

  it("zwei Seiten mit gleichem Pfad in zwei Sprachen: die der eingestellten Sprache gewinnt, in beiden Reihenfolgen", () => {
    const en = inLocale("en", "home", "T1", 1);
    const de = inLocale("de", "home", "T2", 2);
    for (const remotes of [[en, de], [de, en]]) {
      const entries = planSync({ locals: [local("home", "x")], snapshots: [], remotes, locale: "de" });
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ wikiPath: "home", state: "occupied", pageId: 2 });
      expect(entries[0]?.remote?.id).toBe(2);
    }
  });

  it("eine Seite nur in fremder Sprache ist fuer die eingestellte Sprache nicht vorhanden → create statt occupied", () => {
    const entries = planSync({ locals: [local("home", "x")], snapshots: [], remotes: [inLocale("en", "home", "T1", 1)], locale: "de" });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.state).toBe("create");
    expect(entries[0]?.remote).toBeUndefined();
  });

  it("eine fremdsprachige Seite taucht nicht als new-remote auf (kein Pull in eine falsche Sprache)", () => {
    const entries = planSync({ locals: [], snapshots: [], remotes: [inLocale("en", "home", "T1", 1)], locale: "de" });
    expect(entries).toEqual([]);
  });

  it("ohne eingestellte Sprache werden zwei Sprachen nie auf einen Eintrag zusammengezogen", () => {
    const entries = planSync({
      locals: [], snapshots: [],
      remotes: [inLocale("en", "home", "T1", 1), inLocale("de", "home", "T2", 2)],
    });
    expect(entries.map((e) => e.pageId).sort()).toEqual([1, 2]);
  });

  it("ein Snapshot (ohne Sprache gespeichert) gehoert zur eingestellten Sprache und trifft deren Seite", () => {
    const entries = planSync({
      locals: [local("home", "x")], snapshots: [snap("home", "x", "T2", 2)],
      remotes: [inLocale("en", "home", "T1", 1), inLocale("de", "home", "T2", 2)], locale: "de",
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ state: "unchanged", pageId: 2 });
  });
});
