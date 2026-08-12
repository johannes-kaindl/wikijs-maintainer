// Snapshots als Einzeldateien im Plugin-Datenordner (Spec § 2): data.json bleibt den
// Settings vorbehalten, und ein defekter Snapshot reisst nicht den Bestand mit —
// loadAll ueberspringt ihn, statt zu werfen.
import type { DataAdapter } from "obsidian";
import { parseSnapshot, serializeSnapshot, type Snapshot } from "../core/snapshot";
import { snapshotFileName } from "../core/paths";

export class SnapshotStore {
  constructor(
    private readonly adapter: DataAdapter,
    private readonly pluginDir: string,
  ) {}

  private get dir(): string {
    return `${this.pluginDir}/snapshots`;
  }

  private pathFor(wikiPath: string): string {
    return `${this.dir}/${snapshotFileName(wikiPath)}`;
  }

  async loadAll(): Promise<Snapshot[]> {
    if (!(await this.adapter.exists(this.dir))) return [];
    const listing = await this.adapter.list(this.dir);
    const out: Snapshot[] = [];
    for (const file of listing.files) {
      // DataAdapter.list() liefert vollstaendige Pfade, nicht nur Dateinamen —
      // endsWith(".json") reicht trotzdem, weil der Pfadanteil davor egal ist.
      if (!file.endsWith(".json")) continue;
      const parsed = parseSnapshot(await this.adapter.read(file));
      if (parsed !== null) out.push(parsed);
    }
    return out;
  }

  async save(snapshot: Snapshot): Promise<void> {
    if (!(await this.adapter.exists(this.dir))) await this.adapter.mkdir(this.dir);
    await this.adapter.write(this.pathFor(snapshot.wikiPath), serializeSnapshot(snapshot));
  }

  async remove(wikiPath: string): Promise<void> {
    const path = this.pathFor(wikiPath);
    if (await this.adapter.exists(path)) await this.adapter.remove(path);
  }
}
