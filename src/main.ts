import { getLanguage, Notice, Plugin, type TFile, type WorkspaceLeaf } from "obsidian";
import { defineStrings, pickLang, setLang, t } from "./vendor/kit/i18n";
import { STRINGS } from "./i18n/strings";
import { mergeWikijsSettings, type WikijsSettings } from "./core/settings-types";
import { vaultPathToWikiPath } from "./core/paths";
import { WikijsSettingsTab } from "./obsidian/settings";
import { SyncService } from "./obsidian/sync-service";
import { SnapshotStore } from "./obsidian/snapshot-store";
import { WikiClient } from "./wikijs/client";
import { askConflict } from "./obsidian/conflict-modal";
import { askRemoval } from "./obsidian/removal-modal";
import { WikijsStatusView, VIEW_TYPE_WIKIJS_STATUS } from "./obsidian/status-view";
import { describeError, describeOutcome, describePullOutcome } from "./obsidian/describe-outcome";
import { formatReport } from "./obsidian/format-report";

/** Einstiegspunkt. Bewusst duenn: Commands und Wiring kommen mit den
 *  Plan-Tasks hinzu, die Fachlogik lebt in `src/core/`. */
export default class WikijsMaintainerPlugin extends Plugin {
  settings: WikijsSettings = mergeWikijsSettings(null);

  async onload(): Promise<void> {
    // Reihenfolge ist load-bearing: Strings und Sprache stehen VOR jeder
    // Registrierung (addCommand/addSettingTab/addRibbonIcon), sonst tragen
    // Command-Namen den Schluessel statt des uebersetzten Texts.
    defineStrings(STRINGS);
    setLang(pickLang(getLanguage()));

    this.settings = mergeWikijsSettings(await this.loadData());
    this.addSettingTab(new WikijsSettingsTab(this.app, this));

    // Dienst wird pro Leaf frisch via buildService() erzeugt (s. Kommentar dort) --
    // die View haelt nur den Fabrikator, keinen fixen Dienst.
    this.registerView(VIEW_TYPE_WIKIJS_STATUS, (leaf: WorkspaceLeaf) => new WikijsStatusView(leaf, () => this.buildService()));

    this.addCommand({
      id: "show-sync-status",
      name: t("command.showStatus"),
      callback: () => void this.activateStatusView(),
    });

    this.addCommand({
      id: "push-current-note",
      name: t("command.pushCurrent"),
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (file === null) return false;
        if (checking) return true;
        void this.pushCurrent(file);
        return true;
      },
    });

    this.addCommand({
      id: "push-all-changes",
      name: t("command.pushAll"),
      callback: () => void this.pushAll(),
    });

    this.addCommand({
      id: "pull-current-note",
      name: t("command.pullCurrent"),
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (file === null) return false;
        if (checking) return true;
        void this.pullCurrent(file);
        return true;
      },
    });
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  // Minor-Befund „Verwaister i18n-Schluessel notice.noUrl": ohne Wiki-URL/API-Key baut
  // der Client trotzdem einen Endpunkt ("/graphql") und der Nutzer sieht einen
  // Transportfehler statt einer klaren Ansage. Der Guard steht am Anfang JEDES der
  // vier Commands -- vor jedem Aufbau eines Dienstes/Clients.
  private hasCredentials(): boolean {
    return this.settings.baseUrl.trim() !== "" && this.settings.apiKey.trim() !== "";
  }

  // Wiederverwendet eine bereits offene Status-Ansicht statt eine zweite zu
  // oeffnen -- ansonsten haeuften sich bei jedem Command-Aufruf weitere Leaves.
  private async activateStatusView(): Promise<void> {
    if (!this.hasCredentials()) {
      new Notice(t("notice.noUrl"));
      return;
    }
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_WIKIJS_STATUS);
    if (existing.length > 0) {
      void this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf === null) return;
    await leaf.setViewState({ type: VIEW_TYPE_WIKIJS_STATUS, active: true });
    void this.app.workspace.revealLeaf(leaf);
  }

  // Der Dienst wird pro Aktion frisch gebaut, nicht im onload einmal — die
  // Settings koennen sich zwischen zwei Commands geaendert haben, und ein
  // Client mit veralteter URL schriebe sonst ins vorige Wiki.
  private buildService(): SyncService {
    return new SyncService({
      client: new WikiClient({
        baseUrl: this.settings.baseUrl,
        token: this.settings.apiKey,
        locale: this.settings.locale,
        timeoutMs: this.settings.timeoutSec * 1000,
      }),
      store: new SnapshotStore(this.app.vault.adapter, this.manifest.dir ?? ""),
      vault: this.app.vault,
      syncRoot: () => this.settings.syncRoot,
      resolveConflict: (entry, remoteContent) =>
        askConflict(this.app, {
          wikiPath: entry.wikiPath,
          localText: entry.local?.transformed ?? "",
          remoteText: remoteContent,
        }),
      askRemoval: (wikiPath) => askRemoval(this.app, wikiPath),
      // Legt fehlende Zwischenordner Ebene fuer Ebene an (nicht in einem einzigen
      // createFolder-Aufruf) — der vendorte Obsidian-Mock kennt getFolderByPath /
      // createFolder ohnehin nicht, und die reale API dokumentiert nicht, ob
      // createFolder mehrere fehlende Ebenen in einem Rutsch anlegt. Schrittweise
      // ist unabhaengig davon korrekt: existierende Ordner werden uebersprungen.
      writeNote: async (vaultPath: string, content: string): Promise<void> => {
        const segments = vaultPath.split("/").slice(0, -1);
        let built = "";
        for (const segment of segments) {
          built = built === "" ? segment : `${built}/${segment}`;
          if (this.app.vault.getFolderByPath(built) === null) {
            await this.app.vault.createFolder(built);
          }
        }
        const existing = this.app.vault.getFileByPath(vaultPath);
        if (existing === null) await this.app.vault.create(vaultPath, content);
        else await this.app.vault.modify(existing, content);
      },
    });
  }

  private async pushCurrent(file: TFile): Promise<void> {
    if (!this.hasCredentials()) {
      new Notice(t("notice.noUrl"));
      return;
    }
    const service = this.buildService();
    const wikiPath = vaultPathToWikiPath(file.path, this.settings.syncRoot);
    if (wikiPath === null) {
      new Notice(t("notice.outsideRoot", this.settings.syncRoot));
      return;
    }
    try {
      const plan = await service.buildPlan();
      const entry = plan.entries.find((e) => e.wikiPath === wikiPath);
      const meta = plan.meta.get(wikiPath);
      // Minor-Befund „Stumme Rueckkehr": die aktive Datei liegt zwar im Sync-Ordner,
      // ist aber keine gesyncte Seite (z.B. ein .canvas dort) -- ohne Notice sah es
      // aus, als waere gar nichts passiert.
      if (entry === undefined || meta === undefined) {
        new Notice(t("notice.notSyncable", wikiPath));
        return;
      }
      const outcome = await service.pushOne(entry, meta, plan.collisions);
      new Notice(describeOutcome(outcome, wikiPath));
    } catch (err) {
      new Notice(describeError(err));
    }
  }

  // Sammel-Push ueber den gesamten Plan. Ein Fehler bei einer Seite bricht den Lauf
  // nicht ab (Spec § 3) — das gilt bereits in SyncService.pushAll; hier wird nur der
  // gesammelte Report sichtbar gemacht.
  private async pushAll(): Promise<void> {
    if (!this.hasCredentials()) {
      new Notice(t("notice.noUrl"));
      return;
    }
    try {
      const service = this.buildService();
      const plan = await service.buildPlan();
      const report = await service.pushAll(plan);
      new Notice(formatReport(report));
    } catch (err) {
      new Notice(describeError(err));
    }
  }

  // Pull ueber die aktive Datei: der Wiki-Pfad kommt wie bei pushCurrent aus dem
  // Vault-Pfad. Das deckt nur `remote-changed` ab (eine bereits lokal vorhandene
  // Seite hat einen aktiven Vault-Pfad) — `new-remote`-Seiten haben noch keine
  // lokale Datei und damit keinen aktiven Kontext, der diesen Command ausloesen
  // koennte. Ein "alle offenen Pulls anzeigen"-Weg ohne aktive Datei ist hier
  // bewusst NICHT gebaut (s. Bedenken im Task-Report).
  private async pullCurrent(file: TFile): Promise<void> {
    if (!this.hasCredentials()) {
      new Notice(t("notice.noUrl"));
      return;
    }
    const service = this.buildService();
    const wikiPath = vaultPathToWikiPath(file.path, this.settings.syncRoot);
    if (wikiPath === null) {
      new Notice(t("notice.outsideRoot", this.settings.syncRoot));
      return;
    }
    try {
      const plan = await service.buildPlan();
      const entry = plan.entries.find((e) => e.wikiPath === wikiPath);
      if (entry === undefined) {
        new Notice(t("notice.notSyncable", wikiPath));
        return;
      }
      const outcome = await service.pullOne(entry);
      new Notice(describePullOutcome(outcome, wikiPath));
    } catch (err) {
      new Notice(describeError(err));
    }
  }
}
