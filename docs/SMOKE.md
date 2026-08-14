# SMOKE — Prüfliste gegen echtes Obsidian + echtes Wiki.js

> [!tip] Sieben dieser Punkte laufen automatisch
> `npm run smoke:gui -- --vault <name>` fährt sie gegen ein laufendes Obsidian und
> die konfigurierte Instanz. Voraussetzung ist der eine Handgriff, der Handarbeit
> bleibt — Obsidian mit offenem Debug-Port starten:
>
> ```bash
> osascript -e 'quit app "Obsidian"'
> open -a Obsidian --args --remote-debugging-port=9222
> ```
>
> Der Treiber legt ausschließlich Seiten unter `zz-smoke-` an und räumt sie samt
> ihrer Snapshots wieder ab — auch nach einem Abbruch. Die übrigen Punkte unten
> bleiben Handarbeit; sie hängen an visueller Beurteilung.

## Durchläufe

| Datum | Obsidian | Ergebnis | Gegenprobe |
|---|---|---|---|
| 2026-08-12 | 1.13.7 | **7/7 automatisch grün** · Hand-Punkte 1–11 durch Johannes bis Punkt 11 (Nummerierung von damals — die Punkte 12–15 kamen erst mit 0.1.2 dazu) | `unpublishPage` ohne `content`/`tags` ausgebaut → **genau Punkt 3 rot** (`isPublished=true`, das historische Symptom), übrige 6 grün |

**Was der erste Durchlauf gefunden hat** (beides behoben): `pages.update` verlangt
`content` und `tags`, obwohl das Schema sie als optional führt — jedes
Depublizieren schlug fehl. Und die Abschluss-Meldung nannte nur die Anzahl der
Fehler, nicht ihre Ursachen. Beim Automatisieren kam ein dritter dazu: der Client
stufte abgelehnte Schlüssel korrekt als `auth` ein, aber die Oberfläche las die
Einstufung nie und zeigte das nackte Wort „Forbidden".

## Was der Treiber NICHT prüft

- **Aussehen und Lesbarkeit** — ob der Diff im Konflikt-Dialog verständlich ist,
  ob die Callout-Farben stimmen: das bleibt die Hand-Runde unten.
- **Der Settings-Tab** (Punkt: „rendert alle Einstellungen"): Obsidian 1.13 gibt
  das Tab-DOM nicht zuverlässig her, und der Nutzen wäre gering — dass der Tab
  rendert, sieht man beim ersten Blick.
- **Die Sprachumstellung** (Punkt 19): sie schriebe nach `.obsidian/` und änderte
  damit den Wirt. Der Treiber prüft stattdessen, dass keine rohen i18n-Schlüssel
  in der Oberfläche stehen — die eigentliche Regressionsgefahr.

---

## Manuelle Prüfliste

Deckt ab, was kein Unit-Test erreicht: das Zusammenspiel mit einem laufenden
Obsidian **und** einer echten Wiki.js-2.x-Instanz. Vorbedingung für Punkt 1:
die Instanz ist leer (kein `pages.list`-Eintrag) — dann läuft der erste Push
über `create`, nicht `update` (s. `docs/LAB.md`, Messlücke 3).

Jede Zeile: eine abhakbare Beobachtung.

## Grundfluss

- [ ] 1. Neue Notiz in `_published/` anlegen → „Aktuelle Notiz pushen" → Seite
      erscheint im Wiki unter dem erwarteten Pfad, Titel korrekt.
- [ ] 2. Notiz ändern → erneut pushen → Wiki zeigt die Änderung, kein Duplikat.

## Konflikt / Drift

- [ ] 3. Seite **im Wiki** ändern, dann lokal ändern → Push → Konflikt-Dialog
      erscheint mit Zeilen-Diff; „Abbrechen" lässt das Wiki unverändert.
- [ ] 4. Derselbe Fall, „Lokal behalten" → Wiki übernimmt die lokale Fassung.
- [ ] 5. Derselbe Fall, „Wiki behalten" → Push wird abgebrochen, Wiki bleibt
      unverändert — **und die Wiki-Fassung landet NICHT automatisch im
      Vault.** Der Eintrag bleibt im Zustand „Konflikt" und bekommt in der
      Status-Ansicht keinen Pull-Knopf (nur „Im Wiki geändert" und „Neu im
      Wiki" sind pull-fähig). Wer die Wiki-Fassung will, kopiert sie aus dem
      Diff im Dialog oder gleicht die lokale Datei von Hand an.
- [ ] 6. Seite im Wiki ändern, dann **zurücksetzen** auf den alten Stand
      (`updatedAt` bewegt sich, Inhalt landet wieder beim Ausgangstext),
      lokal ändern → Push → Konflikt-Dialog erscheint trotzdem (der
      Live-Vergleich sagt „geändert", unabhängig vom Inhalt).

## Pull

- [ ] 7. Seite im Wiki ändern, lokal nicht → Status-Ansicht zeigt „Im Wiki
      geändert" → Pull-Knopf in der Zeile → Vault-Datei trägt den Wiki-Text.

## Entfernen

- [ ] 8. Notiz aus `_published/` herausziehen → Sammel-Push → Dialog mit drei
      Optionen erscheint, **„Depublizieren" ist hervorgehoben (empfohlene
      Aktion, kein vorausgewähltes Feld)** → bestätigen → Seite ist im Wiki
      nicht mehr sichtbar, Historie bleibt (im Wiki-Adminbereich prüfbar).
- [ ] 9. Denselben Dialog mit **Esc** schließen → Seite bleibt im Wiki
      unverändert sichtbar (Esc bedeutet „Behalten", nie Depublizieren oder
      Löschen).

## Kollisionen und Mehrdeutigkeit (Status-Ansicht)

- [ ] 10. Zwei Notizen in unterschiedlichen Unterordnern, die auf denselben
      Wiki-Pfad slugifizieren → Status-Ansicht zeigt den Kollisions-Block
      mit beiden Vault-Pfaden, **Push ist für beide gesperrt** (kein
      Push-Knopf in ihrer Zeile).
- [ ] 11. Zwei Notizen mit demselben Dateinamen in unterschiedlichen Ordnern,
      eine davon per `[[Name]]` aus einer dritten Notiz verlinkt → Status-
      Ansicht zeigt den Mehrdeutigkeits-Block mit Hinweistext; **Push bleibt
      für die betroffene Seite möglich** (keine Sperre); im gepushten
      Wiki-Text bleibt `[[Name]]` als Klartext statt als Link.

## Sackgassen-Ausgänge (seit 0.1.2)

Beide Wege schreiben **nie** ins Wiki — schlimmstenfalls tun sie nichts. Deshalb
stehen sie hier und nicht im Treiber: der Zustand müsste künstlich hergestellt
werden, und der Gewinn wäre kein neuer Schreibpfad, sondern nur die Verdrahtung
des Knopfes.

- [ ] 12. **Belegter Slug, eigene Seite.** Eine Notiz pushen, danach ihre
      Snapshot-Datei im Plugin-Datenordner (`snapshots/*.json`) löschen →
      Status-Ansicht zeigt „Belegt" mit dem Knopf **„Seite übernehmen"** →
      Klick meldet die Übernahme, und nach dem Refresh ist die Zeile normal
      (unverändert/aktualisierbar).
- [ ] 13. **Belegter Slug, fremde Seite.** Dieselbe Lage, aber die Wiki-Seite
      vorher **im Wiki ändern** → „Seite übernehmen" übernimmt **nichts** und
      sagt, dass der Inhalt abweicht. Die Wiki-Seite bleibt unangetastet.
- [ ] 14. **Verwaister Snapshot.** Eine gesyncte Seite im Wiki löschen **und**
      die lokale Notiz löschen → Status-Ansicht zeigt „Veralteter Snapshot"
      mit dem Knopf **„Snapshot verwerfen"** → Klick entfernt die Datei aus
      `snapshots/`, die Zeile verschwindet.
- [ ] 15. **Kein stiller Abbruch.** Status-Ansicht offen lassen, die Notiz
      einer Zeile **außerhalb** von Obsidian löschen, dann in der alten
      Ansicht auf „Push" drücken → es erscheint eine Meldung (nicht nichts).

## Sammel-Push und Fehlerfälle

- [ ] 16. Mehrere offene Änderungen, eine Seite künstlich zum Scheitern
      bringen (z. B. Wiki während des Laufs kurz abschalten oder eine
      Kollision einbauen) → „Alle Änderungen pushen" läuft für die übrigen
      Seiten sequenziell weiter, Abschluss-Notice nennt sowohl die
      erfolgreichen Zählungen als auch die Fehlerzahl.

## Fehlermeldungen

- [ ] 17. Wiki-Instanz abschalten/unerreichbar machen → Push → verständliche
      Fehlermeldung erscheint binnen des eingestellten Zeitlimits, Obsidian
      friert währenddessen nicht ein.
- [ ] 18. Falschen API-Key eintragen → Push → Meldung benennt Authentifizierung
      (nicht „unbekannter Fehler").

## i18n

- [ ] 19. Obsidian-Sprache auf Englisch stellen → Settings-Tab, Commands,
      Status-Ansicht, Konflikt-Dialog und Entfernen-Dialog zeigen
      ausschließlich englische Texte.
