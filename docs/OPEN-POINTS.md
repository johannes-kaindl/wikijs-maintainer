# Offene Punkte nach dem MVP

Stand 2026-08-10, nach Abschluss des MVP-Plans (`docs/superpowers/plans/2026-08-09-wikijs-maintainer-mvp.md`)
und der Gesamtreview über den Branch. Alles hier ist **bewusst zurückgestellt**, nicht vergessen —
jede Zeile wurde in einer Review benannt und einzeln triagiert.

## Vor einer Store-Einreichung erledigt (2026-08-12)

Die Doku nannte an vier Stellen die konkrete Wiki-Instanz des Maintainers
(`AGENTS.md`, `docs/LAB.md`, der Plan). Sie sind neutralisiert — die Aussagen
bleiben vollständig, sie hängen an Wiki.js 2.x, nicht an einer bestimmten
Installation. **In der git-History stehen sie weiterhin** (drei Commits): dort
wurde bewusst nichts umgeschrieben, weil die Information nichts preisgibt, was
nicht ohnehin per DNS und einem Blick auf die Seite erkennbar wäre. Geprüft und
belegt: **kein Token, kein Schlüssel und keine Vault-Datei** wurde je committet.

## Bekannte Grenzen des MVP

Diese stehen auch in `README.md`; hier mit dem technischen Grund.

- **Keine Bilder/Anhänge** (V2). `![[Embeds]]` werden übersprungen und im Sync-Report gezählt.
- **Kein Drei-Wege-Merge** (V3). Die Snapshots tragen die Datenlage dafür bereits: lokaler
  Rohtext, gepushte Fassung, Remote-`updatedAt`.
- **Kein automatischer Weg aus einem Konflikt heraus.** Sind lokal und remote beide geändert,
  bietet „Wiki behalten" nur den Abbruch — die Wiki-Fassung wird nicht in den Vault geholt.
  Wer sie will, kopiert aus dem Diff-Dialog oder gleicht die lokale Datei von Hand an.
- **`remote-deleted` hat keinen Wiederanlege-Pfad.** Eine im Wiki gelöschte Seite wird beim Push
  blockiert statt neu erzeugt.
- **`occupied` ist eine Sackgasse.** Kein Command und kein Knopf löst den Zustand auf; die
  Wiki-Seite muss von Hand gelöscht werden. Erreichbar u.a., wenn `createPage` gelingt und
  das Schreiben des Snapshots danach scheitert.
- **Verwaiste Snapshots werden nicht aufgeräumt.** Wird eine Seite zuerst im Wiki und dann lokal
  gelöscht, bleibt die Snapshot-Datei liegen und die Zeile „Veralteter Snapshot" steht dauerhaft
  in der Status-Ansicht.

## Aus der Gesamtreview, nicht blockierend

- **Drei `buildPlan()`-Läufe je Klick in der Status-Ansicht** (Refresh, Klick, Nach-Refresh).
  Jeder macht ein `listPages()` gegen die Instanz. Der Preis dafür, dass der Klick auf frischem
  Stand handelt — für einen kleinen VPS vertretbar, aber zusammenlegbar.
- **Zwei Abbruchgründe im Klick-Handler melden nichts:** eine inzwischen entstandene Kollision
  und ein verschwundener Eintrag führen zu keinem Push, aber auch zu keiner Meldung. Erfüllt den
  Buchstaben von „kein Push", reibt sich mit dem Geist von „nichts stillschweigend".
- **`sync-service.ts` nutzt `reason: "occupied"` noch an einer weiteren Stelle** für einen Fall,
  der keine Slug-Kollision ist (`pageId`/`snapshot` fehlen). Derselbe Fehlertyp, der anderswo
  bereits zu `"no-local"` korrigiert wurde.
- **`vaultPathToWikiPath` verschluckt fremde Dateiendungen** statt sie abzuschneiden:
  `Not-A-Page.canvas` wird zu `not-a-pagecanvas`. Fachlich harmlos (die Datei ist ohnehin nicht
  syncbar), aber die Meldung zeigt dem Nutzer einen sinnlosen Pfad.

## Zurückgestellte Kleinbefunde aus den Task-Reviews

Alle als „kann bleiben" triagiert. Sortiert nach Ort.

- `core/paths.ts`: ein Pfadsegment, das zu einer leeren Zeichenkette slugifiziert, wird still
  verworfen — das Ergebnis ist ein Kollisions-Kandidat und wird von `findSlugCollisions` gefangen.
- `core/paths.ts`: FNV-1a-32 für Snapshot-Dateinamen ohne Kollisionsbehandlung. Folge wäre ein
  blockierter Push, kein Datenverlust.
- `core/paths.ts`: eine Datei im Wurzelverzeichnis und eine gleichnamige in einem Unterordner
  machen `[[Name]]` für **beide** unauflösbar. Konservativ, und die Mehrdeutigkeit wird gemeldet.
- `core/page-meta.ts`: ein als Liste geschriebener `title` würde mit `", "` zusammengefügt statt
  aufzufallen. Unerreichbar, solange `title`/`summary` Skalare sind.
- `core/links.ts`: die Codeblock-Erkennung togglet nur auf ``` bzw. ~~~ am Zeilenanfang, ohne
  Zeichen- und Längenabgleich. Fällt sicher aus — sie schreibt im Zweifel weniger um, nie mehr.
- `core/transform.ts`: die Callout-Kopf-Erkennung in der Body-Schleife beachtet den
  Codeblock-Zustand nicht. Betrifft nur einen Codeblock *innerhalb* eines Callouts.
- `wikijs/client.ts`: `succeeded` ist als Pflichtfeld typisiert, obwohl der Code es defensiv
  optional behandelt — die Defensive ist Absicht (das Feld ist ungemessen, siehe `docs/LAB.md`).
- `wikijs/client.ts`: 4xx/5xx außer 401/403 landen im `network`-Topf. Bewusste Wahl bei
  geschlossener Union, aber unkommentiert.
- `wikijs/client.ts`: die Meldung einer `requestUrl`-Ablehnung wird ungeprüft übernommen —
  theoretischer Weg für einen Token in eine Fehlermeldung, nicht reproduziert.
- `obsidian/vault-source.ts`: bei einer echten Slug-Kollision überschreibt der zweite Eintrag die
  Metadaten des ersten. Downstream ist durch den Pflichtparameter `collisions` gedeckt.
- `obsidian/vault-source.ts`: `vaultPathToWikiPath` wird je Datei viermal berechnet, und
  `cachedRead` läuft serialisiert. Laufzeit, nicht Korrektheit.
- `obsidian/status-view.ts`: bei einer blockierten Zeile überschreibt der Kollisionshinweis die
  Zustandsbeschriftung, statt beides zu zeigen.
- `main.ts`: zwischen dem Bauen des Plans und dem Schreiben beim Pull liegt ein schmales Fenster,
  in dem eine lokale Änderung verloren ginge.
- `main.ts`: der Ordner-Anlege-Lauf des Schreib-Adapters prüft und legt in zwei Schritten an —
  bei zwei echt gleichzeitigen Pulls könnte der zweite Aufruf auf einen bereits angelegten
  Ordner treffen und werfen. Landet im `catch` und wird als Meldung sichtbar.
- Testabdeckung: `main.ts` hat inzwischen Tests (`tests/main_commands.test.ts`), aber nicht für
  jeden Zweig. Die Gesamtreview hat diese Lücke ausdrücklich als die riskanteste benannt —
  genau dort lebte der eine Eintrittspunkt-Fehler, den die Umsetzung produziert hat.
