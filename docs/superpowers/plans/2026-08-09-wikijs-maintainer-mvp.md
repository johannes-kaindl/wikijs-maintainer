# wikijs-maintainer MVP — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein Obsidian-Plugin, das einen Vault-Ordner per Wiki.js-2.x-GraphQL-API in beide Richtungen abgleicht — Push mit Drift-Guard, Pull, Status-Ansicht — auf Basis von Snapshots, die den späteren Drei-Wege-Merge (V3) ohne Umbau tragen.

**Architecture:** Pure Core (`src/core/`, kein Obsidian-Import, per `check:pure` erzwungen) trägt Pfad-Mapping, Markdown-Transformation, Diff und die Sync-Zustandsmaschine. Die Obsidian-Schale (`src/obsidian/`) macht Datei-I/O, Commands und UI; `src/wikijs/` kapselt GraphQL über `requestUrl` + `withTimeout`. Zustand lebt in einer Snapshot-Datei je Seite unter dem Plugin-Datenordner, `data.json` bleibt den Settings vorbehalten.

**Tech Stack:** TypeScript, esbuild (Bundle nach `main.js`), vitest + vendorter `obsidian-mock`, obsidian-kit@0.26.0 (vendored), Wiki.js 2.x GraphQL.

## Global Constraints

Diese gelten für **jeden** Task; sie werden in den Tasks nicht wiederholt.

- **Spec ist bindend:** `40_Tools/wikijs/docs/superpowers/specs/2026-08-09-wikijs-gesamt-design.md`, Abschnitte 2 und 3. Abweichung nur mit Rückfrage.
- **`src/core/` importiert niemals `obsidian`.** `npm run check:pure` bricht sonst ab.
- **Vendorte Dateien werden nie von Hand editiert** (`src/vendor/kit/`, `src/vendor/kit-obsidian/`, `tests/vendor/kit/`). Änderungsbedarf → im Kit ändern, dann `tools/sync-kit.sh`.
- **Übernahmen aus Nachbar-Repos tragen in Zeile 1 einen Herkunftsstempel:** `// uebernommen aus <repo>/<pfad>, <YYYY-MM-DD>`.
- **Kein Inline-`eslint-disable`** in `src/` — `scripts/check-no-inline-disables.mjs` blockt es. Nötige Ausnahmen als file-scoped Override mit Begründung in `eslint.config.mjs`.
- **Keine absoluten Maintainer-Pfade** (Home- oder Vault-Pfade wie `~/…` bzw. `$VAULT/…`) in tracked `*.md` — CORE-META-14, `check-no-abs-paths` blockt.
- **EN ist die kanonische UI-Sprache**, DE gleichwertig gepflegt (PROF-OBS-07). Jeder neue UI-String bekommt beide Fassungen in `src/i18n/strings.ts`.
- **UI nur mit Theme-CSS-Variablen** (`UI-STANDARD.md`), keine festen Farben.
- **Vor jedem Commit:** `npm run gate` (lint + typecheck + typecheck:scripts + test + check:pure + build). Ein Task gilt erst als fertig, wenn das Gate grün ist.
- **Commit-Sprache Deutsch**, Format Conventional Commits, Body erklärt das *Warum*.
- **Timeout:** jeder Netzzugriff läuft durch `withTimeout` aus `src/vendor/kit/timeout` mit den Timern aus `src/vendor/kit-obsidian/clock` — `requestUrl` kennt selbst weder Timeout noch Abort.

## File Structure

| Datei | Verantwortung |
|---|---|
| `src/core/paths.ts` | Slugifizierung, Vault-Pfad ↔ Wiki-Pfad, Kollisionserkennung, Snapshot-Dateiname |
| `src/core/page-meta.ts` | Frontmatter → Titel/Description/Tags + Body ohne Frontmatter |
| `src/core/links.ts` | `[[Wikilink]]`- und `![[Embed]]`-Umschreibung |
| `src/core/transform.ts` | Obsidian-MD → Wiki.js-MD (Callouts) + Komposition mit `links.ts` |
| `src/core/diff.ts` | Zeilen-Diff (Übernahme aus koda-agent) |
| `src/core/sync-plan.ts` | Zustandsmaschine (lokal, Snapshot, remote) → Aktion |
| `src/core/snapshot.ts` | Snapshot-Datentyp + Serialisierung/Validierung (pure) |
| `src/wikijs/queries.ts` | GraphQL-Dokumente |
| `src/wikijs/client.ts` | Transport: `requestUrl` + Bearer + `withTimeout`, Fehler-Normalisierung |
| `src/obsidian/snapshot-store.ts` | Snapshot-Dateien lesen/schreiben/löschen im Plugin-Datenordner |
| `src/obsidian/vault-source.ts` | Vault-Ordner → `LocalPage[]` (Datei-I/O, Link-Auflösung) |
| `src/obsidian/settings.ts` | Deklarativer Settings-Tab über den Kit-Walker |
| `src/obsidian/status-view.ts` | Sync-Status-Ansicht |
| `src/obsidian/conflict-modal.ts` | Diff-Ansicht + Entscheidung lokal/remote/abbrechen |
| `src/obsidian/sync-service.ts` | Orchestrierung: Plan holen, Drift-Guard, ausführen, Report |
| `src/i18n/strings.ts` | EN/DE-Strings |
| `src/main.ts` | Plugin-Einstieg: Settings laden, i18n, Commands, View-Registrierung |
| `scripts/wikijs-lab.ts` | Sondier-Skript gegen eine laufende Instanz (kein Bundle-Bestandteil) |

---

### Task 1: Schema-Gegenprobe gegen die laufende Instanz (Lab-Skript)

**Warum zuerst:** Alle GraphQL-Dokumente in Task 8 sind aus der Wiki.js-2.x-Doku
abgeleitet, nicht gemessen. Ein Feldname, den 2.5.x anders schreibt, fällt sonst
erst beim ersten echten Push auf — nach fünf fertigen Tasks. Das Muster ist im
Ökosystem etabliert (REGISTRY „System-Prompt-Iterations-Lab", n=3:
`vim-dojo/scripts/debrief-lab.mjs`, `obsidian-transmute/scripts/diagnose-lab.ts`,
`koda-agent/scripts/koda-lab.ts`) — dies ist das 4. Exemplar und der Anlass, den
Registry-Status auf Kit-Kandidat zu heben.

**Files:**
- Create: `scripts/wikijs-lab.ts`
- Create: `docs/LAB.md`
- Modify: `AGENTS.md` (Befund-Verweis)

**Interfaces:**
- Consumes: nichts.
- Produces: `docs/LAB.md` mit den **gemessenen** Feldnamen von `pages.list`, `pages.single`, `pages.create`, `pages.update`, `pages.delete` und der Fehlerform (`responseResult`). Task 8 zitiert diese Datei, nicht die Online-Doku.

- [ ] **Step 1: Lab-Skript schreiben**

`scripts/wikijs-lab.ts` — läuft in Node (nicht in Obsidian), spricht `fetch`
direkt, liest Zugang aus der Umgebung:

```ts
// Sondier-Skript: misst das GraphQL-Schema einer laufenden Wiki.js-2.x-Instanz.
// Kein Bundle-Bestandteil (nur tsconfig.scripts.json). Muster: koda-agent/scripts/koda-lab.ts.
const URL_BASE = process.env.WIKIJS_URL;
const TOKEN = process.env.WIKIJS_TOKEN;

if (!URL_BASE || !TOKEN) {
  console.error("WIKIJS_URL und WIKIJS_TOKEN muessen gesetzt sein.");
  process.exit(2);
}

async function gql(query: string, variables: Record<string, unknown> = {}): Promise<unknown> {
  const res = await fetch(`${URL_BASE.replace(/\/$/, "")}/graphql`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as { data?: unknown; errors?: unknown };
  if (json.errors) console.error("GraphQL-Fehler:", JSON.stringify(json.errors, null, 2));
  return json.data;
}

async function main(): Promise<void> {
  console.log("── 1. Felder von PageListItem ──");
  console.log(JSON.stringify(await gql(`{ __type(name: "PageListItem") { fields { name type { name kind ofType { name } } } } }`), null, 2));

  console.log("── 2. Felder von Page ──");
  console.log(JSON.stringify(await gql(`{ __type(name: "Page") { fields { name } } }`), null, 2));

  console.log("── 3. Argumente von PageMutation.create/update/delete ──");
  console.log(JSON.stringify(await gql(`{ __type(name: "PageMutation") { fields { name args { name type { name kind ofType { name } } } } } }`), null, 2));

  console.log("── 4. Form von PageResponse (responseResult) ──");
  console.log(JSON.stringify(await gql(`{ __type(name: "PageResponse") { fields { name } } }`), null, 2));

  console.log("── 5. Echter Listen-Aufruf ──");
  console.log(JSON.stringify(await gql(`{ pages { list(orderBy: PATH) { id path title updatedAt locale } } }`), null, 2));
}

void main();
```

- [ ] **Step 2: Typecheck des Skripts**

Run: `npm run typecheck:scripts`
Expected: PASS (keine Ausgabe).

- [ ] **Step 3: Gegen die Instanz laufen lassen**

Das braucht einen API-Key mit Schreibrecht auf Seiten — **dieser
Schritt gehört Johannes**, nicht dem Agenten. Als `/user-handover` übergeben, nicht
als loser Text. Aufruf:

```bash
WIKIJS_URL=https://wiki.example.org WIKIJS_TOKEN=… npm run lab:wikijs
```

- [ ] **Step 4: Befund in `docs/LAB.md` festhalten**

Nicht die Roh-Ausgabe ablegen, sondern das Destillat: je Operation die exakte
Signatur, die Task 8 benutzt, plus jede Abweichung von der Doku-Annahme. Struktur:

```markdown
# LAB — gemessenes GraphQL-Schema

Instanz: Wiki.js <version> · gemessen <YYYY-MM-DD>

## pages.list
Argumente: … · Rückgabefelder: …

## pages.single
…

## Mutations create / update / delete
…

## Fehlerform
`responseResult { succeeded errorCode slug message }` — bestätigt / abweichend: …

## Abweichungen von der Doku-Annahme des Plans
- …
```

- [ ] **Step 5: Commit**

```bash
git add scripts/wikijs-lab.ts docs/LAB.md AGENTS.md
git commit -m "feat(lab): GraphQL-Schema der Instanz gemessen statt angenommen"
```

---

### Task 2: Pfad-Mapping und Slugifizierung

**Files:**
- Create: `src/core/paths.ts`
- Test: `tests/paths.test.ts`

**Interfaces:**
- Consumes: nichts.
- Produces:
  - `slugifySegment(segment: string): string`
  - `vaultPathToWikiPath(vaultPath: string, syncRoot: string): string | null` (`null` = liegt nicht unter `syncRoot`)
  - `wikiPathToVaultPath(wikiPath: string, syncRoot: string, title: string): string`
  - `findSlugCollisions(vaultPaths: string[], syncRoot: string): SlugCollision[]` mit `interface SlugCollision { wikiPath: string; vaultPaths: string[] }`
  - `snapshotFileName(wikiPath: string): string`

- [ ] **Step 1: Failing test schreiben**

```ts
import { describe, expect, it } from "vitest";
import {
  findSlugCollisions,
  slugifySegment,
  snapshotFileName,
  vaultPathToWikiPath,
  wikiPathToVaultPath,
} from "../src/core/paths";

describe("slugifySegment", () => {
  it("schreibt klein und ersetzt Leerzeichen durch Bindestriche", () => {
    expect(slugifySegment("DNS Setup")).toBe("dns-setup");
  });

  it("transliteriert Umlaute und scharfes S statt sie zu entfernen", () => {
    expect(slugifySegment("Größe Änderung Übersicht")).toBe("groesse-aenderung-uebersicht");
  });

  it("wirft alles weg, was kein Buchstabe, keine Ziffer und kein Bindestrich ist", () => {
    expect(slugifySegment("Backup (täglich!) 04:35")).toBe("backup-taeglich-0435");
  });

  it("fasst Bindestrich-Ketten zusammen und trimmt sie an den Raendern", () => {
    expect(slugifySegment("--Netzwerk – Setup--")).toBe("netzwerk-setup");
  });
});

describe("vaultPathToWikiPath", () => {
  it("mappt den Pfad unterhalb der Sync-Wurzel 1:1 und wirft die Endung weg", () => {
    expect(vaultPathToWikiPath("_published/Netzwerk/DNS-Setup.md", "_published")).toBe("netzwerk/dns-setup");
  });

  it("vertraegt einen Schraegstrich am Ende der Sync-Wurzel", () => {
    expect(vaultPathToWikiPath("_published/Netzwerk/DNS-Setup.md", "_published/")).toBe("netzwerk/dns-setup");
  });

  it("gibt null zurueck fuer Dateien ausserhalb der Sync-Wurzel", () => {
    expect(vaultPathToWikiPath("10_Werkstatt/Entwurf.md", "_published")).toBeNull();
  });

  it("beachtet die Ordnergrenze — ein Praefix-Treffer reicht nicht", () => {
    expect(vaultPathToWikiPath("_published_alt/Notiz.md", "_published")).toBeNull();
  });

  it("slugifiziert jedes Segment einzeln, nicht den Gesamtpfad", () => {
    expect(vaultPathToWikiPath("_published/Netzwerk & DNS/Über uns.md", "_published")).toBe("netzwerk-dns/ueber-uns");
  });
});

describe("wikiPathToVaultPath", () => {
  it("haengt den Wiki-Pfad an die Sync-Wurzel und nutzt den Titel als Dateinamen", () => {
    expect(wikiPathToVaultPath("netzwerk/dns-setup", "_published", "DNS Setup")).toBe("_published/netzwerk/DNS Setup.md");
  });

  it("faellt auf das letzte Pfadsegment zurueck, wenn der Titel leer ist", () => {
    expect(wikiPathToVaultPath("netzwerk/dns-setup", "_published", "")).toBe("_published/netzwerk/dns-setup.md");
  });

  it("entschaerft Zeichen, die in einem Dateinamen nicht vorkommen duerfen", () => {
    expect(wikiPathToVaultPath("faq", "_published", "Was/Wie: Warum?")).toBe("_published/Was-Wie- Warum.md");
  });
});

describe("findSlugCollisions", () => {
  it("meldet zwei Dateien, die auf denselben Wiki-Pfad fallen", () => {
    const collisions = findSlugCollisions(
      ["_published/DNS Setup.md", "_published/dns-setup.md", "_published/Anderes.md"],
      "_published",
    );
    expect(collisions).toEqual([
      { wikiPath: "dns-setup", vaultPaths: ["_published/DNS Setup.md", "_published/dns-setup.md"] },
    ]);
  });

  it("meldet nichts, wenn alle Pfade eindeutig sind", () => {
    expect(findSlugCollisions(["_published/A.md", "_published/B.md"], "_published")).toEqual([]);
  });
});

describe("snapshotFileName", () => {
  it("ist deterministisch und endet auf .json", () => {
    expect(snapshotFileName("netzwerk/dns-setup")).toBe(snapshotFileName("netzwerk/dns-setup"));
    expect(snapshotFileName("netzwerk/dns-setup")).toMatch(/^[0-9a-f]{8}\.json$/);
  });

  it("unterscheidet verschiedene Pfade", () => {
    expect(snapshotFileName("a/b")).not.toBe(snapshotFileName("a/c"));
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `npx vitest run tests/paths.test.ts`
Expected: FAIL — `Failed to resolve import "../src/core/paths"`.

- [ ] **Step 3: Minimale Implementierung**

```ts
// Vault-Pfad ↔ Wiki-Pfad. Pure (kein obsidian-Import) — die Slugifizierung ist die
// eine Stelle, an der sich Vault- und Wiki-Namensraum beruehren, und sie muss in
// beide Richtungen deterministisch sein: derselbe Vault-Pfad ergibt ueber Jahre
// denselben Wiki-Pfad, sonst zeigt jeder Snapshot ins Leere.

const TRANSLIT: Record<string, string> = {
  ä: "ae", ö: "oe", ü: "ue", ß: "ss", à: "a", á: "a", â: "a", è: "e", é: "e",
  ê: "e", ë: "e", í: "i", ì: "i", î: "i", ó: "o", ò: "o", ô: "o", ú: "u", ù: "u", û: "u", ç: "c", ñ: "n",
};

/** Ein einzelnes Pfad-Segment → Wiki-Slug. Bewusst konservativ: nur a-z, 0-9, `-`. */
export function slugifySegment(segment: string): string {
  const lower = segment.toLowerCase();
  let out = "";
  for (const ch of lower) out += TRANSLIT[ch] ?? ch;
  return out
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
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
  const rest = vaultPath.slice(prefix.length).replace(/\.md$/i, "");
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
  const name = (title.trim() === "" ? last : title).replace(/[\\/:*?"<>|]/g, "-");
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
```

- [ ] **Step 4: Test laufen lassen, grün bestätigen**

Run: `npx vitest run tests/paths.test.ts`
Expected: PASS (alle Fälle).

- [ ] **Step 5: Gate und Commit**

```bash
npm run gate
git add src/core/paths.ts tests/paths.test.ts
git commit -m "feat(core): Vault-Pfad auf Wiki-Pfad abbilden, Kollisionen erkennen"
```

---

### Task 3: Frontmatter → Seiten-Metadaten

**Files:**
- Create: `src/core/page-meta.ts`
- Test: `tests/page_meta.test.ts`
- Modify: `tools/sync-kit.sh` (Zeile mit der pure-Modulliste: `frontmatter` ergänzen)
- Modify: `src/vendor/kit/VENDOR.json` (entsteht durch den Skript-Lauf, nicht von Hand)

**Interfaces:**
- Consumes: `parseFrontmatter(text)` aus `src/vendor/kit/frontmatter` — liefert `{ data: Record<string, string | number | string[]>; order: string[]; body: string }`. **Achtung:** `parseFrontmatter` liefert Skalare immer als String, nie typinferiert.
- Produces:
  - `interface PageMeta { title: string; description: string; tags: string[]; body: string }`
  - `extractPageMeta(raw: string, fallbackTitle: string): PageMeta`

- [ ] **Step 1: Kit-Modul nachvendorn**

In `tools/sync-kit.sh` die pure-Schleife von `for m in settings i18n timeout; do` auf
`for m in settings i18n timeout frontmatter; do` ändern und im `VENDOR.json`-Heredoc
den `vendored`-Wert auf `"settings.ts, i18n.ts, timeout.ts, frontmatter.ts"` setzen.
Dann:

```bash
tools/sync-kit.sh
```

Expected: Zeile `vendored obsidian-kit@0.26.0/pure/frontmatter.ts` erscheint.

- [ ] **Step 2: Failing test schreiben**

```ts
import { describe, expect, it } from "vitest";
import { extractPageMeta } from "../src/core/page-meta";

describe("extractPageMeta", () => {
  it("nimmt den Frontmatter-Titel und entfernt den Frontmatter-Block aus dem Body", () => {
    const raw = ["---", "title: DNS Setup", "summary: Wie der Resolver haengt", "---", "", "# Text", ""].join("\n");
    const meta = extractPageMeta(raw, "Datei-Name");
    expect(meta.title).toBe("DNS Setup");
    expect(meta.description).toBe("Wie der Resolver haengt");
    expect(meta.body).toBe("# Text\n");
  });

  it("faellt ohne Frontmatter-title auf den uebergebenen Dateinamen zurueck", () => {
    const meta = extractPageMeta("# Nur Text\n", "DNS Setup");
    expect(meta.title).toBe("DNS Setup");
    expect(meta.description).toBe("");
    expect(meta.body).toBe("# Nur Text\n");
  });

  it("liest tags als Liste", () => {
    const raw = ["---", "tags:", "  - netzwerk", "  - dns", "---", "Text", ""].join("\n");
    expect(extractPageMeta(raw, "X").tags).toEqual(["netzwerk", "dns"]);
  });

  it("liest tags auch als kommagetrennten Skalar", () => {
    const raw = ["---", "tags: netzwerk, dns", "---", "Text", ""].join("\n");
    expect(extractPageMeta(raw, "X").tags).toEqual(["netzwerk", "dns"]);
  });

  it("liefert leere tags, wenn das Feld fehlt", () => {
    expect(extractPageMeta("Text\n", "X").tags).toEqual([]);
  });
});
```

- [ ] **Step 3: Test laufen lassen, Fehlschlag bestätigen**

Run: `npx vitest run tests/page_meta.test.ts`
Expected: FAIL — Modul `../src/core/page-meta` nicht auflösbar.

- [ ] **Step 4: Implementierung**

```ts
// Frontmatter → Wiki.js-Seitenmetadaten. Das Frontmatter selbst wird NIE gepusht
// (Spec § 3): es ist Vault-Verwaltung, in der Wiki-Seite waere es sichtbarer Muell.
// Ausgewertet werden nur title, summary und tags.
import { parseFrontmatter } from "../vendor/kit/frontmatter";

export interface PageMeta {
  title: string;
  description: string;
  tags: string[];
  body: string;
}

function asString(value: string | number | string[] | undefined): string {
  if (value === undefined) return "";
  return Array.isArray(value) ? value.join(", ") : String(value);
}

function asTags(value: string | number | string[] | undefined): string[] {
  if (value === undefined) return [];
  const list = Array.isArray(value) ? value : String(value).split(",");
  return list.map((tag) => tag.trim()).filter((tag) => tag !== "");
}

/** `fallbackTitle` ist der Dateiname ohne Endung — der Titel der Wiki-Seite, wenn
 *  kein Frontmatter-`title` gesetzt ist (Spec § 3). */
export function extractPageMeta(raw: string, fallbackTitle: string): PageMeta {
  const parsed = parseFrontmatter(raw);
  const title = asString(parsed.data.title).trim();
  return {
    title: title === "" ? fallbackTitle : title,
    description: asString(parsed.data.summary).trim(),
    tags: asTags(parsed.data.tags),
    body: parsed.body,
  };
}
```

- [ ] **Step 5: Test laufen lassen, grün bestätigen**

Run: `npx vitest run tests/page_meta.test.ts`
Expected: PASS.

Schlägt einer der Tests fehl, weil `parseFrontmatter` den Body anders abschneidet
(führende Leerzeile) oder Listen anders liefert: **den Test an das gemessene
Kit-Verhalten anpassen, nicht das vendorte Kit editieren.**

- [ ] **Step 6: Gate und Commit**

```bash
npm run gate
git add tools/sync-kit.sh src/vendor/kit src/core/page-meta.ts tests/page_meta.test.ts
git commit -m "feat(core): Frontmatter auf Wiki-Metadaten abbilden, Block nicht mitpushen"
```

---

### Task 4: Wikilinks und Embeds umschreiben

**Files:**
- Create: `src/core/links.ts`
- Test: `tests/links.test.ts`

**Interfaces:**
- Consumes: nichts.
- Produces:
  - `type LinkResolver = (target: string) => string | null` — Ziel (Notizname oder Vault-Pfad) → Wiki-Pfad, `null` wenn die Notiz nicht gesynct wird.
  - `interface LinkRewrite { text: string; unresolved: string[]; skippedEmbeds: string[] }`
  - `rewriteLinks(body: string, resolve: LinkResolver): LinkRewrite`

- [ ] **Step 1: Failing test schreiben**

```ts
import { describe, expect, it } from "vitest";
import { rewriteLinks } from "../src/core/links";

const resolve = (target: string): string | null =>
  target === "DNS Setup" ? "netzwerk/dns-setup" : null;

describe("rewriteLinks", () => {
  it("macht aus einem Wikilink auf eine gesyncte Notiz einen absoluten Wiki-Link", () => {
    expect(rewriteLinks("siehe [[DNS Setup]] dort", resolve).text).toBe("siehe [DNS Setup](/netzwerk/dns-setup) dort");
  });

  it("behaelt den Anzeigetext aus der Pipe-Form", () => {
    expect(rewriteLinks("siehe [[DNS Setup|die Aufloesung]]", resolve).text).toBe("siehe [die Aufloesung](/netzwerk/dns-setup)");
  });

  it("haengt einen Ueberschriften-Anker als Fragment an", () => {
    expect(rewriteLinks("[[DNS Setup#Resolver]]", resolve).text).toBe("[Resolver](/netzwerk/dns-setup#resolver)");
  });

  it("laesst von einer nicht gesyncten Notiz nur den Anzeigetext stehen und zaehlt sie", () => {
    const out = rewriteLinks("siehe [[Geheimes Konzept]] hier", resolve);
    expect(out.text).toBe("siehe Geheimes Konzept hier");
    expect(out.unresolved).toEqual(["Geheimes Konzept"]);
  });

  it("nutzt bei nicht gesyncten Zielen den Anzeigetext, nicht den Notiznamen", () => {
    expect(rewriteLinks("[[Geheimes Konzept|das Konzept]]", resolve).text).toBe("das Konzept");
  });

  it("ueberspringt Embeds und meldet sie, statt sie als Link zu behandeln", () => {
    const out = rewriteLinks("Text\n![[Diagramm.png]]\nmehr", resolve);
    expect(out.text).toBe("Text\n\nmehr");
    expect(out.skippedEmbeds).toEqual(["Diagramm.png"]);
  });

  it("laesst Standard-Markdown-Links unangetastet", () => {
    expect(rewriteLinks("[extern](https://example.org)", resolve).text).toBe("[extern](https://example.org)");
  });

  it("fasst Mehrfach-Vorkommen desselben unaufloesbaren Ziels zu einem Eintrag zusammen", () => {
    const out = rewriteLinks("[[X]] und [[X]]", resolve);
    expect(out.unresolved).toEqual(["X"]);
  });

  it("laesst Wikilinks in Codebloecken in Ruhe", () => {
    const src = ["```", "[[DNS Setup]]", "```", "", "[[DNS Setup]]"].join("\n");
    const out = rewriteLinks(src, resolve);
    expect(out.text).toBe(["```", "[[DNS Setup]]", "```", "", "[DNS Setup](/netzwerk/dns-setup)"].join("\n"));
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `npx vitest run tests/links.test.ts`
Expected: FAIL — Modul nicht auflösbar.

- [ ] **Step 3: Implementierung**

```ts
// [[Wikilink]]-Umschreibung. Der Wiki-Leser hat den Vault nicht — ein Link auf eine
// nicht veroeffentlichte Notiz muss deshalb verschwinden statt ins Leere zu zeigen;
// er wird auf seinen Anzeigetext reduziert und im Sync-Report gezaehlt (Spec § 3).

/** Ziel eines Wikilinks → Wiki-Pfad ohne fuehrenden Slash, oder `null` wenn die
 *  Notiz nicht gesynct wird. */
export type LinkResolver = (target: string) => string | null;

export interface LinkRewrite {
  text: string;
  unresolved: string[];
  skippedEmbeds: string[];
}

const FENCE_RE = /^(?:```|~~~)/;

/** `#Ueberschrift` → `#ueberschrift`: Wiki.js baut Anker aus der kleingeschriebenen
 *  Ueberschrift mit Bindestrichen. */
function anchor(heading: string): string {
  return heading.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function rewriteLine(line: string, resolve: LinkResolver, out: LinkRewrite): string {
  // Embeds zuerst: `![[…]]` ist kein Link, und ein spaeterer Wikilink-Pass wuerde
  // die inneren Klammern faelschlich als solchen lesen.
  let result = line.replace(/!\[\[([^\]]+)\]\]/g, (_m, inner: string) => {
    const target = inner.split("|")[0]!.trim();
    if (!out.skippedEmbeds.includes(target)) out.skippedEmbeds.push(target);
    return "";
  });

  result = result.replace(/\[\[([^\]]+)\]\]/g, (_m, inner: string) => {
    const [rawTarget = "", rawLabel] = inner.split("|");
    const [target = "", heading] = rawTarget.split("#");
    const cleanTarget = target.trim();
    const label = (rawLabel ?? heading ?? cleanTarget).trim();
    const wikiPath = cleanTarget === "" ? null : resolve(cleanTarget);
    if (wikiPath === null) {
      if (!out.unresolved.includes(cleanTarget)) out.unresolved.push(cleanTarget);
      return label;
    }
    const fragment = heading === undefined || heading.trim() === "" ? "" : `#${anchor(heading)}`;
    return `[${label}](/${wikiPath}${fragment})`;
  });

  return result;
}

/** Zeilenweise, weil Codebloecke ausgespart bleiben muessen: ein `[[…]]` in einem
 *  Beispiel-Block ist Inhalt, kein Link. */
export function rewriteLinks(body: string, resolve: LinkResolver): LinkRewrite {
  const out: LinkRewrite = { text: "", unresolved: [], skippedEmbeds: [] };
  let inFence = false;
  const lines = body.split("\n").map((line) => {
    if (FENCE_RE.test(line.trimStart())) {
      inFence = !inFence;
      return line;
    }
    return inFence ? line : rewriteLine(line, resolve, out);
  });
  out.text = lines.join("\n");
  return out;
}
```

- [ ] **Step 4: Test laufen lassen, grün bestätigen**

Run: `npx vitest run tests/links.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate und Commit**

```bash
npm run gate
git add src/core/links.ts tests/links.test.ts
git commit -m "feat(core): Wikilinks auf Wiki-Pfade umschreiben, tote Ziele entschaerfen"
```

---

### Task 5: Markdown-Transformation (Callouts) und Komposition

**Files:**
- Create: `src/core/transform.ts`
- Test: `tests/transform.test.ts`

**Interfaces:**
- Consumes: `rewriteLinks`, `LinkResolver`, `LinkRewrite` aus `./links`; `extractPageMeta`, `PageMeta` aus `./page-meta`.
- Produces:
  - `interface TransformResult { content: string; title: string; description: string; tags: string[]; unresolved: string[]; skippedEmbeds: string[] }`
  - `transformForWiki(raw: string, fallbackTitle: string, resolve: LinkResolver): TransformResult`

- [ ] **Step 1: Failing test schreiben**

```ts
import { describe, expect, it } from "vitest";
import { transformForWiki } from "../src/core/transform";

const resolve = (target: string): string | null => (target === "A" ? "a" : null);

describe("transformForWiki", () => {
  it("macht aus einem Info-Callout ein Blockquote mit Wiki.js-Klasse", () => {
    const raw = ["> [!info] Hinweis", "> erste Zeile", "> zweite Zeile", ""].join("\n");
    expect(transformForWiki(raw, "T", resolve).content).toBe(
      ["> **Hinweis**", "> erste Zeile", "> zweite Zeile", "{.is-info}", ""].join("\n"),
    );
  });

  it("laesst die Titelzeile weg, wenn der Callout keinen Titel hat", () => {
    const raw = ["> [!warning]", "> Achtung", ""].join("\n");
    expect(transformForWiki(raw, "T", resolve).content).toBe(["> Achtung", "{.is-warning}", ""].join("\n"));
  });

  it("bildet danger und error auf is-danger ab, tip und success auf is-success", () => {
    expect(transformForWiki("> [!danger]\n> x\n", "T", resolve).content).toContain("{.is-danger}");
    expect(transformForWiki("> [!error]\n> x\n", "T", resolve).content).toContain("{.is-danger}");
    expect(transformForWiki("> [!tip]\n> x\n", "T", resolve).content).toContain("{.is-success}");
    expect(transformForWiki("> [!success]\n> x\n", "T", resolve).content).toContain("{.is-success}");
  });

  it("faellt fuer unbekannte Callout-Typen auf is-info zurueck statt den Block zu verlieren", () => {
    expect(transformForWiki("> [!quote]\n> x\n", "T", resolve).content).toContain("{.is-info}");
  });

  it("ignoriert das Klapp-Suffix des Callout-Kopfes", () => {
    expect(transformForWiki("> [!info]- Titel\n> x\n", "T", resolve).content).toContain("> **Titel**");
  });

  it("laesst ein gewoehnliches Blockquote unangetastet", () => {
    const raw = ["> nur ein Zitat", ""].join("\n");
    expect(transformForWiki(raw, "T", resolve).content).toBe(raw);
  });

  it("laesst Codebloecke, Tabellen und LaTeX unveraendert", () => {
    const raw = ["```ts", "const x = 1;", "```", "", "| a | b |", "| - | - |", "", "$$x^2$$", ""].join("\n");
    expect(transformForWiki(raw, "T", resolve).content).toBe(raw);
  });

  it("liefert Metadaten aus dem Frontmatter und pusht den Block selbst nicht mit", () => {
    const raw = ["---", "title: Echt", "tags: x", "---", "Body", ""].join("\n");
    const out = transformForWiki(raw, "Datei", resolve);
    expect(out.title).toBe("Echt");
    expect(out.tags).toEqual(["x"]);
    expect(out.content).toBe("Body\n");
  });

  it("reicht die Link-Befunde durch", () => {
    const out = transformForWiki("[[A]] und [[B]]\n", "T", resolve);
    expect(out.content).toBe("[A](/a) und B\n");
    expect(out.unresolved).toEqual(["B"]);
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `npx vitest run tests/transform.test.ts`
Expected: FAIL — Modul nicht auflösbar.

- [ ] **Step 3: Implementierung**

```ts
// Obsidian-Markdown → Wiki.js-Markdown. Einweg: aus dem Ergebnis laesst sich das
// Original nicht zurueckrechnen — genau deshalb haelt der Snapshot beide Fassungen
// (Roh und gepusht) getrennt (Spec § 3).
import { extractPageMeta } from "./page-meta";
import { rewriteLinks, type LinkResolver } from "./links";

export interface TransformResult {
  content: string;
  title: string;
  description: string;
  tags: string[];
  unresolved: string[];
  skippedEmbeds: string[];
}

// Wiki.js 2 kennt vier Blockquote-Klassen; Obsidian kennt Dutzende Callout-Typen.
// Unbekanntes faellt auf is-info — ein Block mit falscher Farbe ist harmlos, ein
// verschluckter Block nicht.
const CALLOUT_CLASS: Record<string, string> = {
  info: "is-info", note: "is-info", abstract: "is-info", question: "is-info",
  tip: "is-success", success: "is-success", check: "is-success", done: "is-success",
  warning: "is-warning", caution: "is-warning", attention: "is-warning",
  danger: "is-danger", error: "is-danger", bug: "is-danger", failure: "is-danger",
};

const CALLOUT_HEAD_RE = /^>\s*\[!([a-zA-Z]+)\][+-]?\s*(.*)$/;

/** Wandelt jeden Callout-Block in ein Blockquote plus Klassen-Zeile. Ein Block endet
 *  an der ersten Zeile, die nicht mit `>` beginnt. */
function transformCallouts(body: string): string {
  const lines = body.split("\n");
  const out: string[] = [];
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^(?:```|~~~)/.test(line.trimStart())) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    const head = inFence ? null : CALLOUT_HEAD_RE.exec(line);
    if (head === null) {
      out.push(line);
      continue;
    }
    const kind = (head[1] ?? "info").toLowerCase();
    const title = (head[2] ?? "").trim();
    if (title !== "") out.push(`> **${title}**`);
    let j = i + 1;
    while (j < lines.length && lines[j]!.startsWith(">")) {
      out.push(lines[j]!);
      j++;
    }
    out.push(`{.${CALLOUT_CLASS[kind] ?? "is-info"}}`);
    i = j - 1;
  }
  return out.join("\n");
}

/** Der eine Eingang der Push-Richtung: Rohtext der Notiz → alles, was die
 *  create/update-Mutation braucht, plus die Befunde fuer den Sync-Report. */
export function transformForWiki(raw: string, fallbackTitle: string, resolve: LinkResolver): TransformResult {
  const meta = extractPageMeta(raw, fallbackTitle);
  const links = rewriteLinks(meta.body, resolve);
  return {
    content: transformCallouts(links.text),
    title: meta.title,
    description: meta.description,
    tags: meta.tags,
    unresolved: links.unresolved,
    skippedEmbeds: links.skippedEmbeds,
  };
}
```

- [ ] **Step 4: Test laufen lassen, grün bestätigen**

Run: `npx vitest run tests/transform.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate und Commit**

```bash
npm run gate
git add src/core/transform.ts tests/transform.test.ts
git commit -m "feat(core): Obsidian-Callouts in Wiki.js-Blockquotes uebersetzen"
```

---

### Task 6: Zeilen-Diff übernehmen

**Files:**
- Create: `src/core/diff.ts` (Übernahme, nicht Neuentwicklung)
- Test: `tests/diff.test.ts`

**Interfaces:**
- Consumes: nichts.
- Produces: `type DiffLine = { kind: "ctx" | "add" | "del"; text: string }`, `diffLines(oldText, newText): DiffLine[]`, `type Hunk = { lines: DiffLine[]; startIndex: number }`, `groupHunks(diff): Hunk[]`, `applySelection(diff, selected: boolean[]): string`.

- [ ] **Step 1: Datei übernehmen und stempeln**

Kit-first-Regel Punkt 1: die Lösung existiert bereits (`koda-agent/src/core/diff.ts`,
selbst übernommen aus `image-to-markdown`). Kopieren, **nicht** nachbauen:

```bash
cp ../koda-agent/src/core/diff.ts src/core/diff.ts
```

Danach die erste Zeile — den alten Herkunftsstempel — durch den eigenen ersetzen,
sodass die Datei mit genau diesen zwei Zeilen beginnt:

```ts
// uebernommen aus koda-agent/src/core/diff.ts, 2026-08-09
// Reiner Zeilen-Diff (LCS) — obsidian-frei, in Node testbar (PROF-OBS-03/04).
```

Der Stempel ist keine Buchhaltung: `tools/kit-dupscan.py` meldet byte-identische
Dateien, bei denen keine Seite ihre Herkunft deklariert, und die Extraktions-Schwelle
ins Kit ist eine Zählung — eine Kopier-Kette ohne Stempel sähe darin aus wie mehrere
unabhängige Belege.

- [ ] **Step 2: Test schreiben, der die Übernahme absichert**

```ts
import { describe, expect, it } from "vitest";
import { applySelection, diffLines, groupHunks } from "../src/core/diff";

describe("diffLines", () => {
  it("markiert unveraenderte Zeilen als ctx", () => {
    expect(diffLines("a\nb", "a\nb")).toEqual([
      { kind: "ctx", text: "a" },
      { kind: "ctx", text: "b" },
    ]);
  });

  it("gibt bei einer Ersetzung erst die alte, dann die neue Zeile aus", () => {
    expect(diffLines("a\nx\nb", "a\ny\nb")).toEqual([
      { kind: "ctx", text: "a" },
      { kind: "del", text: "x" },
      { kind: "add", text: "y" },
      { kind: "ctx", text: "b" },
    ]);
  });

  it("behandelt leeren Text als null Zeilen, nicht als eine leere", () => {
    expect(diffLines("", "a")).toEqual([{ kind: "add", text: "a" }]);
  });
});

describe("groupHunks / applySelection", () => {
  it("gruppiert zusammenhaengende Aenderungen zu einem Hunk", () => {
    expect(groupHunks(diffLines("a\nx\ny\nb", "a\nb"))).toHaveLength(1);
  });

  it("uebernimmt bei selektiertem Hunk die neue Fassung", () => {
    const diff = diffLines("a\nx\nb", "a\ny\nb");
    expect(applySelection(diff, [true])).toBe("a\ny\nb");
  });

  it("behaelt bei abgewaehltem Hunk die alte Fassung", () => {
    const diff = diffLines("a\nx\nb", "a\ny\nb");
    expect(applySelection(diff, [false])).toBe("a\nx\nb");
  });
});
```

- [ ] **Step 3: Test laufen lassen, grün bestätigen**

Run: `npx vitest run tests/diff.test.ts`
Expected: PASS ohne jede Änderung an `diff.ts` — die Datei ist erprobt. Schlägt
etwas fehl, ist der Test falsch abgeschrieben, nicht die Übernahme kaputt.

- [ ] **Step 4: Gate und Commit**

```bash
npm run gate
git add src/core/diff.ts tests/diff.test.ts
git commit -m "chore(core): Zeilen-Diff aus koda-agent uebernommen statt nachgebaut"
```

---

### Task 7: Sync-Zustandsmaschine

Das Kernstück. Jede Zeile der Tabelle aus Spec § 3 ist ein Testfall.

**Files:**
- Create: `src/core/snapshot.ts`
- Create: `src/core/sync-plan.ts`
- Test: `tests/sync_plan.test.ts`

**Interfaces:**
- Consumes: nichts (bewusst — die Maschine sieht nur Daten, kein I/O).
- Produces:
  - aus `snapshot.ts`: `interface Snapshot { version: 1; wikiPath: string; pageId: number; raw: string; pushed: string; remoteUpdatedAt: string }`, `parseSnapshot(text: string): Snapshot | null`, `serializeSnapshot(s: Snapshot): string`
  - aus `sync-plan.ts`: `interface LocalPage { vaultPath: string; wikiPath: string; raw: string; transformed: string }`, `interface RemotePage { id: number; path: string; title: string; updatedAt: string }`, `type SyncState`, `interface SyncEntry`, `planSync(input: PlanInput): SyncEntry[]`

- [ ] **Step 1: Snapshot-Typ schreiben (kein eigener Testlauf — die Tests unten decken ihn mit ab)**

```ts
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
```

- [ ] **Step 2: Failing test für die Zustandsmaschine schreiben**

```ts
import { describe, expect, it } from "vitest";
import { planSync, type LocalPage, type RemotePage } from "../src/core/sync-plan";
import type { Snapshot } from "../src/core/snapshot";

const local = (wikiPath: string, raw: string): LocalPage => ({
  vaultPath: `_published/${wikiPath}.md`,
  wikiPath,
  raw,
  transformed: `T:${raw}`,
});

const remote = (path: string, updatedAt: string, id = 1): RemotePage => ({
  id,
  path,
  title: path,
  updatedAt,
});

const snap = (wikiPath: string, raw: string, updatedAt: string, id = 1): Snapshot => ({
  version: 1,
  wikiPath,
  pageId: id,
  raw,
  pushed: `T:${raw}`,
  remoteUpdatedAt: updatedAt,
});

const stateOf = (entries: ReturnType<typeof planSync>, wikiPath: string): string =>
  entries.find((e) => e.wikiPath === wikiPath)?.state ?? "FEHLT";

describe("planSync — die Tabelle aus Spec § 3", () => {
  it("lokal neu, remote nicht vorhanden → create", () => {
    const entries = planSync({ locals: [local("a", "x")], snapshots: [], remotes: [] });
    expect(stateOf(entries, "a")).toBe("create");
  });

  it("lokal neu, remote existiert schon → occupied (nie ueberschreiben)", () => {
    const entries = planSync({ locals: [local("a", "x")], snapshots: [], remotes: [remote("a", "T1")] });
    expect(stateOf(entries, "a")).toBe("occupied");
  });

  it("lokal geaendert, remote unveraendert → update", () => {
    const entries = planSync({
      locals: [local("a", "neu")],
      snapshots: [snap("a", "alt", "T1")],
      remotes: [remote("a", "T1")],
    });
    expect(stateOf(entries, "a")).toBe("update");
  });

  it("lokal unveraendert, remote geaendert → remote-changed (Pull anbieten)", () => {
    const entries = planSync({
      locals: [local("a", "alt")],
      snapshots: [snap("a", "alt", "T1")],
      remotes: [remote("a", "T2")],
    });
    expect(stateOf(entries, "a")).toBe("remote-changed");
  });

  it("beide geaendert → conflict", () => {
    const entries = planSync({
      locals: [local("a", "neu")],
      snapshots: [snap("a", "alt", "T1")],
      remotes: [remote("a", "T2")],
    });
    expect(stateOf(entries, "a")).toBe("conflict");
  });

  it("beide unveraendert → unchanged", () => {
    const entries = planSync({
      locals: [local("a", "alt")],
      snapshots: [snap("a", "alt", "T1")],
      remotes: [remote("a", "T1")],
    });
    expect(stateOf(entries, "a")).toBe("unchanged");
  });

  it("lokal aus dem Sync-Ordner entfernt, remote existiert → removed-locally", () => {
    const entries = planSync({
      locals: [],
      snapshots: [snap("a", "alt", "T1")],
      remotes: [remote("a", "T1")],
    });
    expect(stateOf(entries, "a")).toBe("removed-locally");
  });

  it("lokal vorhanden, remote geloescht → remote-deleted", () => {
    const entries = planSync({
      locals: [local("a", "alt")],
      snapshots: [snap("a", "alt", "T1")],
      remotes: [],
    });
    expect(stateOf(entries, "a")).toBe("remote-deleted");
  });

  it("kein Snapshot, remote neu angelegt → new-remote", () => {
    const entries = planSync({ locals: [], snapshots: [], remotes: [remote("a", "T1")] });
    expect(stateOf(entries, "a")).toBe("new-remote");
  });

  it("weder lokal noch remote, nur ein Snapshot → stale-snapshot (aufraeumbar)", () => {
    const entries = planSync({ locals: [], snapshots: [snap("a", "alt", "T1")], remotes: [] });
    expect(stateOf(entries, "a")).toBe("stale-snapshot");
  });
});

describe("planSync — Ergebnisform", () => {
  it("traegt die pageId aus dem Snapshot, sonst aus der Remote-Liste", () => {
    const entries = planSync({
      locals: [local("a", "neu")],
      snapshots: [snap("a", "alt", "T1", 7)],
      remotes: [remote("a", "T1", 7)],
    });
    expect(entries[0]?.pageId).toBe(7);
  });

  it("laesst pageId undefiniert, wenn die Seite drueben noch nicht existiert", () => {
    const entries = planSync({ locals: [local("a", "x")], snapshots: [], remotes: [] });
    expect(entries[0]?.pageId).toBeUndefined();
  });

  it("sortiert stabil nach Wiki-Pfad, damit die Status-Ansicht nicht springt", () => {
    const entries = planSync({
      locals: [local("b", "x"), local("a", "x")],
      snapshots: [],
      remotes: [],
    });
    expect(entries.map((e) => e.wikiPath)).toEqual(["a", "b"]);
  });

  it("erfasst jeden Pfad genau einmal, egal aus welcher der drei Quellen er stammt", () => {
    const entries = planSync({
      locals: [local("a", "x")],
      snapshots: [snap("a", "x", "T1")],
      remotes: [remote("a", "T1")],
    });
    expect(entries).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Test laufen lassen, Fehlschlag bestätigen**

Run: `npx vitest run tests/sync_plan.test.ts`
Expected: FAIL — Modul `../src/core/sync-plan` nicht auflösbar.

- [ ] **Step 4: Implementierung**

```ts
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

function decide(local: LocalPage | undefined, snapshot: Snapshot | undefined, remote: RemotePage | undefined): SyncState {
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
```

- [ ] **Step 5: Test laufen lassen, grün bestätigen**

Run: `npx vitest run tests/sync_plan.test.ts`
Expected: PASS — alle 14 Fälle.

- [ ] **Step 6: Gate und Commit**

```bash
npm run gate
git add src/core/snapshot.ts src/core/sync-plan.ts tests/sync_plan.test.ts
git commit -m "feat(core): Sync-Zustandsmaschine samt Snapshot-Format"
```

---

### Task 8: GraphQL-Client

**Files:**
- Create: `src/wikijs/queries.ts`
- Create: `src/wikijs/client.ts`
- Test: `tests/wikijs_client.test.ts`

**Vorbedingung:** `docs/LAB.md` aus Task 1 liegt vor. **Weicht das gemessene Schema
von den Dokumenten unten ab, gilt `docs/LAB.md`** — dann die Query-Strings anpassen
und die Abweichung im Commit-Body vermerken.

**Interfaces:**
- Consumes: `withTimeout` aus `../vendor/kit/timeout`, `requestUrl` aus `obsidian`.
- Produces:
  - `interface WikiClientOptions { baseUrl: string; token: string; locale: string; timeoutMs: number }`
  - `class WikiClient` mit `listPages(): Promise<RemotePage[]>`, `fetchPage(id: number): Promise<FetchedPage>`, `fetchUpdatedAt(id: number): Promise<string>`, `createPage(input: PageInput): Promise<{ id: number; updatedAt: string }>`, `updatePage(id: number, input: PageInput): Promise<{ updatedAt: string }>`, `unpublishPage(id: number): Promise<void>`, `deletePage(id: number): Promise<void>`
  - `interface PageInput { path: string; title: string; description: string; tags: string[]; content: string }`
  - `interface FetchedPage { id: number; path: string; title: string; description: string; content: string; updatedAt: string }`
  - `class WikiError extends Error` mit `readonly kind: "network" | "timeout" | "auth" | "graphql"`

- [ ] **Step 1: Failing test schreiben**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestUrl } from "obsidian";
import { WikiClient, WikiError } from "../src/wikijs/client";

const OPTS = { baseUrl: "https://wiki.example.org/", token: "K", locale: "de", timeoutMs: 5000 };

function reply(body: unknown, status = 200): void {
  (requestUrl as unknown as { mockImplementation: (fn: () => unknown) => void }).mockImplementation(() =>
    Promise.resolve({ status, json: body, text: JSON.stringify(body) }),
  );
}

describe("WikiClient", () => {
  beforeEach(() => {
    (requestUrl as unknown as { mockClear: () => void }).mockClear();
  });

  it("spricht /graphql und schickt den Bearer-Token", async () => {
    reply({ data: { pages: { list: [] } } });
    await new WikiClient(OPTS).listPages();
    const call = (requestUrl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0] as {
      url: string;
      method: string;
      headers: Record<string, string>;
    };
    expect(call.url).toBe("https://wiki.example.org/graphql");
    expect(call.method).toBe("POST");
    expect(call.headers.Authorization).toBe("Bearer K");
  });

  it("liefert die Seitenliste als RemotePage[]", async () => {
    reply({ data: { pages: { list: [{ id: 3, path: "a/b", title: "T", updatedAt: "2026-01-01T00:00:00Z" }] } } });
    const pages = await new WikiClient(OPTS).listPages();
    expect(pages).toEqual([{ id: 3, path: "a/b", title: "T", updatedAt: "2026-01-01T00:00:00Z" }]);
  });

  it("wirft WikiError kind=auth bei 401", async () => {
    reply({}, 401);
    await expect(new WikiClient(OPTS).listPages()).rejects.toMatchObject({ kind: "auth" });
  });

  it("wirft WikiError kind=graphql und traegt die Server-Meldung", async () => {
    reply({ errors: [{ message: "Unknown field" }] });
    await expect(new WikiClient(OPTS).listPages()).rejects.toMatchObject({ kind: "graphql", message: expect.stringContaining("Unknown field") });
  });

  it("meldet ein fehlgeschlagenes responseResult als Fehler statt es zu verschlucken", async () => {
    reply({ data: { pages: { create: { responseResult: { succeeded: false, message: "Path exists" }, page: null } } } });
    await expect(
      new WikiClient(OPTS).createPage({ path: "a", title: "T", description: "", tags: [], content: "x" }),
    ).rejects.toMatchObject({ kind: "graphql", message: expect.stringContaining("Path exists") });
  });

  it("gibt bei Erfolg id und updatedAt der neuen Seite zurueck", async () => {
    reply({
      data: { pages: { create: { responseResult: { succeeded: true }, page: { id: 9, updatedAt: "2026-02-02T00:00:00Z" } } } },
    });
    const created = await new WikiClient(OPTS).createPage({ path: "a", title: "T", description: "", tags: [], content: "x" });
    expect(created).toEqual({ id: 9, updatedAt: "2026-02-02T00:00:00Z" });
  });

  it("liest fuer den Drift-Guard nur updatedAt", async () => {
    reply({ data: { pages: { single: { updatedAt: "2026-03-03T00:00:00Z" } } } });
    expect(await new WikiClient(OPTS).fetchUpdatedAt(9)).toBe("2026-03-03T00:00:00Z");
  });

  it("wirft kind=timeout, wenn die Antwort laenger braucht als erlaubt", async () => {
    (requestUrl as unknown as { mockImplementation: (fn: () => unknown) => void }).mockImplementation(
      () => new Promise(() => undefined),
    );
    const client = new WikiClient({ ...OPTS, timeoutMs: 10 });
    await expect(client.listPages()).rejects.toMatchObject({ kind: "timeout" });
  });

  it("wirft kind=network, wenn requestUrl selbst fehlschlaegt", async () => {
    (requestUrl as unknown as { mockImplementation: (fn: () => unknown) => void }).mockImplementation(() =>
      Promise.reject(new Error("ECONNREFUSED")),
    );
    await expect(new WikiClient(OPTS).listPages()).rejects.toMatchObject({ kind: "network" });
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `npx vitest run tests/wikijs_client.test.ts`
Expected: FAIL — Modul `../src/wikijs/client` nicht auflösbar.

- [ ] **Step 3: `queries.ts` schreiben**

```ts
// GraphQL-Dokumente fuer Wiki.js 2.x. Gegen die laufende Instanz gemessen —
// Befund in docs/LAB.md; die Doku-Fassung ist NICHT die Quelle der Wahrheit.
export const LIST_PAGES = `query { pages { list(orderBy: PATH) { id path title updatedAt } } }`;

export const SINGLE_PAGE = `query($id: Int!) {
  pages { single(id: $id) { id path title description content updatedAt } }
}`;

/** Drift-Guard: bewusst nur ein Feld — der Query laeuft vor JEDEM Push. */
export const PAGE_UPDATED_AT = `query($id: Int!) { pages { single(id: $id) { updatedAt } } }`;

export const CREATE_PAGE = `mutation($content: String!, $description: String!, $path: String!, $tags: [String]!, $title: String!, $locale: String!) {
  pages {
    create(content: $content, description: $description, editor: "markdown", isPublished: true,
           isPrivate: false, locale: $locale, path: $path, tags: $tags, title: $title) {
      responseResult { succeeded errorCode slug message }
      page { id updatedAt }
    }
  }
}`;

export const UPDATE_PAGE = `mutation($id: Int!, $content: String!, $description: String!, $tags: [String]!, $title: String!) {
  pages {
    update(id: $id, content: $content, description: $description, tags: $tags, title: $title, isPublished: true) {
      responseResult { succeeded errorCode slug message }
      page { id updatedAt }
    }
  }
}`;

/** Depublizieren statt loeschen: die Seite bleibt samt Historie erhalten, ist aber
 *  nicht mehr oeffentlich (Default-Antwort auf "lokal aus dem Sync-Ordner entfernt"). */
export const UNPUBLISH_PAGE = `mutation($id: Int!) {
  pages { update(id: $id, isPublished: false) { responseResult { succeeded errorCode slug message } } }
}`;

export const DELETE_PAGE = `mutation($id: Int!) {
  pages { delete(id: $id) { responseResult { succeeded errorCode slug message } } }
}`;
```

- [ ] **Step 4: `client.ts` schreiben**

```ts
// GraphQL-Transport ueber requestUrl (Spec: alles im Plugin, keine externen Helfer).
// requestUrl kennt weder Timeout noch Abort — deshalb laeuft JEDER Aufruf durch
// withTimeout aus dem Kit, mit window als Timer-Port.
import { requestUrl } from "obsidian";
import { withTimeout } from "../vendor/kit/timeout";
import type { RemotePage } from "../core/sync-plan";
import {
  CREATE_PAGE, DELETE_PAGE, LIST_PAGES, PAGE_UPDATED_AT, SINGLE_PAGE, UNPUBLISH_PAGE, UPDATE_PAGE,
} from "./queries";

export interface WikiClientOptions {
  baseUrl: string;
  token: string;
  locale: string;
  timeoutMs: number;
}

export interface PageInput {
  path: string;
  title: string;
  description: string;
  tags: string[];
  content: string;
}

export interface FetchedPage {
  id: number;
  path: string;
  title: string;
  description: string;
  content: string;
  updatedAt: string;
}

/** Fehler mit Ursache statt nur Text: die UI unterscheidet "Server sagt nein"
 *  (Meldung zeigen) von "Server schweigt" (Wiederholen anbieten). */
export class WikiError extends Error {
  constructor(
    readonly kind: "network" | "timeout" | "auth" | "graphql",
    message: string,
  ) {
    super(message);
    this.name = "WikiError";
  }
}

interface ResponseResult {
  succeeded: boolean;
  errorCode?: number;
  slug?: string;
  message?: string;
}

export class WikiClient {
  constructor(private readonly opts: WikiClientOptions) {}

  private get endpoint(): string {
    return `${this.opts.baseUrl.replace(/\/+$/, "")}/graphql`;
  }

  private async gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const work = requestUrl({
      url: this.endpoint,
      method: "POST",
      contentType: "application/json",
      headers: { Authorization: `Bearer ${this.opts.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      throw: false,
    });

    let raced;
    try {
      raced = await withTimeout(work, this.opts.timeoutMs, window);
    } catch (err) {
      throw new WikiError("network", err instanceof Error ? err.message : String(err));
    }
    if (raced.timedOut) throw new WikiError("timeout", `Keine Antwort binnen ${this.opts.timeoutMs} ms`);

    const res = raced.value;
    if (res.status === 401 || res.status === 403) throw new WikiError("auth", `HTTP ${res.status}`);
    if (res.status >= 400) throw new WikiError("network", `HTTP ${res.status}`);

    const payload = res.json as { data?: T; errors?: { message: string }[] };
    if (payload.errors && payload.errors.length > 0) {
      throw new WikiError("graphql", payload.errors.map((e) => e.message).join("; "));
    }
    if (payload.data === undefined) throw new WikiError("graphql", "Antwort ohne data");
    return payload.data;
  }

  /** Wiki.js meldet fachliche Fehler mit HTTP 200 im responseResult — unbehandelt
   *  sieht ein fehlgeschlagener Push wie ein gelungener aus. */
  private assertSucceeded(result: ResponseResult | undefined, what: string): void {
    if (result?.succeeded === true) return;
    throw new WikiError("graphql", `${what} fehlgeschlagen: ${result?.message ?? "unbekannter Grund"}`);
  }

  async listPages(): Promise<RemotePage[]> {
    const data = await this.gql<{ pages: { list: RemotePage[] } }>(LIST_PAGES);
    return data.pages.list;
  }

  async fetchPage(id: number): Promise<FetchedPage> {
    const data = await this.gql<{ pages: { single: FetchedPage } }>(SINGLE_PAGE, { id });
    return data.pages.single;
  }

  async fetchUpdatedAt(id: number): Promise<string> {
    const data = await this.gql<{ pages: { single: { updatedAt: string } } }>(PAGE_UPDATED_AT, { id });
    return data.pages.single.updatedAt;
  }

  async createPage(input: PageInput): Promise<{ id: number; updatedAt: string }> {
    const data = await this.gql<{
      pages: { create: { responseResult: ResponseResult; page: { id: number; updatedAt: string } | null } };
    }>(CREATE_PAGE, { ...input, locale: this.opts.locale });
    this.assertSucceeded(data.pages.create.responseResult, "Anlegen");
    const page = data.pages.create.page;
    if (page === null) throw new WikiError("graphql", "Anlegen meldete Erfolg ohne Seite");
    return { id: page.id, updatedAt: page.updatedAt };
  }

  async updatePage(id: number, input: PageInput): Promise<{ updatedAt: string }> {
    const data = await this.gql<{
      pages: { update: { responseResult: ResponseResult; page: { updatedAt: string } | null } };
    }>(UPDATE_PAGE, { id, ...input });
    this.assertSucceeded(data.pages.update.responseResult, "Aktualisieren");
    const page = data.pages.update.page;
    if (page === null) throw new WikiError("graphql", "Aktualisieren meldete Erfolg ohne Seite");
    return { updatedAt: page.updatedAt };
  }

  async unpublishPage(id: number): Promise<void> {
    const data = await this.gql<{ pages: { update: { responseResult: ResponseResult } } }>(UNPUBLISH_PAGE, { id });
    this.assertSucceeded(data.pages.update.responseResult, "Depublizieren");
  }

  async deletePage(id: number): Promise<void> {
    const data = await this.gql<{ pages: { delete: { responseResult: ResponseResult } } }>(DELETE_PAGE, { id });
    this.assertSucceeded(data.pages.delete.responseResult, "Loeschen");
  }
}
```

- [ ] **Step 5: Test laufen lassen, grün bestätigen**

Run: `npx vitest run tests/wikijs_client.test.ts`
Expected: PASS.

Der `window`-Timer-Port existiert im Test nicht automatisch. Falls der
Timeout-Fall scheitert, in der Testdatei vor den Fällen ergänzen:

```ts
vi.stubGlobal("window", { setTimeout, clearTimeout });
```

- [ ] **Step 6: Gate und Commit**

```bash
npm run gate
git add src/wikijs tests/wikijs_client.test.ts
git commit -m "feat(wikijs): GraphQL-Client mit Timeout und normalisierten Fehlern"
```

---

### Task 9: Snapshot-Speicher (Obsidian-Schicht)

**Files:**
- Create: `src/obsidian/snapshot-store.ts`
- Test: `tests/snapshot_store.test.ts`

**Interfaces:**
- Consumes: `Snapshot`, `parseSnapshot`, `serializeSnapshot` aus `../core/snapshot`; `snapshotFileName` aus `../core/paths`.
- Produces: `class SnapshotStore` mit `constructor(adapter: DataAdapter, pluginDir: string)`, `loadAll(): Promise<Snapshot[]>`, `save(s: Snapshot): Promise<void>`, `remove(wikiPath: string): Promise<void>`. `DataAdapter` ist der Obsidian-Typ (`this.app.vault.adapter`).

- [ ] **Step 1: Failing test schreiben**

Der Adapter wird als schlankes Fake gestellt — der Store soll nur die vier Methoden
brauchen, die hier auftauchen:

```ts
import { describe, expect, it } from "vitest";
import { SnapshotStore } from "../src/obsidian/snapshot-store";
import type { Snapshot } from "../src/core/snapshot";

function fakeAdapter(files: Record<string, string> = {}) {
  return {
    files,
    exists: (p: string) => Promise.resolve(p === "DIR/snapshots" || p in files),
    list: (_p: string) => Promise.resolve({ files: Object.keys(files), folders: [] }),
    read: (p: string) => Promise.resolve(files[p] ?? ""),
    write: (p: string, data: string) => {
      files[p] = data;
      return Promise.resolve();
    },
    remove: (p: string) => {
      delete files[p];
      return Promise.resolve();
    },
    mkdir: (_p: string) => Promise.resolve(),
  };
}

const snap: Snapshot = {
  version: 1, wikiPath: "netzwerk/dns-setup", pageId: 4,
  raw: "roh", pushed: "gepusht", remoteUpdatedAt: "2026-01-01T00:00:00Z",
};

describe("SnapshotStore", () => {
  it("schreibt den Snapshot unter seinen Hash-Dateinamen", async () => {
    const adapter = fakeAdapter();
    const store = new SnapshotStore(adapter as never, "DIR");
    await store.save(snap);
    const written = Object.keys(adapter.files);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatch(/^DIR\/snapshots\/[0-9a-f]{8}\.json$/);
  });

  it("liest zurueck, was es geschrieben hat", async () => {
    const adapter = fakeAdapter();
    const store = new SnapshotStore(adapter as never, "DIR");
    await store.save(snap);
    expect(await store.loadAll()).toEqual([snap]);
  });

  it("ueberspringt eine kaputte Datei, statt den ganzen Bestand zu verlieren", async () => {
    const adapter = fakeAdapter({ "DIR/snapshots/aaaaaaaa.json": "{kaputt", "DIR/snapshots/bbbbbbbb.json": JSON.stringify(snap) });
    const store = new SnapshotStore(adapter as never, "DIR");
    expect(await store.loadAll()).toEqual([snap]);
  });

  it("ignoriert Dateien, die keine .json sind", async () => {
    const adapter = fakeAdapter({ "DIR/snapshots/notizen.md": "x" });
    expect(await new SnapshotStore(adapter as never, "DIR").loadAll()).toEqual([]);
  });

  it("loescht den Snapshot zu einem Wiki-Pfad", async () => {
    const adapter = fakeAdapter();
    const store = new SnapshotStore(adapter as never, "DIR");
    await store.save(snap);
    await store.remove(snap.wikiPath);
    expect(Object.keys(adapter.files)).toEqual([]);
  });

  it("liefert eine leere Liste, wenn das Verzeichnis noch nicht existiert", async () => {
    const adapter = { ...fakeAdapter(), exists: () => Promise.resolve(false) };
    expect(await new SnapshotStore(adapter as never, "DIR").loadAll()).toEqual([]);
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `npx vitest run tests/snapshot_store.test.ts`
Expected: FAIL — Modul nicht auflösbar.

- [ ] **Step 3: Implementierung**

```ts
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
```

- [ ] **Step 4: Test laufen lassen, grün bestätigen**

Run: `npx vitest run tests/snapshot_store.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate und Commit**

```bash
npm run gate
git add src/obsidian/snapshot-store.ts tests/snapshot_store.test.ts
git commit -m "feat(obsidian): Snapshots als Einzeldateien im Plugin-Ordner"
```

---

### Task 10: Settings und i18n

**Files:**
- Create: `src/core/settings-types.ts`
- Create: `src/i18n/strings.ts`
- Create: `src/obsidian/settings.ts`
- Modify: `src/main.ts`
- Test: `tests/settings.test.ts`

**Interfaces:**
- Consumes: `mergeSettings` aus `../vendor/kit/settings`; `defineStrings`, `pickLang`, `setLang`, `t` aus `../vendor/kit/i18n`; `renderSettingDefinitions`, `refreshSettingsTab` aus `../vendor/kit-obsidian/settings_walker`.
- Produces:
  - `interface WikijsSettings { baseUrl: string; apiKey: string; syncRoot: string; locale: string; timeoutSec: number }`
  - `DEFAULT_SETTINGS: WikijsSettings`, `mergeWikijsSettings(raw: unknown): WikijsSettings`
  - `class WikijsSettingsTab extends PluginSettingTab`
  - `STRINGS: Record<"en" | "de", Record<string, string>>`

- [ ] **Step 1: Failing test schreiben**

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, mergeWikijsSettings } from "../src/core/settings-types";
import { STRINGS } from "../src/i18n/strings";

describe("mergeWikijsSettings", () => {
  it("liefert die Defaults, wenn nichts gespeichert ist", () => {
    expect(mergeWikijsSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it("uebernimmt gespeicherte Werte und ergaenzt fehlende aus den Defaults", () => {
    const merged = mergeWikijsSettings({ baseUrl: "https://w.example" });
    expect(merged.baseUrl).toBe("https://w.example");
    expect(merged.syncRoot).toBe(DEFAULT_SETTINGS.syncRoot);
  });

  it("hat _published als Sync-Wurzel und de als Wiki-Locale (Spec)", () => {
    expect(DEFAULT_SETTINGS.syncRoot).toBe("_published");
    expect(DEFAULT_SETTINGS.locale).toBe("de");
  });
});

describe("STRINGS", () => {
  it("fuehrt DE und EN mit denselben Schluesseln", () => {
    expect(Object.keys(STRINGS.de).sort()).toEqual(Object.keys(STRINGS.en).sort());
  });

  it("hat keinen leeren Wert", () => {
    for (const lang of ["en", "de"] as const) {
      for (const [key, value] of Object.entries(STRINGS[lang])) {
        expect(value, `${lang}.${key}`).not.toBe("");
      }
    }
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `npx vitest run tests/settings.test.ts`
Expected: FAIL — Module nicht auflösbar.

- [ ] **Step 3: `settings-types.ts` schreiben (pure)**

```ts
// Settings-Datentyp und Merge. Pure — der Tab in src/obsidian/settings.ts rendert
// diese Wahrheit, definiert sie aber nicht.
import { mergeSettings } from "../vendor/kit/settings";

export interface WikijsSettings {
  /** Basis-URL der Instanz, ohne /graphql. */
  baseUrl: string;
  apiKey: string;
  /** Vault-Ordner, dessen Inhalt veroeffentlicht wird. Umzug hinein = Publikations-
   *  entscheidung (Spec § "Ratifizierte Grundentscheidungen"). */
  syncRoot: string;
  /** Wiki.js-Locale der angelegten Seiten. */
  locale: string;
  timeoutSec: number;
}

export const TIMEOUT_SEC_MIN = 5;
export const TIMEOUT_SEC_MAX = 120;
export const TIMEOUT_SEC_STEP = 5;

export const DEFAULT_SETTINGS: WikijsSettings = {
  baseUrl: "",
  apiKey: "",
  syncRoot: "_published",
  locale: "de",
  timeoutSec: 30,
};

export function mergeWikijsSettings(raw: unknown): WikijsSettings {
  return mergeSettings(DEFAULT_SETTINGS, raw);
}
```

- [ ] **Step 4: `strings.ts` schreiben**

EN ist kanonisch; DE gleichwertig. Startbestand (weitere Tasks ergänzen hier):

```ts
// UI-Strings. EN ist kanonisch (PROF-OBS-07), DE gleichwertig gepflegt. Der Test in
// tests/settings.test.ts erzwingt Schluesselgleichheit — eine Sprache nachzuziehen
// vergisst man sonst genau einmal pro Feature.
export const STRINGS = {
  en: {
    "settings.url": "Wiki URL",
    "settings.url.desc": "Base URL of your Wiki.js instance, without /graphql.",
    "settings.key": "API key",
    "settings.key.desc": "Token of a group with write access to pages.",
    "settings.root": "Sync folder",
    "settings.root.desc": "Notes in this folder are published; the path maps onto the wiki path.",
    "settings.locale": "Wiki locale",
    "settings.locale.desc": "Locale used for pages created by this plugin.",
    "settings.timeout": "Request timeout",
    "settings.timeout.sec": "{0} s",
    "notice.noUrl": "Set the wiki URL and API key first.",
  },
  de: {
    "settings.url": "Wiki-URL",
    "settings.url.desc": "Basis-URL deiner Wiki.js-Instanz, ohne /graphql.",
    "settings.key": "API-Schlüssel",
    "settings.key.desc": "Token einer Gruppe mit Schreibrecht auf Seiten.",
    "settings.root": "Sync-Ordner",
    "settings.root.desc": "Notizen in diesem Ordner werden veröffentlicht; der Pfad bildet den Wiki-Pfad.",
    "settings.locale": "Wiki-Sprache",
    "settings.locale.desc": "Locale der von diesem Plugin angelegten Seiten.",
    "settings.timeout": "Zeitlimit je Anfrage",
    "settings.timeout.sec": "{0} s",
    "notice.noUrl": "Erst Wiki-URL und API-Schlüssel eintragen.",
  },
} as const satisfies Record<"en" | "de", Record<string, string>>;
```

- [ ] **Step 5: `settings.ts` schreiben — eine Wahrheit, zwei Renderpfade**

`getSettingDefinitions()` ist die einzige Definition; `display()` zeichnet dieselbe
Struktur mit dem Kit-Walker nach (nötig, weil `minAppVersion` 1.8.7 ist). Muster
wörtlich wie `koda-agent/src/obsidian/settings.ts`:

```ts
import { PluginSettingTab, type App, type SettingDefinitionItem } from "obsidian";
import { t } from "../vendor/kit/i18n";
import { renderSettingDefinitions } from "../vendor/kit-obsidian/settings_walker";
import {
  TIMEOUT_SEC_MAX, TIMEOUT_SEC_MIN, TIMEOUT_SEC_STEP, type WikijsSettings,
} from "../core/settings-types";
import type WikijsMaintainerPlugin from "../main";

export class WikijsSettingsTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: WikijsMaintainerPlugin,
  ) {
    super(app, plugin);
  }

  getSettingDefinitions(): SettingDefinitionItem<keyof WikijsSettings>[] {
    return [
      { name: t("settings.url"), desc: t("settings.url.desc"), control: { type: "text", key: "baseUrl", placeholder: "https://wiki.example.org" } },
      { name: t("settings.key"), desc: t("settings.key.desc"), control: { type: "text", key: "apiKey" } },
      { name: t("settings.root"), desc: t("settings.root.desc"), control: { type: "folder", key: "syncRoot" } },
      { name: t("settings.locale"), desc: t("settings.locale.desc"), control: { type: "text", key: "locale", placeholder: "de" } },
      {
        name: t("settings.timeout"),
        control: {
          type: "slider", key: "timeoutSec",
          min: TIMEOUT_SEC_MIN, max: TIMEOUT_SEC_MAX, step: TIMEOUT_SEC_STEP,
          displayFormat: (v: number) => t("settings.timeout.sec", v),
        },
      },
    ];
  }

  getControlValue(key: string): unknown {
    return this.plugin.settings[key as keyof WikijsSettings];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    (this.plugin.settings as Record<string, unknown>)[key] = value;
    await this.plugin.saveSettings();
  }

  // Fallback-Pfad fuer Obsidian < 1.13: dieselbe Definition, klassisch gezeichnet.
  display(): void {
    this.containerEl.empty();
    renderSettingDefinitions(this.containerEl, this.getSettingDefinitions(), this, this.app);
  }
}
```

- [ ] **Step 6: `main.ts` verdrahten**

```ts
import { Plugin } from "obsidian";
import { getLanguage } from "obsidian";
import { defineStrings, pickLang, setLang } from "./vendor/kit/i18n";
import { STRINGS } from "./i18n/strings";
import { mergeWikijsSettings, type WikijsSettings } from "./core/settings-types";
import { WikijsSettingsTab } from "./obsidian/settings";

export default class WikijsMaintainerPlugin extends Plugin {
  settings: WikijsSettings = mergeWikijsSettings(null);

  async onload(): Promise<void> {
    // Reihenfolge ist load-bearing: Strings und Sprache stehen VOR jeder
    // Registrierung, sonst tragen Command-Namen den Schluessel statt des Texts.
    defineStrings(STRINGS);
    setLang(pickLang(getLanguage()));
    this.settings = mergeWikijsSettings(await this.loadData());
    this.addSettingTab(new WikijsSettingsTab(this.app, this));
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
```

- [ ] **Step 7: Test laufen lassen, grün bestätigen**

Run: `npx vitest run tests/settings.test.ts`
Expected: PASS.

- [ ] **Step 8: Gate und Commit**

```bash
npm run gate
git add src/core/settings-types.ts src/i18n/strings.ts src/obsidian/settings.ts src/main.ts tests/settings.test.ts
git commit -m "feat(settings): deklarativer Settings-Tab mit EN/DE-Strings"
```

---

### Task 11: Vault-Quelle — Notizen einlesen und transformieren

**Files:**
- Create: `src/obsidian/vault-source.ts`
- Test: `tests/vault_source.test.ts`

**Interfaces:**
- Consumes: `vaultPathToWikiPath`, `findSlugCollisions` aus `../core/paths`; `transformForWiki` aus `../core/transform`; `LocalPage` aus `../core/sync-plan`.
- Produces:
  - `interface AmbiguousName { name: string; vaultPaths: string[] }`
  - `interface CollectedPages { pages: LocalPage[]; meta: Map<string, TransformResult>; collisions: SlugCollision[]; ambiguousNames: AmbiguousName[] }`
  - `collectLocalPages(vault: Vault, syncRoot: string): Promise<CollectedPages>`

**Mehrdeutige Dateinamen** (Entscheidung 2026-08-09): Tragen zwei gesyncte Dateien
in verschiedenen Ordnern denselben Dateinamen, löst `[[Dateiname]]` ihn **gar nicht**
auf — der Link wird zu reinem Text und zählt als offener Link. Die Mehrdeutigkeit
wird zusätzlich in `ambiguousNames` gemeldet und erscheint in der Status-Ansicht
(Task 15). Eindeutige Pfadangaben (`[[Ordner/Dateiname]]`) funktionieren weiter.
Grund: ein sichtbar fehlender Link ist harmlos, ein stiller Link aufs falsche Thema
nicht — und welches Ziel gewönne, hinge an der Reihenfolge, in der Obsidian die
Dateien liefert.

**Wichtig:** Der Link-Resolver muss über **alle** Dateien der Sync-Wurzel gebildet
werden, bevor die erste Notiz transformiert wird — sonst hängt das Ergebnis von der
Reihenfolge ab, in der Obsidian die Dateien liefert.

- [ ] **Step 1: Failing test schreiben**

```ts
import { describe, expect, it } from "vitest";
import { collectLocalPages } from "../src/obsidian/vault-source";

function fakeVault(files: Record<string, string>) {
  const list = Object.keys(files).map((path) => ({ path, basename: path.split("/").pop()!.replace(/\.md$/, ""), extension: "md" }));
  return {
    getMarkdownFiles: () => list,
    cachedRead: (file: { path: string }) => Promise.resolve(files[file.path] ?? ""),
  };
}

describe("collectLocalPages", () => {
  it("nimmt nur Dateien unterhalb der Sync-Wurzel", async () => {
    const vault = fakeVault({ "_published/A.md": "x", "Entwurf/B.md": "y" });
    const out = await collectLocalPages(vault as never, "_published");
    expect(out.pages.map((p) => p.wikiPath)).toEqual(["a"]);
  });

  it("loest einen Wikilink auf eine andere gesyncte Notiz auf, egal in welcher Reihenfolge gelesen wird", async () => {
    const vault = fakeVault({ "_published/A.md": "siehe [[B]]", "_published/B.md": "ziel" });
    const out = await collectLocalPages(vault as never, "_published");
    const a = out.pages.find((p) => p.wikiPath === "a");
    expect(a?.transformed).toBe("siehe [B](/b)");
  });

  it("entschaerft einen Wikilink auf eine nicht gesyncte Notiz und meldet ihn", async () => {
    const vault = fakeVault({ "_published/A.md": "siehe [[Geheim]]", "Entwurf/Geheim.md": "z" });
    const out = await collectLocalPages(vault as never, "_published");
    expect(out.pages[0]?.transformed).toBe("siehe Geheim");
    expect(out.meta.get("a")?.unresolved).toEqual(["Geheim"]);
  });

  it("meldet Slug-Kollisionen, statt eine der Dateien stillschweigend zu verlieren", async () => {
    const vault = fakeVault({ "_published/DNS Setup.md": "x", "_published/dns-setup.md": "y" });
    const out = await collectLocalPages(vault as never, "_published");
    expect(out.collisions).toHaveLength(1);
  });

  it("nimmt den Dateinamen als Titel, wenn kein Frontmatter-title da ist", async () => {
    const vault = fakeVault({ "_published/DNS Setup.md": "x" });
    const out = await collectLocalPages(vault as never, "_published");
    expect(out.meta.get("dns-setup")?.title).toBe("DNS Setup");
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `npx vitest run tests/vault_source.test.ts`
Expected: FAIL — Modul nicht auflösbar.

- [ ] **Step 3: Implementierung**

```ts
// Vault-Ordner → LocalPage[]. Der einzige Ort, an dem Datei-I/O auf die pure
// Transformation trifft.
import type { TFile, Vault } from "obsidian";
import { findSlugCollisions, vaultPathToWikiPath, type SlugCollision } from "../core/paths";
import { transformForWiki, type TransformResult } from "../core/transform";
import type { LocalPage } from "../core/sync-plan";

export interface CollectedPages {
  pages: LocalPage[];
  /** Wiki-Pfad → Transformations-Befund (Titel, Tags, offene Links). */
  meta: Map<string, TransformResult>;
  collisions: SlugCollision[];
}

export async function collectLocalPages(vault: Vault, syncRoot: string): Promise<CollectedPages> {
  const files = vault.getMarkdownFiles().filter((f: TFile) => vaultPathToWikiPath(f.path, syncRoot) !== null);

  // Erst die vollstaendige Karte bauen, dann transformieren: ein Wikilink darf nicht
  // davon abhaengen, ob sein Ziel zufaellig frueher gelesen wurde.
  const byName = new Map<string, string>();
  for (const file of files) {
    const wikiPath = vaultPathToWikiPath(file.path, syncRoot);
    if (wikiPath === null) continue;
    byName.set(file.basename, wikiPath);
    byName.set(file.path.replace(/\.md$/i, ""), wikiPath);
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

  return { pages, meta, collisions: findSlugCollisions(files.map((f: TFile) => f.path), syncRoot) };
}
```

- [ ] **Step 4: Test laufen lassen, grün bestätigen**

Run: `npx vitest run tests/vault_source.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate und Commit**

```bash
npm run gate
git add src/obsidian/vault-source.ts tests/vault_source.test.ts
git commit -m "feat(obsidian): Sync-Ordner einlesen und in einem Zug transformieren"
```

---

### Task 12: Sync-Dienst mit Drift-Guard und Push der aktuellen Notiz

Der erste Task, nach dem das Plugin etwas Sichtbares tut.

**Files:**
- Create: `src/obsidian/sync-service.ts`
- Modify: `src/main.ts` (Command registrieren)
- Modify: `src/i18n/strings.ts` (neue Schlüssel)
- Test: `tests/sync_service.test.ts`

**Interfaces:**
- Consumes: `WikiClient`, `WikiError`, `PageInput` aus `../wikijs/client`; `SnapshotStore`; `collectLocalPages`; `planSync`, `SyncEntry`; `TransformResult`.
- Produces:
  - `type PushOutcome = { kind: "created" | "updated" } | { kind: "skipped"; reason: "unchanged" } | { kind: "blocked"; reason: "drift" | "occupied" | "collision" }`
  - `class SyncService` mit `constructor(deps: SyncDeps)`, `buildPlan(): Promise<{ entries: SyncEntry[]; meta: Map<string, TransformResult>; collisions: SlugCollision[] }>`, `pushOne(entry: SyncEntry, meta: TransformResult): Promise<PushOutcome>`
  - `interface SyncDeps { client: WikiClient; store: SnapshotStore; vault: Vault; syncRoot: () => string }`

**Der Drift-Guard ist der Kern dieses Tasks:** unmittelbar vor jedem `update` wird
`fetchUpdatedAt(pageId)` geholt und gegen `snapshot.remoteUpdatedAt` geprüft. Weicht
es ab, wird **nicht** gepusht (Spec § 3). Die Prüfung im Plan reicht nicht — zwischen
Plan und Klick können Minuten liegen.

- [ ] **Step 1: Failing test schreiben**

```ts
import { describe, expect, it, vi } from "vitest";
import { SyncService } from "../src/obsidian/sync-service";
import type { SyncEntry } from "../src/core/sync-plan";
import type { TransformResult } from "../src/core/transform";

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
    const out = await svc.pushOne(entry({ state: "create", pageId: undefined, snapshot: undefined }), meta);
    expect(out).toEqual({ kind: "created" });
    expect(client.createPage).toHaveBeenCalledTimes(1);
    expect(store.save).toHaveBeenCalledWith(expect.objectContaining({ wikiPath: "a", pageId: 5, raw: "roh", pushed: "neu", remoteUpdatedAt: "T2" }));
  });

  it("prueft vor dem Update den Drift-Guard und aktualisiert bei Gleichstand", async () => {
    const { svc, client } = service();
    const out = await svc.pushOne(entry({}), meta);
    expect(out).toEqual({ kind: "updated" });
    expect(client.fetchUpdatedAt).toHaveBeenCalledWith(5);
    expect(client.updatePage).toHaveBeenCalledTimes(1);
  });

  it("pusht NICHT, wenn sich das Remote-updatedAt seit dem Plan geaendert hat", async () => {
    const { svc, client } = service({ fetchUpdatedAt: vi.fn(() => Promise.resolve("T-NEU")) });
    const out = await svc.pushOne(entry({}), meta);
    expect(out).toEqual({ kind: "blocked", reason: "drift" });
    expect(client.updatePage).not.toHaveBeenCalled();
  });

  it("pusht NICHT auf eine fremde Seite, die zufaellig denselben Pfad belegt", async () => {
    const { svc, client } = service();
    const out = await svc.pushOne(entry({ state: "occupied", snapshot: undefined }), meta);
    expect(out).toEqual({ kind: "blocked", reason: "occupied" });
    expect(client.updatePage).not.toHaveBeenCalled();
    expect(client.createPage).not.toHaveBeenCalled();
  });

  it("macht nichts bei unveraendertem Stand", async () => {
    const { svc, client } = service();
    const out = await svc.pushOne(entry({ state: "unchanged" }), meta);
    expect(out).toEqual({ kind: "skipped", reason: "unchanged" });
    expect(client.updatePage).not.toHaveBeenCalled();
  });

  it("schreibt bei einem Fehler KEINEN Snapshot — sonst gilt ein misslungener Push als Stand", async () => {
    const { svc, store } = service({ updatePage: vi.fn(() => Promise.reject(new Error("boom"))) });
    await expect(svc.pushOne(entry({}), meta)).rejects.toThrow("boom");
    expect(store.save).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `npx vitest run tests/sync_service.test.ts`
Expected: FAIL — Modul nicht auflösbar.

- [ ] **Step 3: Implementierung**

```ts
// Orchestrierung: Plan bauen, Drift pruefen, ausfuehren, Snapshot fortschreiben.
// Die Entscheidung, WAS zu tun ist, liegt in core/sync-plan.ts — hier liegt nur,
// WIE es ausgefuehrt wird.
import type { Vault } from "obsidian";
import type { WikiClient, PageInput } from "../wikijs/client";
import type { SnapshotStore } from "./snapshot-store";
import { collectLocalPages } from "./vault-source";
import { planSync, type SyncEntry } from "../core/sync-plan";
import type { TransformResult } from "../core/transform";
import type { SlugCollision } from "../core/paths";

export type PushOutcome =
  | { kind: "created" | "updated" }
  | { kind: "skipped"; reason: "unchanged" }
  | { kind: "blocked"; reason: "drift" | "occupied" | "collision" };

export interface SyncDeps {
  client: WikiClient;
  store: SnapshotStore;
  vault: Vault;
  syncRoot: () => string;
}

export interface BuiltPlan {
  entries: SyncEntry[];
  meta: Map<string, TransformResult>;
  collisions: SlugCollision[];
  /** Mehrdeutige Dateinamen aus der Vault-Quelle — unverändert durchgereicht,
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
   *  Klick koennen Minuten liegen, und der Plan ist ein Foto, kein Vertrag. */
  async pushOne(entry: SyncEntry, meta: TransformResult): Promise<PushOutcome> {
    if (entry.state === "unchanged") return { kind: "skipped", reason: "unchanged" };
    if (entry.state === "occupied") return { kind: "blocked", reason: "occupied" };
    if (entry.local === undefined) return { kind: "blocked", reason: "occupied" };

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

    const currentUpdatedAt = await this.deps.client.fetchUpdatedAt(pageId);
    if (currentUpdatedAt !== entry.snapshot.remoteUpdatedAt) return { kind: "blocked", reason: "drift" };

    const updated = await this.deps.client.updatePage(pageId, this.inputFor(entry, meta));
    await this.deps.store.save({
      version: 1, wikiPath: entry.wikiPath, pageId,
      raw: entry.local.raw, pushed: meta.content, remoteUpdatedAt: updated.updatedAt,
    });
    return { kind: "updated" };
  }
}
```

- [ ] **Step 4: Test laufen lassen, grün bestätigen**

Run: `npx vitest run tests/sync_service.test.ts`
Expected: PASS.

- [ ] **Step 5: Command „Aktuelle Notiz pushen" verdrahten**

In `src/main.ts` in `onload()` ergänzen (Notice-Texte über `t(...)`, neue Schlüssel
`command.pushCurrent`, `notice.pushed`, `notice.created`, `notice.drift`,
`notice.occupied`, `notice.outsideRoot`, `notice.error` in **beiden** Sprachen
nachtragen):

```ts
this.addCommand({
  id: "push-current-note",
  name: t("command.pushCurrent"),
  checkCallback: (checking: boolean) => {
    const file = this.app.workspace.getActiveFile();
    if (file === null) return false;
    if (checking) return true;
    void this.pushCurrent(file);
    return true;
  },
});
```

Dazu die Methode im Plugin (Fehler werden **immer** als `Notice` sichtbar — ein
stiller Fehlschlag beim Veröffentlichen ist der schlechteste Ausgang):

```ts
private async pushCurrent(file: TFile): Promise<void> {
  const service = this.buildService();
  const wikiPath = vaultPathToWikiPath(file.path, this.settings.syncRoot);
  if (wikiPath === null) {
    new Notice(t("notice.outsideRoot", this.settings.syncRoot));
    return;
  }
  try {
    const plan = await service.buildPlan();
    const entry = plan.entries.find((e) => e.wikiPath === wikiPath);
    const meta = plan.meta.get(wikiPath);
    if (entry === undefined || meta === undefined) return;
    const outcome = await service.pushOne(entry, meta);
    new Notice(this.describeOutcome(outcome, wikiPath));
  } catch (err) {
    new Notice(t("notice.error", err instanceof Error ? err.message : String(err)));
  }
}
```

Der Dienst wird pro Aktion frisch gebaut, nicht im `onload` einmal — die Settings
können sich zwischen zwei Commands geändert haben, und ein Client mit veralteter
URL schreibt sonst ins vorige Wiki:

```ts
private buildService(): SyncService {
  return new SyncService({
    client: new WikiClient({
      baseUrl: this.settings.baseUrl,
      token: this.settings.apiKey,
      locale: this.settings.locale,
      timeoutMs: this.settings.timeoutSec * 1000,
    }),
    store: new SnapshotStore(this.app.vault.adapter, this.manifest.dir ?? ""),
    vault: this.app.vault,
    syncRoot: () => this.settings.syncRoot,
  });
}
```

`this.manifest.dir` ist der Plugin-Datenordner
(`.obsidian/plugins/wikijs-maintainer`) — genau der Ort, den Spec § 2 für die
Snapshots vorsieht. In den späteren Tasks kommen `resolveConflict` (13),
`writeNote` (14) und `askRemoval` (16) als weitere Felder hinzu.

Dazu die Übersetzung des Ergebnisses in eine Meldung — als eigene Methode, weil
sie in Task 16 wiederverwendet wird:

```ts
private describeOutcome(outcome: PushOutcome, wikiPath: string): string {
  if (outcome.kind === "created") return t("notice.created", wikiPath);
  if (outcome.kind === "updated") return t("notice.pushed", wikiPath);
  if (outcome.kind === "skipped") return t("notice.unchanged", wikiPath);
  if (outcome.reason === "drift") return t("notice.drift", wikiPath);
  if (outcome.reason === "collision") return t("notice.collision", wikiPath);
  return t("notice.occupied", wikiPath);
}
```

- [ ] **Step 6: Gate und Commit**

```bash
npm run gate
git add src/obsidian/sync-service.ts src/main.ts src/i18n/strings.ts tests/sync_service.test.ts
git commit -m "feat(sync): aktuelle Notiz pushen, mit Drift-Guard unmittelbar davor"
```

---

### Task 13: Konflikt-Dialog mit Diff

**Files:**
- Create: `src/obsidian/conflict-modal.ts`
- Create: `styles.css` (Ergänzung)
- Modify: `src/i18n/strings.ts`
- Modify: `src/obsidian/sync-service.ts` (Konflikt-Auflösung als Callback)
- Test: `tests/conflict_choice.test.ts`

**Interfaces:**
- Consumes: `diffLines`, `groupHunks` aus `../core/diff`; `Modal` aus `obsidian`.
- Produces:
  - `type ConflictChoice = "local" | "remote" | "cancel"`
  - `askConflict(app: App, opts: { wikiPath: string; localText: string; remoteText: string }): Promise<ConflictChoice>`
  - in `sync-service.ts`: `SyncDeps` bekommt das optionale Feld `resolveConflict?: (entry: SyncEntry, remoteContent: string) => Promise<ConflictChoice>`

**UI-Regel:** nur Theme-CSS-Variablen (`UI-STANDARD.md`). Für die Diff-Zeilen:
`var(--background-modifier-success)` für `add`, `var(--background-modifier-error)`
für `del`, keine festen Farben.

- [ ] **Step 1: Failing test für die pure Entscheidungslogik schreiben**

Das Modal selbst wird nicht getestet (DOM), die Auflösung im Dienst schon:

```ts
import { describe, expect, it, vi } from "vitest";
import { SyncService } from "../src/obsidian/sync-service";
import type { SyncEntry } from "../src/core/sync-plan";
import type { TransformResult } from "../src/core/transform";

const meta: TransformResult = { content: "neu", title: "T", description: "", tags: [], unresolved: [], skippedEmbeds: [] };

const conflictEntry: SyncEntry = {
  wikiPath: "a", state: "conflict", pageId: 5,
  local: { vaultPath: "_published/A.md", wikiPath: "a", raw: "roh-neu", transformed: "neu" },
  snapshot: { version: 1, wikiPath: "a", pageId: 5, raw: "roh-alt", pushed: "alt", remoteUpdatedAt: "T1" },
  remote: { id: 5, path: "a", title: "T", updatedAt: "T-NEU" },
};

function service(choice: "local" | "remote" | "cancel") {
  const client = {
    fetchUpdatedAt: vi.fn(() => Promise.resolve("T-NEU")),
    fetchPage: vi.fn(() => Promise.resolve({ id: 5, path: "a", title: "T", description: "", content: "remote-text", updatedAt: "T-NEU" })),
    updatePage: vi.fn(() => Promise.resolve({ updatedAt: "T3" })),
  };
  const store = { save: vi.fn(() => Promise.resolve()), loadAll: vi.fn(() => Promise.resolve([])), remove: vi.fn(() => Promise.resolve()) };
  const resolveConflict = vi.fn(() => Promise.resolve(choice));
  const svc = new SyncService({
    client: client as never, store: store as never, vault: {} as never,
    syncRoot: () => "_published", resolveConflict: resolveConflict as never,
  });
  return { svc, client, store, resolveConflict };
}

describe("SyncService.pushOne bei Konflikt", () => {
  it("fragt nach und pusht die lokale Fassung, wenn der Nutzer lokal waehlt", async () => {
    const { svc, client, resolveConflict } = service("local");
    const out = await svc.pushOne(conflictEntry, meta);
    expect(resolveConflict).toHaveBeenCalledTimes(1);
    expect(client.updatePage).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ kind: "updated" });
  });

  it("pusht nicht, wenn der Nutzer abbricht", async () => {
    const { svc, client } = service("cancel");
    expect(await svc.pushOne(conflictEntry, meta)).toEqual({ kind: "blocked", reason: "drift" });
    expect(client.updatePage).not.toHaveBeenCalled();
  });

  it("blockt den Konflikt ohne Rueckfrage, wenn kein Aufloeser gestellt ist", async () => {
    const svc = new SyncService({
      client: { fetchUpdatedAt: vi.fn(() => Promise.resolve("T-NEU")), updatePage: vi.fn() } as never,
      store: { save: vi.fn(), loadAll: vi.fn(), remove: vi.fn() } as never,
      vault: {} as never, syncRoot: () => "_published",
    });
    expect(await svc.pushOne(conflictEntry, meta)).toEqual({ kind: "blocked", reason: "drift" });
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `npx vitest run tests/conflict_choice.test.ts`
Expected: FAIL — `resolveConflict` ist in `SyncDeps` noch nicht vorgesehen.

- [ ] **Step 3: `sync-service.ts` erweitern**

**Zwei Änderungen, nicht eine.** Die zweite ist leicht zu übersehen und der Grund,
warum dieser Task nicht nur ein Dialog ist:

**(a) Ein eigener Guard für den Zustand `conflict`.** `pushOne` prüft `entry.state`
im Update-Pfad bisher gar nicht — ein `conflict`-Eintrag läuft durch denselben
generischen Zweig wie ein `update`. Aufgefangen wird er heute nur *zufällig* vom
Drift-Guard, nämlich solange `remoteUpdatedAt` noch abweicht. Stimmt es wieder
überein (die Wiki-Seite wurde auf den alten Stand zurückgesetzt), überschreibt ein
`conflict` still. Deshalb bekommt `pushOne` — analog zur Kollisionsprüfung, direkt
daneben am Anfang der Methode — einen ausdrücklichen Zustandsguard:

```ts
// Ein Konflikt wird NIE ohne Entscheidung des Nutzers gepusht. Sich auf den
// Drift-Guard zu verlassen genügt nicht: der vergleicht gegen den Snapshot, und
// eine zurückgesetzte Wiki-Seite stimmt damit wieder überein, obwohl der Plan
// den Eintrag als Konflikt kennt.
if (entry.state === "conflict" && this.deps.resolveConflict === undefined) {
  return { kind: "blocked", reason: "drift" };
}
```

Der zugehörige Test: ein `conflict`-Eintrag, dessen `fetchUpdatedAt` **denselben**
Wert liefert wie der Snapshot (der Drift-Guard schlägt also *nicht* an), und kein
`resolveConflict` gestellt → `blocked`, und `updatePage` wurde nicht gerufen. Ohne
den Guard ist dieser Test rot; er ist die eigentliche Zusicherung dieses Steps.

**(b) Der Auflöser selbst.** `SyncDeps` bekommt
`resolveConflict?: (entry: SyncEntry, remoteContent: string) => Promise<ConflictChoice>`.
Die eine Zeile aus Task 12 —

```ts
if (currentUpdatedAt !== entry.snapshot.remoteUpdatedAt) return { kind: "blocked", reason: "drift" };
```

— wird **ersetzt** durch:

```ts
if (currentUpdatedAt !== entry.snapshot.remoteUpdatedAt) {
  if (this.deps.resolveConflict === undefined) return { kind: "blocked", reason: "drift" };
  const remote = await this.deps.client.fetchPage(pageId);
  const choice = await this.deps.resolveConflict(entry, remote.content);
  if (choice !== "local") return { kind: "blocked", reason: "drift" };
  // "local" heisst: bewusst ueberschreiben — der Nutzer hat den Diff gesehen.
}
```

- [ ] **Step 4: Modal schreiben**

```ts
// Konflikt-Dialog: zeigt den Zeilen-Diff zwischen der zuletzt gepushten Fassung und
// dem, was jetzt im Wiki steht, und laesst den Nutzer entscheiden. Bewusst KEIN
// Merge — der kommt in V3; hier gilt "sehen, dann entscheiden".
import { App, Modal, Setting } from "obsidian";
import { diffLines } from "../core/diff";
import { t } from "../vendor/kit/i18n";

export type ConflictChoice = "local" | "remote" | "cancel";

class ConflictModal extends Modal {
  private done: ((choice: ConflictChoice) => void) | null;

  constructor(
    app: App,
    private readonly opts: { wikiPath: string; localText: string; remoteText: string },
    done: (choice: ConflictChoice) => void,
  ) {
    super(app);
    this.done = done;
  }

  // finish() nullt den Callback VOR dem Aufloesen: Button-Klick und nachlaufendes
  // onClose loesen sonst doppelt auf (Muster aus dem Kit-confirm).
  private finish(choice: ConflictChoice): void {
    const done = this.done;
    this.done = null;
    this.close();
    done?.(choice);
  }

  onOpen(): void {
    this.titleEl.setText(t("conflict.title", this.opts.wikiPath));
    const diffEl = this.contentEl.createDiv({ cls: "wikijs-diff" });
    for (const line of diffLines(this.opts.remoteText, this.opts.localText)) {
      diffEl.createDiv({ cls: `wikijs-diff-line wikijs-diff-${line.kind}`, text: line.text === "" ? " " : line.text });
    }
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText(t("conflict.keepLocal")).setCta().onClick(() => this.finish("local")))
      .addButton((b) => b.setButtonText(t("conflict.keepRemote")).onClick(() => this.finish("remote")))
      .addButton((b) => b.setButtonText(t("conflict.cancel")).onClick(() => this.finish("cancel")));
  }

  onClose(): void {
    this.contentEl.empty();
    this.finish("cancel"); // sonst haengt das Promise bei Esc oder Klick daneben
  }
}

export function askConflict(app: App, opts: { wikiPath: string; localText: string; remoteText: string }): Promise<ConflictChoice> {
  return new Promise((resolve) => new ConflictModal(app, opts, resolve).open());
}
```

- [ ] **Step 5: `styles.css` ergänzen**

```css
.wikijs-diff {
  max-height: 50vh;
  overflow: auto;
  font-family: var(--font-monospace);
  font-size: var(--font-smaller);
}
.wikijs-diff-line { white-space: pre-wrap; padding: 0 var(--size-2-2); }
.wikijs-diff-add { background-color: var(--background-modifier-success); }
.wikijs-diff-del { background-color: var(--background-modifier-error); }
```

- [ ] **Step 6: Test laufen lassen, Gate, Commit**

```bash
npx vitest run tests/conflict_choice.test.ts
npm run gate
git add src/obsidian/conflict-modal.ts src/obsidian/sync-service.ts src/i18n/strings.ts styles.css tests/conflict_choice.test.ts
git commit -m "feat(ui): Konflikt-Dialog mit Zeilen-Diff statt stiller Blockade"
```

---

### Task 14: Pull

**Files:**
- Modify: `src/obsidian/sync-service.ts` (`pullOne`)
- Modify: `src/main.ts` (Command „Seite vom Wiki pullen")
- Modify: `src/i18n/strings.ts`
- Test: `tests/sync_pull.test.ts`

**Interfaces:**
- Produces: `SyncService.pullOne(entry: SyncEntry): Promise<PullOutcome>` mit `type PullOutcome = { kind: "written"; vaultPath: string } | { kind: "skipped" }`; `SyncDeps` bekommt `writeNote?: (vaultPath: string, content: string) => Promise<void>` —
optional wie `resolveConflict` und `askRemoval`, damit die Tests der Push-Tasks den
Dienst weiterhin ohne Vault-Schreibrechte bauen können. In `sync-service.ts` kommt
dafür der Import `import { wikiPathToVaultPath } from "../core/paths";` dazu
(neben dem bestehenden `SlugCollision`-Import).

**Semantik (Spec § 3):** Pull schreibt das Wiki-Markdown weitgehend 1:1 in den Vault
und aktualisiert den Snapshot. Für `new-remote` wird der Vault-Pfad über
`wikiPathToVaultPath(wikiPath, syncRoot, title)` gebildet.

- [ ] **Step 1: Failing test schreiben**

```ts
import { describe, expect, it, vi } from "vitest";
import { SyncService } from "../src/obsidian/sync-service";
import type { SyncEntry } from "../src/core/sync-plan";

function service() {
  const client = {
    fetchPage: vi.fn(() => Promise.resolve({ id: 5, path: "netzwerk/dns", title: "DNS Setup", description: "", content: "wiki-text", updatedAt: "T9" })),
    listPages: vi.fn(() => Promise.resolve([])),
  };
  const store = { save: vi.fn(() => Promise.resolve()), loadAll: vi.fn(() => Promise.resolve([])), remove: vi.fn(() => Promise.resolve()) };
  const writeNote = vi.fn(() => Promise.resolve());
  const svc = new SyncService({
    client: client as never, store: store as never, vault: {} as never,
    syncRoot: () => "_published", writeNote,
  });
  return { svc, client, store, writeNote };
}

describe("SyncService.pullOne", () => {
  it("schreibt eine remote geaenderte Seite an ihren bekannten Vault-Pfad", async () => {
    const { svc, writeNote } = service();
    const entry: SyncEntry = {
      wikiPath: "netzwerk/dns", state: "remote-changed", pageId: 5,
      local: { vaultPath: "_published/Netzwerk/DNS.md", wikiPath: "netzwerk/dns", raw: "alt", transformed: "alt" },
      snapshot: { version: 1, wikiPath: "netzwerk/dns", pageId: 5, raw: "alt", pushed: "alt", remoteUpdatedAt: "T1" },
      remote: { id: 5, path: "netzwerk/dns", title: "DNS Setup", updatedAt: "T9" },
    };
    expect(await svc.pullOne(entry)).toEqual({ kind: "written", vaultPath: "_published/Netzwerk/DNS.md" });
    expect(writeNote).toHaveBeenCalledWith("_published/Netzwerk/DNS.md", "wiki-text");
  });

  it("legt eine im Wiki neu angelegte Seite unter dem aus Titel und Pfad gebauten Ort ab", async () => {
    const { svc, writeNote } = service();
    const entry: SyncEntry = {
      wikiPath: "netzwerk/dns", state: "new-remote", pageId: 5,
      remote: { id: 5, path: "netzwerk/dns", title: "DNS Setup", updatedAt: "T9" },
    };
    expect(await svc.pullOne(entry)).toEqual({ kind: "written", vaultPath: "_published/netzwerk/DNS Setup.md" });
    expect(writeNote).toHaveBeenCalledWith("_published/netzwerk/DNS Setup.md", "wiki-text");
  });

  it("schreibt den Snapshot mit dem neuen updatedAt fort — sonst gilt die Seite sofort wieder als geaendert", async () => {
    const { svc, store } = service();
    await svc.pullOne({ wikiPath: "netzwerk/dns", state: "new-remote", pageId: 5, remote: { id: 5, path: "netzwerk/dns", title: "DNS Setup", updatedAt: "T9" } });
    expect(store.save).toHaveBeenCalledWith(expect.objectContaining({ remoteUpdatedAt: "T9", raw: "wiki-text", pushed: "wiki-text" }));
  });

  it("tut nichts fuer Zustaende, die keinen Pull kennen", async () => {
    const { svc, writeNote } = service();
    expect(await svc.pullOne({ wikiPath: "a", state: "create" })).toEqual({ kind: "skipped" });
    expect(writeNote).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `npx vitest run tests/sync_pull.test.ts`
Expected: FAIL — `pullOne` existiert nicht.

- [ ] **Step 3: `pullOne` implementieren**

```ts
export type PullOutcome = { kind: "written"; vaultPath: string } | { kind: "skipped" };

/** Pull schreibt das Wiki-Markdown weitgehend 1:1 in den Vault (Spec § 3) — Standard-
 *  Markdown-Links bleiben funktional. Der Snapshot wird MIT dem frischen updatedAt
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
```

`writeNote` wird in `main.ts` gestellt und legt fehlende Ordner an:

```ts
writeNote: async (vaultPath: string, content: string): Promise<void> => {
  const folder = vaultPath.split("/").slice(0, -1).join("/");
  if (folder !== "" && this.app.vault.getFolderByPath(folder) === null) {
    await this.app.vault.createFolder(folder);
  }
  const existing = this.app.vault.getFileByPath(vaultPath);
  if (existing === null) await this.app.vault.create(vaultPath, content);
  else await this.app.vault.modify(existing, content);
},
```

- [ ] **Step 4: Test laufen lassen, Gate, Commit**

```bash
npx vitest run tests/sync_pull.test.ts
npm run gate
git add src/obsidian/sync-service.ts src/main.ts src/i18n/strings.ts tests/sync_pull.test.ts
git commit -m "feat(sync): Seiten aus dem Wiki in den Vault ziehen"
```

---

### Task 15: Status-Ansicht

**Files:**
- Create: `src/obsidian/status-view.ts`
- Modify: `src/main.ts` (View registrieren, Command „Sync-Status anzeigen")
- Modify: `src/i18n/strings.ts`, `styles.css`
- Test: `tests/status_labels.test.ts`

**Interfaces:**
- Consumes: `BuiltPlan`, `SyncService`; `t` aus dem Kit-i18n.
- Produces: `const VIEW_TYPE_WIKIJS_STATUS = "wikijs-status"`, `class WikijsStatusView extends ItemView`, und — **pure, deshalb testbar** — `statusLabelKey(state: SyncState): string` in `src/core/sync-plan.ts`.

**Warum ein eigener pure Helfer:** Die Zuordnung Zustand → i18n-Schlüssel ist die
Stelle, an der ein neuer Zustand stillschweigend ohne Beschriftung durchrutscht. Der
Vollständigkeitstest über `Record<SyncState, true>` fängt das — dieselbe Lehre wie
die `statusKindKey`-Lücke, die im Ökosystem am 2026-08-08 aufschlug.

- [ ] **Step 1: Failing test schreiben**

```ts
import { describe, expect, it } from "vitest";
import { statusLabelKey, type SyncState } from "../src/core/sync-plan";
import { STRINGS } from "../src/i18n/strings";

// Ein Record ueber die Union: ein neuer Zustand bricht den BUILD, nicht erst die UI.
const ALL: Record<SyncState, true> = {
  create: true, update: true, "remote-changed": true, conflict: true, occupied: true,
  "removed-locally": true, "remote-deleted": true, "new-remote": true,
  "stale-snapshot": true, unchanged: true,
};

describe("statusLabelKey", () => {
  it("hat fuer jeden Zustand einen Schluessel, den beide Sprachen kennen", () => {
    for (const state of Object.keys(ALL) as SyncState[]) {
      const key = statusLabelKey(state);
      expect(STRINGS.en[key], `EN fehlt: ${key}`).toBeDefined();
      expect(STRINGS.de[key], `DE fehlt: ${key}`).toBeDefined();
    }
  });

  it("vergibt fuer verschiedene Zustaende verschiedene Schluessel", () => {
    const keys = (Object.keys(ALL) as SyncState[]).map(statusLabelKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("Warn-Schluessel der Status-Ansicht", () => {
  it("kennt beide Sprachen fuer Kollisionen und mehrdeutige Namen", () => {
    for (const key of ["view.collision", "view.ambiguous", "view.ambiguous.hint", "status.collision"]) {
      expect(STRINGS.en[key], `EN fehlt: ${key}`).toBeDefined();
      expect(STRINGS.de[key], `DE fehlt: ${key}`).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `npx vitest run tests/status_labels.test.ts`
Expected: FAIL — `statusLabelKey` existiert nicht.

- [ ] **Step 3: `statusLabelKey` in `sync-plan.ts` ergänzen**

```ts
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
```

Dazu die zehn Schlüssel in **beiden** Sprachen in `strings.ts` (EN kanonisch),
z. B. `"status.conflict": "Conflict"` / `"Konflikt"`.

- [ ] **Step 4: View schreiben**

```ts
// Status-Ansicht: die eine Stelle, an der der Nutzer den Plan sieht, bevor er ihn
// ausfuehrt. Sie rechnet nichts aus — planSync() hat das getan.
import { ItemView, Setting, type WorkspaceLeaf } from "obsidian";
import { statusLabelKey, type SyncEntry } from "../core/sync-plan";
import { t } from "../vendor/kit/i18n";
import type { BuiltPlan, SyncService } from "./sync-service";

export const VIEW_TYPE_WIKIJS_STATUS = "wikijs-status";

const PUSHABLE = new Set(["create", "update", "conflict"]);
const PULLABLE = new Set(["remote-changed", "new-remote"]);

export class WikijsStatusView extends ItemView {
  private showUnchanged = false;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly service: () => SyncService,
  ) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE_WIKIJS_STATUS; }
  getDisplayText(): string { return t("view.title"); }
  getIcon(): string { return "cloud"; }

  async onOpen(): Promise<void> { await this.refresh(); }

  async refresh(): Promise<void> {
    const container = this.contentEl;
    container.empty();
    container.createEl("h3", { text: t("view.title") });

    let plan: BuiltPlan;
    try {
      plan = await this.service().buildPlan();
    } catch (err) {
      container.createEl("p", { text: t("notice.error", err instanceof Error ? err.message : String(err)) });
      return;
    }

    new Setting(container)
      .addButton((b) => b.setButtonText(t("view.refresh")).onClick(() => void this.refresh()))
      .addToggle((tg) =>
        tg.setValue(this.showUnchanged).onChange((v) => {
          this.showUnchanged = v;
          void this.refresh();
        }),
      )
      .setName(t("view.showUnchanged"));

    // Kollisionen oben und unuebersehbar: solange eine besteht, ist fuer die
    // beteiligten Pfade JEDER Push gesperrt (Spec § 3) -- sonst ueberschriebe die
    // zweite Datei stillschweigend die erste.
    const blocked = new Set<string>();
    for (const collision of plan.collisions) {
      blocked.add(collision.wikiPath);
      const box = container.createDiv({ cls: "wikijs-collision" });
      box.createEl("strong", { text: t("view.collision", collision.wikiPath) });
      for (const vaultPath of collision.vaultPaths) box.createEl("div", { text: vaultPath });
    }

    // Mehrdeutige Dateinamen sperren NICHTS -- sie sind ein Hinweis, kein Fehler:
    // die betroffenen Seiten werden gepusht, nur `[[Dateiname]]` bleibt in ihnen
    // Text statt Link (Entscheidung 2026-08-09). Sie stehen hier, weil genau hier
    // der Ort ist, an dem man sie behebt: Datei umbenennen oder Link auf die
    // Pfadform aendern.
    for (const ambiguous of plan.ambiguousNames) {
      const box = container.createDiv({ cls: "wikijs-ambiguous" });
      box.createEl("strong", { text: t("view.ambiguous", ambiguous.name) });
      box.createEl("div", { text: t("view.ambiguous.hint", ambiguous.name) });
      for (const vaultPath of ambiguous.vaultPaths) box.createEl("div", { text: vaultPath });
    }

    const entries = plan.entries.filter((e) => this.showUnchanged || e.state !== "unchanged");
    if (entries.length === 0) container.createEl("p", { text: t("view.empty") });

    for (const entry of entries) this.renderRow(container, entry, plan, blocked.has(entry.wikiPath));
  }

  private renderRow(container: HTMLElement, entry: SyncEntry, plan: BuiltPlan, isBlocked: boolean): void {
    const row = new Setting(container).setName(entry.wikiPath).setDesc(t(statusLabelKey(entry.state)));
    if (isBlocked) {
      row.setDesc(t("status.collision"));
      return;
    }
    if (PUSHABLE.has(entry.state)) {
      const meta = plan.meta.get(entry.wikiPath);
      if (meta !== undefined) {
        row.addButton((b) =>
          b.setButtonText(t("view.push")).onClick(async () => {
            await this.service().pushOne(entry, meta);
            await this.refresh();
          }),
        );
      }
    }
    if (PULLABLE.has(entry.state)) {
      row.addButton((b) =>
        b.setButtonText(t("view.pull")).onClick(async () => {
          await this.service().pullOne(entry);
          await this.refresh();
        }),
      );
    }
  }
}
```

Dazu in `styles.css` (nur Theme-Variablen):

```css
.wikijs-collision {
  border-left: 3px solid var(--text-error);
  padding: var(--size-2-2) var(--size-4-2);
  margin-bottom: var(--size-4-2);
}
/* Hinweis, kein Fehler -- deshalb die Warn-Farbe, nicht die Fehler-Farbe. */
.wikijs-ambiguous {
  border-left: 3px solid var(--text-warning);
  padding: var(--size-2-2) var(--size-4-2);
  margin-bottom: var(--size-4-2);
}
```

Neue i18n-Schlüssel in **beiden** Sprachen: `view.title`, `view.refresh`,
`view.showUnchanged`, `view.collision`, `view.empty`, `view.push`, `view.pull`,
`status.collision`, `view.ambiguous`, `view.ambiguous.hint`.
Vorschlag für die zwei neuen (EN kanonisch): `view.ambiguous` = `"Ambiguous note name: {0}"` /
`"Mehrdeutiger Notizname: {0}"`; `view.ambiguous.hint` = `"[[{0}]] stays plain text — rename one file or link by path."` /
`"[[{0}]] bleibt Text — eine der Dateien umbenennen oder den Link über den Pfad setzen."`

- [ ] **Step 5: Test laufen lassen, Gate, Commit**

```bash
npx vitest run tests/status_labels.test.ts
npm run gate
git add src/core/sync-plan.ts src/obsidian/status-view.ts src/main.ts src/i18n/strings.ts styles.css tests/status_labels.test.ts
git commit -m "feat(ui): Sync-Status-Ansicht mit vollstaendig beschrifteten Zustaenden"
```

---

### Task 16: Sammel-Push und Depublizieren

**Files:**
- Modify: `src/obsidian/sync-service.ts` (`pushAll`, `handleRemovedLocally`)
- Modify: `src/main.ts` (Command „Alle Änderungen pushen")
- Modify: `src/i18n/strings.ts`
- Test: `tests/sync_push_all.test.ts`

**Interfaces:**
- Produces:
  - `interface SyncReport { created: number; updated: number; blocked: number; skipped: number; unresolvedLinks: number; skippedEmbeds: number; errors: { wikiPath: string; message: string }[] }`
  - `SyncService.pushAll(plan: BuiltPlan): Promise<SyncReport>`
  - `SyncDeps` bekommt `askRemoval?: (wikiPath: string) => Promise<"unpublish" | "delete" | "keep">`

**Semantik (Spec § 3):** Für `removed-locally` fragt das Plugin nach; **Default ist
depublizieren**, nicht löschen. Ein Fehler bei einer Seite bricht den Lauf **nicht**
ab, sondern landet im Report.

**Warum hier nicht das Kit-`confirm` genügt:** dessen Fassade ist zweiwertig
(`Promise<boolean>`), die Frage hier ist dreiwertig (depublizieren / löschen /
behalten). Eine Kaskade aus zwei Ja-Nein-Dialogen wäre die schlechtere Oberfläche —
also ein eigenes Modal, das aber die zwei load-bearing Details des Kit-Musters
übernimmt: Callback vor dem Auflösen nullen, `onClose` → sicherer Ausgang.

- [ ] **Step 1: Failing test schreiben**

```ts
import { describe, expect, it, vi } from "vitest";
import { SyncService } from "../src/obsidian/sync-service";
import type { BuiltPlan } from "../src/obsidian/sync-service";
import type { TransformResult } from "../src/core/transform";

const meta = (over: Partial<TransformResult> = {}): TransformResult => ({
  content: "neu", title: "T", description: "", tags: [], unresolved: [], skippedEmbeds: [], ...over,
});

function plan(entries: BuiltPlan["entries"], metaEntries: [string, TransformResult][]): BuiltPlan {
  return { entries, meta: new Map(metaEntries), collisions: [] };
}

describe("SyncService.pushAll", () => {
  it("zaehlt Anlegen, Aktualisieren und Uebersprungenes getrennt", async () => {
    const client = {
      createPage: vi.fn(() => Promise.resolve({ id: 1, updatedAt: "T2" })),
      updatePage: vi.fn(() => Promise.resolve({ updatedAt: "T2" })),
      fetchUpdatedAt: vi.fn(() => Promise.resolve("T1")),
    };
    const svc = new SyncService({ client: client as never, store: { save: vi.fn(() => Promise.resolve()) } as never, vault: {} as never, syncRoot: () => "_published" });
    const report = await svc.pushAll(plan(
      [
        { wikiPath: "a", state: "create", local: { vaultPath: "x", wikiPath: "a", raw: "r", transformed: "neu" } },
        { wikiPath: "b", state: "update", pageId: 2, local: { vaultPath: "y", wikiPath: "b", raw: "r", transformed: "neu" }, snapshot: { version: 1, wikiPath: "b", pageId: 2, raw: "alt", pushed: "alt", remoteUpdatedAt: "T1" } },
        { wikiPath: "c", state: "unchanged" },
      ],
      [["a", meta()], ["b", meta()], ["c", meta()]],
    ));
    expect(report).toMatchObject({ created: 1, updated: 1, skipped: 1, blocked: 0 });
  });

  it("laeuft nach einem Fehler weiter und sammelt ihn im Report", async () => {
    const client = {
      createPage: vi.fn(() => Promise.reject(new Error("boom"))),
      updatePage: vi.fn(() => Promise.resolve({ updatedAt: "T2" })),
      fetchUpdatedAt: vi.fn(() => Promise.resolve("T1")),
    };
    const svc = new SyncService({ client: client as never, store: { save: vi.fn(() => Promise.resolve()) } as never, vault: {} as never, syncRoot: () => "_published" });
    const report = await svc.pushAll(plan(
      [
        { wikiPath: "a", state: "create", local: { vaultPath: "x", wikiPath: "a", raw: "r", transformed: "neu" } },
        { wikiPath: "b", state: "update", pageId: 2, local: { vaultPath: "y", wikiPath: "b", raw: "r", transformed: "neu" }, snapshot: { version: 1, wikiPath: "b", pageId: 2, raw: "alt", pushed: "alt", remoteUpdatedAt: "T1" } },
      ],
      [["a", meta()], ["b", meta()]],
    ));
    expect(report.errors).toEqual([{ wikiPath: "a", message: "boom" }]);
    expect(report.updated).toBe(1);
  });

  it("summiert die Link-Befunde ueber alle gepushten Seiten", async () => {
    const client = { createPage: vi.fn(() => Promise.resolve({ id: 1, updatedAt: "T2" })), updatePage: vi.fn(), fetchUpdatedAt: vi.fn() };
    const svc = new SyncService({ client: client as never, store: { save: vi.fn(() => Promise.resolve()) } as never, vault: {} as never, syncRoot: () => "_published" });
    const report = await svc.pushAll(plan(
      [{ wikiPath: "a", state: "create", local: { vaultPath: "x", wikiPath: "a", raw: "r", transformed: "neu" } }],
      [["a", meta({ unresolved: ["X", "Y"], skippedEmbeds: ["bild.png"] })]],
    ));
    expect(report.unresolvedLinks).toBe(2);
    expect(report.skippedEmbeds).toBe(1);
  });

  it("depubliziert eine lokal entfernte Seite, wenn der Nutzer den Default waehlt", async () => {
    const client = { unpublishPage: vi.fn(() => Promise.resolve()), deletePage: vi.fn(), createPage: vi.fn(), updatePage: vi.fn(), fetchUpdatedAt: vi.fn() };
    const store = { save: vi.fn(() => Promise.resolve()), remove: vi.fn(() => Promise.resolve()) };
    const svc = new SyncService({
      client: client as never, store: store as never, vault: {} as never, syncRoot: () => "_published",
      askRemoval: vi.fn(() => Promise.resolve("unpublish" as const)),
    });
    await svc.pushAll(plan(
      [{ wikiPath: "a", state: "removed-locally", pageId: 3, snapshot: { version: 1, wikiPath: "a", pageId: 3, raw: "r", pushed: "p", remoteUpdatedAt: "T1" }, remote: { id: 3, path: "a", title: "A", updatedAt: "T1" } }],
      [],
    ));
    expect(client.unpublishPage).toHaveBeenCalledWith(3);
    expect(client.deletePage).not.toHaveBeenCalled();
    expect(store.remove).toHaveBeenCalledWith("a");
  });

  it("fasst eine lokal entfernte Seite nicht an, wenn kein Aufloeser gestellt ist", async () => {
    const client = { unpublishPage: vi.fn(), deletePage: vi.fn(), createPage: vi.fn(), updatePage: vi.fn(), fetchUpdatedAt: vi.fn() };
    const svc = new SyncService({ client: client as never, store: { save: vi.fn(), remove: vi.fn() } as never, vault: {} as never, syncRoot: () => "_published" });
    await svc.pushAll(plan([{ wikiPath: "a", state: "removed-locally", pageId: 3 }], []));
    expect(client.unpublishPage).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `npx vitest run tests/sync_push_all.test.ts`
Expected: FAIL — `pushAll` existiert nicht.

- [ ] **Step 3: Implementierung**

```ts
export interface SyncReport {
  created: number;
  updated: number;
  blocked: number;
  skipped: number;
  unresolvedLinks: number;
  skippedEmbeds: number;
  errors: { wikiPath: string; message: string }[];
}

/** Sequenziell, nicht parallel: eine private Instanz auf einem kleinen VPS soll
 *  nicht von 200 gleichzeitigen Mutations getroffen werden, und die Reihenfolge
 *  macht den Report lesbar. Ein Fehler beendet den Lauf NICHT — sonst haengt der
 *  Bestand nach der ersten kaputten Seite auf halbem Weg. */
async pushAll(plan: BuiltPlan): Promise<SyncReport> {
  const report: SyncReport = { created: 0, updated: 0, blocked: 0, skipped: 0, unresolvedLinks: 0, skippedEmbeds: 0, errors: [] };
  for (const entry of plan.entries) {
    if (entry.state === "removed-locally") {
      await this.handleRemovedLocally(entry, report);
      continue;
    }
    const meta = plan.meta.get(entry.wikiPath);
    if (meta === undefined) { report.skipped++; continue; }
    try {
      const outcome = await this.pushOne(entry, meta);
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
 *  ihre Historie bleibt. Loeschen ist unumkehrbar und deshalb nie die Vorauswahl. */
private async handleRemovedLocally(entry: SyncEntry, report: SyncReport): Promise<void> {
  const pageId = entry.pageId;
  if (pageId === undefined || this.deps.askRemoval === undefined) { report.skipped++; return; }
  const choice = await this.deps.askRemoval(entry.wikiPath);
  if (choice === "keep") { report.skipped++; return; }
  try {
    if (choice === "unpublish") await this.deps.client.unpublishPage(pageId);
    else await this.deps.client.deletePage(pageId);
    await this.deps.store.remove(entry.wikiPath);
    report.updated++;
  } catch (err) {
    report.errors.push({ wikiPath: entry.wikiPath, message: err instanceof Error ? err.message : String(err) });
  }
}
```

`askRemoval` wird in `main.ts` als Modal mit drei Knöpfen gestellt (Default-CTA =
„Depublizieren"); Esc entspricht `keep`.

- [ ] **Step 4: `askRemoval` und den Command verdrahten**

`src/obsidian/removal-modal.ts`:

```ts
import { App, Modal, Setting } from "obsidian";
import { t } from "../vendor/kit/i18n";

export type RemovalChoice = "unpublish" | "delete" | "keep";

class RemovalModal extends Modal {
  private done: ((choice: RemovalChoice) => void) | null;

  constructor(app: App, private readonly wikiPath: string, done: (choice: RemovalChoice) => void) {
    super(app);
    this.done = done;
  }

  private finish(choice: RemovalChoice): void {
    const done = this.done;
    this.done = null;
    this.close();
    done?.(choice);
  }

  onOpen(): void {
    this.titleEl.setText(t("removal.title"));
    this.contentEl.createEl("p", { text: t("removal.body", this.wikiPath) });
    new Setting(this.contentEl)
      // Depublizieren ist CTA: umkehrbar. Loeschen ist es nicht und bleibt unbetont.
      .addButton((b) => b.setButtonText(t("removal.unpublish")).setCta().onClick(() => this.finish("unpublish")))
      .addButton((b) => b.setButtonText(t("removal.delete")).onClick(() => this.finish("delete")))
      .addButton((b) => b.setButtonText(t("removal.keep")).onClick(() => this.finish("keep")));
  }

  onClose(): void {
    this.contentEl.empty();
    this.finish("keep"); // Esc darf nie etwas depublizieren
  }
}

export function askRemoval(app: App, wikiPath: string): Promise<RemovalChoice> {
  return new Promise((resolve) => new RemovalModal(app, wikiPath, resolve).open());
}
```

Command in `main.ts`:

```ts
this.addCommand({
  id: "push-all-changes",
  name: t("command.pushAll"),
  callback: () => void this.pushAll(),
});
```

```ts
private async pushAll(): Promise<void> {
  try {
    const service = this.buildService();
    const plan = await service.buildPlan();
    const report = await service.pushAll(plan);
    const lines = [t("report.head", report.created, report.updated, report.blocked)];
    if (report.unresolvedLinks > 0) lines.push(t("report.unresolved", report.unresolvedLinks));
    if (report.skippedEmbeds > 0) lines.push(t("report.embeds", report.skippedEmbeds));
    if (report.errors.length > 0) lines.push(t("report.errors", report.errors.length));
    new Notice(lines.join("\n"));
  } catch (err) {
    new Notice(t("notice.error", err instanceof Error ? err.message : String(err)));
  }
}
```

- [ ] **Step 5: Test laufen lassen, Gate, Commit**

```bash
npx vitest run tests/sync_push_all.test.ts
npm run gate
git add src/obsidian/sync-service.ts src/main.ts src/i18n/strings.ts tests/sync_push_all.test.ts
git commit -m "feat(sync): Sammel-Push mit Report, Depublizieren als Default beim Entfernen"
```

---

### Task 17: Doku, Smoke-Checkliste, Registry-Eintrag

**Files:**
- Modify: `README.md`, `AGENTS.md`, `CHANGELOG.md`
- Create: `docs/SMOKE.md`
- Modify: `../REGISTRY.md` (Dach-Repo!)

- [ ] **Step 1: README auf den erreichten Stand bringen**

Den „work in progress"-Block ersetzen: Installation, Erst-Einrichtung (URL, API-Key
aus einer Gruppe mit Schreibrecht auf Seiten, Sync-Ordner), die vier Commands, und
ausdrücklich die Grenzen des MVP (keine Bilder, kein Merge — und was stattdessen
passiert: Konflikt-Dialog).

- [ ] **Step 2: `docs/SMOKE.md` schreiben**

Die Prüfpunkte, die kein Unit-Test abdeckt, gegen ein echtes Obsidian **und** eine
echte Instanz — je Zeile eine abhakbare Beobachtung:

1. Neue Notiz in `_published/` anlegen → „Aktuelle Notiz pushen" → Seite erscheint unter dem erwarteten Pfad, Titel korrekt.
2. Notiz ändern → erneut pushen → Wiki zeigt die Änderung, kein Duplikat.
3. Seite **im Wiki** ändern, dann lokal ändern → Push → Konflikt-Dialog erscheint mit Diff; „Abbrechen" lässt das Wiki unverändert.
4. Derselbe Fall, „Lokale Fassung" → Wiki übernimmt lokal.
5. Seite im Wiki ändern, lokal nicht → Status zeigt „Remote geändert" → Pull → Vault-Datei trägt den Wiki-Text.
6. Notiz aus `_published/` herausziehen → Sammel-Push → Nachfrage erscheint, Default depubliziert, Seite ist im Wiki nicht mehr sichtbar.
7. Zwei Notizen mit kollidierendem Slug → Status zeigt die Kollision, Push ist gesperrt.
8. Wiki abschalten → Push → verständliche Fehlermeldung binnen Zeitlimit, kein Freeze.
9. Falscher API-Key → Meldung nennt Authentifizierung, nicht „unbekannter Fehler".
10. Obsidian-Sprache auf Englisch → alle sichtbaren Texte sind englisch.

- [ ] **Step 3: Registry-Eintrag im Dach**

Kit-first-Regel Punkt 2. In `../REGISTRY.md` unter einer passenden Rubrik ergänzen —
mindestens diese zwei Zeilen, weil beide über dieses Plugin hinaus wiederverwendbar
sind:

- **Snapshot-basierter Ein-Weg-Sync mit Drift-Guard** → `wikijs-maintainer/src/core/sync-plan.ts` (+ `snapshot.ts`) · Status: `n=1, beobachten`
- **GraphQL über `requestUrl` mit Timeout und normalisierten Fehlern** → `wikijs-maintainer/src/wikijs/client.ts` · Status: `n=1, beobachten`

Ist das Lab-Skript aus Task 1 gebaut, außerdem die bestehende Zeile
„System-Prompt-Iterations-Lab" auf **n=4** heben und `scripts/wikijs-lab.ts` als
Exemplar nennen — mit dem Vermerk, dass es sich vom LLM-Lab unterscheidet: hier wird
ein **API-Schema** gemessen, keine Modell-Antwortqualität.

- [ ] **Step 4: CHANGELOG und Version**

`## [0.1.0]` mit den umgesetzten Punkten anlegen. **Kein `npm run release`** in
diesem Zug — der Erst-Release läuft über den Skill `plugin-release-setup` (Remotes,
Forgejo + GitHub-Mirror) und die Store-Einreichung über das Developer Dashboard;
beides braucht Johannes' Accounts.

- [ ] **Step 5: Gate und Commit**

```bash
npm run gate
git add README.md AGENTS.md CHANGELOG.md docs/SMOKE.md
git commit -m "docs: Bedienung, Smoke-Checkliste und Grenzen des MVP"
```

---

## Nach dem Plan

1. **GUI-Smoke gegen ein laufendes Obsidian** — `docs/SMOKE.md` ist die Vorlage; automatisiert wird das über den Skill `gui-smoke-setup` (CDP-Treiber), sobald die Punkte von Hand einmal durchlaufen sind.
2. **Erst-Release + Store** — Skill `plugin-release-setup`, dann Developer Dashboard auf `community.obsidian.md`. Der Tag ist nicht das Ende: der Review muss dort per Rescan angestoßen werden.
3. **V2** — Bilder/Assets samt Upload und Pfad-Umschreibung.
4. **V3** — Drei-Wege-Merge auf Snapshot-Basis. Die Datenlage dafür steht ab Task 7; es kommt eine Merge-Funktion in `core/` und eine Konflikt-UI dazu, kein Umbau.
