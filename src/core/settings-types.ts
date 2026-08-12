// Settings-Datentyp und Merge. Pure — der Tab in src/obsidian/settings.ts rendert
// diese Wahrheit, definiert sie aber nicht.
import { mergeSettings } from "../vendor/kit/settings";

export interface WikijsSettings {
  /** Basis-URL der Instanz, ohne /graphql. */
  baseUrl: string;
  apiKey: string;
  /** Vault-Ordner, dessen Inhalt veroeffentlicht wird. Umzug hinein = Publikations-
   *  entscheidung (Spec § "Ratifizierte Grundentscheidungen"). */
  syncRoot: string;
  /** Wiki.js-Locale der angelegten Seiten. */
  locale: string;
  timeoutSec: number;
}

export const TIMEOUT_SEC_MIN = 5;
export const TIMEOUT_SEC_MAX = 120;
export const TIMEOUT_SEC_STEP = 5;

export const DEFAULT_SETTINGS: WikijsSettings = {
  baseUrl: "",
  apiKey: "",
  syncRoot: "_published",
  locale: "de",
  timeoutSec: 30,
};

export function mergeWikijsSettings(raw: unknown): WikijsSettings {
  return mergeSettings(DEFAULT_SETTINGS, raw);
}
