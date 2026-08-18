/**
 * Aufnahme-Treiber fuer die README-Bilder — faehrt den Vertrag aus `docs/images/README.md`
 * gegen ein **laufendes** Obsidian und eine **echte** Wiki.js-Instanz, statt die Bilder
 * von Hand zu klicken.
 *
 * Warum getrackt: ein Werkzeug, das nur einmal im Scratchpad existiert, ist keine Praxis.
 * Dieselbe Begruendung wie bei `scripts/gui-smoke.ts`, mit dem sich dieser Treiber die
 * CDP-Bruecke teilt. Bruecke, Aufnahme-Primitive und Fixture→Vault liegen zentral im Dach
 * (`obsidian-plugins/tools/obsidian-cdp/`) — dieser Treiber importiert sie von dort. Was
 * den Pruefling kennt (Zustaende herstellen, welches Bild was zeigt) bleibt hier.
 *
 * ## Ablauf
 *
 * ```bash
 * export STAGING_VAULTS_DIR="$HOME/StagingVaults"   # einmalig
 * export WIKIJS_URL="https://…" WIKIJS_TOKEN="…"     # dieselbe Instanz wie smoke:gui
 * npm run build && npm run shots -- --setup          # Vault aus dem Fixture bauen
 *
 * osascript -e 'quit app "Obsidian"'                 # Handarbeit: Debug-Port
 * open -a Obsidian --args --remote-debugging-port=9222
 * #   ... den Aufnahme-Vault oeffnen und einmalig als vertrauenswuerdig markieren
 *
 * npm run shots                                      # alles aufnehmen
 * npm run shots -- --only overview.png                   # ein Bild nachziehen
 * npm run shots -- --list                             # Vertrag anzeigen
 * ```
 *
 * ⚠️ Schreibt in die konfigurierte Wiki-Instanz. Legt ausschliesslich Seiten unter
 * `zz-shots/…` an und raeumt sie im `finally` wieder ab — auch nach einem Abbruch.
 *
 * ## Reihenfolge ist load-bearing
 *
 * `overview.png` muss VOR `conflict-modal.png` entstehen: der Konflikt-Zustand von
 * `network/overview` wird beim Aufnehmen des Dialogs aufgeloest ("Keep local"), damit
 * `push-all-changes` fuer `removal-modal.png` nicht ein zweites Mal darauf laeuft. Waere
 * die Reihenfolge umgekehrt, zeigte der Hero eine bereits aufgeloeste, "unveraenderte"
 * Zeile statt des Konflikts, den er zeigen soll.
 */

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { argv, cwd, env, exit } from "node:process";

import {
  attachTo,
  Cdp,
  closeExtraLeaves,
  openExisting,
  pollUntil,
  requireVisible,
  setAppConfig,
  setPluginSetting,
} from "../../tools/obsidian-cdp/cdp.js";
import {
  boxOf,
  capture,
  setWindowSize,
  writeShot,
  type Rect,
  type ShotOptions,
} from "../../tools/obsidian-cdp/shot.js";
import { buildVault, stagingVaultDir } from "../../tools/obsidian-cdp/vault.js";

const PLUGIN_ID = "wikijs-maintainer";
const STATUS_VIEW = "wikijs-status";
const REPO_NAME = "wikijs-maintainer";
const OUT_DIR = "docs/images";
const CAPTURE_WIDTH = 1200;
const THUMB_WIDTH = 380;
const FENSTER_BREITE = 1440;
const FENSTER_HOEHE = 960;

/** Alle Wiki-Pfade und Vault-Notizen des Laufs liegen unter diesem Ordner — die
 *  Zusicherung an die Instanz: der Treiber fasst nichts an, was nicht ihm gehoert, und
 *  das `finally` weiss, was es abraeumen darf. Ordner statt Praefix (wie bei
 *  `zz-smoke-` im GUI-Smoke), weil hier auch Unterordner fuer Kollision/Konflikt
 *  vorkommen — ein Praefix vor jedem Segment waere unleserlich. */
const ROOT = "zz-shots";

// --- Wiki-Seite: Zustaende herstellen ----------------------------------------

interface WikiPage {
  id: number;
  path: string;
  title: string;
}

class Wiki {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  private async gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl.replace(/\/+$/, "")}/graphql`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    const payload = (await response.json()) as { data?: T; errors?: { message: string }[] };
    if (payload.errors?.length) throw new Error(`Wiki: ${payload.errors.map((e) => e.message).join("; ")}`);
    if (!payload.data) throw new Error("Wiki: Antwort ohne data");
    return payload.data;
  }

  async list(): Promise<WikiPage[]> {
    const data = await this.gql<{ pages: { list: WikiPage[] } }>(
      `{ pages { list(orderBy: PATH) { id path title } } }`,
    );
    return data.pages.list;
  }

  async find(path: string): Promise<WikiPage | undefined> {
    return (await this.list()).find((p) => p.path === path);
  }

  /** Aendert eine Seite DIREKT im Wiki, am Plugin vorbei — stellt den Konflikt-Zustand
   *  her (der Push-Guard vergleicht `updatedAt` gegen den Snapshot). */
  async editDirectly(id: number, title: string, content: string): Promise<void> {
    await this.gql(
      `mutation($id: Int!, $content: String!, $description: String!, $tags: [String]!, $title: String!) {
        pages { update(id: $id, content: $content, description: $description, tags: $tags, title: $title, isPublished: true) {
          responseResult { succeeded errorCode message }
        } }
      }`,
      { id, content, description: "shots fixture", tags: [], title },
    );
  }

  /** Raeumt jede Seite ab, die der Lauf angelegt hat — und nur die. */
  async purge(): Promise<number> {
    const mine = (await this.list()).filter((p) => p.path.startsWith(ROOT));
    for (const page of mine) {
      await this.gql(`mutation($id: Int!) { pages { delete(id: $id) { responseResult { succeeded } } } }`, {
        id: page.id,
      });
    }
    return mine.length;
  }
}

// --- Kleine Obsidian-Helfer ----------------------------------------------------

/** Notiz aktivieren, Command feuern, auf die Notice als Abschluss-Signal warten. Wie
 *  `runCommand` in `gui-smoke.ts` — hier bewusst schlanker, weil kein Meldungstext
 *  gebraucht wird, nur der Abschluss. */
async function pushNote(cdp: Cdp, path: string, timeoutMs = 20_000): Promise<void> {
  if (!(await openExisting(cdp, path, "preview"))) {
    throw new Error(`${path} liess sich nicht oeffnen — liegt sie im Vault?`);
  }
  await closeExtraLeaves(cdp);
  await cdp.evaluate(`
    document.querySelectorAll(".notice").forEach((n) => n.remove());
    app.commands.executeCommandById(${JSON.stringify(`${PLUGIN_ID}:push-current-note`)});
    return true;
  `);
  const gemeldet = await pollUntil<boolean>(cdp, `
    return !!document.querySelector(".notice");
  `, timeoutMs, 200);
  if (!gemeldet) throw new Error(`${path} — keine Meldung nach dem Push binnen ${timeoutMs} ms`);
}

/** Snapshot-Datei zu genau einem Wiki-Pfad entfernen (nicht per Praefix — sonst reisst
 *  ein Schritt dem naechsten die Vorbedingung weg). Stellt "Belegt" her: lokale Notiz und
 *  Wiki-Seite bestehen, der Snapshot, der beide verbindet, nicht mehr. */
async function dropSnapshot(cdp: Cdp, wikiPath: string): Promise<void> {
  await cdp.evaluate(`
    const dir = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].manifest.dir + "/snapshots";
    if (!(await app.vault.adapter.exists(dir))) return "kein Snapshot-Ordner";
    const listing = await app.vault.adapter.list(dir);
    for (const file of listing.files) {
      if (!file.endsWith(".json")) continue;
      try {
        const snapshot = JSON.parse(await app.vault.adapter.read(file));
        if (snapshot.wikiPath === ${JSON.stringify(wikiPath)}) {
          await app.vault.adapter.remove(file);
          return "entfernt";
        }
      } catch {}
    }
    return "nicht gefunden";
  `);
}

/** Alle Snapshot-Dateien unter `ROOT` entfernen. `--setup` loescht nur `data.json`,
 *  nicht den ganzen Plugin-Datenordner — ein Snapshot aus einem frueheren Lauf
 *  ueberlebt den Vault-Neubau und blockiert den naechsten Push als "remote-deleted"
 *  (die zugehoerige Seite wurde ja tatsaechlich geloescht, per `wiki.purge()` im
 *  vorigen `finally`). Muss deshalb VOR jedem Lauf UND danach laufen, nicht nur danach. */
async function purgeSnapshots(cdp: Cdp): Promise<number> {
  return Number(await cdp.evaluate<number>(`
    const dir = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].manifest.dir + "/snapshots";
    if (!(await app.vault.adapter.exists(dir))) return 0;
    const listing = await app.vault.adapter.list(dir);
    let n = 0;
    for (const file of listing.files) {
      if (!file.endsWith(".json")) continue;
      try {
        const snapshot = JSON.parse(await app.vault.adapter.read(file));
        if (String(snapshot.wikiPath || "").startsWith(${JSON.stringify(ROOT)})) {
          await app.vault.adapter.remove(file);
          n++;
        }
      } catch {}
    }
    return n;
  `));
}

const refreshStatusView = `
  const leaf = app.workspace.getLeavesOfType(${JSON.stringify(STATUS_VIEW)})[0];
  if (!leaf) return "keine Status-Ansicht offen";
  await leaf.view.refresh();
  return "ok";
`;

// --- Lauf -----------------------------------------------------------------------

function flag(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}

/** Der Einstellungen-Tab lebt in einem EIGENEN Fenster (URL `about:blank`) — s.
 *  Kopfkommentar von `cdp.ts`, "Einstellungen sind ein eigenes Fenster". */
async function settingsBild(port: number, opts: ShotOptions): Promise<{ ok: boolean; msg: string }> {
  const workspace = await attachTo("workspace", port, REPO_NAME);
  if (!workspace) return { ok: false, msg: "settings.png — kein Hauptfenster gefunden" };
  await workspace.evaluate(`
    app.setting.open();
    app.setting.openTabById(${JSON.stringify(PLUGIN_ID)});
    await new Promise((r) => setTimeout(r, 900));
    return true;
  `);
  const fenster = await attachTo("settings", port);
  if (!fenster) return { ok: false, msg: "settings.png — kein Einstellungen-Fenster gefunden" };
  try {
    await fenster.send("Page.bringToFront");
    await new Promise((r) => setTimeout(r, 600));
    // NICHT die volle Containerhoehe (`.vertical-tab-content` reicht bis zum
    // Fensterende, auch wenn der Inhalt viel kuerzer ist — toter Weissraum unten).
    // Das LETZTE Kind entscheidet: seine Unterkante ist die tatsaechliche Inhaltshoehe.
    const box = await fenster.evaluate<Rect | null>(`
      const container = document.querySelector(".vertical-tab-content") ?? document.querySelector(".modal-content");
      if (!container) return null;
      const items = [...container.querySelectorAll(".setting-item")];
      const last = items[items.length - 1] ?? container;
      const top = container.getBoundingClientRect();
      const bottom = last.getBoundingClientRect();
      return { x: top.x, y: top.y, width: top.width, height: bottom.bottom - top.y };
    `);
    if (!box) return { ok: false, msg: "settings.png — kein Inhaltsbereich im Einstellungen-Fenster" };
    const png = await capture(fenster, box, 2);
    return { ok: true, msg: await writeShot(fenster, "settings.png", png, { ...opts, thumb: false }) };
  } finally {
    await fenster.evaluate("window.close(); return true;").catch(() => undefined);
    fenster.close();
  }
}

async function main(): Promise<void> {
  const repoRoot = cwd();
  const outDir = join(repoRoot, OUT_DIR);

  if (argv.includes("--list")) {
    console.log("  feature overview.png");
    console.log("  feature  settings.png");
    console.log("  feature  conflict-modal.png");
    console.log("  feature  removal-modal.png");
    return;
  }

  if (argv.includes("--setup")) {
    const vaultDir = stagingVaultDir(REPO_NAME);
    console.log(`Aufnahme-Vault: ${vaultDir}`);
    for (const zeile of buildVault({
      repoRoot,
      vaultDir,
      fixtureDir: join(repoRoot, "docs/images/fixture"),
      pluginId: PLUGIN_ID,
    })) {
      console.log(`  ${zeile}`);
    }
    console.log(
      "\n⚠️  Lief Obsidian waehrend dieses Setups, muss es JETZT neu starten. --setup hat\n" +
      "   Notizen, Layout und Plugin-Einstellungen ersetzt.\n" +
      "\nObsidian mit offenem Debug-Port starten und diesen Vault oeffnen:\n" +
      "  osascript -e 'quit app \"Obsidian\"'\n" +
      "  open -a Obsidian --args --remote-debugging-port=9222\n" +
      "Beim ersten Mal fragt Obsidian, ob es dem Vault-Autor vertraut — bestaetigen,\n" +
      "sonst laeuft das Plugin nicht.",
    );
    return;
  }

  const wikijsUrl = env.WIKIJS_URL;
  const wikijsToken = env.WIKIJS_TOKEN;
  if (!wikijsUrl || !wikijsToken) {
    throw new Error(
      "WIKIJS_URL und WIKIJS_TOKEN muessen gesetzt sein — dieselbe Instanz wie `npm run " +
      "smoke:gui` bzw. `npm run lab:wikijs`. Der Wert wird nie ausgegeben.",
    );
  }

  const port = Number(flag("--port") ?? env.SHOTS_PORT ?? 9222);
  const nur = flag("--only");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const cdp = await attachTo("workspace", port, REPO_NAME);
  if (!cdp) {
    throw new Error(
      `Kein Obsidian-Fenster mit dem Vault "${REPO_NAME}" auf Port ${port}.\n` +
      `Den Aufnahme-Vault oeffnen: open -a Obsidian "$STAGING_VAULTS_DIR/${REPO_NAME}"`,
    );
  }
  console.log(`Verbunden auf Port ${port}.\n`);
  await requireVisible(cdp);
  await setWindowSize(cdp, FENSTER_BREITE, FENSTER_HOEHE);
  await setAppConfig(cdp, "readableLineLength", false);
  await setAppConfig(cdp, "showInlineTitle", false);

  // data.json ueberlebt --setup nicht — Wiki-URL und Schlüssel muessen jeden Lauf neu
  // gesetzt werden. Der Wert wandert nur ueber setPluginSetting, nie ueber console.log.
  await setPluginSetting(cdp, PLUGIN_ID, "baseUrl", wikijsUrl);
  await setPluginSetting(cdp, PLUGIN_ID, "apiKey", wikijsToken);
  await setPluginSetting(cdp, PLUGIN_ID, "syncRoot", "_published");
  await setPluginSetting(cdp, PLUGIN_ID, "locale", "en");

  const wiki = new Wiki(wikijsUrl, wikijsToken);
  let ok = 0;
  let fehlend = 0;

  try {
    const leftovers = await wiki.purge();
    const leftoverSnapshots = await purgeSnapshots(cdp);
    if (leftovers > 0 || leftoverSnapshots > 0) {
      console.log(`  (${leftovers} Wiki-Seite(n) + ${leftoverSnapshots} Snapshot(s) eines frueheren Laufs entfernt)\n`);
    }

    // --- Zustaende herstellen ---------------------------------------------------
    console.log("Zustaende herstellen …");
    await pushNote(cdp, `_published/${ROOT}/Style-Guide.md`);
    await pushNote(cdp, `_published/${ROOT}/Deploy-Runbook.md`);
    await pushNote(cdp, `_published/${ROOT}/network/Overview.md`);
    await pushNote(cdp, `_published/${ROOT}/Retired-Page.md`);

    // Belegt: Snapshot weg, Notiz und Wiki-Seite bleiben.
    await dropSnapshot(cdp, `${ROOT}/deploy-runbook`);

    // Lokal geaendert, nicht erneut gepusht.
    await cdp.evaluate(`
      const file = app.vault.getAbstractFileByPath(${JSON.stringify(`_published/${ROOT}/Style-Guide.md`)});
      await app.vault.modify(file, (await app.vault.read(file)) + "\\n- Line length caps at 100 characters.\\n");
      return true;
    `);

    // Konflikt: lokal UND im Wiki geaendert.
    const overviewPage = await wiki.find(`${ROOT}/network/overview`);
    if (!overviewPage) throw new Error("network/Overview wurde nicht gefunden — Push fehlgeschlagen?");
    await wiki.editDirectly(
      overviewPage.id,
      overviewPage.title,
      "# Network Overview\n\nUpdated directly in the wiki: a fourth VLAN for IoT devices was added.\n",
    );
    await cdp.evaluate(`
      const file = app.vault.getAbstractFileByPath(${JSON.stringify(`_published/${ROOT}/network/Overview.md`)});
      await app.vault.modify(file, "# Network Overview\\n\\nUpdated locally: guests now share the staff VLAN during office hours.\\n");
      return true;
    `);

    // --- overview.png ----------------------------------------------------------
    // Die Status-Ansicht listet ALLE Seiten der Wiki-Instanz, nicht nur den
    // Sync-Ordner — jede Fremdseite ohne lokales Gegenstueck erscheint als "Neu im
    // Wiki" (sync-plan.ts: `remote` kommt ungefiltert aus `listPages()`). Gegen eine
    // Instanz mit echtem Inhalt wuerde ein unbearbeiteter Screenshot also echte
    // Seitennamen zeigen. Deshalb wird vor der Aufnahme NUR IM RENDER gefiltert
    // (jede Zeile ohne `zz-shots` im Text entfernt) — die Daten selbst bleiben
    // unangetastet, nur das Bild zeigt sie nicht.
    if (!nur || nur === "overview.png") {
      await cdp.evaluate(`
        app.commands.executeCommandById(${JSON.stringify(`${PLUGIN_ID}:show-sync-status`)});
        return true;
      `);
      await cdp.evaluate(refreshStatusView);
      // Sidebar verbreitern: die Standardbreite (~300 px) macht aus jeder Zeile eine
      // Textwand. `setSize` wirkt asynchron (lokale Lektion aus local-image-generator);
      // deshalb erst setzen, dann per pollUntil auf die neue Breite warten statt eine
      // feste Zeit zu raten.
      await cdp.evaluate(`
        app.workspace.rightSplit.setSize(560);
        return true;
      `);
      await pollUntil<boolean>(cdp, `
        const view = document.querySelector(".workspace-leaf-content[data-type='${STATUS_VIEW}']");
        return !!(view && view.getBoundingClientRect().width > 500);
      `, 4000, 150);
      const box = await pollUntil<Rect>(cdp, `
        const view = document.querySelector(".workspace-leaf-content[data-type='${STATUS_VIEW}']");
        if (!view) return null;
        const rows = [...view.querySelectorAll(".setting-item")];
        if (rows.length < 2) return null; // erst pruefen, wenn wirklich etwas gerendert ist
        rows.forEach((r, i) => {
          if (i === 0) return; // die Kopfzeile mit Aktualisieren/Toggle bleibt
          if (!(r.textContent || "").includes("zz-shots")) r.remove();
        });
        const vc = view.querySelector(".view-content");
        if (!vc) return null;
        const r = vc.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: Math.min(vc.scrollHeight, r.height) };
      `, 8000, 200);
      if (box) {
        const png = await capture(cdp, box, 2);
        console.log(`  ✓ ${await writeShot(cdp, "overview.png", png, {
          outDir, captureWidth: CAPTURE_WIDTH, thumbWidth: THUMB_WIDTH,
        })}`);
        ok++;
      } else {
        console.log("  ✗ overview.png — Status-Ansicht kam nicht zustande");
        fehlend++;
      }
    }

    // --- conflict-modal.png -------------------------------------------------
    // Loest den Konflikt danach ueber "Keep local" auf (s. Kopfkommentar zur
    // Reihenfolge) — sonst hielte er `removal-modal.png` unten ein zweites Mal auf.
    if (!nur || nur === "conflict-modal.png") {
      if (!(await openExisting(cdp, `_published/${ROOT}/network/Overview.md`, "preview"))) {
        console.log("  ✗ conflict-modal.png — Overview.md liess sich nicht oeffnen");
        fehlend++;
      } else {
        await closeExtraLeaves(cdp);
        await cdp.evaluate(`
          app.commands.executeCommandById(${JSON.stringify(`${PLUGIN_ID}:push-current-note`)});
          return true;
        `);
        const modal = await pollUntil<boolean>(cdp, `
          return !!document.querySelector(".modal-container .wikijs-diff");
        `, 10_000, 200);
        if (!modal) {
          console.log("  ✗ conflict-modal.png — Konflikt-Dialog erschien nicht");
          fehlend++;
        } else {
          const box = await boxOf(cdp, ".modal-container", 0);
          const png = box ? await capture(cdp, box, 2) : null;
          if (png) {
            console.log(`  ✓ ${await writeShot(cdp, "conflict-modal.png", png, {
              outDir, captureWidth: CAPTURE_WIDTH, thumbWidth: THUMB_WIDTH,
            })}`);
            ok++;
          } else {
            console.log("  ✗ conflict-modal.png — kein Ausschnitt");
            fehlend++;
          }
          await cdp.evaluate(`
            const btn = [...document.querySelectorAll(".modal-container button")]
              .find((b) => /keep local/i.test(b.textContent || ""));
            if (btn) btn.click();
            return true;
          `);
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
    }

    // --- removal-modal.png ---------------------------------------------------
    if (!nur || nur === "removal-modal.png") {
      await cdp.evaluate(`
        const from = ${JSON.stringify(`_published/${ROOT}/Retired-Page.md`)};
        const to = ${JSON.stringify(`${ROOT}-Retired-Page.md`)};
        const file = app.vault.getAbstractFileByPath(from);
        if (!file) throw new Error("Retired-Page.md fehlt im Sync-Ordner");
        await app.fileManager.renameFile(file, to);
        return true;
      `);
      await cdp.evaluate(`
        document.querySelectorAll(".notice").forEach((n) => n.remove());
        app.commands.executeCommandById(${JSON.stringify(`${PLUGIN_ID}:push-all-changes`)});
        return true;
      `);
      // Ein vorausgehender Konflikt-Dialog (network/overview, falls noch ungeloest —
      // z.B. bei `--only removal-modal.png` ohne den vorherigen Schritt) blockiert die
      // Reihe: push-all wartet auf IHN, bevor Retired-Page uebergehaupt drankommt.
      // EIN Ausdruck mit eigener Schleife statt mehrerer Roundtrips: zwischen zwei
      // evaluate-Aufrufen laege ein offener modaler Zustand, dessen Ende niemand
      // garantiert.
      const modal = await cdp.evaluate<boolean>(`
        const deadline = Date.now() + 20000;
        while (Date.now() < deadline) {
          const m = document.querySelector(".modal-container");
          if (m) {
            if (/removed locally/i.test(m.textContent || "")) return true;
            if (/^Conflict:/.test(m.textContent || "")) {
              const btn = [...m.querySelectorAll("button")].find((b) => /keep local/i.test(b.textContent || ""));
              if (btn) btn.click();
            }
          }
          await new Promise((r) => setTimeout(r, 250));
        }
        return false;
      `);
      if (!modal) {
        console.log("  ✗ removal-modal.png — Entfernen-Dialog erschien nicht");
        fehlend++;
      } else {
        const box = await boxOf(cdp, ".modal-container", 0);
        const png = box ? await capture(cdp, box, 2) : null;
        if (png) {
          console.log(`  ✓ ${await writeShot(cdp, "removal-modal.png", png, {
            outDir, captureWidth: CAPTURE_WIDTH, thumbWidth: THUMB_WIDTH,
          })}`);
          ok++;
        } else {
          console.log("  ✗ removal-modal.png — kein Ausschnitt");
          fehlend++;
        }
        await cdp.evaluate(`
          const btn = [...document.querySelectorAll(".modal-container button")]
            .find((b) => /unpublish/i.test(b.textContent || ""));
          if (btn) btn.click();
          return true;
        `);
        await new Promise((r) => setTimeout(r, 2000));
      }
      // Push-all laeuft nach dem Dialog weiter (Getting-Started, guides/Setup,
      // archive/Setup, Style-Guide sind noch pushbar) — kurz Zeit geben, bevor
      // aufgeraeumt wird, sonst konkurriert das Aufraeumen mit dem laufenden Sammel-Push.
      await new Promise((r) => setTimeout(r, 2000));
    }

    // --- settings.png ---------------------------------------------------------
    // Platzhalter statt der echten Instanz: die Werte werden gleich sichtbar
    // fotografiert, und ein Wiki-Schlüssel gehoert nie auch nur teilweise in ein
    // Bild, das mit dem Repo um die Welt geht. Muss der LETZTE Schritt vor dieser
    // Aufnahme sein — kein weiterer Zustand braucht danach noch echte Zugangsdaten.
    if (!nur || nur === "settings.png") {
      await setPluginSetting(cdp, PLUGIN_ID, "baseUrl", "https://wiki.example.org");
      await setPluginSetting(cdp, PLUGIN_ID, "apiKey", "•".repeat(48));
      const result = await settingsBild(port, { outDir, captureWidth: CAPTURE_WIDTH, thumbWidth: THUMB_WIDTH });
      console.log(`  ${result.ok ? "✓" : "✗"} ${result.msg}`);
      if (result.ok) ok++; else fehlend++;
    }
  } finally {
    const purged = await wiki.purge().catch(() => 0);
    const purgedSnapshots = await purgeSnapshots(cdp).catch(() => 0);
    if (purged > 0 || purgedSnapshots > 0) {
      console.log(`\nAufgeraeumt: ${purged} Wiki-Seite(n) + ${purgedSnapshots} Snapshot(s) geloescht.`);
    }
    cdp.close();
  }

  console.log(`\n${ok} Bild(er) geschrieben, ${fehlend} offen.`);
  if (fehlend) exit(1);
}

main().catch((err: Error) => {
  console.error(err.message);
  exit(1);
});
