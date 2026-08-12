// Die Abschluss-Meldung des Sammel-Pushs.
//
// Warum eine eigene Datei und nicht drei Zeilen in main.ts: die Fassung dort
// nannte nur die ANZAHL der Fehler ("Fehler: 2"). Im GUI-Smoke am 2026-08-12
// stand der Nutzer damit vor einer Zahl und konnte ohne direkten API-Zugriff
// nicht herausfinden, was fehlgeschlagen war — obwohl der Report die Ursachen
// laengst mitfuehrt. Eine Meldung, die einen Fehlschlag meldet, ohne ihn zu
// benennen, ist Rauschen.
import { t } from "../vendor/kit/i18n";
import type { SyncReport } from "./sync-service";

/** Wieviele Fehler namentlich genannt werden, bevor der Rest zusammengefasst
 *  wird. Eine Notice ist kein Protokoll — bei einem kaputten Endpunkt scheitert
 *  jede Seite, und eine 200-zeilige Meldung liest niemand. */
const MAX_DETAILS = 3;

export function formatReport(report: SyncReport): string {
  const lines = [t("report.head", report.created, report.updated, report.blocked)];
  if (report.removed > 0) lines.push(t("report.removed", report.removed));
  if (report.unresolvedLinks > 0) lines.push(t("report.unresolved", report.unresolvedLinks));
  if (report.skippedEmbeds > 0) lines.push(t("report.embeds", report.skippedEmbeds));

  if (report.errors.length > 0) {
    lines.push(t("report.errors", report.errors.length));
    for (const err of report.errors.slice(0, MAX_DETAILS)) {
      lines.push(t("report.errorLine", err.wikiPath, err.message));
    }
    const rest = report.errors.length - MAX_DETAILS;
    if (rest > 0) lines.push(t("report.errorsMore", rest));
  }

  return lines.join("\n");
}
