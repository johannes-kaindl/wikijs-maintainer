import { describe, expect, it } from "vitest";
import { App, Modal } from "obsidian";
import { askRemoval } from "../src/obsidian/removal-modal";

// Modal.__last ist eine Testaffordanz des Kit-Mocks (obsidian-mock.ts): der zuletzt
// konstruierte Modal-Doppelgaenger. modal.close() ruft im Mock synchron onClose()
// auf — genau der Pfad, den Obsidian bei Esc oder Klick daneben nimmt.
function lastModal(): { contentEl: any; titleEl: any; close: () => void } {
  return (Modal as unknown as { __last: { contentEl: any; titleEl: any; close: () => void } }).__last;
}

describe("askRemoval", () => {
  it("loest bei Esc (Schliessen ohne Knopfdruck) mit 'keep' auf, niemals mit 'delete' oder 'unpublish'", async () => {
    const app = new App();
    const promise = askRemoval(app, "a");
    lastModal().close();
    await expect(promise).resolves.toBe("keep");
  });

  it("ein Klick loest auf; ein nachfolgendes Schliessen darf das Ergebnis NICHT mehr auf 'keep' umbiegen", async () => {
    const app = new App();
    const promise = askRemoval(app, "a");
    const modal = lastModal();
    const buttons = modal.contentEl.querySelectorAll("button");
    expect(buttons.length).toBe(3);
    buttons[0].__component.clickCB(); // erster Knopf = Depublizieren (CTA)
    modal.close(); // Esc NACH dem Klick darf nichts mehr aendern (Callback-Null-Pattern)
    await expect(promise).resolves.toBe("unpublish");
  });

  it("der zweite Knopf loest mit 'delete' auf", async () => {
    const app = new App();
    const promise = askRemoval(app, "a");
    const modal = lastModal();
    const buttons = modal.contentEl.querySelectorAll("button");
    buttons[1].__component.clickCB();
    await expect(promise).resolves.toBe("delete");
  });

  it("der dritte Knopf loest mit 'keep' auf; Titel, Satz und Knopfreihenfolge (Texte ohne geladene Strings: die Schluessel)", async () => {
    const app = new App();
    const promise = askRemoval(app, "docs/Seite");
    const modal = lastModal();
    expect(modal.titleEl.textContent).toBe("removal.title");
    expect(modal.contentEl.textContent).toContain("removal.body");
    const buttons = modal.contentEl.querySelectorAll("button");
    expect(buttons.map((b: any) => b.__component.textValue)).toEqual(["removal.unpublish", "removal.delete", "removal.keep"]);
    expect(buttons.map((b: any) => b.__component.ctaSet)).toEqual([true, false, false]); // nur Depublizieren (umkehrbar) ist Hauptknopf
    buttons[2].__component.clickCB();
    await expect(promise).resolves.toBe("keep");
  });
});
