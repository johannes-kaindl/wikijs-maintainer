// "Bestand uebernehmen": der Vorab-Bericht, was passieren wuerde, und die Wahl bei bereits
// vorhandenen Notizen ("Wiki gewinnt" / "ueberspringen"). Schreibt nie ins Wiki; das sagt der
// Dialog auch. Esc heisst Abbrechen, nie eine Uebernahme.
import { App, Modal, Setting } from "obsidian";
import { t } from "../vendor/kit/i18n";
import type { ImportMode, ImportPreview } from "./sync-service";

export type ImportChoice = ImportMode | "cancel";

class ImportModal extends Modal {
  private done: ((choice: ImportChoice) => void) | null;

  constructor(app: App, private readonly preview: ImportPreview, done: (choice: ImportChoice) => void) {
    super(app);
    this.done = done;
  }

  // Callback VOR dem Aufloesen nullen: Klick und nachlaufendes onClose loesen sonst doppelt auf.
  private finish(choice: ImportChoice): void {
    if (this.done === null) return;
    const done = this.done;
    this.done = null;
    this.close();
    done(choice);
  }

  onOpen(): void {
    const { create, overwrite } = this.preview;
    this.titleEl.setText(t("import.title"));
    this.contentEl.createEl("p", { text: t("import.body", create.length, overwrite.length) });
    this.contentEl.createEl("p", { text: t("import.noWrite") });
    const buttons = new Setting(this.contentEl);
    if (overwrite.length > 0) {
      buttons
        .addButton((b) => b.setButtonText(t("import.skipExisting")).setCta().onClick(() => { this.finish("skip-existing"); }))
        .addButton((b) => b.setButtonText(t("import.wikiWins")).onClick(() => { this.finish("wiki-wins"); }));
    } else {
      buttons.addButton((b) => b.setButtonText(t("import.go")).setCta().onClick(() => { this.finish("wiki-wins"); }));
    }
    buttons.addButton((b) => b.setButtonText(t("confirm.cancel")).onClick(() => { this.finish("cancel"); }));
  }

  onClose(): void {
    this.contentEl.empty();
    this.finish("cancel");
  }
}

export function askImport(app: App, preview: ImportPreview): Promise<ImportChoice> {
  return new Promise((resolve) => new ImportModal(app, preview, resolve).open());
}
