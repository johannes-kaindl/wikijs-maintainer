// Entfernen-Dialog: bei "removed-locally" fragt das Plugin nach, was mit der
// Wiki-Seite geschehen soll. Depublizieren ist der Default (Spec § 3) — die Seite
// verschwindet aus dem Wiki, ihre Historie bleibt. Loeschen ist unumkehrbar und
// deshalb nie die Vorauswahl. Das Kit-`confirm` genuegt hier NICHT: dessen Fassade
// ist zweiwertig (Promise<boolean>), diese Frage ist dreiwertig — eine Kaskade aus
// zwei Ja/Nein-Dialogen waere die schlechtere Oberflaeche.
import { App, Modal, Setting } from "obsidian";
import { t } from "../vendor/kit/i18n";

export type RemovalChoice = "unpublish" | "delete" | "keep";

class RemovalModal extends Modal {
  private done: ((choice: RemovalChoice) => void) | null;

  constructor(app: App, private readonly wikiPath: string, done: (choice: RemovalChoice) => void) {
    super(app);
    this.done = done;
  }

  // finish() nullt den Callback VOR dem Aufloesen: Button-Klick und nachlaufendes
  // onClose loesen sonst doppelt auf. Der Re-Entrance-Guard (`this.done === null` →
  // return) ist zusaetzlich zum vendorten Muster noetig: das echte Obsidian-Modal
  // schuetzt close() intern gegen doppeltes Schliessen, der Test-Doppelgaenger
  // (obsidian-mock.ts) tut das nicht — ohne Guard ruft close() -> onClose() ->
  // finish() -> close() sich endlos selbst.
  //
  // Reihenfolge INNERHALB von finish() ist bewusst anders als im Kit-Confirm
  // (src/vendor/kit-obsidian/confirm.ts) und in conflict-modal.ts: dort steht
  // `done(choice)` VOR `close()`, hier `close()` VOR `done(choice)`. Beide
  // Reihenfolgen sind durch den Null-Guard gleichermassen sicher gegen die
  // Doppelaufloesung, die der Kommentar oben beschreibt — es ist keine zweite Kopie
  // desselben Musters, nur derselbe Guard in unterschiedlicher Reihenfolge.
  private finish(choice: RemovalChoice): void {
    if (this.done === null) return;
    const done = this.done;
    this.done = null;
    this.close();
    done(choice);
  }

  onOpen(): void {
    this.titleEl.setText(t("removal.title"));
    this.contentEl.createEl("p", { text: t("removal.body", this.wikiPath) });
    new Setting(this.contentEl)
      // Depublizieren ist CTA: umkehrbar. Loeschen ist es nicht und bleibt unbetont.
      .addButton((b) => b.setButtonText(t("removal.unpublish")).setCta().onClick(() => { this.finish("unpublish"); }))
      .addButton((b) => b.setButtonText(t("removal.delete")).onClick(() => { this.finish("delete"); }))
      .addButton((b) => b.setButtonText(t("removal.keep")).onClick(() => { this.finish("keep"); }));
  }

  onClose(): void {
    this.contentEl.empty();
    this.finish("keep"); // Esc darf nie depublizieren oder loeschen
  }
}

export function askRemoval(app: App, wikiPath: string): Promise<RemovalChoice> {
  return new Promise((resolve) => new RemovalModal(app, wikiPath, resolve).open());
}
