// Ergebnis-Text fuer einen Push/Pull, an EINER Stelle statt zweimal (main.ts-Commands
// UND status-view.ts). Pure bis auf den i18n-Import -- kein Notice hier, das bleibt
// Sache der Aufrufer (main.ts / status-view.ts), sonst waere dieses Modul an Obsidian
// gebunden, ohne es zu brauchen.
import { t } from "../vendor/kit/i18n";
import type { PullOutcome, PushOutcome } from "./sync-service";

/** Eigene Methode, weil sie sowohl von den Commands (main.ts) als auch vom Push-Knopf
 *  der Status-Ansicht (status-view.ts) gebraucht wird (Important-Befund „Push/Pull in
 *  der Ansicht verschluckt Ergebnis und Fehler"). Kein "sonst"-Fallback mehr am Ende:
 *  jede `PushOutcome`-Variante hat einen eigenen, zutreffenden Text -- ein neuer
 *  `reason` ohne Zweig hier faellt beim Typecheck auf (s. Erschoepfungs-Test unten). */
export function describeOutcome(outcome: PushOutcome, wikiPath: string): string {
  if (outcome.kind === "created") return t("notice.created", wikiPath);
  if (outcome.kind === "updated") return t("notice.pushed", wikiPath);
  if (outcome.kind === "skipped") return t("notice.unchanged", wikiPath);
  // outcome.kind === "blocked" ab hier -- das ist die einzige verbleibende Variante,
  // aber `kind: "created" | "updated"` sitzt als EIN Union-Glied ohne `reason`-Feld,
  // sodass TS die drei fruehen Returns oben allein nicht zum Narrowen nutzt. Statt
  // eines vierten, tatsaechlich unreachable-en `if (kind !== "blocked")`-Zweigs (das
  // war genau der Minor-Befund „unerreichbarer Zweig in describeOutcome") sagt die
  // Signatur dem Compiler direkt, was hier feststeht.
  return describeBlocked(outcome as Extract<PushOutcome, { kind: "blocked" }>, wikiPath);
}

function describeBlocked(outcome: Extract<PushOutcome, { kind: "blocked" }>, wikiPath: string): string {
  if (outcome.reason === "drift") return t("notice.drift", wikiPath);
  if (outcome.reason === "collision") return t("notice.collision", wikiPath);
  // "no-local": removed-locally/new-remote/stale-snapshot haben kein lokales Pendant --
  // fachlich etwas ganz anderes als eine Slug-Kollision ("occupied" waere hier falsch,
  // s. Minor-Befund „blocked/occupied erzeugt falsche Meldungen").
  if (outcome.reason === "no-local") return t("notice.noLocal", wikiPath);
  if (outcome.reason === "remote-deleted") return t("notice.remoteDeleted", wikiPath);
  return t("notice.occupied", wikiPath); // outcome.reason === "occupied"
}

export function describePullOutcome(outcome: PullOutcome, wikiPath: string): string {
  if (outcome.kind === "written") return t("notice.pulled", wikiPath);
  return t("notice.pullSkipped", wikiPath);
}

/** Fehler → Meldung für den Nutzer.
 *
 *  Der Client stuft jeden Fehler ein (`WikiError.kind`) — bis zum 2026-08-12 hat das
 *  aber niemand gelesen: die Commands zeigten stumpf `err.message`, und ein
 *  abgelehnter Schlüssel erschien als nacktes "Forbidden". Eine Klassifikation, die
 *  in keiner Meldung ankommt, ist keine.
 *
 *  Die Server-Meldung bleibt dort, wo sie das Nützlichste ist: bei fachlichen
 *  Fehlern sagt sie mehr als jede Umschreibung ("Page content cannot be empty" ist
 *  ein brauchbarer Hinweis). Bei Auth und Zeitlimit ist sie es nicht — dort weiß der
 *  Client mehr über die Lage als der Server über den Nutzer. */
export function describeError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const kind = (err as { kind?: string } | null)?.kind;
  if (kind === "auth") return t("notice.authFailed");
  if (kind === "timeout") return t("notice.unreachable", message);
  if (kind === "network") return t("notice.unreachable", message);
  return t("notice.error", message);
}
