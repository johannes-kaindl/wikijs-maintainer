// Vault-Pfad ↔ Wiki-Pfad. Pure (kein obsidian-Import) — die Slugifizierung ist die
// eine Stelle, an der sich Vault- und Wiki-Namensraum beruehren, und sie muss in
// beide Richtungen deterministisch sein: derselbe Vault-Pfad ergibt ueber Jahre
// denselben Wiki-Pfad, sonst zeigt jeder Snapshot ins Leere.

import { parseFrontmatter } from "../vendor/kit/frontmatter";
import { slugify } from "../vendor/kit/slug";

/** Ein einzelnes Pfad-Segment → Wiki-Slug: Kit-`slugify` mit `punctuation: "drop"`. Satzzeichen ohne
 *  Trennfunktion (`:`, `!`, `(` …) werden geloescht statt durch `-` ersetzt — sonst wuerde aus
 *  "04:35" "04-35" statt "0435", und ein Wiki-Pfad muss ueber Jahre derselbe bleiben. */
const slugOf = (segment: string): string => slugify(segment, { punctuation: "drop" });

function stripTrailingSlash(p: string): string {
  return p.replace(/\/+$/, "");
}

/** Vault-Pfad → Wiki-Pfad; `null`, wenn die Datei nicht unter der Sync-Wurzel liegt.
 *  Die Ordnergrenze wird explizit geprueft — `_published_alt/` faengt zwar mit
 *  `_published` an, ist aber ein anderer Ordner. */
export function vaultPathToWikiPath(vaultPath: string, syncRoot: string): string | null {
  const root = stripTrailingSlash(syncRoot);
  const prefix = root === "" ? "" : `${root}/`;
  if (prefix !== "" && !vaultPath.startsWith(prefix)) return null;
  // Nur `.md` traegt hier eine Endung, die verschwinden soll. Bei jeder anderen Datei
  // faellt die Endung ebenfalls — sonst zieht `slugOf` sie punktlos in den Slug
  // (`Not-A-Page.canvas` → `not-a-pagecanvas`). Die Unterscheidung ist noetig, weil ein
  // Punkt im Notiznamen legitim ist: bei `.md` darf NUR `.md` fallen, sonst wuerde aus
  // `Node.js Grundlagen.md` der Pfad `node`.
  const withoutRoot = vaultPath.slice(prefix.length);
  const rest = /\.md$/i.test(withoutRoot)
    ? withoutRoot.replace(/\.md$/i, "")
    : withoutRoot.replace(/\.[^./]+$/, "");
  if (rest === "") return null;
  return rest.split("/").map(slugOf).filter((s) => s !== "").join("/");
}

/** Frontmatter-Feld, das den Wiki-Pfad einer Notiz festhaelt (der Pfad-Anker). */
export const ANCHOR_KEY = "wiki_path";

/** `/` am Anfang und Ende entfernen — per Schleife, `\/+$` ist auf langen Nicht-Treffern quadratisch (50 000 Zeichen: knapp 1 s). */
function trimSlashes(text: string): string {
  let a = 0;
  let b = text.length;
  while (a < b && text[a] === "/") a++;
  while (b > a && text[b - 1] === "/") b--;
  return text.slice(a, b);
}

/** Der Pfad-Anker einer Notiz: `wiki_path` im Frontmatter, oder `null`, wenn er fehlt oder nicht brauchbar ist
 *  (leer, `..`, leeres Segment, Backslash). Fuehrende und folgende `/` fallen. Ein unbrauchbarer Anker gilt als
 *  fehlend, damit eine Notiz nie auf einen Pfad zeigt, der aus dem Wiki-Namensraum herausfuehrt. */
export function anchorFromFrontmatter(raw: string): string | null {
  const value = parseFrontmatter(raw).data[ANCHOR_KEY];
  if (typeof value !== "string") return null;
  const path = trimSlashes(value.trim());
  if (path === "" || path.includes("\\")) return null;
  if (path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) return null;
  return path;
}

/** Der Wiki-Pfad einer Notiz: der Pfad-Anker, sonst die Ableitung aus dem Vault-Pfad. Ein Anker aendert nichts
 *  daran, ob die Datei unter der Sync-Wurzel liegt (`null` ausserhalb). Der Anker gilt, weil sich der Wiki-Pfad
 *  eines Namens mit `ß`, Umlaut oder Grossbuchstaben aus dem Dateinamen nicht verlustfrei zurueckrechnen laesst. */
export function effectiveWikiPath(vaultPath: string, syncRoot: string, raw: string): string | null {
  const derived = vaultPathToWikiPath(vaultPath, syncRoot);
  if (derived === null) return null;
  return anchorFromFrontmatter(raw) ?? derived;
}

/** Braucht die Notiz einen Anker: nur, wenn die Ableitung aus ihrem Vault-Pfad nicht auf `wikiPath` fuehrt. */
export function anchorNeeded(wikiPath: string, vaultPath: string, syncRoot: string): boolean {
  return vaultPathToWikiPath(vaultPath, syncRoot) !== wikiPath;
}

/** Wiki-Pfad → Vault-Pfad fuer den Pull. Der Titel wird zum Dateinamen (er ist die
 *  menschenlesbare Fassung), aber nur, wenn er zum Pfad zurueckrechnet: der Push leitet den
 *  Wiki-Pfad aus dem Dateinamen ab, ein abweichender Titel liesse die Seite beim naechsten Push
 *  auf einen anderen Pfad wandern. Sonst gilt das letzte Pfadsegment. Zeichen, die kein
 *  Dateiname tragen kann, werden ersetzt.
 *  Ein Pfadsegment, das selbst nicht dem Slug-Alphabet entspricht (Wiki.js erlaubt etwa `ß`), laesst sich
 *  nicht verlustfrei rueckrechnen; dafuer schreibt der Pull `wiki_path` ins Frontmatter ({@link anchorNeeded}). */
export function wikiPathToVaultPath(wikiPath: string, syncRoot: string, title: string): string {
  const root = stripTrailingSlash(syncRoot);
  const segments = wikiPath.split("/");
  const last = segments[segments.length - 1] ?? wikiPath;
  const folder = segments.slice(0, -1).join("/");
  const clean = (text: string): string => text.replace(/[\\/:*?"<>|]/g, "-").replace(/^-+|-+$/g, "");
  const fromTitle = clean(title);
  const name = title.trim() !== "" && slugOf(fromTitle) === last ? fromTitle : clean(last);
  return [root, folder, `${name}.md`].filter((p) => p !== "").join("/");
}

export interface SlugCollision {
  wikiPath: string;
  vaultPaths: string[];
}

/** Zwei Dateien, die auf denselben Wiki-Pfad fallen (`anchorOf`: der Pfad-Anker einer Datei, falls sie einen traegt), duerfen NICHT gepusht werden —
 *  die zweite ueberschriebe sonst stillschweigend die erste. */
export function findSlugCollisions(vaultPaths: string[], syncRoot: string, anchorOf?: (vaultPath: string) => string | null): SlugCollision[] {
  const byWikiPath = new Map<string, string[]>();
  for (const vaultPath of vaultPaths) {
    const wikiPath = anchorOf?.(vaultPath) ?? vaultPathToWikiPath(vaultPath, syncRoot);
    if (wikiPath === null) continue;
    const list = byWikiPath.get(wikiPath);
    if (list) list.push(vaultPath);
    else byWikiPath.set(wikiPath, [vaultPath]);
  }
  return [...byWikiPath.entries()]
    .filter(([, paths]) => paths.length > 1)
    .map(([wikiPath, paths]) => ({ wikiPath, vaultPaths: paths }));
}

/** Dateiname des Snapshots zu einem Wiki-Pfad: FNV-1a-32 als 8 Hex-Stellen.
 *  Hash statt Pfad, weil `/` im Dateinamen nicht geht und eine Ersetzungs-Regel
 *  (`/`→`__`) selbst wieder kollidieren kann. Der Klartext-Pfad steht im JSON. */
export function snapshotFileName(wikiPath: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < wikiPath.length; i++) {
    hash ^= wikiPath.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16).padStart(8, "0")}.json`;
}
