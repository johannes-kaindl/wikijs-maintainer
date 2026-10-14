import { describe, expect, it } from "vitest";
import { App, Modal } from "obsidian";
import { askImport } from "../src/obsidian/import-modal";

function lastModal(): { contentEl: any; close: () => void } {
  return (Modal as unknown as { __last: { contentEl: any; close: () => void } }).__last;
}

describe("askImport", () => {
  it("Esc (Schliessen ohne Knopf) heisst Abbrechen, nie eine Uebernahme", async () => {
    const promise = askImport(new App(), { create: ["a"], overwrite: [] });
    lastModal().close();
    await expect(promise).resolves.toBe("cancel");
  });

  it("ohne vorhandene Notizen: ein Uebernehmen-Knopf und Abbrechen", async () => {
    const promise = askImport(new App(), { create: ["a"], overwrite: [] });
    const buttons = lastModal().contentEl.querySelectorAll("button");
    expect(buttons).toHaveLength(2);
    buttons[0].__component.clickCB();
    await expect(promise).resolves.toBe("wiki-wins");
  });

  it("mit vorhandenen Notizen ist 'nur neue' die Vorauswahl (CTA), 'Wiki gewinnt' der zweite Knopf", async () => {
    const promise = askImport(new App(), { create: ["a"], overwrite: ["b"] });
    const modal = lastModal();
    const buttons = modal.contentEl.querySelectorAll("button");
    expect(buttons).toHaveLength(3);
    buttons[1].__component.clickCB();
    modal.close(); // ein Schliessen NACH dem Klick darf das Ergebnis nicht mehr aendern
    await expect(promise).resolves.toBe("wiki-wins");
  });

  it("der erste Knopf bei vorhandenen Notizen ueberspringt sie", async () => {
    const promise = askImport(new App(), { create: [], overwrite: ["b"] });
    lastModal().contentEl.querySelectorAll("button")[0].__component.clickCB();
    await expect(promise).resolves.toBe("skip-existing");
  });
});
