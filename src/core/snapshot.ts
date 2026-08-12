// Snapshot einer gesyncten Seite. Drei Teile, weil die Transformation einweg ist:
// `raw` beantwortet "lokal geaendert?" (gegen den heutigen Dateiinhalt), `pushed`
// beantwortet "was steht drueben, wenn niemand am Wiki war", und `remoteUpdatedAt`
// beantwortet "remote geaendert?" (Spec § 3).
export interface Snapshot {
  version: 1;
  wikiPath: string;
  pageId: number;
  raw: string;
  pushed: string;
  remoteUpdatedAt: string;
}

export function serializeSnapshot(snapshot: Snapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

/** Tolerant gegen Muell: ein kaputter Snapshot ergibt `null` und wird behandelt wie
 *  "kein Snapshot" — die Seite gilt dann als neu, was schlimmstenfalls einen
 *  Konflikt-Dialog erzeugt. Ein Wurf wuerde stattdessen den ganzen Sync-Lauf
 *  abbrechen; das ist der Grund fuer eine Datei je Seite (Spec § 2). */
export function parseSnapshot(text: string): Snapshot | null {
  try {
    const raw = JSON.parse(text) as Partial<Snapshot>;
    if (raw.version !== 1) return null;
    if (typeof raw.wikiPath !== "string" || typeof raw.pageId !== "number") return null;
    if (typeof raw.raw !== "string" || typeof raw.pushed !== "string") return null;
    if (typeof raw.remoteUpdatedAt !== "string") return null;
    return raw as Snapshot;
  } catch {
    return null;
  }
}
