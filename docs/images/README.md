# Aufnahme-Vertrag — README-Bilder

Dieser Ordner hält die Bilder, die `README.md` und `README.de.md` einbetten. Diese Datei
ist der **Vertrag** dafür: welche Bilder es gibt, was jedes zeigen muss, in welcher Klasse
es steht — und wie man sie reproduzierbar neu aufnimmt.

Geprüft wird der Vertrag automatisch: `readme_lint.py` (Workspace-Werkzeug) gleicht
**Vertrag ↔ Dateien ↔ README-Einbettungen** in alle Richtungen ab.

> Erstaufnahme (2026-08-18): bis dahin trug die README nur Badges — kein einziges Bild.

> **Fund beim Aufnehmen:** Die Status-Ansicht listet ALLE Seiten der konfigurierten
> Wiki-Instanz, nicht nur die im Sync-Ordner (`sync-plan.ts` nimmt `remote` ungefiltert
> aus `listPages()` — jede Fremdseite ohne lokales Gegenstück erscheint als „Neu im
> Wiki"). Ein Screenshot gegen eine Instanz mit echtem Inhalt zeigt also echte
> Seitennamen. `overview.png` filtert deshalb VOR der Aufnahme im Render — jede Zeile
> ohne `zz-shots` im Text wird aus dem DOM entfernt, bevor der Screenshot entsteht. Die
> Daten selbst bleiben unangetastet, nur das Bild zeigt sie nicht. Kein Plugin-Fehler,
> aber ein Punkt, den ein zweiter Aufnahme-Lauf gegen eine andere Instanz kennen muss.
>
> **Zweiter Fund:** der erste `settings.png`-Lauf zeigte die echte Wiki-URL UND den
> Anfang des echten API-Schlüssels — beides original sichtbar, weil die Einstellungen
> einfach den laufenden Plugin-Zustand fotografieren. Der Treiber setzt seither
> `baseUrl`/`apiKey` unmittelbar vor dieser einen Aufnahme auf Platzhalter (letzter
> Schritt im Lauf, kein weiterer Zustand braucht danach echte Zugangsdaten).

## Bilder

| Datei | Klasse | Zeigt | Zustand |
|---|---|---|---|
| `overview.png` | feature (≤1.6) | Status-Ansicht: Kollisions- und Mehrdeutigkeits-Block oben, darunter Zeilen in den Zuständen Neu, Lokal geändert, Konflikt, Belegt. Ursprünglich als Hero-Bild geplant — die Sidebar-Form (schmal, viele Zeilen) verfehlt den ≤1.0-Ratio der `hero`-Klasse selbst verbreitert; `feature` passt der Form nach besser, ohne Inhalt zu opfern. | `Getting-Started.md` (neu, nie gepusht), `Style-Guide.md` (gepusht, dann nur lokal geändert), `network/Overview.md` (gepusht, dann lokal UND im Wiki geändert), `Deploy-Runbook.md` (gepusht, Snapshot danach entfernt), `Access Policy.md` + `access-policy.md` (gleicher Slug), `guides/Setup.md` + `archive/Setup.md` (gleicher Basisname, per `[[Setup]]` aus `Getting-Started.md` verlinkt) |
| `settings.png` | feature | Settings-Tab vollständig: Wiki-URL, API-Schlüssel, Sync-Ordner, Wiki-Sprache, Zeitlimit. | Platzhalter-URL (`https://wiki.example.org`) und maskierter Schlüssel, unmittelbar vor der Aufnahme gesetzt — s. Fund unten |
| `conflict-modal.png` | feature | Konflikt-Dialog: Zeilen-Diff zwischen Wiki- und lokaler Fassung, drei Knöpfe. | Ausgelöst durch einen Push auf `network/Overview.md` im Konflikt-Zustand |
| `removal-modal.png` | feature | „Lokal entfernt"-Dialog nach einem Sammel-Push, Depublizieren hervorgehoben. | `Retired-Page.md` wird aus dem Sync-Ordner verschoben, danach „Alle Änderungen pushen" |

## Reproduzieren

Aufgenommen wird in einer **Zweitinstanz** mit eigenem Profil und eigenem Port, nie in der regulären Instanz: `.asar` der regulären Instanz ins `--user-data-dir` kopieren, den Aufnahme-Vault und `"language":"en"` in dessen `obsidian.json` eintragen, mit `--remote-debugging-port=<port>` starten, den CDP-Lock für den Port halten. Vertrauensdialog und Restricted Mode erledigt der Treiber.

```bash
npm run build && npm run shots -- --setup                # Vault aus dem Fixture bauen

npm run shots -- --port <port>                           # alles aufnehmen
npm run shots -- --port <port> --only overview.png       # ein Bild nachziehen
npm run shots -- --list                                  # Vertrag anzeigen
npm run shots:check                                      # Standard-Konformität prüfen
```

## Was der Lauf voraussetzt

- Ein gebautes Plugin (`npm run build`) — der Vault zeigt den Stand, der gerade geändert
  wird, nicht den letzten Release.
- Eine Zweitinstanz mit `--remote-debugging-port=<port>` und dem Aufnahme-Vault (der Treiber bestätigt den Trust-Dialog selbst).
- Netzwerkzugriff auf die konfigurierte Wiki.js-Instanz für `overview.png`,
  `conflict-modal.png` und `removal-modal.png` — nur `settings.png` kommt ohne aus.
