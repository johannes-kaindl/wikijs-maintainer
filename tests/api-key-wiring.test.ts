import { describe, expect, it, vi } from "vitest";
import WikijsMaintainerPlugin from "../src/main";
import { API_KEY_SECRET_ID } from "../src/core/settings-types";

// Verdrahtung von loadSecretValue/persistSecretValue (code-kit secret-value) in main.ts: Migration
// beim Laden, Verteilung beim Speichern. Die reine Logik testet das Kit; hier geht es darum, dass das Plugin
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

// Verhalten, das mit dem Wechsel auf das Kit-Modul dazukam oder sich geaendert hat.
describe("API-Schluessel: Kit-Modul secret-value", () => {
  it("ein Schluesselbund, der den Wert verwirft, laesst ihn in data.json stehen (Klartext mit Warnung, kein Verlust)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const leaky = { getSecret: () => null, setSecret: () => undefined, listSecrets: () => [] };
    const p = plugin({ secretStorage: leaky }, null);
    await p.onload();
    p.settings.apiKey = "sk-1";
    await p.saveSettings();
    expect((p.gespeichert() as { apiKey: string }).apiKey).toBe("sk-1");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("ohne Schluesselbund (alte Obsidian-Version) bleibt der Wert in data.json und geht nirgends verloren", async () => {
    const p = plugin({}, { apiKey: "sk-alt" });
    await p.onload();
    expect(p.settings.apiKey).toBe("sk-alt");
    expect((p.gespeichert() as { apiKey: string }).apiKey).toBe("sk-alt");
  });

  it("Zeilenumbrueche im Schluessel werden entfernt (wie der Schluesselbund es tut), Leerzeichen bleiben", async () => {
    const kc = keychain();
    const p = plugin({ secretStorage: kc.storage }, null);
    await p.onload();
    p.settings.apiKey = "sk-1\r\n";
    await p.saveSettings();
    expect(p.settings.apiKey).toBe("sk-1");
    expect(kc.values.get(API_KEY_SECRET_ID)).toBe("sk-1");
  });

  it("Leeren des Feldes raeumt den Schluesselbund-Eintrag", async () => {
    const kc = keychain();
    kc.values.set(API_KEY_SECRET_ID, "sk-bund");
    const p = plugin({ secretStorage: kc.storage }, { apiKey: "" });
    await p.onload();
    p.settings.apiKey = "";
    await p.saveSettings();
    expect(kc.values.get(API_KEY_SECRET_ID)).toBe("");
    expect((p.gespeichert() as { apiKey: string }).apiKey).toBe("");
  });
});
