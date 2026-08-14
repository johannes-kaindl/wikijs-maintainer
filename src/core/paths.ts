// Vault-Pfad ↔ Wiki-Pfad. Pure (kein obsidian-Import) — die Slugifizierung ist die
// eine Stelle, an der sich Vault- und Wiki-Namensraum beruehren, und sie muss in
// beide Richtungen deterministisch sein: derselbe Vault-Pfad ergibt ueber Jahre
// denselben Wiki-Pfad, sonst zeigt jeder Snapshot ins Leere.

const TRANSLIT: Record<string, string> = {
  ä: "ae", ö: "oe", ü: "ue", ß: "ss", à: "a", á: "a", â: "a", è: "e", é: "e",
  ê: "e", ë: "e", í: "i", ì: "i", î: "i", ó: "o", ò: "o", ô: "o", ú: "u", ù: "u", û: "u", ç: "c", ñ: "n",
};

/** Ein einzelnes Pfad-Segment → Wiki-Slug. Bewusst konservativ: nur a-z, 0-9, `-`.
 *  Satzzeichen ohne Trennfunktion (`:`, `!`, `(` …) werden geloescht statt durch
 *  `-` ersetzt — sonst wuerde aus "04:35" "04-35" statt "0435". Erst danach werden
 *  verbleibende Whitespace-/Bindestrich-Ketten zu einem einzelnen `-` zusammengefasst. */
export function slugifySegment(segment: string): string {
  const lower = segment.toLowerCase();
  let out = "";
  for (const ch of lower) out += TRANSLIT[ch] ?? ch;
  return out
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

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
  // faellt die Endung ebenfalls — sonst zieht `slugifySegment` sie punktlos in den Slug
  // (`Not-A-Page.canvas` → `not-a-pagecanvas`). Die Unterscheidung ist noetig, weil ein
  // Punkt im Notiznamen legitim ist: bei `.md` darf NUR `.md` fallen, sonst wuerde aus
  // `Node.js Grundlagen.md` der Pfad `node`.
  const withoutRoot = vaultPath.slice(prefix.length);
  const rest = /\.md$/i.test(withoutRoot)
    ? withoutRoot.replace(/\.md$/i, "")
    : withoutRoot.replace(/\.[^./]+$/, "");
  if (rest === "") return null;
  return rest.split("/").map(slugifySegment).filter((s) => s !== "").join("/");
}

/** Wiki-Pfad → Vault-Pfad fuer den Pull. Der Titel wird zum Dateinamen (er ist die
 *  menschenlesbare Fassung); Zeichen, die kein Dateiname tragen kann, werden ersetzt. */
export function wikiPathToVaultPath(wikiPath: string, syncRoot: string, title: string): string {
  const root = stripTrailingSlash(syncRoot);
  const segments = wikiPath.split("/");
  const last = segments[segments.length - 1] ?? wikiPath;
  const folder = segments.slice(0, -1).join("/");
  const name = (title.trim() === "" ? last : title)
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/^-+|-+$/g, "");
  return [root, folder, `${name}.md`].filter((p) => p !== "").join("/");
}

export interface SlugCollision {
  wikiPath: string;
  vaultPaths: string[];
}

/** Zwei Dateien, die auf denselben Wiki-Pfad fallen, duerfen NICHT gepusht werden —
 *  die zweite ueberschriebe sonst stillschweigend die erste. */
export function findSlugCollisions(vaultPaths: string[], syncRoot: string): SlugCollision[] {
  const byWikiPath = new Map<string, string[]>();
  for (const vaultPath of vaultPaths) {
    const wikiPath = vaultPathToWikiPath(vaultPath, syncRoot);
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
