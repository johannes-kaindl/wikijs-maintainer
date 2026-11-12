// Konflikt-Dialog: zeigt den Zeilen-Diff zwischen der zuletzt gepushten Fassung und
// dem, was jetzt im Wiki steht, und laesst den Nutzer entscheiden. Bewusst KEIN
// Merge — der kommt in V3; hier gilt "sehen, dann entscheiden".
// Der Dialog ist das Kit-`askChoice` mit Koerper-Hook (obsidian-kit 0.83.0): Knoepfe, Esc und
// Aufloesung gehoeren dem Kit, der Zeilen-Diff wird im Hook gezeichnet.
import type { App } from "obsidian";
import { diffLines } from "../vendor/kit/diff";
import { t } from "../vendor/kit/i18n";
import { askChoice } from "../vendor/kit-obsidian/choice-modal";

export type ConflictChoice = "local" | "remote" | "cancel";

/** Esc, Klick daneben und Schliessen liefern in `askChoice` `null`; hier heisst das „cancel“ — nichts wird geschrieben. */
export async function askConflict(app: App, opts: { wikiPath: string; localText: string; remoteText: string }): Promise<ConflictChoice> {
  const choice = await askChoice<ConflictChoice>(app, {
    title: t("conflict.title", opts.wikiPath),
    options: [
      { value: "local", label: t("conflict.keepLocal"), cta: true },
      { value: "remote", label: t("conflict.keepRemote") },
      { value: "cancel", label: t("conflict.cancel") },
    ],
    render: (contentEl) => {
      const diffEl = contentEl.createDiv({ cls: "wikijs-diff" });
      for (const line of diffLines(opts.remoteText, opts.localText)) {
        diffEl.createDiv({ cls: `wikijs-diff-line wikijs-diff-${line.kind}`, text: line.text === "" ? " " : line.text });
      }
    },
  });
  return choice ?? "cancel";
}
