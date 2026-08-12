# Changelog

Alle nennenswerten Änderungen an diesem Plugin. Format: [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
Versionierung nach [SemVer](https://semver.org/lang/de/).

## [Unreleased]

## [0.1.1] — 2026-08-12

## [0.1.0] — 2026-08-12

### Added
- Ein-Weg-Sync (Push/Pull) eines Vault-Ordners gegen eine Wiki.js-2.x-Instanz
  über GraphQL, snapshot-basiert (`src/core/sync-plan.ts` + `snapshot.ts`):
  Vault-Pfad ↔ Wiki-Pfad per deterministischer Slugifizierung, Drift-Guard
  unmittelbar vor jedem Schreiben (`updatedAt`-Vergleich als String).
- Vier Commands: „Sync-Status anzeigen", „Aktuelle Notiz pushen", „Alle
  Änderungen pushen", „Aktuelle Notiz vom Wiki pullen".
- Status-Ansicht mit Push-/Pull-Knöpfen je Zeile; Warnblöcke für
  Slug-Kollisionen (sperrt den Push für die betroffenen Seiten) und für
  mehrdeutige Notiznamen (sperrt nichts — `[[Name]]` bleibt dort Text statt
  Link).
- Konflikt-Dialog mit Zeilen-Diff (lokal vs. Wiki), auch wenn die Wiki-Seite
  zwischenzeitlich auf den alten Stand zurückgesetzt wurde. Kein Merge im
  MVP — die Entscheidung liegt beim Nutzer (lokal behalten / abbrechen; „Wiki
  behalten" bricht den Push nur ab, holt die Wiki-Fassung aber **nicht** in
  den Vault — ein Konflikt-Eintrag ist nicht pull-fähig, s. Grenzen unten).
- Entfernen-Dialog beim Herausnehmen einer Notiz aus dem Sync-Ordner:
  Depublizieren (Default) / Löschen / Behalten; Esc bedeutet immer Behalten.
- Sammel-Push läuft sequenziell und sammelt Fehler statt beim ersten
  Fehlschlag abzubrechen; der Report zählt Angelegt/Aktualisiert/Blockiert/
  Fehler.
- Obsidian-Markdown → Wiki.js-Markdown: Wikilinks → Wiki-Links, Callouts →
  Wiki.js-Blockquote-Klassen (`is-info`/`is-success`/`is-warning`/
  `is-danger`).
- GraphQL-Client über `requestUrl` mit Timeout und normalisierten Fehlern
  (`src/wikijs/client.ts`); Schema gegen eine laufende Instanz gemessen statt
  aus der Doku abgeleitet (`docs/LAB.md`, Werkzeug `npm run lab:wikijs`).
- Vollständige i18n (DE/EN, EN kanonisch).
- 158 Tests, Gate grün (`lint`, `typecheck`, `typecheck:scripts`, `test`,
  `check:pure`, `build`).

### Limits (bewusst nicht im MVP)
- Bilder/Assets werden nicht synchronisiert (V2).
- Kein Drei-Wege-Merge bei Konflikten (V3) — die Snapshot-Struktur ist bereits
  die Basis dafür.
- Kein automatischer Pull aus einem Konflikt heraus: solange eine Seite
  sowohl lokal als auch im Wiki geändert ist, gibt es keinen Weg, die
  Wiki-Fassung per Knopfdruck in den Vault zu holen — nur „Neu im Wiki" und
  „Im Wiki geändert" sind pull-fähig. Wer die Wiki-Fassung will, kopiert sie
  aus dem Diff im Konflikt-Dialog oder gleicht die lokale Datei von Hand an,
  bis der Konflikt aufgelöst ist.

### Verifiziert

- Gegen eine echte Wiki.js-2.x-Instanz und ein laufendes Obsidian geprüft, nicht nur
  gegen Attrappen: `docs/SMOKE.md` (sieben Punkte automatisiert über
  `npm run smoke:gui`, der Rest Handarbeit). Der erste Lauf fand drei Fehler, die
  194 grüne Unit-Tests nicht sehen konnten — alle vor diesem Release behoben.
- Das GraphQL-Schema ist gemessen, nicht aus der Dokumentation abgeleitet
  (`docs/LAB.md`) — samt der zwei Stellen, an denen Wiki.js' Laufzeitverhalten von
  der eigenen Schema-Deklaration abweicht (`content` und `tags` sind bei
  `pages.update` als optional deklariert, aber Pflicht).
