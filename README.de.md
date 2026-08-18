# Wiki.js Maintainer

> [🇬🇧 English](https://github.com/johannes-kaindl/wikijs-maintainer/blob/main/README.md) · 🇩🇪 Deutsch

Obsidian-Plugin, das Notizen aus **einem** Ordner deines Vaults über die
GraphQL-API in eine [Wiki.js](https://js.wiki/)-2.x-Instanz veröffentlicht und
mit ihr abgleicht.

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Docs: CC BY-SA 4.0](https://img.shields.io/badge/docs-CC%20BY--SA%204.0-lightgrey.svg)](LICENSE-DOCS)
[![Release](https://img.shields.io/gitea/v/release/jkaindl/wikijs-maintainer?gitea_url=https%3A%2F%2Fgit.jkaindl.de&label=release)](https://git.jkaindl.de/jkaindl/wikijs-maintainer/releases)
![Platform](https://img.shields.io/badge/platform-Obsidian-lightgrey)

<p align="center"><img src="https://git.jkaindl.de/jkaindl/wikijs-maintainer/raw/branch/main/docs/images/overview.png" width="820" alt="Die Sync-Status-Ansicht mit Zeilen in den Zuständen Neu, Lokal geändert, Konflikt und Belegt, darüber eine Slug-Kollisionswarnung und ein Hinweis auf einen mehrdeutigen Notiznamen"></p>

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

In Obsidian: **Einstellungen → Community-Plugins → Durchsuchen**, nach
„Wiki.js Maintainer" suchen. (Gelistet seit 2026-08-12.)

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

<img src="https://git.jkaindl.de/jkaindl/wikijs-maintainer/raw/branch/main/docs/images/settings.png" width="820" alt="Der Einstellungs-Tab des Plugins: Wiki-URL, API-Schlüssel, Sync-Ordner, Wiki-Sprache und Zeitlimit">

## Verwendung

Vier Befehle, alle über die Befehlspalette:

- **Sync-Status anzeigen** — listet jede Seite unter der Sync-Wurzel als neu,
  geändert, konfliktär, entfernt oder unverändert. Nicht jede Zeile hat einen Knopf:
  **Push** bei „Neu", „Lokal geändert" und „Konflikt"; **Pull** bei „Im Wiki geändert"
  und „Neu im Wiki". Die übrigen Zustände („Belegt", „Lokal entfernt", „Im Wiki
  entfernt", „Veralteter Snapshot", „Unverändert") zeigen nur den Status — es gibt
  nichts zu pushen oder zu pullen, oder (bei „Lokal entfernt") die Aktion braucht den
  Bestätigungsdialog, den nur ein Sammel-Push zeigt. Kollisionen und mehrdeutige
  Notiznamen stehen über der Liste (siehe unten).
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

<img src="https://git.jkaindl.de/jkaindl/wikijs-maintainer/raw/branch/main/docs/images/conflict-modal.png" width="820" alt="Der Konflikt-Dialog: ein Zeilen-Diff zwischen Wiki- und lokaler Fassung, mit den Knöpfen Lokal behalten, Wiki behalten und Abbrechen">

- **Slug-Kollisionen** sperren den Push für beide beteiligten Notizen, bis eine
  umbenannt ist.
- **Mehrdeutige Notiznamen** sperren nichts: die Seiten werden gepusht, nur bleibt
  `[[Name]]` in ihnen reiner Text statt eines Links. Die Status-Ansicht weist darauf hin.
- **Eine Notiz aus dem Sync-Ordner zu ziehen** löscht die Wiki-Seite nicht von selbst.
  Der Sammel-Push fragt und schlägt **Depublizieren** vor; Esc bedeutet immer
  „behalten" — nie depublizieren oder löschen.

<img src="https://git.jkaindl.de/jkaindl/wikijs-maintainer/raw/branch/main/docs/images/removal-modal.png" width="820" alt="Der Entfernen-Dialog nach einem Sammel-Push: Depublizieren, Löschen und Behalten, mit Depublizieren als hervorgehobener empfohlener Aktion">

- **Die Markdown-Umwandlung ist einweg.** Das Plugin bewahrt deshalb den Rohtext und
  die gepushte Fassung als getrennte Snapshots, damit ein späterer Merge beide hat.

## Grenzen dieses MVP

- **Nur Text.** Bilder und Anhänge werden nicht mitgesynct — für eine spätere Version
  geplant (Asset-Upload + Pfad-Umschreibung).
- **Kein Merge.** Widersprüchliche Änderungen werden nie automatisch zusammengeführt;
  du löst sie immer von Hand über den Konflikt-Dialog. Ein echter Drei-Wege-Merge auf
  Basis der vorhandenen Snapshots ist für eine spätere Version geplant.
- **Kein automatischer Weg aus einem Konflikt heraus.** Solange eine Seite sowohl
  lokal als auch im Wiki geändert ist, gibt es keinen Knopf, der die Wiki-Fassung in
  den Vault holt — ein Konflikt-Eintrag ist nicht pull-fähig (nur „Neu im Wiki" und
  „Im Wiki geändert" sind es). „Wiki behalten" im Konflikt-Dialog bricht nur den Push
  ab; es schreibt nichts. Wer den Wiki-Text will, kopiert ihn aus dem Diff im Dialog
  oder gleicht die lokale Notiz von Hand an — sobald sie übereinstimmt, ist es kein
  Konflikt mehr.
- **Im Wiki entfernt.** Wird eine Seite direkt im Wiki gelöscht (z. B. über die
  Wiki.js-Administration), während die Notiz lokal noch existiert, zeigt die
  Status-Ansicht „Im Wiki entfernt" und bietet keinen Push dafür an. Eine gelöschte
  Seite aus der lokalen Notiz neu anzulegen wird noch nicht unterstützt — für eine
  spätere Version geplant. Auch der Snapshot dieser Seite räumt sich nicht von selbst
  auf (siehe „Veralteter Snapshot" unten); am Vault ändert das nichts.
- **„Belegt" löst sich nur auf, wenn die Seite nachweislich deine ist.** Eine Seite
  zeigt „Belegt", wenn eine lokale Notiz und eine Wiki-Seite auf denselben Wiki-Pfad
  fallen, ohne dass ein Snapshot beide verbindet. Die Status-Ansicht bietet **Seite
  übernehmen** an: das holt die Wiki-Seite und schreibt — *nur* wenn ihr Inhalt
  Zeichen für Zeichen mit deiner Notiz übereinstimmt — den fehlenden Snapshot, danach
  synct die Seite normal weiter. Das deckt den Weg ab, auf dem dieser Zustand
  tatsächlich entsteht: das Anlegen der Seite gelang, das Schreiben des Snapshots
  danach schlug fehl. Weicht der Inhalt ab, ist es eine andere Seite und nichts wird
  übernommen; das wird gemeldet, und die Korrektur bleibt manuell (Notiz umbenennen
  oder die Seite im Wiki entfernen). Übernehmen schreibt nie ins Wiki.
- **Veraltete Snapshots werden auf Wunsch verworfen, nicht automatisch.** Existieren
  weder die lokale Notiz noch die Wiki-Seite, auf die ein Snapshot zeigte, bietet die
  Status-Ansicht für diese Zeile **Snapshot verwerfen** an. Verworfen wird nichts von
  selbst — ein Snapshot ist die Grundlage jedes späteren Drift-Checks, ihn zu
  entfernen bleibt deine Entscheidung.

Ausführlich: [`docs/OPEN-POINTS.md`](docs/OPEN-POINTS.md).

## Dokumentation

- [`docs/SMOKE.md`](docs/SMOKE.md) — die Prüfliste, gegen die das Plugin verifiziert
  ist; elf Punkte davon automatisiert (`npm run smoke:gui`)
- [`docs/LAB.md`](docs/LAB.md) — das GraphQL-Schema, **gegen eine laufende Instanz
  gemessen**, samt der zwei Stellen, an denen das Verhalten von der Deklaration abweicht
- [`docs/OPEN-POINTS.md`](docs/OPEN-POINTS.md) — bekannte Grenzen und bewusst
  zurückgestellte Befunde
- [`AGENTS.md`](AGENTS.md) — Architektur und die Entscheidungen dahinter
- [`CONTRIBUTING.md`](CONTRIBUTING.md) · [`SECURITY.md`](SECURITY.md) ·
  [`CHANGELOG.md`](CHANGELOG.md)

## Lizenz

Code: **AGPL-3.0-or-later** ([`LICENSE`](LICENSE)) — Dual-Lizenzierung möglich, siehe
[`LICENSING.md`](LICENSING.md).
Dokumentation und Text: **CC BY-SA 4.0** ([`LICENSE-DOCS`](LICENSE-DOCS)).
