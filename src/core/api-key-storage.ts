// uebernommen aus yijing-oracle/src/core/settings/api-key-storage.ts, 2026-09-30
//
// Verteilt den API-Schluessel zwischen data.json und Obsidians Schluesselbund (SecretStorage,
// seit 1.11.4). Rein: kennt weder `obsidian` noch das Settings-Objekt — nur einen Store.
//
// Der Floor dieses Plugins ist seit 0.3.0 1.11.4 (manifest.json), der Schluesselbund ist also
// garantiert da — anders als im Vorbild gibt es keinen Zweig ohne Store. Der Wert liegt
// OS-verschluesselt und je Geraet, data.json traegt einen Leerstring. Die Netzwege lesen
// weiterhin `settings.apiKey` aus dem Speicher — `getSecret` ist synchron, deshalb aendert sich
// an ihnen nichts, nur an Laden und Speichern.
import type { SecretStore } from "../vendor/kit/secrets";
export type { SecretStore };

/** Feste ID: lowercase-alphanumerisch mit Bindestrichen, wie SecretStorage sie verlangt. */
export const API_KEY_SECRET_ID = "wikijs-maintainer-api-key";

/** Beim Laden: welcher Wert gilt, und muss data.json bereinigt werden (`migrate`)?
 *  Der Schluesselbund gewinnt, wenn beide gefuellt sind — er ist der neuere Ort, und ein
 *  Altwert in data.json ist auf jeden Fall aufzuraeumen. */
export function loadApiKey(stored: string, secrets: SecretStore): { apiKey: string; migrate: boolean } {
  const inStore = secrets.get(API_KEY_SECRET_ID) ?? "";
  return { apiKey: inStore || stored, migrate: stored !== "" };
}

/** Beim Speichern: schreibt in den Schluesselbund und gibt zurueck, was data.json tragen
 *  soll. Verwirft der Store den Wert (Wurf), bleibt der Schluessel in data.json wie bisher —
 *  lieber Klartext mit Warnung als ein stiller Verlust, den der Nutzer erst am 401 bemerkt. */
export function persistApiKey(apiKey: string, secrets: SecretStore, warn: (msg: string) => void): string {
  try {
    secrets.set(API_KEY_SECRET_ID, apiKey);
    return "";
  } catch (e) {
    warn(`wikijs-maintainer: API key stays in data.json — ${e instanceof Error ? e.message : String(e)}`);
    return apiKey;
  }
}
