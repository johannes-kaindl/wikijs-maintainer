import { describe, expect, it } from "vitest";
import { statusLabelKey, type SyncState } from "../src/core/sync-plan";
import { STRINGS } from "../src/i18n/strings";

// Ein Record ueber die Union: ein neuer Zustand bricht den BUILD, nicht erst die UI.
const ALL: Record<SyncState, true> = {
  create: true, update: true, "remote-changed": true, conflict: true, occupied: true,
  "removed-locally": true, "remote-deleted": true, "new-remote": true,
  "stale-snapshot": true, unchanged: true,
};

describe("statusLabelKey", () => {
  it("hat fuer jeden Zustand einen Schluessel, den beide Sprachen kennen", () => {
    for (const state of Object.keys(ALL) as SyncState[]) {
      const key = statusLabelKey(state);
      expect(STRINGS.en[key as keyof typeof STRINGS.en], `EN fehlt: ${key}`).toBeDefined();
      expect(STRINGS.de[key as keyof typeof STRINGS.de], `DE fehlt: ${key}`).toBeDefined();
    }
  });

  it("vergibt fuer verschiedene Zustaende verschiedene Schluessel", () => {
    const keys = (Object.keys(ALL) as SyncState[]).map(statusLabelKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("Warn-Schluessel der Status-Ansicht", () => {
  it("kennt beide Sprachen fuer Kollisionen und mehrdeutige Namen", () => {
    for (const key of ["view.collision", "view.ambiguous", "view.ambiguous.hint", "status.collision"] as const) {
      expect(STRINGS.en[key as keyof typeof STRINGS.en], `EN fehlt: ${key}`).toBeDefined();
      expect(STRINGS.de[key as keyof typeof STRINGS.de], `DE fehlt: ${key}`).toBeDefined();
    }
  });
});
