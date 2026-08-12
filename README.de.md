# Wiki.js Maintainer

> [🇬🇧 English](https://github.com/johannes-kaindl/wikijs-maintainer/blob/main/README.md) · 🇩🇪 Deutsch

Obsidian-Plugin, das Notizen aus **einem** Ordner deines Vaults über die
GraphQL-API in eine [Wiki.js](https://js.wiki/)-2.x-Instanz veröffentlicht und
mit ihr abgleicht.

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Docs: CC BY-SA 4.0](https://img.shields.io/badge/docs-CC%20BY--SA%204.0-lightgrey.svg)](LICENSE-DOCS)
[![Release](https://img.shields.io/gitea/v/release/jkaindl/wikijs-maintainer?gitea_url=https%3A%2F%2Fgit.jkaindl.de&label=release)](https://git.jkaindl.de/jkaindl/wikijs-maintainer/releases)
![Platform](https://img.shields.io/badge/platform-Obsidian-lightgrey)

## Features

- **Veröffentlichen durch Verschieben.** Notizen in einem Ordner deines Vaults
  (Standard `_published`) werden zu Wiki-Seiten; die Ordnerstruktur bildet 1:1 den
  Wiki-Pfad. Eine Notiz dorthin zu ziehen *ist* die Entscheidung, sie zu veröffentlichen.
- **Überschreibt nie stillschweigend.** Unmittelbar vor jedem Schreiben prüft das
  Plugin den Änderungszeitstempel der Wiki-Seite. Hat er sich bewegt, bekommst du
  einen Zeilen-Diff und entscheidest — der Push läuft nicht von selbst weiter.
- **Zwei Richtungen, soweit der MVP reicht.** Seiten, die im Wiki geändert oder neu
  angelegt wurden, lassen sich in den Vault ziehen.
- **Obsidian-Markdown wird beim Push übersetzt.** Wikilinks werden zu Wiki-Links,
  Callouts zu Wiki.js-Blockquote-Klassen; Links auf nicht veröffentlichte Notizen
  werden zu reinem Text entschärft, statt ins Leere zu zeigen, und im Bericht gezählt.
- **Eine Notiz zu entfernen fragt nach** — und schlägt Depublizieren vor (umkehrbar)
  statt Löschen.
- **Kollisionen werden gemeldet, nicht hinter deinem Rücken aufgelöst.** Zwei Notizen,
  die auf denselben Wiki-Pfad fallen, sperren sich gegenseitig, bis du eine umbenennst.

## Voraussetzungen

- Obsidian 1.8.7 oder neuer.
- Eine **Wiki.js-2.x**-Instanz, die über HTTPS erreichbar ist.
- Einen API-Schlüssel aus einer Wiki.js-Gruppe mit **Schreibrecht auf Seiten**
  (Administration → Gruppen → API-Zugriff).

## Installation

Noch nicht im Community Store (MVP, ohne Release).

### Von Hand

1. `main.js`, `manifest.json` und `styles.css` nach
   `<vault>/.obsidian/plugins/wikijs-maintainer/` kopieren.
2. **Wiki.js Maintainer** unter Einstellungen → Community-Plugins aktivieren.

### Aus dem Quellcode

```bash
npm install
npm run build
# main.js manifest.json styles.css → <vault>/.obsidian/plugins/wikijs-maintainer/
```

Obsidian hält den zuvor geladenen `main.js` im Speicher — nach dem Kopieren das
Plugin aus- und wieder einschalten (oder Obsidian neu starten).

## Konfiguration

Im Einstellungs-Tab des Plugins eintragen:

- **Wiki-URL** — Basis-URL deiner Instanz, ohne `/graphql`.
- **API-Schlüssel** — Token einer Gruppe mit Schreibrecht auf Seiten. Ein Schlüssel
  ohne dieses Recht lässt jeden Push mit einer Authentifizierungsmeldung scheitern,
  nicht still ins Leere laufen.
- **Sync-Ordner** — der Vault-Ordner, dessen Notizen veröffentlicht werden
  (Standard `_published`). `_published/Netzwerk/DNS-Setup.md` wird zu `netzwerk/dns-setup`.
- **Wiki-Sprache** — Locale der Seiten, die das Plugin anlegt (Standard `de`).
  Sie muss in deiner Instanz **installiert** sein, sonst lehnt Wiki.js das Anlegen ab.
- **Zeitlimit** — Sekunden pro Anfrage (5–120, Standard 30).

## Verwendung

Vier Befehle, alle über die Befehlspalette:

- **Sync-Status anzeigen** — listet jede Seite unter der Sync-Wurzel als neu,
  geändert, konfliktär, entfernt oder unverändert. Nicht jede Zeile hat einen Knopf:
  **Push** bei „Neu", „Lokal geändert" und „Konflikt"; **Pull** bei „Im Wiki geändert"
  und „Neu im Wiki". Kollisionen und mehrdeutige Notiznamen stehen über der Liste.
- **Aktuelle Notiz pushen** — veröffentlicht oder aktualisiert die aktive Notiz.
- **Alle Änderungen pushen** — fährt den vollen Plan. Eine fehlgeschlagene Seite
  beendet den Lauf nicht; die Fehler stehen mit Ursache in der Abschlussmeldung.
- **Aktuelle Notiz vom Wiki holen** — zieht den Wiki-Stand in den Vault, wenn die
  Seite dort geändert wurde.

## Funktionsweise

- **Ein Vault-Ordner gehört zu einem Wiki**, 1:1 über den Pfad. Kein Profil-Konzept.
- **Drift-Guard.** Vor jedem Schreiben wird der Zeitstempel der Wiki-Seite neu geholt.
  Weicht er ab — auch wenn die Seite zwischenzeitlich auf einen älteren Stand
  zurückgesetzt wurde — öffnet sich der **Konflikt-Dialog** mit einem Zeilen-Diff.
  Du wählst „Lokal behalten" (überschreiben), „Wiki behalten" (Push abbrechen, das
  Wiki bleibt unberührt — es wird dabei **nichts** geholt) oder „Abbrechen".
- **Slug-Kollisionen** sperren den Push für beide beteiligten Notizen, bis eine
  umbenannt ist.
- **Mehrdeutige Notiznamen** sperren nichts: die Seiten werden gepusht, nur bleibt
  `[[Name]]` in ihnen reiner Text statt eines Links. Die Status-Ansicht weist darauf hin.
- **Eine Notiz aus dem Sync-Ordner zu ziehen** löscht die Wiki-Seite nicht von selbst.
  Der Sammel-Push fragt und schlägt **Depublizieren** vor; Esc bedeutet immer
  „behalten" — nie depublizieren oder löschen.
- **Die Markdown-Umwandlung ist einweg.** Das Plugin bewahrt deshalb den Rohtext und
  die gepushte Fassung als getrennte Snapshots, damit ein späterer Merge beide hat.

## Grenzen dieses MVP

- **Nur Text.** Bilder und Anhänge werden nicht mitgesynct (für eine spätere Version geplant).
- **Kein Merge.** Konflikte werden nie automatisch zusammengeführt.
- **Kein automatischer Weg aus einem Konflikt heraus.** Solange beide Seiten geändert
  sind, gibt es keinen Knopf, der die Wiki-Fassung in den Vault holt. „Wiki behalten"
  bricht nur den Push ab. Wer den Wiki-Text will, kopiert ihn aus dem Diff im Dialog.
- **Im Wiki gelöschte Seiten** lassen sich nicht aus der lokalen Notiz neu anlegen.
- **„Belegt" hat keinen Auflösungsweg** — dann eine der beiden Seiten umbenennen.
- **Verwaiste Snapshots werden nicht aufgeräumt.**

Ausführlich: [`docs/OPEN-POINTS.md`](docs/OPEN-POINTS.md).

## Dokumentation

- [`docs/SMOKE.md`](docs/SMOKE.md) — die Prüfliste, gegen die das Plugin verifiziert
  ist; sieben Punkte davon automatisiert (`npm run smoke:gui`)
- [`docs/LAB.md`](docs/LAB.md) — das GraphQL-Schema, **gegen eine laufende Instanz
  gemessen**, samt der zwei Stellen, an denen das Verhalten von der Deklaration abweicht
- [`AGENTS.md`](AGENTS.md) — Architektur und die Entscheidungen dahinter

## Lizenz

Code: **AGPL-3.0-or-later** ([`LICENSE`](LICENSE)) — Dual-Lizenzierung möglich, siehe
[`LICENSING.md`](LICENSING.md).
Dokumentation und Text: **CC BY-SA 4.0** ([`LICENSE-DOCS`](LICENSE-DOCS)).
