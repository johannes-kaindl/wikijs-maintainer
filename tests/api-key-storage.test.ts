import { describe, expect, it } from "vitest";
import { API_KEY_SECRET_ID, loadApiKey, persistApiKey, type SecretStore } from "../src/core/api-key-storage";

// Der API-Schluessel lag bis 0.2.1 in `data.json` — maskiert angezeigt, aber im Klartext in einer
// Datei im Vault, die jeder Sync mitnimmt. Seit 0.3.0 haelt ihn Obsidians Schluesselbund
// (SecretStorage, Floor 1.11.4) OS-verschluesselt und je Geraet; data.json traegt einen Leerstring.

class MemoryStore implements SecretStore {
  readonly values = new Map<string, string>();
  get(id: string): string | null {
    return this.values.get(id) ?? null;
  }
  set(id: string, value: string): void {
    this.values.set(id, value);
  }
  has(id: string): boolean {
    return (this.values.get(id) ?? "") !== "";
  }
  delete(id: string): void {
    this.values.delete(id);
  }
}

/** Ein Store, der Schreibvorgaenge verwirft (Plattform ohne Keychain-Zugriff) — der Kit-Store wirft dann. */
class LeakyStore implements SecretStore {
  get(): string | null {
    return null;
  }
  set(id: string): void {
    throw new Error(`SecretStorage did not persist ${id}`);
  }
  has(): boolean {
    return false;
  }
  delete(): void {
    // no-op
  }
}

describe("loadApiKey — welcher Wert gilt beim Laden", () => {
  it("ein Altwert in data.json wird zur Migration angemeldet", () => {
    expect(loadApiKey("sk-alt", new MemoryStore())).toEqual({ apiKey: "sk-alt", migrate: true });
  });

  it("der Schluesselbund gewinnt, wenn beide gefuellt sind — data.json wird trotzdem bereinigt", () => {
    const store = new MemoryStore();
    store.set(API_KEY_SECRET_ID, "sk-bund");
    expect(loadApiKey("sk-alt", store)).toEqual({ apiKey: "sk-bund", migrate: true });
  });

  it("nur der Schluesselbund gefuellt: kein Schreibvorgang noetig", () => {
    const store = new MemoryStore();
    store.set(API_KEY_SECRET_ID, "sk-bund");
    expect(loadApiKey("", store)).toEqual({ apiKey: "sk-bund", migrate: false });
  });

  it("beide leer: leer, nichts zu tun", () => {
    expect(loadApiKey("", new MemoryStore())).toEqual({ apiKey: "", migrate: false });
  });
});

describe("persistApiKey — was in data.json landet", () => {
  it("mit Schluesselbund landet der Wert dort und data.json bekommt einen Leerstring", () => {
    const store = new MemoryStore();
    expect(persistApiKey("sk-1", store, () => {})).toBe("");
    expect(store.get(API_KEY_SECRET_ID)).toBe("sk-1");
  });

  it("ein geleertes Feld leert auch den Schluesselbund-Eintrag", () => {
    const store = new MemoryStore();
    store.set(API_KEY_SECRET_ID, "sk-1");
    expect(persistApiKey("", store, () => {})).toBe("");
    expect(store.get(API_KEY_SECRET_ID)).toBe("");
  });

  it("verwirft der Schluesselbund den Wert, bleibt er in data.json — mit Warnung, ohne Wurf", () => {
    const warnungen: string[] = [];
    expect(persistApiKey("sk-1", new LeakyStore(), (m) => warnungen.push(m))).toBe("sk-1");
    expect(warnungen).toHaveLength(1);
    expect(warnungen[0]).toMatch(/did not persist/);
  });
});
