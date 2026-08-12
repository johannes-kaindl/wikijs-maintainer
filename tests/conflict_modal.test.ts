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
});
