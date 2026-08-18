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

```bash
export STAGING_VAULTS_DIR="$HOME/StagingVaults"   # einmalig
npm run build && npm run shots -- --setup          # Vault aus dem Fixture bauen

osascript -e 'quit app "Obsidian"'                  # Handarbeit: Debug-Port
open -a Obsidian --args --remote-debugging-port=9222
# ... den Aufnahme-Vault öffnen und einmalig als vertrauenswürdig markieren

npm run shots                                       # alles aufnehmen
npm run shots -- --only overview.png                # ein Bild nachziehen
npm run shots -- --list                             # Vertrag anzeigen
npm run shots:check                                 # Standard-Konformität prüfen
```

**Obsidians Oberfläche muss auf Englisch stehen** — `README.md` ist die kanonische Fassung
(CORE-META-09). Die Sprache ist app-weit, nicht vault-weit (`obsidian.json.language` UND
zusätzlich `localStorage["language"]`, beide vor dem Lauf setzen, dann Obsidian neu
starten — die geladene Sprache steht in `document.documentElement.lang`, nicht in der
gespeicherten Einstellung). Nach der Aufnahme zurückstellen, sonst startet der
Arbeits-Vault des Maintainers in der Aufnahmesprache. Der Treiber prüft das selbst nicht
— das Zurückstellen betrifft alle offenen Vaults, nicht nur den Aufnahme-Vault, und gehört
deshalb bewusst in Menschenhand.

**Braucht eine erreichbare Wiki.js-Instanz** — dieselbe, gegen die `npm run smoke:gui`
läuft. Wiki-URL und API-Schlüssel kommen aus der Umgebung (`WIKIJS_URL`, `WIKIJS_TOKEN` —
dieselbe Konvention wie `npm run lab:wikijs`) und werden zur Laufzeit ins Plugin
eingetragen (`setPluginSetting`, `data.json` überlebt `--setup` nicht, keine Geheimnisse
im Fixture). Alle Seiten landen unter `zz-shots/…`, der Treiber räumt sie am Ende des
Laufs wieder ab — dieselbe Aufräum-Zusage wie beim GUI-Smoke (dessen `zz-smoke-`-Präfix),
nur mit eigenem Ordner, damit ein gleichzeitig laufender Smoke sich nicht in die Quere
kommt.

Beispieldaten sind generisch und englisch (Style Guide, Deploy Runbook, Network Overview,
Access Policy) — keine echten Namen, keine echte Infrastruktur.

## Was der Lauf voraussetzt

- Ein gebautes Plugin (`npm run build`) — der Vault zeigt den Stand, der gerade geändert
  wird, nicht den letzten Release.
- Obsidian mit `--remote-debugging-port=9222`, den Aufnahme-Vault geöffnet und einmalig
  bestätigt (Trust-Dialog).
- Netzwerkzugriff auf die konfigurierte Wiki.js-Instanz für `overview.png`,
  `conflict-modal.png` und `removal-modal.png` — nur `settings.png` kommt ohne aus.
