// Vault-Ordner → LocalPage[]. Der einzige Ort, an dem Datei-I/O auf die pure
// Transformation trifft.
import type { TFile, Vault } from "obsidian";
import { findSlugCollisions, vaultPathToWikiPath, type SlugCollision } from "../core/paths";
import { transformForWiki, type TransformResult } from "../core/transform";
import type { LocalPage } from "../core/sync-plan";

export interface AmbiguousName {
  name: string;
  vaultPaths: string[];
}

export interface CollectedPages {
  pages: LocalPage[];
  /** Wiki-Pfad → Transformations-Befund (Titel, Tags, offene Links). */
  meta: Map<string, TransformResult>;
  collisions: SlugCollision[];
  /** Basisnamen, die mehr als eine gesyncte Datei tragen — deshalb aus dem
   *  Resolver entfernt statt willkuerlich auf eine davon aufzuloesen. */
  ambiguousNames: AmbiguousName[];
}

export async function collectLocalPages(vault: Vault, syncRoot: string): Promise<CollectedPages> {
  const files = vault.getMarkdownFiles().filter((f: TFile) => vaultPathToWikiPath(f.path, syncRoot) !== null);

  // Erst die vollstaendige Karte bauen, dann transformieren: ein Wikilink darf nicht
  // davon abhaengen, ob sein Ziel zufaellig frueher gelesen wurde.
  //
  // Obsidian schreibt Wikilinks im "shortest path when possible"-Modus: es haengt
  // nur so viel vom Pfad an, wie zur Eindeutigkeit noetig ist. `[[Uebersicht]]`,
  // `[[Netzwerk/Uebersicht]]` und `[[_published/Netzwerk/Uebersicht]]` sind alle
  // gueltige Verweise auf dieselbe Datei -- deshalb wird hier jede zusammenhaengende
  // End-Sequenz der Pfadsegmente als eigener Schluessel registriert, nicht nur
  // Basisname und voller Pfad.
  const byName = new Map<string, string>();
  const keyPaths = new Map<string, string[]>();
  const pathsByBasename = new Map<string, string[]>();
  for (const file of files) {
    const wikiPath = vaultPathToWikiPath(file.path, syncRoot);
    if (wikiPath === null) continue;
    const segments = file.path.replace(/\.md$/i, "").split("/");
    for (let i = segments.length - 1; i >= 0; i--) {
      const key = segments.slice(i).join("/");
      byName.set(key, wikiPath);
      const paths = keyPaths.get(key);
      if (paths) paths.push(file.path);
      else keyPaths.set(key, [file.path]);
    }
    const basenamePaths = pathsByBasename.get(file.basename);
    if (basenamePaths) basenamePaths.push(file.path);
    else pathsByBasename.set(file.basename, [file.path]);
  }

  // Jeder Schluessel, der auf mehr als eine Datei zeigt, wird wieder entfernt: ein
  // Treffer, der von der Iterationsreihenfolge abhinge, waere schlimmer als gar
  // keiner — der Link bleibt Text und landet ueber `unresolved` sichtbar im
  // Sync-Report. Ist z. B. nur der Basisname mehrdeutig, bleiben die laengeren,
  // disambiguierenden Formen (`Netzwerk/Uebersicht`, `Archiv/Uebersicht`) auflösbar.
  for (const [key, paths] of keyPaths) {
    if (paths.length > 1) byName.delete(key);
  }

  // `ambiguousNames` meldet bewusst nur mehrdeutige Basisnamen, nicht jeden
  // mehrdeutigen Suffix: das ist die Form, die Nutzer tatsaechlich tippen und die
  // sie umbenennen muessten, um die Kollision aufzuloesen.
  const ambiguousNames: AmbiguousName[] = [];
  for (const [name, paths] of pathsByBasename) {
    if (paths.length > 1) ambiguousNames.push({ name, vaultPaths: paths });
  }

  const resolve = (target: string): string | null => byName.get(target) ?? null;

  const pages: LocalPage[] = [];
  const meta = new Map<string, TransformResult>();
  for (const file of files) {
    const wikiPath = vaultPathToWikiPath(file.path, syncRoot);
    if (wikiPath === null) continue;
    const raw = await vault.cachedRead(file);
    const result = transformForWiki(raw, file.basename, resolve);
    pages.push({ vaultPath: file.path, wikiPath, raw, transformed: result.content });
    meta.set(wikiPath, result);
  }

  return { pages, meta, collisions: findSlugCollisions(files.map((f: TFile) => f.path), syncRoot), ambiguousNames };
}
