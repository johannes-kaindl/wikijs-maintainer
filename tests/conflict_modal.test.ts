import { describe, expect, it } from "vitest";
import { App, Modal } from "obsidian";
import { askConflict } from "../src/obsidian/conflict-modal";

// Modal.__last ist eine Testaffordanz des Kit-Mocks (obsidian-mock.ts): der zuletzt
// konstruierte Modal-Doppelgaenger. modal.close() ruft im Mock synchron onClose()
// auf — genau der Pfad, den Obsidian bei Esc oder Klick daneben nimmt.
function lastModal(): { contentEl: any; close: () => void } {
  return (Modal as unknown as { __last: { contentEl: any; close: () => void } }).__last;
}

const opts = { wikiPath: "a", localText: "neu", remoteText: "alt" };

describe("askConflict", () => {
  it("loest bei Esc (Schliessen ohne Knopfdruck) mit 'cancel' auf", async () => {
    const app = new App();
    const promise = askConflict(app, opts);
    lastModal().close();
    await expect(promise).resolves.toBe("cancel");
  });

  // Der eigentliche Re-Entrance-Fund: ein Klick loest auf, und close() (bei Esc oder
  // Klick daneben) laeuft im Mock synchron NOCHMAL onClose() -> finish("cancel"). Ohne
  // Guard rekursiert finish() -> close() -> onClose() -> finish() -> close() -> ...
  // endlos; MIT Guard bricht der zweite finish()-Aufruf sofort ab und das Ergebnis
  // bleibt beim ersten (echten) Klick.
  it("ein Klick loest auf; ein nachfolgendes Schliessen darf weder rekursieren noch das Ergebnis umbiegen", async () => {
    const app = new App();
    const promise = askConflict(app, opts);
    const modal = lastModal();
    const buttons = modal.contentEl.querySelectorAll("button");
    expect(buttons.length).toBe(3);
    buttons[0].__component.clickCB(); // erster Knopf = "lokal behalten" (CTA)
    expect(() => modal.close()).not.toThrow(); // keine Endlosrekursion / kein Stack-Overflow
    await expect(promise).resolves.toBe("local");
  });

  it("der zweite Knopf loest mit 'remote' auf", async () => {
    const app = new App();
    const promise = askConflict(app, opts);
    const modal = lastModal();
    const buttons = modal.contentEl.querySelectorAll("button");
    buttons[1].__component.clickCB();
    await expect(promise).resolves.toBe("remote");
  });

  it("der dritte Knopf loest mit 'cancel' auf", async () => {
    const app = new App();
    const promise = askConflict(app, opts);
    const modal = lastModal();
    const buttons = modal.contentEl.querySelectorAll("button");
    buttons[2].__component.clickCB();
    await expect(promise).resolves.toBe("cancel");
  });

  // Der Koerper kommt seit der Umstellung auf das Kit-askChoice aus dem Hook `render` (obsidian-kit 0.83.0):
  // der Diff steht VOR der Knopfzeile, loeschende Zeilen vor einfuegenden (Ersetzung: erst alt, dann neu).
  it("zeichnet den Zeilen-Diff vor der Knopfzeile (alt rot, neu gruen, Kontext unveraendert)", async () => {
    const app = new App();
    const promise = askConflict(app, { wikiPath: "a", localText: "gleich\nneu", remoteText: "gleich\nalt" });
    const modal = lastModal();
    const zeilen = [...modal.contentEl.querySelectorAll(".wikijs-diff-line")].map((z: any) => `${z.className.split(" ").pop()}:${z.textContent}`);
    expect(zeilen).toEqual(["wikijs-diff-ctx:gleich", "wikijs-diff-del:alt", "wikijs-diff-add:neu"]);
    const kinder = [...modal.contentEl.children].map((c: any) => c.className);
    expect(kinder.indexOf("wikijs-diff")).toBeGreaterThanOrEqual(0);
    expect(kinder.indexOf("wikijs-diff")).toBeLessThan(kinder.indexOf("modal-button-container"));
    modal.close();
    await promise;
  });

  it("die Knopfbeschriftungen stehen in der Reihenfolge lokal, Wiki, abbrechen, nur der erste ist Hauptknopf", async () => {
    const app = new App();
    const promise = askConflict(app, opts);
    const modal = lastModal();
    const knoepfe = [...modal.contentEl.querySelectorAll("button")].map((b: any) => b.__component);
    expect(knoepfe.map((k: any) => k.textValue)).toEqual(["conflict.keepLocal", "conflict.keepRemote", "conflict.cancel"]); // ohne registrierte Strings liefert t() den Schluessel
    expect(knoepfe.map((k: any) => k.ctaSet)).toEqual([true, false, false]);
    modal.close();
    await promise;
  });
});
