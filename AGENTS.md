# AGENTS — wikijs-maintainer

Obsidian-Plugin, das einen Ordner des Vaults per **GraphQL** mit einer
**Wiki.js-2.x**-Instanz synchronisiert. Eigenständiges Repo nach Dach-Konvention
(PROF-OBS-09).

## Status

**0.1.2 im Community Store, Review bestanden (2026-08-14)** — alle
17 Plan-Tasks umgesetzt: Sync-Kern (`sync-plan`/`snapshot`/`transform`/`links`/
`paths`/`diff`), GraphQL-Client gegen das gemessene Schema (`docs/LAB.md`), die
vier Commands, Status-Ansicht, Konflikt- und Entfernen-Dialog, i18n DE/EN.
235 Tests, Gate grün, **GUI-Smoke 11/11** (`npm run smoke:gui`, Gegenprobe belegt;
zuletzt am 2026-08-18 gefahren). Die vier Sackgassen-Ausgänge (SMOKE-Punkte
12–15, s. u.) sind seit 2026-08-18 automatisiert und laufen mit; die
CDP-Brücke des Treibers importiert seither die zentrale Dach-Fassung
(`tools/obsidian-cdp/`) statt sie inline zu tragen.

Der erste Lauf gegen ein echtes Obsidian und die echte Instanz fand drei Fehler,
die 194 grüne Unit-Tests nicht sehen konnten — alle drei behoben:
1. `pages.update` verlangt `content` und `tags`, obwohl das Schema sie als
   optional führt: **jedes Depublizieren schlug fehl** (`docs/LAB.md` § Nachtrag).
2. Die Abschluss-Meldung des Sammel-Pushs nannte nur die Anzahl der Fehler,
   nicht ihre Ursachen — der Fehler oben war dadurch von außen nicht auffindbar.
3. Der Client stufte abgelehnte Schlüssel korrekt als `auth` ein, aber die
   Oberfläche las die Einstufung nie und zeigte das nackte Wort „Forbidden".
   Eine Klassifikation, die in keiner Meldung ankommt, ist keine.

**Wartungsrunde 0.1.2 (2026-08-14).** Bewusste Entscheidung gegen V2: geschlossen wurde
die Fehlerklasse, die der erste echte Lauf schon dreimal getroffen hatte — das Plugin tut
das Richtige und sagt es niemandem. Drei stille Abbrüche in der Status-Ansicht melden sich;
die Ansicht liest jetzt (wie die Commands seit dem 12.8.) die Fehlereinstufung des Clients;
`occupied` und `stale-snapshot` sind keine Sackgassen mehr; Blockierungsgründe sind
typmäßig erschöpfend (`assertNever`) statt in der zuletzt genannten Meldung zu landen —
genau dieser Weg hatte einen falsch etikettierten Grund erzeugt. 235 Tests (vorher 225).
Der Grund für den Zuschnitt steht in `docs/OPEN-POINTS.md` § „Erledigt in 0.1.2".

Bedienung und Grenzen: `README.md`; Prüfliste gegen echtes Obsidian + echte
Instanz: `docs/SMOKE.md` (elf Punkte automatisch, seit 2026-08-18 auch die
0.1.2-Sackgassen-Ausgänge 12–15 — der Rest bleibt Handarbeit, weil er an
visueller Beurteilung hängt);
CHANGELOG-Abschnitt `[0.1.0]`.
Releases: **0.1.2** (zuvor 0.1.1) auf Forgejo (Quelle) und GitHub (Mirror), beide
öffentlich, Assets vorhanden. Im Community Store gelistet seit 2026-08-12:
`community.obsidian.md/plugins/wikijs-maintainer` — Review beim ersten Anlauf
bestanden, ohne Warnungen. Der lokale Vorlauf war `npm run lint` (das ist
derselbe `eslint-plugin-obsidianmd`, den der Store fährt), zusätzlich einmal
gegen dessen `all`-Konfiguration statt nur `recommended`.

**Für jede weitere Version gilt:** ein neues GitHub-Release wird erfasst, aber
der Review **läuft nicht von selbst an** — er muss im Developer Dashboard als
Rescan angestoßen werden. Fällt er durch, verschwindet das Plugin binnen 24 h
aus der Suche, nicht nur die Version. Für 0.1.2 am 2026-08-14 durchgeführt:
grün, Höchstwertung. Der lokale Vorlauf ist unverändert `npm run lint` — das
ist derselbe `eslint-plugin-obsidianmd`, den der Store fährt.

**0.1.0 gibt es nicht als öffentliches Release:** die Historie wurde vor dem
Öffentlichmachen neu aufgesetzt (der Vorgänger nannte an mehreren Stellen die
private Instanz), und der zugehörige Tag wurde dabei entfernt.
Verbindliche Spec: `2026-08-09-wikijs-gesamt-design.md`, Abschnitte 2
(Plugin-Architektur) und 3 (Sync-Semantik) — sie liegt in einem privaten Repo des
Maintainers. Plan: `docs/superpowers/plans/2026-08-09-wikijs-maintainer-mvp.md`.

Das Plugin ist Teil eines größeren Vorhabens; die zugehörige Wiki.js-Instanz und
ihr Deployment leben in einem eigenen, nicht öffentlichen Repo.

Das gegen die laufende Instanz gemessene GraphQL-Schema (statt aus der Doku
abgeleitet) steht in `docs/LAB.md` — Task 8 (GraphQL-Client) zitiert diese
Datei, nicht die Wiki.js-Online-Doku.

## Verbindlicher Rahmen

Es gilt das Dach-`AGENTS.md` (`../AGENTS.md`, wird automatisch geladen): Kit-first
(`REGISTRY.md` vor jeder Neuentwicklung prüfen), `UI-STANDARD.md` vor UI-Arbeit,
eigener Release-Takt, Release-Infra über Skill `plugin-release-setup`, Test-Setup
über Skill `obsidian-plugin-test-pattern`.

## Tragende Entscheidungen (aus der Spec)

1. **Pure Core / dünne Schale.** Die gesamte Sync-Logik lebt in `src/core/` ohne
   Obsidian-Import — `npm run check:pure` erzwingt das. Obsidian-Schicht macht
   Datei-I/O, Commands, UI.
2. **Snapshot-basiert.** Pro gesyncter Seite eine JSON-Datei im Plugin-Datenordner
   (`snapshots/<hash>.json`); `data.json` bleibt für Settings. Ein defekter
   Snapshot reißt nicht den Bestand mit. Der Snapshot trägt drei Teile: lokaler
   Rohinhalt, gepushte (transformierte) Fassung, Remote-`updatedAt`.
3. **Drift-Guard vor jedem Push.** Leichter `updatedAt`-Query unmittelbar vor dem
   Schreiben; bei Abweichung kein Push, sondern Diff.
4. **Alles im Plugin.** GraphQL über `requestUrl`, keine externen Helfer.
5. **Ein Vault = eine Wiki-Instanz.** Kein Profil-Konzept.
6. **MVP = Text.** Bilder/Assets sind V2, voller Zwei-Wege-Merge ist V3 — die
   Snapshots ab Tag 1 sind genau die Basis dafür.

## Kit-first-Anker

Vendored aus `../obsidian-kit` (verbatim, Re-Sync über `tools/sync-kit.sh`, nie von
Hand editieren): `settings`, `i18n`, `timeout` (pure) sowie `clock`, `confirm`,
`folder-suggest`, `settings_walker` (obsidian) und `testing/obsidian-mock`
(→ `tests/vendor/kit/`).
Katalog-Übernahme mit Herkunftsstempel: `src/core/diff.ts` aus `koda-agent`.
**Bewusst nicht übernommen:** `endpoint_config` — das ist die LLM-Endpunkt-Form;
hier reichen URL + API-Key.

## Commands

- `npm run gate` — voller Gate: `lint` + `typecheck` + `typecheck:scripts` + `test`
  + `check:pure` + `build`. Vor jedem Commit erwartet.
- `npm run dev` — esbuild-Watch-Build.
- `npm test` — `check-no-abs-paths` + vitest.
- `npm run lab:wikijs` — Sondier-Skript gegen eine laufende Wiki.js-Instanz
  (GraphQL-Schema-Gegenprobe; braucht `WIKIJS_URL` + `WIKIJS_TOKEN` in der Umgebung).
- `npm run smoke:gui -- --vault <name>` — GUI-Smoke gegen ein **laufendes**
  Obsidian und die echte Instanz (CORE-TEST-02 b). Voraussetzung ist der eine
  Handgriff, der Handarbeit bleibt: Obsidian mit `--remote-debugging-port=9222`
  neu starten. Der Treiber legt nur Seiten unter `zz-smoke-` an und räumt sie
  samt Snapshots wieder ab. Details und Fallen: `docs/SMOKE.md`, Kopfkommentar
  in `scripts/gui-smoke.ts`.
- `npm run deploy` — Build ins Vault kopieren (`OBSIDIAN_PLUGIN_DIR` setzen).
  **Danach lädt Obsidian das Plugin nicht von selbst neu** — der Smoke-Treiber
  tut das zu Beginn selbst, von Hand geht es über disable/enable.
- `tools/sync-kit.sh` — Kit-Module neu vendorn.

## Struktur

- `src/core/` — rein: `sync-plan.ts` (Zustandsmaschine), `transform.ts`, `links.ts`,
  `paths.ts`, `diff.ts`.
- `src/wikijs/` — `client.ts` (GraphQL über `requestUrl` + `withTimeout`),
  `queries.ts`.
- `src/obsidian/` — Settings-Tab, Status-View, Modals.
- `src/vendor/kit` + `src/vendor/kit-obsidian/` — verbatim vendortes Kit.
- `src/i18n/` — DE/EN-Strings (EN kanonisch, PROF-OBS-07).
