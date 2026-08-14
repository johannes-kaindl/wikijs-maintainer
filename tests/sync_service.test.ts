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

  // Der Guard vor dem Drift-Check faengt einen Entry ab, der einen Update-Zustand
  // behauptet, aber die Daten dafuer nicht mitbringt. Ueber `planSync` ist das
  // unerreichbar (update/remote-changed/conflict haben immer Snapshot UND Remote,
  // und pageId faellt aus einem von beiden) — `pushOne` ist aber oeffentlich, der
  // Guard bleibt also. Falsch war nur sein Etikett: "occupied" heisst "der Slug ist
  // im Wiki schon von einer anderen Seite belegt" und hat mit einem unvollstaendigen
  // Entry nichts zu tun. Die Meldung schickte den Nutzer damit auf die Suche nach
  // einer Seite, die es nicht gibt.
  it("unvollstaendiger Entry (kein pageId): eigener Grund statt der Slug-Kollisions-Meldung", async () => {
    const { svc, client } = service();
    const out = await svc.pushOne(entry({ pageId: undefined }), meta, noCollisions);
    expect(out).toEqual({ kind: "blocked", reason: "incomplete" });
    expect(client.fetchUpdatedAt).not.toHaveBeenCalled();
    expect(client.updatePage).not.toHaveBeenCalled();
  });

  it("unvollstaendiger Entry (kein Snapshot bei state=update): derselbe eigene Grund", async () => {
    const { svc, client } = service();
    const out = await svc.pushOne(entry({ snapshot: undefined }), meta, noCollisions);
    expect(out).toEqual({ kind: "blocked", reason: "incomplete" });
    expect(client.updatePage).not.toHaveBeenCalled();
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

// Ein Snapshot ohne lokale Datei UND ohne Wiki-Seite ("stale-snapshot") war bis
// 2026-08-14 nicht wegzubekommen: die Zeile "Veralteter Snapshot" stand dauerhaft in
// der Status-Ansicht, ohne dass irgendein Knopf sie aufloeste. Push half nicht (kein
// local), Pull half nicht (kein remote) -- die Datei musste im Plugin-Datenordner von
// Hand geloescht werden.
describe("SyncService.forgetSnapshot", () => {
  it("loescht den verwaisten Snapshot", async () => {
    const { svc, store } = service();
    const out = await svc.forgetSnapshot(entry({ state: "stale-snapshot", local: undefined, remote: undefined }));
    expect(out).toEqual({ kind: "forgotten" });
    expect(store.remove).toHaveBeenCalledWith("a");
  });

  // Die Pruefung sitzt im Dienst, nicht nur in der Ansicht: der Knopf ist die eine
  // Stelle, an der ein Nutzer einen Snapshot verliert -- und ein Snapshot, zu dem es
  // noch eine lokale Datei oder eine Wiki-Seite gibt, ist die Grundlage jedes
  // kuenftigen Drift-Vergleichs. Ihn dort zu loeschen hiesse, den naechsten Push
  // blind zu machen.
  it("verweigert das Loeschen, solange der Snapshot noch gebraucht wird", async () => {
    const { svc, store } = service();
    const out = await svc.forgetSnapshot(entry({ state: "update" }));
    expect(out).toEqual({ kind: "blocked", reason: "not-stale" });
    expect(store.remove).not.toHaveBeenCalled();
  });
});

// "occupied" heisst: lokale Datei da, Wiki-Seite unter demselben Slug da, aber kein
// Snapshot — das Plugin weiss also nicht, ob die Seite drueben seine eigene ist. Bis
// 2026-08-14 war das eine Sackgasse: kein Command und kein Knopf loeste sie auf, die
// Wiki-Seite musste von Hand geloescht werden.
//
// Der dokumentierte Entstehungsweg ist aber ein anderer als "fremde Seite im Weg":
// `createPage` gelingt und das Schreiben des Snapshots danach scheitert. Dann IST die
// Seite drueben unsere, ihr Inhalt ist Zeichen fuer Zeichen das, was wir gepusht haben
// — und genau daran laesst sich das pruefen, ohne irgendetwas zu ueberschreiben.
describe("SyncService.adoptOccupied", () => {
  const occupied = () => entry({ state: "occupied", snapshot: undefined, pageId: 7 });

  it("traegt den fehlenden Snapshot nach, wenn die Wiki-Seite Zeichen fuer Zeichen unsere Fassung traegt", async () => {
    const { svc, client, store } = service({
      fetchPage: vi.fn(() => Promise.resolve({ id: 7, path: "a", title: "T", content: "neu", updatedAt: "T9" })),
    });
    const out = await svc.adoptOccupied(occupied(), meta);
    expect(out).toEqual({ kind: "adopted" });
    expect(store.save).toHaveBeenCalledWith({
      version: 1, wikiPath: "a", pageId: 7, raw: "roh", pushed: "neu", remoteUpdatedAt: "T9",
    });
    expect(client.updatePage).not.toHaveBeenCalled();
    expect(client.createPage).not.toHaveBeenCalled();
  });

  // Der wichtigere der beiden Faelle: eine fremde Seite unter demselben Slug darf NICHT
  // uebernommen werden. Ein Snapshot waere hier die Behauptung "das haben wir gepusht",
  // und der naechste Push wuerde sie auf Basis dieser Behauptung ueberschreiben.
  it("uebernimmt NICHTS, wenn der Wiki-Inhalt abweicht — und schreibt keinen Snapshot", async () => {
    const { svc, store } = service({
      fetchPage: vi.fn(() => Promise.resolve({ id: 7, path: "a", title: "T", content: "fremder Text", updatedAt: "T9" })),
    });
    const out = await svc.adoptOccupied(occupied(), meta);
    expect(out).toEqual({ kind: "blocked", reason: "content-differs" });
    expect(store.save).not.toHaveBeenCalled();
  });

  it("verweigert die Uebernahme fuer jeden anderen Zustand", async () => {
    const { svc, client, store } = service();
    const out = await svc.adoptOccupied(entry({ state: "update" }), meta);
    expect(out).toEqual({ kind: "blocked", reason: "not-occupied" });
    expect(client.fetchPage).toBeUndefined();
    expect(store.save).not.toHaveBeenCalled();
  });
});
