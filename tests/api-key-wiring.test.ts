import { describe, expect, it } from "vitest";
import WikijsMaintainerPlugin from "../src/main";
import { API_KEY_SECRET_ID } from "../src/core/api-key-storage";

// Verdrahtung von loadApiKey/persistApiKey in main.ts: Migration beim Laden, Verteilung beim
// Speichern. Die reine Logik testet api-key-storage.test.ts; hier geht es darum, dass das Plugin
// sie an BEIDEN Stellen aufruft und der Speicherwert dabei unangetastet bleibt — die Netzwege
// lesen `settings.apiKey` aus dem Speicher.

function keychain(): { values: Map<string, string>; storage: object } {
  const values = new Map<string, string>();
  return {
    values,
    storage: {
      getSecret: (id: string) => values.get(id) ?? null,
      setSecret: (id: string, v: string) => void values.set(id, v),
      listSecrets: () => [...values.keys()],
    },
  };
}

function plugin(app: object, stored: unknown): WikijsMaintainerPlugin & { gespeichert: () => unknown } {
  const p = new WikijsMaintainerPlugin(app as never, { id: "wikijs-maintainer", name: "Wiki.js Maintainer", version: "0.0.0" } as never);
  const daten = { wert: stored };
  p.loadData = async () => daten.wert;
  p.saveData = async (d: unknown) => {
    daten.wert = JSON.parse(JSON.stringify(d));
  };
  return Object.assign(p, { gespeichert: () => daten.wert });
}

describe("API-Schluessel: Verdrahtung in main.ts", () => {
  it("migriert einen Altwert aus data.json beim Laden in den Schluesselbund", async () => {
    const kc = keychain();
    const p = plugin({ secretStorage: kc.storage }, { apiKey: "sk-alt" });
    await p.onload();
    expect(p.settings.apiKey).toBe("sk-alt");
    expect(kc.values.get(API_KEY_SECRET_ID)).toBe("sk-alt");
    expect((p.gespeichert() as { apiKey: string }).apiKey).toBe("");
  });

  it("laedt den Wert aus dem Schluesselbund, wenn data.json leer ist", async () => {
    const kc = keychain();
    kc.values.set(API_KEY_SECRET_ID, "sk-bund");
    const p = plugin({ secretStorage: kc.storage }, { apiKey: "" });
    await p.onload();
    expect(p.settings.apiKey).toBe("sk-bund");
  });

  it("beim Speichern bleibt der Wert im Speicher, data.json bekommt einen Leerstring", async () => {
    const kc = keychain();
    const p = plugin({ secretStorage: kc.storage }, null);
    await p.onload();
    p.settings.apiKey = "sk-neu";
    await p.saveSettings();
    expect(p.settings.apiKey).toBe("sk-neu");
    expect(kc.values.get(API_KEY_SECRET_ID)).toBe("sk-neu");
    expect((p.gespeichert() as { apiKey: string }).apiKey).toBe("");
  });
});
