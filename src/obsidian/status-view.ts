// Status-Ansicht: die eine Stelle, an der der Nutzer den Plan sieht, bevor er ihn
// ausfuehrt. Sie rechnet nichts aus — planSync() hat das getan.
import { ItemView, Notice, Setting, type WorkspaceLeaf } from "obsidian";
import { statusLabelKey, type SyncEntry } from "../core/sync-plan";
import { t } from "../vendor/kit/i18n";
import { describeOutcome, describePullOutcome } from "./describe-outcome";
import type { BuiltPlan, SyncService } from "./sync-service";

export const VIEW_TYPE_WIKIJS_STATUS = "wikijs-status";

// "conflict" ist bewusst pushbar: pushOne loest ueber den resolveConflict-Adapter
// (askConflict-Modal) auf, statt stillschweigend nichts zu tun — s. sync-service.ts.
const PUSHABLE = new Set(["create", "update", "conflict"]);
// pullOne liefert fuer JEDEN anderen Zustand nur { kind: "skipped" } (Spec-Vorgabe
// aus Task 14) -- ein Knopf dafuer waere sichtbar wirkungslos. Insbesondere
// "conflict" und "removed-locally" bekommen deshalb KEINEN Pull-Knopf.
const PULLABLE = new Set(["remote-changed", "new-remote"]);

export class WikijsStatusView extends ItemView {
  private showUnchanged = false;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly service: () => SyncService,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_WIKIJS_STATUS;
  }

  getDisplayText(): string {
    return t("view.title");
  }

  getIcon(): string {
    return "cloud";
  }

  async onOpen(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const container = this.contentEl;
    container.empty();
    container.createEl("h3", { text: t("view.title") });

    let plan: BuiltPlan;
    try {
      plan = await this.service().buildPlan();
    } catch (err) {
      container.createEl("p", { text: t("notice.error", err instanceof Error ? err.message : String(err)) });
      return;
    }

    new Setting(container)
      .setName(t("view.showUnchanged"))
      .addButton((b) => b.setButtonText(t("view.refresh")).onClick(() => void this.refresh()))
      .addToggle((tg) =>
        tg.setValue(this.showUnchanged).onChange((v) => {
          this.showUnchanged = v;
          void this.refresh();
        }),
      );

    // Kollisionen oben und unuebersehbar: solange eine besteht, ist fuer die
    // beteiligten Pfade JEDER Push gesperrt (Spec § 3) -- sonst ueberschriebe die
    // zweite Datei stillschweigend die erste.
    const blocked = new Set<string>();
    for (const collision of plan.collisions) {
      blocked.add(collision.wikiPath);
      const box = container.createDiv({ cls: "wikijs-collision" });
      box.createEl("strong", { text: t("view.collision", collision.wikiPath) });
      for (const vaultPath of collision.vaultPaths) box.createDiv({ text: vaultPath });
    }

    // Mehrdeutige Dateinamen sperren NICHTS -- sie sind ein Hinweis, kein Fehler:
    // die betroffenen Seiten werden gepusht, nur `[[Dateiname]]` bleibt in ihnen
    // Text statt Link (Entscheidung 2026-08-09). Sie stehen hier, weil genau hier
    // der Ort ist, an dem man sie behebt: Datei umbenennen oder Link auf die
    // Pfadform aendern.
    for (const ambiguous of plan.ambiguousNames) {
      const box = container.createDiv({ cls: "wikijs-ambiguous" });
      box.createEl("strong", { text: t("view.ambiguous", ambiguous.name) });
      box.createDiv({ text: t("view.ambiguous.hint", ambiguous.name) });
      for (const vaultPath of ambiguous.vaultPaths) box.createDiv({ text: vaultPath });
    }

    const entries = plan.entries.filter((e) => this.showUnchanged || e.state !== "unchanged");
    if (entries.length === 0) container.createEl("p", { text: t("view.empty") });

    for (const entry of entries) this.renderRow(container, entry, plan, blocked.has(entry.wikiPath));
  }

  private renderRow(container: HTMLElement, entry: SyncEntry, plan: BuiltPlan, isBlocked: boolean): void {
    const row = new Setting(container).setName(entry.wikiPath).setDesc(t(statusLabelKey(entry.state)));
    if (isBlocked) {
      row.setDesc(t("status.collision"));
      return;
    }
    if (PUSHABLE.has(entry.state)) {
      const meta = plan.meta.get(entry.wikiPath);
      if (meta !== undefined) {
        row.addButton((b) =>
          b.setButtonText(t("view.push")).onClick(async () => {
            await this.handlePush(entry.wikiPath);
            await this.refresh();
          }),
        );
      }
    }
    if (PULLABLE.has(entry.state)) {
      row.addButton((b) =>
        b.setButtonText(t("view.pull")).onClick(async () => {
          await this.handlePull(entry.wikiPath);
          await this.refresh();
        }),
      );
    }
  }

  /** Important-Befund „Status-Ansicht handelt auf einer veralteten Momentaufnahme":
   *  `entry`/`meta`/`plan.collisions` aus dem letzten `refresh()` waren im Klick-Handler
   *  eingeschlossen und wurden unveraendert an `pushOne` gereicht -- der Drift-Guard im
   *  Dienst wird live nachgezogen, Inhalt und Kollisionsliste dagegen NICHT. Zwischen
   *  Refresh und Klick koennen Minuten liegen (Notiz weiterbearbeitet) oder eine neue
   *  Slug-Kollision entstanden sein (zweite Datei auf denselben Wiki-Pfad). Der Klick
   *  baut den Plan deshalb NEU und schlaegt den Eintrag ueber seinen wikiPath nach --
   *  genau das, was `pushCurrent` in main.ts bereits tut. Findet er ihn nicht mehr, oder
   *  ist er inzwischen kollidiert, passiert kein Push; der anschliessende refresh() zeigt
   *  den echten, aktuellen Zustand (leere Zeile bzw. Kollisions-Warnblock). */
  private async handlePush(wikiPath: string): Promise<void> {
    try {
      const service = this.service();
      const freshPlan = await service.buildPlan();
      if (freshPlan.collisions.some((c) => c.wikiPath === wikiPath)) return;
      const freshEntry = freshPlan.entries.find((e) => e.wikiPath === wikiPath);
      const freshMeta = freshEntry === undefined ? undefined : freshPlan.meta.get(wikiPath);
      if (freshEntry === undefined || freshMeta === undefined) return;
      const outcome = await service.pushOne(freshEntry, freshMeta, freshPlan.collisions);
      new Notice(describeOutcome(outcome, wikiPath));
    } catch (err) {
      new Notice(t("notice.error", err instanceof Error ? err.message : String(err)));
    }
  }

  // Dieselbe Momentaufnahme-Luecke wie bei handlePush, fuer Pull -- s. Kommentar dort.
  private async handlePull(wikiPath: string): Promise<void> {
    try {
      const service = this.service();
      const freshPlan = await service.buildPlan();
      const freshEntry = freshPlan.entries.find((e) => e.wikiPath === wikiPath);
      if (freshEntry === undefined) return;
      const outcome = await service.pullOne(freshEntry);
      new Notice(describePullOutcome(outcome, wikiPath));
    } catch (err) {
      new Notice(t("notice.error", err instanceof Error ? err.message : String(err)));
    }
  }
}
