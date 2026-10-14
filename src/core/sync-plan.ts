// Die Zustandsmaschine aus Spec § 3. Pure und ohne I/O: sie bekommt drei Listen und
// gibt eine Liste zurueck. Genau deshalb ist jede Zeile der Spec-Tabelle ein Test,
// der in Millisekunden laeuft — ohne Wiki, ohne Vault, ohne Obsidian.
import type { Snapshot } from "./snapshot";

export interface LocalPage {
  vaultPath: string;
  wikiPath: string;
  /** Rohinhalt der Datei — die Vergleichsgrundlage gegen `snapshot.raw`. */
  raw: string;
  /** Bereits transformierte Fassung — was gepusht wuerde. */
  transformed: string;
}

export interface RemotePage {
  id: number;
  path: string;
  title: string;
  updatedAt: string;
  /** Sprache der Wiki-Seite. Pfad allein identifiziert in Wiki.js keine Seite. */
  locale?: string;
}

export type SyncState =
  | "create"
  | "update"
  | "remote-changed"
  | "conflict"
  | "occupied"
  | "removed-locally"
  | "remote-deleted"
  | "new-remote"
  | "stale-snapshot"
  | "unchanged";

export interface SyncEntry {
  wikiPath: string;
  state: SyncState;
  pageId?: number;
  local?: LocalPage;
  remote?: RemotePage;
  snapshot?: Snapshot;
}

export interface PlanInput {
  locals: LocalPage[];
  snapshots: Snapshot[];
  remotes: RemotePage[];
  /** Eingestellte Wiki-Sprache. Lokale Seiten und Snapshots gehoeren zu ihr; Seiten anderer
   *  Sprachen sind fuer diesen Plan nicht vorhanden. */
  locale?: string;
}

function decide(
  local: LocalPage | undefined,
  snapshot: Snapshot | undefined,
  remote: RemotePage | undefined,
): SyncState {
  if (snapshot === undefined) {
    if (local !== undefined && remote === undefined) return "create";
    if (local !== undefined && remote !== undefined) return "occupied";
    return "new-remote"; // remote existiert, lokal nichts, kein Snapshot
  }
  if (local === undefined && remote === undefined) return "stale-snapshot";
  if (local === undefined) return "removed-locally";
  if (remote === undefined) return "remote-deleted";

  const localChanged = local.raw !== snapshot.raw;
  const remoteChanged = remote.updatedAt !== snapshot.remoteUpdatedAt;
  if (localChanged && remoteChanged) return "conflict";
  if (localChanged) return "update";
  if (remoteChanged) return "remote-changed";
  return "unchanged";
}

/** Fuehrt die drei Quellen ueber Sprache und Wiki-Pfad zusammen und entscheidet je Eintrag.
 *  Sortiert nach Pfad — die Status-Ansicht soll zwischen zwei Laeufen nicht
 *  umspringen, auch wenn die API die Seiten anders herum liefert. */
export function planSync(input: PlanInput): SyncEntry[] {
  // Schluessel ist `locale:path`, nicht der Pfad allein: zwei Seiten gleichen Pfads in zwei
  // Sprachen duerfen sich nicht denselben Slot teilen (eine ueberschriebe die andere, und
  // `pageId` zeigte auf die falsche Sprache). Lokale Dateien und Snapshots tragen keine
  // Sprache; sie gehoeren zur eingestellten.
  const own = input.locale ?? "";
  const bySlot = new Map<string, { wikiPath: string; local?: LocalPage; snapshot?: Snapshot; remote?: RemotePage }>();
  const slot = (locale: string, wikiPath: string): { wikiPath: string; local?: LocalPage; snapshot?: Snapshot; remote?: RemotePage } => {
    const key = `${locale}:${wikiPath}`;
    const found = bySlot.get(key);
    if (found) return found;
    const fresh = { wikiPath };
    bySlot.set(key, fresh);
    return fresh;
  };

  for (const local of input.locals) slot(own, local.wikiPath).local = local;
  for (const snapshot of input.snapshots) slot(own, snapshot.wikiPath).snapshot = snapshot;
  for (const remote of input.remotes) {
    // Eine Seite in fremder Sprache ist fuer diesen Plan nicht vorhanden: weder `occupied`
    // noch `new-remote` (ein Pull legte sie sonst als Notiz einer falschen Sprache an).
    if (input.locale !== undefined && remote.locale !== undefined && remote.locale !== input.locale) continue;
    slot(remote.locale ?? own, remote.path).remote = remote;
  }

  return [...bySlot.values()]
    .map((parts) => ({
      wikiPath: parts.wikiPath,
      state: decide(parts.local, parts.snapshot, parts.remote),
      pageId: parts.snapshot?.pageId ?? parts.remote?.id,
      local: parts.local,
      remote: parts.remote,
      snapshot: parts.snapshot,
    }))
    .sort((a, b) => (a.wikiPath < b.wikiPath ? -1 : a.wikiPath > b.wikiPath ? 1 : 0));
}

/** Zustand → i18n-Schluessel. Als `Record` ueber die Union geschrieben, nicht als
 *  switch mit default: ein neuer Zustand bricht damit den Build statt in der
 *  Oberflaeche unbeschriftet zu erscheinen. */
const STATUS_LABEL_KEY: Record<SyncState, string> = {
  create: "status.create",
  update: "status.update",
  "remote-changed": "status.remoteChanged",
  conflict: "status.conflict",
  occupied: "status.occupied",
  "removed-locally": "status.removedLocally",
  "remote-deleted": "status.remoteDeleted",
  "new-remote": "status.newRemote",
  "stale-snapshot": "status.staleSnapshot",
  unchanged: "status.unchanged",
};

export function statusLabelKey(state: SyncState): string {
  return STATUS_LABEL_KEY[state];
}
