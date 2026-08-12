// Important 2: describeOutcome/describePullOutcome lebten bisher als private Methoden
// auf dem Plugin (main.ts) und waren aus der Status-Ansicht nicht erreichbar -- ein
// Push/Pull-Klick dort verschluckte Ergebnis und Fehler komplett. Beide Funktionen
// ziehen deshalb in ein eigenes, obsidian-freies Modul, das main.ts und status-view.ts
// gemeinsam nutzen.
import { beforeAll, describe, expect, it } from "vitest";
import { defineStrings, setLang, t } from "../src/vendor/kit/i18n";
import { STRINGS } from "../src/i18n/strings";
import { describeError, describeOutcome, describePullOutcome } from "../src/obsidian/describe-outcome";
import { WikiError } from "../src/wikijs/client";
import type { PushOutcome, PullOutcome } from "../src/obsidian/sync-service";

beforeAll(() => {
  defineStrings(STRINGS);
  setLang("en");
});

describe("describeOutcome", () => {
  it("created", () => {
    expect(describeOutcome({ kind: "created" }, "a")).toBe(t("notice.created", "a"));
  });
  it("updated", () => {
    expect(describeOutcome({ kind: "updated" }, "a")).toBe(t("notice.pushed", "a"));
  });
  it("skipped/unchanged", () => {
    expect(describeOutcome({ kind: "skipped", reason: "unchanged" }, "a")).toBe(t("notice.unchanged", "a"));
  });
  it("blocked/drift", () => {
    expect(describeOutcome({ kind: "blocked", reason: "drift" }, "a")).toBe(t("notice.drift", "a"));
  });
  it("blocked/collision", () => {
    expect(describeOutcome({ kind: "blocked", reason: "collision" }, "a")).toBe(t("notice.collision", "a"));
  });
  it("blocked/occupied", () => {
    expect(describeOutcome({ kind: "blocked", reason: "occupied" }, "a")).toBe(t("notice.occupied", "a"));
  });
  it("blocked/no-local bekommt eine eigene, zutreffende Meldung -- nicht 'existiert bereits unter anderer Seite'", () => {
    const msg = describeOutcome({ kind: "blocked", reason: "no-local" }, "a");
    expect(msg).toBe(t("notice.noLocal", "a"));
    expect(msg).not.toBe(t("notice.occupied", "a"));
  });
  it("blocked/remote-deleted bekommt eine eigene Meldung", () => {
    const msg = describeOutcome({ kind: "blocked", reason: "remote-deleted" }, "a");
    expect(msg).toBe(t("notice.remoteDeleted", "a"));
  });

  // Erschoepfende Union: TS soll bei jedem neuen PushOutcome-Zweig hier auffallen,
  // wenn describeOutcome ihn nicht behandelt (kein "sonst"-Fallback fuer reason mehr).
  it("deckt jede PushOutcome-Variante ab", () => {
    const outcomes: PushOutcome[] = [
      { kind: "created" },
      { kind: "updated" },
      { kind: "skipped", reason: "unchanged" },
      { kind: "blocked", reason: "drift" },
      { kind: "blocked", reason: "collision" },
      { kind: "blocked", reason: "occupied" },
      { kind: "blocked", reason: "no-local" },
      { kind: "blocked", reason: "remote-deleted" },
    ];
    for (const o of outcomes) expect(() => describeOutcome(o, "a")).not.toThrow();
  });
});

describe("describePullOutcome", () => {
  it("written", () => {
    expect(describePullOutcome({ kind: "written", vaultPath: "x" } as PullOutcome, "a")).toBe(t("notice.pulled", "a"));
  });
  it("skipped", () => {
    expect(describePullOutcome({ kind: "skipped" }, "a")).toBe(t("notice.pullSkipped", "a"));
  });
});

describe("describeError — die Fehlerart entscheidet die Meldung", () => {
  // Befund aus dem GUI-Smoke am 2026-08-12: der Client stufte einen abgelehnten
  // Schlüssel korrekt als `kind: "auth"` ein — die Oberfläche zeigte trotzdem nur
  // `err.message`, also das nackte Wort "Forbidden". Eine Klassifikation, die
  // niemand liest, ist keine.
  it("nennt bei einem Auth-Fehler den Schlüssel statt der Server-Vokabel", () => {
    const text = describeError(new WikiError("auth", "Forbidden"));
    expect(text).toMatch(/schlüssel|key/i);
    expect(text).not.toBe("Forbidden");
  });

  it("nennt bei einem Zeitlimit die Erreichbarkeit", () => {
    expect(describeError(new WikiError("timeout", "Keine Antwort binnen 30000 ms"))).toMatch(/erreich|reach/i);
  });

  it("reicht die Server-Meldung durch, wo sie das Nützlichste ist", () => {
    expect(describeError(new WikiError("graphql", "Page content cannot be empty."))).toContain(
      "Page content cannot be empty.",
    );
  });

  it("kommt auch mit einem gewöhnlichen Fehler zurecht", () => {
    expect(describeError(new Error("irgendwas"))).toContain("irgendwas");
  });
});
