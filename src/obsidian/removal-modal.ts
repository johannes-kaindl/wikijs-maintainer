// Entfernen-Dialog: bei "removed-locally" fragt das Plugin nach, was mit der
// Wiki-Seite geschehen soll. Depublizieren ist der Default (Spec § 3) — die Seite
// verschwindet aus dem Wiki, ihre Historie bleibt. Loeschen ist unumkehrbar und
// deshalb nie die Vorauswahl. Das Kit-`confirm` genuegt hier NICHT: dessen Fassade
// ist zweiwertig (Promise<boolean>), diese Frage ist dreiwertig — der Dialog ist
// das Kit-`askChoice` (Auswahl mit drei und mehr Antworten).
import type { App } from "obsidian";
import { t } from "../vendor/kit/i18n";
import { askChoice } from "../vendor/kit-obsidian/choice-modal";

export type RemovalChoice = "unpublish" | "delete" | "keep";

/** Esc oder Klick daneben liefert in `askChoice` `null`; hier heisst das „keep“ — Schliessen darf nie depublizieren oder loeschen. */
export async function askRemoval(app: App, wikiPath: string): Promise<RemovalChoice> {
  const choice = await askChoice<RemovalChoice>(app, {
    title: t("removal.title"),
    message: t("removal.body", wikiPath),
    options: [
      // Depublizieren ist CTA: umkehrbar. Loeschen ist es nicht und bleibt unbetont.
      { value: "unpublish", label: t("removal.unpublish"), cta: true },
      { value: "delete", label: t("removal.delete") },
      { value: "keep", label: t("removal.keep") },
    ],
  });
  return choice ?? "keep";
}
