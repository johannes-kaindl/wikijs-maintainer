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

/** Fuehrt die drei Quellen ueber den Wiki-Pfad zusammen und entscheidet je Pfad.
 *  Sortiert nach Pfad — die Status-Ansicht soll zwischen zwei Laeufen nicht
 *  umspringen, auch wenn die API die Seiten anders herum liefert. */
export function planSync(input: PlanInput): SyncEntry[] {
  const byPath = new Map<string, { local?: LocalPage; snapshot?: Snapshot; remote?: RemotePage }>();
  const slot = (wikiPath: string): { local?: LocalPage; snapshot?: Snapshot; remote?: RemotePage } => {
    const found = byPath.get(wikiPath);
    if (found) return found;
    const fresh = {};
    byPath.set(wikiPath, fresh);
    return fresh;
  };

  for (const local of input.locals) slot(local.wikiPath).local = local;
  for (const snapshot of input.snapshots) slot(snapshot.wikiPath).snapshot = snapshot;
  for (const remote of input.remotes) slot(remote.path).remote = remote;

  return [...byPath.entries()]
    .map(([wikiPath, parts]) => ({
      wikiPath,
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
