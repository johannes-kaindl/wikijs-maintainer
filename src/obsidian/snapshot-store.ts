// Snapshots als Einzeldateien im Plugin-Datenordner (Spec § 2): data.json bleibt den
// Settings vorbehalten, und ein defekter Snapshot reisst nicht den Bestand mit —
// loadAll ueberspringt ihn, statt zu werfen.
import type { DataAdapter } from "obsidian";
import { parseSnapshot, serializeSnapshot, type Snapshot } from "../core/snapshot";
import { snapshotFileName } from "../core/paths";

export class SnapshotStore {
  private readonly vaultFolder: string;

  /** `folder` leer: Plugin-Ordner (bisheriges Verhalten). Gesetzt: Ordner im Vault, damit die
   *  Snapshots mit dem Vault auf ein zweites Geraet reisen. */
  constructor(
    private readonly adapter: DataAdapter,
    private readonly pluginDir: string,
    folder = "",
  ) {
    this.vaultFolder = folder.trim().replace(/^\/+|\/+$/g, "");
  }

  private get legacyDir(): string {
    return `${this.pluginDir}/snapshots`;
  }

  private get dir(): string {
    return this.vaultFolder === "" ? this.legacyDir : this.vaultFolder;
  }

  /** Beim ersten Laden mit neuem Ordner: Snapshots aus dem Plugin-Ordner kopieren (nicht
   *  verschieben), sonst stuende der gesamte Bestand nach dem Umstellen auf `occupied`. Nur wenn
   *  der Zielordner noch keinen Snapshot traegt — ein dort vorhandener Stand gewinnt. */
  private async adoptLegacy(): Promise<void> {
    if (this.vaultFolder === "") return;
    if (await this.adapter.exists(this.dir)) {
      const present = await this.adapter.list(this.dir);
      if (present.files.some((f) => f.endsWith(".json"))) return;
    }
    if (!(await this.adapter.exists(this.legacyDir))) return;
    const legacy = (await this.adapter.list(this.legacyDir)).files.filter((f) => f.endsWith(".json"));
    if (legacy.length === 0) return;
    if (!(await this.adapter.exists(this.dir))) await this.adapter.mkdir(this.dir);
    for (const file of legacy) {
      await this.adapter.write(`${this.dir}/${file.slice(file.lastIndexOf("/") + 1)}`, await this.adapter.read(file));
    }
  }

  private pathFor(wikiPath: string): string {
    return `${this.dir}/${snapshotFileName(wikiPath)}`;
  }

  async loadAll(): Promise<Snapshot[]> {
    await this.adoptLegacy();
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
