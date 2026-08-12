// Konflikt-Dialog: zeigt den Zeilen-Diff zwischen der zuletzt gepushten Fassung und
// dem, was jetzt im Wiki steht, und laesst den Nutzer entscheiden. Bewusst KEIN
// Merge — der kommt in V3; hier gilt "sehen, dann entscheiden".
import { App, Modal, Setting } from "obsidian";
import { diffLines } from "../core/diff";
import { t } from "../vendor/kit/i18n";

export type ConflictChoice = "local" | "remote" | "cancel";

class ConflictModal extends Modal {
  private done: ((choice: ConflictChoice) => void) | null;

  constructor(
    app: App,
    private readonly opts: { wikiPath: string; localText: string; remoteText: string },
    done: (choice: ConflictChoice) => void,
  ) {
    super(app);
    this.done = done;
  }

  // Muster aus dem Kit-confirm (src/vendor/kit-obsidian/confirm.ts): Guard zuerst
  // (sonst rekursiert close() -> onClose() -> finish() -> close() -> ... endlos, weil
  // der Test-Doppelgaenger aus obsidian-mock.ts close() synchron auf onClose() abbildet
  // und nichts sonst das Wiederbetreten verhindert), dann Callback NULLEN und AUFRUFEN
  // VOR close() — Button-Klick und nachlaufendes onClose loesen sonst doppelt auf.
  // removal-modal.ts loest denselben Guard mit vertauschter Reihenfolge (close() vor
  // done()) — beide sind wegen des Null-Guards gleichermassen sicher, s. Kommentar dort.
  private finish(choice: ConflictChoice): void {
    if (this.done === null) return;
    const done = this.done;
    this.done = null;
    done(choice);
    this.close();
  }

  onOpen(): void {
    this.titleEl.setText(t("conflict.title", this.opts.wikiPath));
    const diffEl = this.contentEl.createDiv({ cls: "wikijs-diff" });
    for (const line of diffLines(this.opts.remoteText, this.opts.localText)) {
      diffEl.createDiv({ cls: `wikijs-diff-line wikijs-diff-${line.kind}`, text: line.text === "" ? " " : line.text });
    }
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText(t("conflict.keepLocal")).setCta().onClick(() => { this.finish("local"); }))
      .addButton((b) => b.setButtonText(t("conflict.keepRemote")).onClick(() => { this.finish("remote"); }))
      .addButton((b) => b.setButtonText(t("conflict.cancel")).onClick(() => { this.finish("cancel"); }));
  }

  onClose(): void {
    this.contentEl.empty();
    this.finish("cancel"); // sonst haengt das Promise bei Esc oder Klick daneben
  }
}

export function askConflict(app: App, opts: { wikiPath: string; localText: string; remoteText: string }): Promise<ConflictChoice> {
  return new Promise((resolve) => new ConflictModal(app, opts, resolve).open());
}
