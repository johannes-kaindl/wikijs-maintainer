// Orchestrierung: Plan bauen, Drift pruefen, ausfuehren, Snapshot fortschreiben.
// Die Entscheidung, WAS zu tun ist, liegt in core/sync-plan.ts — hier liegt nur,
// WIE es ausgefuehrt wird.
import type { Vault } from "obsidian";
import type { WikiClient, PageInput } from "../wikijs/client";
import type { SnapshotStore } from "./snapshot-store";
import { collectLocalPages, type AmbiguousName } from "./vault-source";
import { planSync, type SyncEntry } from "../core/sync-plan";
import type { TransformResult } from "../core/transform";
import type { SlugCollision } from "../core/paths";
import { wikiPathToVaultPath } from "../core/paths";
import type { ConflictChoice } from "./conflict-modal";
import type { RemovalChoice } from "./removal-modal";

export type PushOutcome =
  | { kind: "created" | "updated" }
  | { kind: "skipped"; reason: "unchanged" }
  | { kind: "blocked"; reason: "drift" | "occupied" | "collision" | "no-local" | "remote-deleted" };

export type PullOutcome = { kind: "written"; vaultPath: string } | { kind: "skipped" };

export interface SyncDeps {
  client: WikiClient;
  store: SnapshotStore;
  vault: Vault;
  syncRoot: () => string;
  /** Fehlt dieser Auflöser, wird ein `conflict`-Eintrag ohne Rückfrage blockiert
   *  (s. Guard am Anfang von `pushOne`). Gesetzt, entscheidet er per Diff-Dialog. */
  resolveConflict?: (entry: SyncEntry, remoteContent: string) => Promise<ConflictChoice>;
  /** Fehlt dieser Adapter, liefert `pullOne` fuer JEDEN Zustand `{ kind: "skipped" }" —
   *  ohne Schreibzugriff auf den Vault gibt es nichts zu tun. Optional aus demselben
   *  Grund wie `resolveConflict`: bestehende Tests bauen den Dienst ohne Vault-Schreibrechte. */
  writeNote?: (vaultPath: string, content: string) => Promise<void>;
  /** Fehlt dieser Auflöser, laesst `pushAll` `removed-locally`-Eintraege unangetastet
   *  (kein Depublizieren, kein Loeschen ohne gestellte Rueckfrage) — derselbe Grund
   *  wie bei `resolveConflict`/`writeNote`: bestehende Tests bauen den Dienst ohne
   *  UI-Fassade. */
  askRemoval?: (wikiPath: string) => Promise<RemovalChoice>;
}

export interface SyncReport {
  created: number;
  updated: number;
  blocked: number;
  skipped: number;
  /** Depublizierte/geloeschte Seiten (`removed-locally`). Eigenes Feld statt in `updated`
   *  mitgezaehlt: Depublizieren/Loeschen ist die destruktivste Operation eines Laufs und
   *  soll nie hinter einer neutralen "aktualisiert"-Zahl verschwinden. */
  removed: number;
  unresolvedLinks: number;
  skippedEmbeds: number;
  errors: { wikiPath: string; message: string }[];
}

export interface BuiltPlan {
  entries: SyncEntry[];
  meta: Map<string, TransformResult>;
  collisions: SlugCollision[];
  /** Mehrdeutige Dateinamen aus der Vault-Quelle — unveraendert durchgereicht,
   *  damit die Status-Ansicht sie neben den Slug-Kollisionen zeigen kann. */
  ambiguousNames: AmbiguousName[];
}

export class SyncService {
  constructor(private readonly deps: SyncDeps) {}

  async buildPlan(): Promise<BuiltPlan> {
    const collected = await collectLocalPages(this.deps.vault, this.deps.syncRoot());
    const [snapshots, remotes] = await Promise.all([this.deps.store.loadAll(), this.deps.client.listPages()]);
    return {
      entries: planSync({ locals: collected.pages, snapshots, remotes }),
      meta: collected.meta,
      collisions: collected.collisions,
      ambiguousNames: collected.ambiguousNames,
    };
  }

  private inputFor(entry: SyncEntry, meta: TransformResult): PageInput {
    return {
      path: entry.wikiPath,
      title: meta.title,
      description: meta.description,
      tags: meta.tags,
      content: meta.content,
    };
  }

  /** Ein Push. Der Drift-Guard laeuft HIER, nicht beim Planen: zwischen Plan und
   *  Klick koennen Minuten liegen, und der Plan ist ein Foto, kein Vertrag.
   *
   *  `collisions` wird explizit hereingereicht statt intern nachgeschlagen: `pushOne`
   *  kennt nur den einen Entry, nicht den ganzen Plan, und `buildPlan()`/`pushOne()`
   *  duerfen zwischen Aufruf und Klick auseinanderfallen (derselbe Grund, aus dem der
   *  Drift-Guard hier und nicht im Plan sitzt). Ein Parameter statt eines impliziten
   *  Felds macht diesen Aufrufer-Vertrag *typmaessig* erzwungen: jeder zukuenftige
   *  Aufrufer — auch `pushAll` aus Task 16 — kann die Pruefung nicht vergessen, ohne
   *  einen fehlenden Parameter zu bekommen. Die Pruefung steht bewusst vor der
   *  gesamten Zustandsverzweigung: eine Slug-Kollision blockiert unabhaengig davon,
   *  ob der Entry sonst als `create`, `update` oder `conflict` durchginge (Spec § 3:
   *  „Slug-Kollision → Fehler in der Status-Ansicht, kein Push"). */
  async pushOne(entry: SyncEntry, meta: TransformResult, collisions: SlugCollision[]): Promise<PushOutcome> {
    if (collisions.some((c) => c.wikiPath === entry.wikiPath)) return { kind: "blocked", reason: "collision" };
    if (entry.state === "unchanged") return { kind: "skipped", reason: "unchanged" };
    if (entry.state === "occupied") return { kind: "blocked", reason: "occupied" };
    // Eigener Zweig VOR dem Drift-Guard: local und snapshot sind hier gesetzt (die Seite
    // war da, ist es aber nicht mehr), also wuerde die generische local/pageId-Pruefung
    // unten durchrutschen und fetchUpdatedAt(pageId) auf eine geloeschte Seite loslassen —
    // Wiki.js liefert dafuer `pages.single: null`, der Client wirft dann WikiError statt
    // still zu scheitern (s. client.ts), aber die Anfrage ist trotzdem sinnlos: der
    // Wiederanlege-Pfad ist bewusst V2 (README/CHANGELOG „Grenzen dieses MVP").
    if (entry.state === "remote-deleted") return { kind: "blocked", reason: "remote-deleted" };
    // "no-local": removed-locally, new-remote und stale-snapshot landen alle hier, weil
    // sie kein `local` haben — keins davon ist eine Slug-Kollision ("occupied" waere hier
    // fachlich falsch, s. main.ts describeOutcome).
    if (entry.local === undefined) return { kind: "blocked", reason: "no-local" };

    if (entry.state === "create") {
      const created = await this.deps.client.createPage(this.inputFor(entry, meta));
      await this.deps.store.save({
        version: 1, wikiPath: entry.wikiPath, pageId: created.id,
        raw: entry.local.raw, pushed: meta.content, remoteUpdatedAt: created.updatedAt,
      });
      return { kind: "created" };
    }

    const pageId = entry.pageId;
    if (pageId === undefined || entry.snapshot === undefined) return { kind: "blocked", reason: "occupied" };

    // updatedAt ist ein GraphQL-Date, das ueber JSON als String ankommt (docs/LAB.md).
    // Der Drift-Guard vergleicht deshalb bewusst Zeichenketten, nicht Zeitpunkte.
    const currentUpdatedAt = await this.deps.client.fetchUpdatedAt(pageId);
    const drifted = currentUpdatedAt !== entry.snapshot.remoteUpdatedAt;
    // Zwei verschiedene Fragen: der Live-Vergleich (drifted) beantwortet "hat sich
    // drueben seit dem Snapshot etwas geaendert?"; state === "conflict" beantwortet
    // "wissen wir bereits, dass beide Seiten auseinanderlaufen?". Ein zurueckgesetztes
    // updatedAt beantwortet die zweite Frage nicht — ein Konflikt braucht IMMER eine
    // Entscheidung, unabhaengig davon, was der Live-Vergleich gerade sagt.
    if (drifted || entry.state === "conflict") {
      if (this.deps.resolveConflict === undefined) return { kind: "blocked", reason: "drift" };
      const remote = await this.deps.client.fetchPage(pageId);
      const choice = await this.deps.resolveConflict(entry, remote.content);
      if (choice !== "local") return { kind: "blocked", reason: "drift" };
      // "local" heisst: bewusst ueberschreiben — der Nutzer hat den Diff gesehen.
    }

    const updated = await this.deps.client.updatePage(pageId, this.inputFor(entry, meta));
    await this.deps.store.save({
      version: 1, wikiPath: entry.wikiPath, pageId,
      raw: entry.local.raw, pushed: meta.content, remoteUpdatedAt: updated.updatedAt,
    });
    return { kind: "updated" };
  }

  /** Sammel-Push ueber den gesamten Plan. Sequenziell, nicht parallel: eine private
   *  Instanz auf einem kleinen VPS soll nicht von 200 gleichzeitigen Mutations
   *  getroffen werden, und die Reihenfolge macht den Report lesbar. Ein Fehler bei
   *  einer Seite beendet den Lauf NICHT — sonst haengt der Bestand nach der ersten
   *  kaputten Seite auf halbem Weg (Spec § 3). `collisions` kommt aus demselben
   *  Plan wie die Entries: `pushOne` erbt die Kollisionspruefung ueber seinen
   *  Pflichtparameter, statt sie zu umgehen. */
  async pushAll(plan: BuiltPlan): Promise<SyncReport> {
    const report: SyncReport = {
      created: 0, updated: 0, blocked: 0, skipped: 0, removed: 0, unresolvedLinks: 0, skippedEmbeds: 0, errors: [],
    };
    for (const entry of plan.entries) {
      if (entry.state === "removed-locally") {
        await this.handleRemovedLocally(entry, report);
        continue;
      }
      const meta = plan.meta.get(entry.wikiPath);
      if (meta === undefined) { report.skipped++; continue; }
      try {
        const outcome = await this.pushOne(entry, meta, plan.collisions);
        if (outcome.kind === "created") report.created++;
        else if (outcome.kind === "updated") report.updated++;
        else if (outcome.kind === "blocked") report.blocked++;
        else report.skipped++;
        if (outcome.kind === "created" || outcome.kind === "updated") {
          report.unresolvedLinks += meta.unresolved.length;
          report.skippedEmbeds += meta.skippedEmbeds.length;
        }
      } catch (err) {
        report.errors.push({ wikiPath: entry.wikiPath, message: err instanceof Error ? err.message : String(err) });
      }
    }
    return report;
  }

  /** Depublizieren ist der Default (Spec § 3): die Seite verschwindet aus dem Wiki,
   *  ihre Historie bleibt. Loeschen ist unumkehrbar und deshalb nie die Vorauswahl —
   *  der Nutzer muss es explizit waehlen. Ein Fehler beim Depublizieren/Loeschen
   *  landet im Report statt den Lauf abzubrechen, aus demselben Grund wie in
   *  `pushAll`. */
  private async handleRemovedLocally(entry: SyncEntry, report: SyncReport): Promise<void> {
    const pageId = entry.pageId;
    if (pageId === undefined || this.deps.askRemoval === undefined) { report.skipped++; return; }
    const choice = await this.deps.askRemoval(entry.wikiPath);
    if (choice === "keep") { report.skipped++; return; }
    try {
      if (choice === "unpublish") await this.deps.client.unpublishPage(pageId);
      else await this.deps.client.deletePage(pageId);
      await this.deps.store.remove(entry.wikiPath);
      report.removed++;
    } catch (err) {
      report.errors.push({ wikiPath: entry.wikiPath, message: err instanceof Error ? err.message : String(err) });
    }
  }

  /** Ein Pull. Nur `remote-changed` und `new-remote` kennen einen Pull — beide sind
   *  Zustaende, in denen sich das Wiki gegenueber dem letzten Snapshot bewegt hat und
   *  die lokale Seite dem folgen soll (bei `new-remote` gibt es noch keine lokale
   *  Seite). Fehlt der `writeNote`-Adapter, gibt es nichts zu tun.
   *
   *  Das Wiki-Markdown wird weitgehend 1:1 in den Vault geschrieben (Spec § 3) — Standard-
   *  Markdown-Links bleiben funktional. Der Snapshot wird MIT dem frischen `updatedAt`
   *  fortgeschrieben; ohne das gaelte die Seite beim naechsten Plan sofort wieder als
   *  remote geaendert. `raw` und `pushed` sind hier identisch: was im Vault steht, ist
   *  genau das, was drueben steht. */
  async pullOne(entry: SyncEntry): Promise<PullOutcome> {
    if (entry.state !== "remote-changed" && entry.state !== "new-remote") return { kind: "skipped" };
    const pageId = entry.pageId;
    if (pageId === undefined || this.deps.writeNote === undefined) return { kind: "skipped" };

    const page = await this.deps.client.fetchPage(pageId);
    const vaultPath = entry.local?.vaultPath ?? wikiPathToVaultPath(entry.wikiPath, this.deps.syncRoot(), page.title);
    await this.deps.writeNote(vaultPath, page.content);
    await this.deps.store.save({
      version: 1, wikiPath: entry.wikiPath, pageId,
      raw: page.content, pushed: page.content, remoteUpdatedAt: page.updatedAt,
    });
    return { kind: "written", vaultPath };
  }
}
