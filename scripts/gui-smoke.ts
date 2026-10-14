/**
 * GUI-Smoke-Treiber — fährt die mechanisch entscheidbaren Punkte aus `docs/SMOKE.md`
 * gegen ein **laufendes** Obsidian und einen **lokalen Wiki.js-Stub** (`scripts/demo-wikijs.ts`).
 * Mit `--live` fährt er stattdessen gegen die in den Plugin-Einstellungen konfigurierte echte Instanz.
 *
 * Warum getrackt (CORE-TEST-02 b): Der erste Hand-Durchlauf am 2026-08-12 kam bis
 * Punkt 11 und fand dort einen echten Fehler — `pages.update` verlangt `content` und
 * `tags`, obwohl das Schema sie als optional führt. Kein Unit-Test konnte das sehen,
 * weil keiner gegen eine echte Instanz läuft. Eine Prüfung, die nur von Hand
 * existiert, wird beim nächsten Release nicht wieder gefahren.
 *
 * Was er prüft, das die vitest-Suite strukturell nicht kann: den echten
 * Settings-Tab, die echte Status-Ansicht im DOM, und vor allem die **echten
 * Antworten von Wiki.js** — dort saßen beide bisher gefundenen Fehler. Der Stub bildet diese
 * Antworten und ihre Eigenheiten nach (Kopfkommentar dort), ersetzt aber nicht den Beweis gegen
 * eine echte Instanz; die Bilanz weist den Lauf deshalb als „gegen Stub“ aus.
 *
 * ## Voraussetzung
 *
 * Der Smoke läuft in einer **Zweitinstanz** mit eigenem Profil und eigenem Port, nie in der
 * regulären Instanz (Dach-AGENTS § Staging-Vaults); `--port` ist Pflicht, es gibt keinen Standard.
 * Der Vault `wikijs-maintainer` unter `$STAGING_VAULTS_DIR` kommt aus dem Fixture
 * (`npm run build && npm run shots -- --setup`). Profil: die aktuelle `.asar` der regulären
 * Instanz ins `--user-data-dir` kopieren, Vault und `"language":"en"` in dessen `obsidian.json`
 * eintragen, mit `--remote-debugging-port=<port>` starten. Vertrauensdialog und Restricted Mode
 * erledigt `bereiteInstanzVor` selbst. Den CDP-Lock für den eigenen Port halten
 * (`python3 ~/.claude/hooks/obsidian-cdp-lock.py acquire --label wikijs-maintainer --intent … --exclusive focus --port <port>`).
 *
 * Das Smoke-Ziel ist standardmäßig der **Stub**: der Treiber startet ihn im eigenen Prozess (Port 0),
 * setzt Wiki-URL und einen ASCII-Platzhalter-Schlüssel in die Plugin-Einstellungen und schreibt am
 * Ende die vorherigen Werte zurück (der Schlüssel liegt über `saveSettings` im Schlüsselbund, der
 * Eintrag `wikijs-maintainer-api-key` wird gelöscht, wenn vorher keiner da war). Mit `--live` sind
 * Wiki-URL und API-Schlüssel der **echten Instanz** aus den Plugin-Einstellungen das Ziel; fehlen
 * sie, ist jeder Prüfpunkt „nichts gemessen“ (Exit 1), nicht grün.
 *
 * ```bash
 * npm run smoke:gui -- --port <port>                # gegen Stub, Vault-Name: wikijs-maintainer
 * npm run smoke:gui -- --port <port> --live         # gegen die konfigurierte Wiki-Instanz
 * npm run smoke:gui -- --port <port> --keep         # Testnotizen stehen lassen
 * ```
 *
 * ⚠️ Mit `--live` schreibt der Treiber in die konfigurierte Wiki-Instanz; gegen den Stub in dessen
 * Speicher. Er legt ausschließlich Seiten unter dem Präfix `zz-smoke-` an und löscht sie im
 * `finally` wieder — auch nach einem Abbruch. Er fasst keine andere Seite an.
 *
 * ⚠️ Chromium drosselt das Rendering nicht-fokussierter Fenster: ohne Fokus bleibt das
 * DOM leer und man debuggt ein Phantom (CORE-TEST-02).
 */


// Die CDP-Brücke liegt seit 2026-08-16 zentral im Dach (tools/obsidian-cdp/) und wird
// importiert, nicht vendored: sie ist plugin-neutral und lief zuvor byte-identisch in
// sechs Repos. Fehlt das Dach (fremder Checkout), bricht esbuild beim Auflösen ab — das
// ist die gewollte Meldung. Was ihr fehlt, wird DORT ergänzt, nicht hier nachgebaut.
import { join } from "node:path";
import { cwd } from "node:process";
import { Cdp, attachTo, beimAbbruch, bereiteInstanzVor, clearNotices, istAbgebrochen, ladePluginNeu, pollUntil, requireVisible } from "../../tools/obsidian-cdp/cdp.js";
import { createBilanz, parseArgs, runDriver } from "../../tools/obsidian-cdp/bilanz.js";
import { startWikiStub, type RunningWikiStub } from "./demo-wikijs.js";

const PLUGIN_ID = "wikijs-maintainer";
const STATUS_VIEW = "wikijs-status";
/** Feste ID des Schlüsselbund-Eintrags (`src/core/api-key-storage.ts`). */
const API_KEY_SECRET_ID = "wikijs-maintainer-api-key";

/** Alle Wiki-Pfade und Vault-Dateien des Smokes tragen dieses Präfix. Das ist die
 *  Zusicherung an den Maintainer: der Treiber fasst nichts an, was nicht ihm gehört —
 *  und das `finally` weiß, was es aufräumen darf. */
const PREFIX = "zz-smoke";

// --- Prüfpunkte -------------------------------------------------------------

/** Soll-Liste (Nenner, CORE-TEST-19): ein Punkt, der nie aufgezeichnet wird, zählt als „nichts gemessen“. */
const PUNKTE = [
  "00. Plugin geladen, Wiki-URL und API-Schlüssel stehen in den Plugin-Einstellungen (gegen Stub: vom Treiber gesetzt)",
  "0a. apiKey trägt keinen liegen gebliebenen Test-Wert aus einem abgebrochenen Vorlauf",
  "0b. API-Schlüssel ist header-tauglich (Latin-1/ByteString)",
  "1. Push legt die Seite im Wiki an",
  "2. Zweiter Push aktualisiert, ohne zu doppeln",
  "3. Depublizieren macht die Seite unsichtbar (Historie bleibt)",
  "14. Sichtbarkeit: wiki_published: false bleibt über mehrere Pushs mit Inhaltsänderung unsichtbar",
  "4. Slug-Kollision: Warnblock da, Push für die Zeile gesperrt",
  "5. Mehrdeutiger Name: Hinweisblock da, Push bleibt möglich",
  "6. Falscher Schlüssel: Meldung benennt die Authentifizierung",
  "9. Belegter Slug, eigene Seite: Übernehmen räumt die Zeile ab (SMOKE 12)",
  "10. Belegter Slug, fremde Seite: Übernehmen bleibt aus, Wiki unangetastet (SMOKE 13)",
  "11. Verwaister Snapshot: Verwerfen räumt die Zeile ab (SMOKE 14)",
  "12. Kein stiller Abbruch bei extern gelöschter Notiz (SMOKE 15)",
  "13. Keine rohen i18n-Schlüssel in Commands und Status-Ansicht",
  "15. Umbenannte Notiz: Seite wird verschoben (pages.move), Id bleibt, kein Anlegen und kein Entfernen-Dialog",
  "16. Bestand übernehmen: Wiki-Seite wird zur Notiz mit Snapshot, im Wiki wird nichts geschrieben",
] as const;

const bilanz = createBilanz({ punkte: PUNKTE });
const { record } = bilanz;

/** Alle Punkte ab `ab` (Index in PUNKTE) als „nichts gemessen“ mit Grund aufzeichnen. */
function restUnmeasured(ab: number, grund: string): void {
  for (const name of PUNKTE.slice(ab)) bilanz.unmeasured(name, grund);
}

/** Erster Zeichen-Codepunkt > 255 in `s`, oder `null` — Header-Werte sind
 *  ByteStrings (Latin-1); ein Wert darueber laesst `fetch`/`requestUrl` nicht mit
 *  einer fachlichen Meldung scheitern, sondern mit einem WebIDL-Konvertierungsfehler
 *  ("Cannot convert argument to a ByteString …"), lange bevor irgendein Prüfpunkt
 *  greift (gemessen 2026-09-16, Welle 4b: ein von `shots.ts` hinterlassener
 *  "•"-Platzhalter im Vault). */
function firstNonLatin1(s: string): { char: string; codePoint: number; index: number } | null {
  for (let i = 0; i < s.length; i++) {
    const codePoint = s.codePointAt(i) ?? 0;
    if (codePoint > 255) return { char: s[i] ?? "", codePoint, index: i };
  }
  return null;
}

// --- Wiki-Seite der Verifikation --------------------------------------------
// Der Treiber prüft die Wirkung DRÜBEN, nicht die Meldung im Plugin. Eine Notice
// sagt nur, was das Plugin glaubt; die Instanz sagt, was geschehen ist. Genau
// dieser Unterschied war der Fehler vom 2026-08-12: die Antwort meldete einen
// Fehler, die Seite war trotzdem schon geändert.

interface WikiPage {
  id: number;
  path: string;
  title: string;
  isPublished: boolean;
  updatedAt?: string;
  content?: string;
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
      `{ pages { list(orderBy: PATH) { id path title isPublished updatedAt } } }`,
    );
    return data.pages.list;
  }

  /** Legt eine Seite DIREKT im Wiki an, am Plugin vorbei — eine Seite, die der Vault nicht kennt
   *  (Ausgangslage von "Bestand uebernehmen"). */
  async create(path: string, title: string, content: string, locale: string): Promise<number> {
    const data = await this.gql<{ pages: { create: { responseResult: { succeeded: boolean; message: string }; page: { id: number } | null } } }>(
      `mutation($content: String!, $description: String!, $path: String!, $tags: [String]!, $title: String!, $locale: String!) {
        pages { create(content: $content, description: $description, editor: "markdown", isPublished: true, isPrivate: false,
                       locale: $locale, path: $path, tags: $tags, title: $title) {
          responseResult { succeeded message } page { id }
        } }
      }`,
      { content, description: "aus dem Wiki", path, tags: ["smoke"], title, locale },
    );
    if (!data.pages.create.responseResult.succeeded || data.pages.create.page === null) {
      throw new Error(`Wiki: Anlegen fehlgeschlagen: ${data.pages.create.responseResult.message}`);
    }
    return data.pages.create.page.id;
  }

  async find(path: string): Promise<WikiPage | undefined> {
    return (await this.list()).find((p) => p.path === path);
  }

  async content(id: number): Promise<string> {
    const data = await this.gql<{ pages: { single: { content: string } | null } }>(
      `query($id: Int!) { pages { single(id: $id) { content } } }`,
      { id },
    );
    return data.pages.single?.content ?? "";
  }

  /** Ändert eine Seite DIREKT im Wiki, am Plugin vorbei — simuliert eine fremde
   *  Bearbeitung. Braucht Punkt 13 (SMOKE.md): "Belegter Slug, fremde Seite" muss
   *  vom Plugin ABGEWIESEN werden, weil `adoptOccupied` Zeichen für Zeichen
   *  vergleicht — dafür muss der Wiki-Inhalt zuerst wirklich abweichen. */
  async setForeignContent(id: number, title: string, content: string): Promise<void> {
    await this.gql(
      `mutation($id: Int!, $content: String!, $description: String!, $tags: [String]!, $title: String!) {
        pages { update(id: $id, content: $content, description: $description, tags: $tags, title: $title, isPublished: true) {
          responseResult { succeeded errorCode message }
        } }
      }`,
      { id, content, description: "smoke", tags: [], title },
    );
  }

  /** Räumt jede Seite ab, die der Smoke angelegt hat — und nur die. */
  async purge(): Promise<number> {
    const mine = (await this.list()).filter((p) => p.path.startsWith(PREFIX));
    for (const page of mine) {
      await this.gql(`mutation($id: Int!) { pages { delete(id: $id) { responseResult { succeeded } } } }`, {
        id: page.id,
      });
    }
    return mine.length;
  }
}

/** Datei aktivieren, Command feuern, auf die Notice als Abschluss-Signal warten.
 *
 *  Drei Lehren aus dem 2026-08-12 in einer Funktion: (1) `openFile` allein genuegt
 *  nicht — die Commands haengen an `getActiveFile()`, und das ist unmittelbar danach
 *  noch nicht gesetzt; der Command tut dann stillschweigend nichts. (2) Nach dem
 *  Feuern eine feste Zeit zu warten ist geraten: langsame Netzantworten machen den
 *  Pruefpunkt rot, ohne dass etwas kaputt ist. Die Notice ist das Signal, dass die
 *  Operation zu Ende ist. (3) Der Rueckgabewert ist ihr Text — er gehoert in die
 *  Detailspalte, sonst steht im Fehlerfall wieder nur eine Zahl da. */
const runCommand = (file: string | null, commandId: string, timeoutMs = 25000): string => `
  ${file === null ? "" : `
  const target = app.vault.getAbstractFileByPath(${JSON.stringify(file)});
  if (!target) return "DATEI FEHLT: " + ${JSON.stringify(file)};
  await app.workspace.getLeaf(false).openFile(target);
  for (let i = 0; i < 40; i++) {
    if (app.workspace.getActiveFile()?.path === ${JSON.stringify(file)}) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (app.workspace.getActiveFile()?.path !== ${JSON.stringify(file)}) return "DATEI WURDE NICHT AKTIV";
  `}
  app.commands.executeCommandById(${JSON.stringify(commandId)});
  const deadline = Date.now() + ${timeoutMs};
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 150));
    const notice = document.querySelector(".notice");
    if (notice) return notice.textContent || "(leere Meldung)";
  }
  return "KEINE MELDUNG binnen ${timeoutMs} ms";
`;

/** `runCommand` ausführen. Vorher räumt die Brücke die Notices weg (`clearNotices`: Hauptfenster UND aktives Dokument), damit eine
 *  Meldung aus einem früheren Schritt nicht als Abschluss dieses Commands gelesen wird. */
async function fuehreCommandAus(cdp: Cdp, file: string | null, commandId: string, timeoutMs?: number): Promise<string> {
  await clearNotices(cdp);
  return cdp.evaluate<string>(runCommand(file, commandId, timeoutMs));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const portRaw = args.value("port");
  if (!portRaw || !Number.isInteger(Number(portRaw))) {
    throw new Error(
      "--port <Port> ist Pflicht (Zweitinstanz mit eigenem Profil und Port, Kopfkommentar). " +
        "Es gibt keinen Standardport: 9222 ist die reguläre Instanz.",
    );
  }
  const port = Number(portRaw);
  const keep = args.has("keep");
  const live = args.has("live");
  const vault = args.value("vault") ?? PLUGIN_ID;

  console.log(`GUI-Smoke — Obsidian auf Port ${port}`);
  // `attachTo` unterscheidet Haupt- und Einstellungen-Fenster an der Sache (nur das
  // Hauptfenster trägt einen Workspace), nicht am lokalisierten Titel.
  const cdp = await attachTo("workspace", port, vault);
  if (!cdp) {
    throw new Error(
      `Kein Obsidian-Hauptfenster auf Port ${port} für Vault „${vault}“. ` +
        "Läuft die Zweitinstanz mit --remote-debugging-port? (siehe Kopfkommentar)",
    );
  }

  // Außerhalb des try: das `finally` muss auch nach einem Abbruch mitten im Lauf
  // zurückschreiben können, sonst bleibt der Vault im Smoke-Zustand stehen.
  let previousApiKey: string | null = null;
  let previousBaseUrl = "";
  let wiki: Wiki | null = null;
  let stub: RunningWikiStub | null = null;

  /** Einstellungen von vorher zurückschreiben. War vorher kein Schlüssel da, bleibt auch im
   *  Schlüsselbund keiner stehen (`saveSettings` hat den Platzhalter dort abgelegt). */
  const restoreSettings = (): string => `
    const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    p.settings.apiKey = ${JSON.stringify(previousApiKey ?? "")};
    p.settings.baseUrl = ${JSON.stringify(previousBaseUrl)};
    await p.saveSettings();
    ${previousApiKey === "" ? `await app.secretStorage?.deleteSecret?.(${JSON.stringify(API_KEY_SECRET_ID)});` : ""}
    return true;
  `;

  // Alles, was dieser Lauf am Wirt und am Wiki verändert, räumt EIN Schritt zurück: der Normalweg im `finally`
  // (`zustand.schliesse()`), Ctrl-C/SIGTERM über das Abbruch-Modul der Brücke (Hauptzweig gesperrt, dieser Schritt darf noch
  // senden, danach Bilanz, Exit 130). Punkt 6 verstellt `settings.apiKey` bewusst auf einen ungültigen Wert; zwischen dem
  // Verstellen und dem Zurückschreiben bliebe bei einem Abbruch der echte Schlüssel durch den Test-String ersetzt.
  // `previousApiKey` ist zum Zeitpunkt des Signals der jeweils aktuelle Wert (per closure, kein Snapshot).
  // Aufräumen darf nie am Ergebnis hängen: auch ein abgebrochener Lauf gibt Vault und Wiki so zurück, wie er sie vorfand.
  const zustandZurueck = async (): Promise<void> => {
    if (previousApiKey !== null) {
      await cdp.evaluate(restoreSettings()).catch(() => { console.log("  ! Einstellungen konnten nicht zurueckgeschrieben werden — von Hand pruefen"); });
    }
    if (!keep) {
      await cdp
        .evaluate(`
          const doomed = app.vault.getFiles().filter((f) => f.path.includes(${JSON.stringify(PREFIX)}));
          for (const f of doomed) await app.vault.delete(f);
          const folders = app.vault.getAllFolders().filter((f) => f.path.includes(${JSON.stringify(PREFIX)}));
          for (const f of folders) { try { await app.vault.delete(f, true); } catch {} }

          // Die Snapshots MUESSEN mit weg. Bleiben sie liegen, waehrend die
          // Wiki-Seiten geloescht werden, sieht der naechste Lauf den Zustand
          // "remote-deleted" — und blockiert voellig korrekt jeden Push. Der
          // Smoke waere dann genau einmal wiederholbar. (Am 2026-08-12 genau so
          // passiert; die Meldung des Plugins hat es aufgedeckt.)
          const dir = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].manifest.dir + "/snapshots";
          if (await app.vault.adapter.exists(dir)) {
            const listing = await app.vault.adapter.list(dir);
            for (const file of listing.files) {
              if (!file.endsWith(".json")) continue;
              try {
                const snapshot = JSON.parse(await app.vault.adapter.read(file));
                if (String(snapshot.wikiPath || "").startsWith(${JSON.stringify(PREFIX)})) {
                  await app.vault.adapter.remove(file);
                }
              } catch {}
            }
          }
          return doomed.length;
        `)
        .catch(() => undefined);
      if (wiki) {
        const purged = await wiki.purge().catch(() => 0);
        if (purged > 0) console.log(`\nAufgeräumt: ${purged} Wiki-Seite(n) des Smokes gelöscht.`);
      }
    }
  };
  const zustand = beimAbbruch(zustandZurueck, "Wirt und Wiki zurücksetzen (Einstellungen, Smoke-Dateien, Snapshots, Wiki-Seiten)");

  try {
    // Ohne Fokus drosselt Chromium den Renderer — der DOM bleibt leer, während die
    // App-API korrekten Zustand meldet. `requireVisible` macht das Fenster dieser Zweitinstanz
    // sichtbar und bricht mit Handlungsanweisung ab, wenn das nicht reicht.
    await requireVisible(cdp);

    const vaultName = await cdp.evaluate<string>(`return window.app?.appId ? app.vault.getName() : "";`);
    if (!vaultName) throw new Error("Obsidians `app` ist im Renderer nicht erreichbar.");
    console.log(`Vault: ${vaultName}\n`);

    // Vertrauensdialog bestätigen, Restricted Mode aufheben, Plugin laden (frisches Profil).
    const vorbereitet = await bereiteInstanzVor(cdp, { pluginIds: [PLUGIN_ID], nurVault: vault, sprache: "en" });
    console.log(`Instanz: ${vorbereitet.hinweis}`);

    const plugin = await cdp.evaluate<{ ok: boolean; version?: string; baseUrl?: string; syncRoot?: string; apiKey?: string }>(`
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      if (!p) return { ok: false };
      return { ok: true, version: p.manifest.version, baseUrl: p.settings.baseUrl,
               syncRoot: p.settings.syncRoot, apiKey: p.settings.apiKey };
    `);
    if (!plugin.ok) {
      restUnmeasured(0, `Plugin ${PLUGIN_ID} nicht geladen (${vorbereitet.hinweis}) — erst bauen und deployen.`);
      return;
    }
    // Der gespeicherte Schlüssel bleibt im Node-Prozess und wird nie ausgegeben.
    const storedKey = plugin.apiKey ?? "";
    previousApiKey = storedKey;
    previousBaseUrl = plugin.baseUrl ?? "";
    if (live) {
      // Ohne Wiki-URL/API-Schlüssel gibt es keine Gegenstelle: jeder Punkt ist „nichts gemessen“
      // (CORE-TEST-19), nicht übersprungen und nicht grün.
      if (!plugin.baseUrl || !storedKey) {
        restUnmeasured(
          0,
          `Keine Gegenstelle: baseUrl ${plugin.baseUrl ? "gesetzt" : "fehlt"} · apiKey ${storedKey ? "gesetzt" : "fehlt"} in den Plugin-Einstellungen.`,
        );
        return;
      }
      record(PUNKTE[0], true, `Wiki ${plugin.baseUrl} (live)`);
    } else {
      // Gegenstelle ist der Stub. Einstellungen setzen, bevor das Plugin neu geladen wird: der
      // Schlüssel geht über `saveSettings` in den Schlüsselbund und von dort wieder in den Speicher.
      stub = await startWikiStub();
      await cdp.evaluate(`
        const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        p.settings.baseUrl = ${JSON.stringify(stub.url)};
        p.settings.apiKey = ${JSON.stringify(stub.apiKey)};
        await p.saveSettings();
        return true;
      `);
      console.log(`Gegenstelle: Wiki.js-Stub ${stub.url} (kein echtes Wiki — Bilanz „gegen Stub“)`);
      record(PUNKTE[0], true, `gegen Stub ${stub.url}, Schlüssel vom Treiber gesetzt`);
    }
    // Das Plugin neu laden, statt auf den Zufall zu setzen: Obsidian haelt den zuvor
    // geladenen `main.js` im Speicher, ein frisches `npm run deploy` erreicht den
    // laufenden Renderer also NICHT. Ohne diesen Schritt misst der Smoke einen
    // aelteren Stand als den, der auf der Platte liegt — am 2026-08-12 lief genau
    // deshalb ein bereits behobener Fehler noch dreimal als rot durch.
    // `ladePluginNeu` prüft mit `repoMainJs` vor dem Reload, dass `main.js` im Vault der gebaute Repo-Stand ist (kein Store-Build),
    // und stellt danach die Version auf der Platte neben die im Speicher. Die Kopfzeile nennt die Version NACH dem Reload.
    const neu = await ladePluginNeu(cdp, PLUGIN_ID, { repoMainJs: join(cwd(), "main.js"), beruhigungMs: 1200 });
    console.log(neu.hinweis);
    if (!neu.geladen || !neu.aktuell) throw new Error(`Plugin nach dem Neuladen nicht auf dem Stand der Platte — ${neu.hinweis}`);
    const wikiUrl = stub?.url ?? plugin.baseUrl ?? "";
    console.log(`Plugin ${neu.nachher.plugin} (Platte ${neu.platte}) · Wiki ${wikiUrl}${stub ? " (Stub)" : ""} · Sync-Ordner ${plugin.syncRoot} (neu geladen)\n`);

    // Der Schlüssel, mit dem der Treiber selbst spricht (nach dem Neuladen aus den Einstellungen).
    const token = await cdp.evaluate<string>(
      `return app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].settings.apiKey;`,
    );
    // Ein liegen gebliebener Test-Schluessel aus einem VOR diesem Handler abgebrochenen
    // Vorlauf (SIGKILL/Absturz) ist NICHT reparierbar — der echte Schluessel wurde bereits
    // ueberschrieben und ist nirgends mehr gespeichert. Der Punkt kann ihn deshalb nur laut
    // melden, nicht wiederherstellen, damit das als Plugin-Bug missverstandene
    // Authentifizierungsproblem nicht in die falsche Richtung gesucht wird.
    record(
      "0a. apiKey trägt keinen liegen gebliebenen Test-Wert aus einem abgebrochenen Vorlauf",
      storedKey !== "ungueltig-fuer-den-smoke",
      storedKey === "ungueltig-fuer-den-smoke"
        ? "apiKey ist der Smoke-Testwert — der echte Schlüssel ist verloren, von Hand neu setzen"
        : "unauffällig",
    );

    // Praeflug-Check 0: bricht der Treiber hier statt in einem der folgenden Punkte,
    // ist der Schluessel im VAULT beschaedigt (nicht der Treiber) — alle Punkte ab
    // hier waeren sonst nicht "nichts gemessen", sondern ein nackter Absturz.
    const headerIssue = firstNonLatin1(storedKey);
    record(
      "0b. API-Schlüssel ist header-tauglich (Latin-1/ByteString)",
      headerIssue === null,
      headerIssue === null
        ? "keine Zeichen außerhalb Latin-1"
        : `Zeichen U+${headerIssue.codePoint.toString(16).toUpperCase()} an Index ${headerIssue.index} — ` +
          "Header-Werte sind ByteStrings; der im Vault gespeicherte Schlüssel ist beschädigt " +
          "(z. B. ein Aufnahme-Platzhalter, der nie zurückgesetzt wurde).",
    );
    if (headerIssue !== null && live) {
      restUnmeasured(3, "Der gespeicherte API-Schlüssel ist nicht header-tauglich — keine Anfrage möglich.");
      return;
    }
    wiki = new Wiki(wikiUrl, token);

    const root = plugin.syncRoot ?? "_published";
    const notePath = (name: string): string => `${root}/${PREFIX}-${name}.md`;

    // Ein offenes Modal blockiert alles Folgende: es faengt den Fokus und legt sich
    // ueber die Ansicht, sodass jeder spaetere Pruefpunkt gegen eine verdeckte
    // Oberflaeche misst und rot wird, ohne dass etwas kaputt waere. Deshalb hier
    // ABBRECHEN statt aufraeumen — ein Modal wegzuklicken hiesse, eine fremde
    // Entscheidung zu treffen, und es hart aus dem DOM zu entfernen hinterlaesst
    // Obsidians Modal-Stack beschaedigt (am 2026-08-12 genau so passiert: der
    // naechste Dialog blockierte den Renderer).
    const openModal = await cdp.evaluate<string | null>(`
      const m = document.querySelector(".modal-container .modal-title");
      return m ? (m.textContent || "(ohne Titel)") : null;
    `);
    if (openModal !== null) {
      throw new Error(`Ein Dialog ist offen ("${openModal}") — erst schliessen, dann erneut starten.`);
    }

    // Voraussetzung prüfen, statt sie anzunehmen: liegt aus einem früheren Abbruch
    // noch etwas herum, sind alle Zählungen unten falsch.
    const leftovers = await wiki.purge();
    if (leftovers > 0) console.log(`  (${leftovers} Reste eines früheren Laufs entfernt)\n`);

    // --- 1. Push legt eine Seite an ----------------------------------------
    await cdp.evaluate(`
      const path = ${JSON.stringify(notePath("push"))};
      const body = "# Smoke\\n\\nErste Fassung.\\n";
      const old = app.vault.getAbstractFileByPath(path);
      if (old) await app.vault.modify(old, body); else await app.vault.create(path, body);
      return true;
    `);
    const push1 = await fuehreCommandAus(cdp, notePath("push"), `${PLUGIN_ID}:push-current-note`);
    const created = await wiki.find(`${PREFIX}-push`);
    record(
      "1. Push legt die Seite im Wiki an",
      created !== undefined,
      created ? `id=${created.id} · "${push1.slice(0, 50)}"` : `keine Seite — Meldung: "${push1.slice(0, 70)}"`,
    );

    // --- 2. Erneuter Push aktualisiert, statt zu doppeln --------------------
    await cdp.evaluate(`
      const file = app.vault.getAbstractFileByPath(${JSON.stringify(notePath("push"))});
      await app.vault.modify(file, "# Smoke\\n\\nZweite Fassung.\\n");
      return true;
    `);
    const push2 = await fuehreCommandAus(cdp, notePath("push"), `${PLUGIN_ID}:push-current-note`);
    const all = await wiki.list();
    const sameName = all.filter((p) => p.path === `${PREFIX}-push`);
    const body = created ? await wiki.content(created.id) : "";
    record(
      "2. Zweiter Push aktualisiert, ohne zu doppeln",
      sameName.length === 1 && body.includes("Zweite Fassung"),
      `${sameName.length} Seite(n), Inhalt ${body.includes("Zweite Fassung") ? "aktuell" : "veraltet"} · "${push2.slice(0, 40)}"`,
    );

    // --- 3. Depublizieren ---------------------------------------------------
    // Der Punkt, an dem der Hand-Durchlauf am 2026-08-12 scheiterte. Er misst die
    // ganze Kette: Notiz verschwindet aus der Sync-Wurzel → Sammel-Push erkennt
    // `removed-locally` → Dialog → `unpublishPage` → Seite drueben unsichtbar.
    //
    // Bewusst EIN Renderer-Ausdruck statt "Command feuern" und "Dialog suchen" in
    // zwei Aufrufen: der Dialog wartet auf eine Antwort, und zwischen zwei
    // evaluate-Aufrufen laege ein offener modaler Zustand, dessen Ende niemand
    // garantiert. Der Ausdruck endet erst, wenn der Dialog beantwortet UND wieder
    // zu ist — oder er meldet, woran es lag.
    await cdp.evaluate(`
      const file = app.vault.getAbstractFileByPath(${JSON.stringify(notePath("push"))});
      // Loeschen statt Umbenennen: eine umbenannte Notiz mit gleichem Text erkennt das Plugin seit
      // Welle 22 als Umzug (pages.move, Punkt 15), nicht mehr als "lokal entfernt".
      await app.vault.delete(file);
      return true;
    `);
    const removal = await cdp.evaluate<{ dialog: boolean; cta: string | null; closed: boolean }>(`
      app.commands.executeCommandById(${JSON.stringify(`${PLUGIN_ID}:push-all-changes`)});

      let modal = null;
      for (let i = 0; i < 40 && !modal; i++) {
        await new Promise((r) => setTimeout(r, 150));
        modal = document.querySelector(".modal-container");
      }
      if (!modal) return { dialog: false, cta: null, closed: false };

      // Den hervorgehobenen Knopf zu greifen prueft die Zusage "Depublizieren ist
      // die empfohlene Aktion" beilaeufig mit: waere sie nicht gesetzt, gaebe es
      // hier nichts zu klicken.
      const cta = modal.querySelector(".mod-cta");
      const label = cta ? (cta.textContent || "") : null;
      if (!cta) return { dialog: true, cta: null, closed: false };
      cta.click();

      let closed = false;
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 150));
        if (!document.querySelector(".modal-container")) { closed = true; break; }
      }
      return { dialog: true, cta: label, closed };
    `);
    await new Promise((r) => setTimeout(r, 2500));
    const unpublished = await wiki.find(`${PREFIX}-push`);
    record(
      "3. Depublizieren macht die Seite unsichtbar (Historie bleibt)",
      removal.dialog && removal.closed && unpublished !== undefined && unpublished.isPublished === false,
      !removal.dialog
        ? "Entfernen-Dialog erschien nicht"
        : removal.cta === null
          ? "kein hervorgehobener Knopf im Dialog"
          : !removal.closed
            ? `Dialog blieb nach Klick auf "${removal.cta}" offen`
            : unpublished === undefined
              ? "Seite ist ganz verschwunden — erwartet war depubliziert, nicht geloescht"
              : `isPublished=${unpublished.isPublished}`,
    );

    // --- 14. Sichtbarkeit aus dem Frontmatter -------------------------------
    // Sicherheitsrelevant: eine bewusst depublizierte Seite darf durch einen späteren Push
    // nicht wieder online gehen (früher: `isPublished: true` fest im Update-Dokument).
    // Gemessen wird drüben im Wiki, über drei Pushs mit Inhaltsänderung; Gegenprobe: dieselbe
    // Notiz ohne das Feld wird veröffentlicht.
    const hiddenPath = notePath("versteckt");
    const writeHidden = (text: string): Promise<boolean> => cdp.evaluate<boolean>(`
      const path = ${JSON.stringify(hiddenPath)};
      const body = ${JSON.stringify(text)};
      const old = app.vault.getAbstractFileByPath(path);
      if (old) await app.vault.modify(old, body); else await app.vault.create(path, body);
      return true;
    `);
    const hiddenSeen: boolean[] = [];
    for (const text of [
      "---\nwiki_published: false\n---\n# Versteckt\n\nEins.\n",
      "---\nwiki_published: false\n---\n# Versteckt\n\nZwei.\n",
      "---\nwiki_published: false\n---\n# Versteckt\n\nDrei.\n",
    ]) {
      await writeHidden(text);
      await fuehreCommandAus(cdp, hiddenPath, `${PLUGIN_ID}:push-current-note`);
      const page = await wiki.find(`${PREFIX}-versteckt`);
      hiddenSeen.push(page !== undefined && page.isPublished === false);
    }
    await writeHidden("# Versteckt\n\nOhne Feld, jetzt öffentlich.\n");
    await fuehreCommandAus(cdp, hiddenPath, `${PLUGIN_ID}:push-current-note`);
    const nowPublic = await wiki.find(`${PREFIX}-versteckt`);
    record(
      "14. Sichtbarkeit: wiki_published: false bleibt über mehrere Pushs mit Inhaltsänderung unsichtbar",
      hiddenSeen.length === 3 && hiddenSeen.every(Boolean) && nowPublic?.isPublished === true,
      `nach Push 1-3 unsichtbar: ${hiddenSeen.join("/")} · ohne Feld danach isPublished=${nowPublic?.isPublished}`,
    );

    // --- 4. Slug-Kollision sperrt den Push ---------------------------------
    await cdp.evaluate(`
      const root = ${JSON.stringify(root)};
      const mk = async (path, body) => {
        const old = app.vault.getAbstractFileByPath(path);
        if (old) await app.vault.modify(old, body); else await app.vault.create(path, body);
      };
      await mk(root + "/" + ${JSON.stringify(`${PREFIX} Kollision`)} + ".md", "eins");
      await mk(root + "/" + ${JSON.stringify(`${PREFIX}-kollision`)} + ".md", "zwei");
      await app.commands.executeCommandById(${JSON.stringify(`${PLUGIN_ID}:show-sync-status`)});
      return true;
    `);
    // Die Ansicht deterministisch neu aufbauen: den Refresh-Knopf zu klicken waere
    // eine Wette auf Beschriftung und Timing. `refresh()` ist die Methode, die der
    // Knopf ohnehin ruft — sie zu awaiten ist der Unterschied zwischen "gleich
    // nachgesehen" und "nachgesehen, als es fertig war".
    const refreshView = `
      const leaf = app.workspace.getLeavesOfType(${JSON.stringify(STATUS_VIEW)})[0];
      if (!leaf) return "keine Status-Ansicht offen";
      await leaf.view.refresh();
      return "ok";
    `;
    await cdp.evaluate(refreshView);

    const collision = await pollUntil<{ block: boolean; button: boolean; blocks: number }>(
      cdp,
      `
        const view = document.querySelector(".workspace-leaf-content[data-type='${STATUS_VIEW}']");
        if (!view) return null;
        const block = view.querySelector(".wikijs-collision");
        if (!block) return null;
        // Erst die Zeile belegen, dann ihre Eigenschaft pruefen: ein Vergleich gegen
        // ein nicht vorhandenes Element wuerde ausgerechnet im Defektfall gruen.
        const rows = [...view.querySelectorAll(".setting-item")];
        const row = rows.find((r) => (r.textContent || "").includes(${JSON.stringify(`${PREFIX}-kollision`)}));
        if (!row) return null;
        const hasPush = [...row.querySelectorAll("button")].some((b) => /push|senden/i.test(b.textContent || ""));
        return { block: true, button: hasPush, blocks: view.querySelectorAll(".wikijs-collision").length };
      `,
      8000,
    );
    record(
      "4. Slug-Kollision: Warnblock da, Push für die Zeile gesperrt",
      // `blocks === 1`: das Öffnen (onOpen) und der awaitete refresh() überlappen — ohne
      // Serialisierung stand jeder Block zweimal im DOM (Welle 21, vw-w21).
      collision !== null && collision.block && !collision.button && collision.blocks === 1,
      collision === null
        ? "Block oder Zeile nicht gefunden"
        : `Push-Knopf ${collision.button ? "noch da" : "weg"} · ${collision.blocks} Warnblock/-blöcke`,
    );

    // --- 5. Mehrdeutiger Name meldet, sperrt aber nicht --------------------
    await cdp.evaluate(`
      const root = ${JSON.stringify(root)};
      for (const p of [${JSON.stringify(`${PREFIX} Kollision`)}, ${JSON.stringify(`${PREFIX}-kollision`)}]) {
        const f = app.vault.getAbstractFileByPath(root + "/" + p + ".md");
        if (f) await app.vault.delete(f);
      }
      const mkdir = async (p) => { if (!app.vault.getFolderByPath(p)) await app.vault.createFolder(p); };
      await mkdir(root + "/" + ${JSON.stringify(`${PREFIX}-a`)});
      await mkdir(root + "/" + ${JSON.stringify(`${PREFIX}-b`)});
      const mk = async (path, body) => {
        const old = app.vault.getAbstractFileByPath(path);
        if (old) await app.vault.modify(old, body); else await app.vault.create(path, body);
      };
      await mk(root + "/" + ${JSON.stringify(`${PREFIX}-a`)} + "/Doppel.md", "eins");
      await mk(root + "/" + ${JSON.stringify(`${PREFIX}-b`)} + "/Doppel.md", "zwei");
      return true;
    `);
    await cdp.evaluate(refreshView);
    const ambiguous = await pollUntil<{ block: boolean; button: boolean }>(
      cdp,
      `
        const view = document.querySelector(".workspace-leaf-content[data-type='${STATUS_VIEW}']");
        if (!view) return null;
        const block = view.querySelector(".wikijs-ambiguous");
        if (!block) return null;
        const rows = [...view.querySelectorAll(".setting-item")];
        const row = rows.find((r) => (r.textContent || "").includes(${JSON.stringify(`${PREFIX}-a/doppel`)}));
        if (!row) return null;
        const hasPush = [...row.querySelectorAll("button")].some((b) => /push|senden/i.test(b.textContent || ""));
        return { block: true, button: hasPush };
      `,
      12000,
    );
    record(
      "5. Mehrdeutiger Name: Hinweisblock da, Push bleibt möglich",
      ambiguous !== null && ambiguous.block && ambiguous.button,
      ambiguous === null ? "Block oder Zeile nicht gefunden" : `Push-Knopf ${ambiguous.button ? "da" : "fehlt"}`,
    );

    // --- 15. Umbenennen verschiebt die Seite ---------------------------------
    // Eine umbenannte Notiz war fuer das Plugin eine neue Seite plus eine verschwundene: Id, Historie
    // und URL gingen verloren. Gemessen wird drueben: dieselbe Id unter neuem Pfad, kein Eintrag mehr
    // unter dem alten, und der Entfernen-Dialog erscheint nicht.
    const umzugBody = "# Umzug\n\nDieser Text bleibt beim Umbenennen gleich, damit der Umzug erkannt wird.\n";
    await cdp.evaluate(`
      const path = ${JSON.stringify(notePath("umzug"))};
      const old = app.vault.getAbstractFileByPath(path);
      if (old) await app.vault.modify(old, ${JSON.stringify(umzugBody)}); else await app.vault.create(path, ${JSON.stringify(umzugBody)});
      return true;
    `);
    await fuehreCommandAus(cdp, notePath("umzug"), `${PLUGIN_ID}:push-current-note`);
    const vorUmzug = await wiki.find(`${PREFIX}-umzug`);
    await cdp.evaluate(`
      const file = app.vault.getAbstractFileByPath(${JSON.stringify(notePath("umzug"))});
      await app.fileManager.renameFile(file, ${JSON.stringify(`${root}/${PREFIX}-umzug-neu.md`)});
      return true;
    `);
    await cdp.evaluate(refreshView);
    const moveClick = await cdp.evaluate<{ row: boolean; label: string | null; dialog: boolean }>(`
      const view = document.querySelector(".workspace-leaf-content[data-type='${STATUS_VIEW}']");
      const rows = view ? [...view.querySelectorAll(".setting-item")] : [];
      const row = rows.find((r) => (r.querySelector(".setting-item-name")?.textContent || "") === ${JSON.stringify(`${PREFIX}-umzug-neu`)});
      if (!row) return { row: false, label: null, dialog: false };
      const btn = [...row.querySelectorAll("button")].find((b) => /move|verschieb/i.test(b.textContent || ""));
      if (!btn) return { row: true, label: null, dialog: false };
      btn.click();
      await new Promise((r) => setTimeout(r, 1500));
      return { row: true, label: btn.textContent, dialog: !!document.querySelector(".modal-container") };
    `);
    await new Promise((r) => setTimeout(r, 1500));
    const nachUmzug = await wiki.find(`${PREFIX}-umzug-neu`);
    const altUebrig = await wiki.find(`${PREFIX}-umzug`);
    record(
      "15. Umbenannte Notiz: Seite wird verschoben (pages.move), Id bleibt, kein Anlegen und kein Entfernen-Dialog",
      vorUmzug !== undefined && nachUmzug?.id === vorUmzug.id && altUebrig === undefined && !moveClick.dialog,
      !moveClick.row
        ? "Zeile zur umbenannten Notiz fehlt in der Status-Ansicht"
        : moveClick.label === null
          ? "Zeile ohne Verschieben-Knopf"
          : `Id vorher ${vorUmzug?.id} · nachher ${nachUmzug?.id} · alter Pfad ${altUebrig ? "noch da" : "weg"} · Dialog ${moveClick.dialog ? "ja" : "nein"}`,
    );

    // --- 6. Falscher Schlüssel wird als Authentifizierung benannt -----------
    // Der Schlüssel wird absichtlich verstellt; das `finally` setzt ihn zurück —
    // deshalb liegt `previousApiKey` außerhalb des try.
    //
    // Warum eine schreibende Aktion nötig ist: die Instanz erlaubt das LESEN der
    // Seitenliste ohne gültigen Schlüssel (gemessen 2026-08-12). Ein Plan-Aufbau
    // liefe also durch, und der Prüfpunkt prüfte nichts.
    await cdp.evaluate(`
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      p.settings.apiKey = "ungueltig-fuer-den-smoke";
      await p.saveSettings();
      const path = ${JSON.stringify(`${root}/${PREFIX}-auth.md`)};
      const old = app.vault.getAbstractFileByPath(path);
      if (old) await app.vault.modify(old, "Auth-Test"); else await app.vault.create(path, "Auth-Test");
      return true;
    `);
    const authNotice = await fuehreCommandAus(cdp, `${root}/${PREFIX}-auth.md`, `${PLUGIN_ID}:push-current-note`);
    record(
      "6. Falscher Schlüssel: Meldung benennt die Authentifizierung",
      /401|403|auth|schlüssel|key|berecht/i.test(authNotice),
      authNotice.slice(0, 90),
    );

    await cdp.evaluate(`
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      p.settings.apiKey = ${JSON.stringify(token)};
      await p.saveSettings();
      return true;
    `);

    // --- 9.–12. Sackgassen-Ausgänge (SMOKE.md Punkte 12–15) -----------------
    // Bis 0.1.2 schrieben "occupied" und "stale-snapshot" nie ins Wiki, hatten aber
    // auch keinen Ausgang — die Zeile blieb dauerhaft stehen. Alle vier Wege hier
    // schreiben NIE ins Wiki (schlimmstenfalls tun sie nichts); deshalb ist der
    // Snapshot-Ordner direkt zu manipulieren der einzige Weg, den Ausgangszustand
    // ohne Wiki-Seiteneffekt herzustellen.

    /** Snapshot-Datei zu genau einem `wikiPath` entfernen — nicht per Präfix wie im
     *  `finally`, sonst räumt ein Check dem nächsten die Vorbedingung weg. */
    const dropSnapshot = (wikiPath: string): string => `
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
      return "Snapshot nicht gefunden";
    `;

    /** Zeile der Status-Ansicht zu einem `wikiPath` finden: erst Existenz, dann
     *  Eigenschaft — ein Vergleich gegen eine fehlende Zeile wäre im Defektfall grün. */
    const findRow = (wikiPath: string): string => `
      const view = document.querySelector(".workspace-leaf-content[data-type='${STATUS_VIEW}']");
      if (!view) return null;
      const rows = [...view.querySelectorAll(".setting-item")];
      const row = rows.find((r) => (r.textContent || "").includes(${JSON.stringify(wikiPath)}));
      if (!row) return null;
      const desc = row.querySelector(".setting-item-description");
      const buttons = [...row.querySelectorAll("button")].map((b) => b.textContent || "");
      return { desc: desc ? desc.textContent || "" : "", buttons };
    `;

    // --- 9. Belegter Slug, eigene Seite (SMOKE 12) --------------------------
    const ownPath = notePath("occupied-own");
    await cdp.evaluate(`
      const path = ${JSON.stringify(ownPath)};
      const old = app.vault.getAbstractFileByPath(path);
      if (old) await app.vault.modify(old, "# Belegt eigen\\n"); else await app.vault.create(path, "# Belegt eigen\\n");
      return true;
    `);
    await fuehreCommandAus(cdp, ownPath, `${PLUGIN_ID}:push-current-note`);
    await cdp.evaluate(dropSnapshot(`${PREFIX}-occupied-own`));
    await cdp.evaluate(refreshView);
    const ownRow = await pollUntil<{ desc: string; buttons: string[] }>(
      cdp,
      findRow(`${PREFIX}-occupied-own`),
      8000,
    );
    const ownAdoptButton = ownRow?.buttons.some((b) => /übernehmen|adopt/i.test(b)) ?? false;
    let ownAdoptNotice = "";
    if (ownAdoptButton) {
      await clearNotices(cdp);
      await cdp.evaluate(`
        const view = document.querySelector(".workspace-leaf-content[data-type='${STATUS_VIEW}']");
        const row = [...view.querySelectorAll(".setting-item")].find((r) => (r.textContent || "").includes(${JSON.stringify(`${PREFIX}-occupied-own`)}));
        [...row.querySelectorAll("button")].find((b) => /übernehmen|adopt/i.test(b.textContent || "")).click();
        return true;
      `);
      ownAdoptNotice = (await pollUntil<string>(cdp, `const n = document.querySelector(".notice"); return n ? n.textContent : null;`, 10000)) ?? "KEINE MELDUNG";
    }
    await cdp.evaluate(refreshView);
    const ownRowAfter = await cdp.evaluate<{ desc: string; buttons: string[] } | null>(findRow(`${PREFIX}-occupied-own`));
    record(
      "9. Belegter Slug, eigene Seite: Übernehmen räumt die Zeile ab (SMOKE 12)",
      ownRow !== null && /belegt|occupied/i.test(ownRow.desc) && ownAdoptButton && /übernommen|adopted/i.test(ownAdoptNotice) && ownRowAfter === null,
      ownRow === null
        ? "Zeile nicht gefunden"
        : !ownAdoptButton
          ? `kein Übernehmen-Knopf (Zustand: "${ownRow.desc}")`
          : `Meldung "${ownAdoptNotice.slice(0, 60)}" · Zeile danach ${ownRowAfter === null ? "weg" : `noch da ("${ownRowAfter.desc}")`}`,
    );

    // --- 10. Belegter Slug, fremde Seite (SMOKE 13) -------------------------
    const foreignPath = notePath("occupied-foreign");
    await cdp.evaluate(`
      const path = ${JSON.stringify(foreignPath)};
      const old = app.vault.getAbstractFileByPath(path);
      if (old) await app.vault.modify(old, "# Belegt fremd\\n"); else await app.vault.create(path, "# Belegt fremd\\n");
      return true;
    `);
    await fuehreCommandAus(cdp, foreignPath, `${PLUGIN_ID}:push-current-note`);
    const foreignPage = await wiki.find(`${PREFIX}-occupied-foreign`);
    if (foreignPage) await wiki.setForeignContent(foreignPage.id, foreignPage.title, "Fremd geändert, nicht vom Plugin.");
    await cdp.evaluate(dropSnapshot(`${PREFIX}-occupied-foreign`));
    await cdp.evaluate(refreshView);
    const foreignRow = await pollUntil<{ desc: string; buttons: string[] }>(
      cdp,
      findRow(`${PREFIX}-occupied-foreign`),
      8000,
    );
    const foreignAdoptButton = foreignRow?.buttons.some((b) => /übernehmen|adopt/i.test(b)) ?? false;
    let foreignAdoptNotice = "";
    if (foreignAdoptButton) {
      await clearNotices(cdp);
      await cdp.evaluate(`
        const view = document.querySelector(".workspace-leaf-content[data-type='${STATUS_VIEW}']");
        const row = [...view.querySelectorAll(".setting-item")].find((r) => (r.textContent || "").includes(${JSON.stringify(`${PREFIX}-occupied-foreign`)}));
        [...row.querySelectorAll("button")].find((b) => /übernehmen|adopt/i.test(b.textContent || "")).click();
        return true;
      `);
      foreignAdoptNotice = (await pollUntil<string>(cdp, `const n = document.querySelector(".notice"); return n ? n.textContent : null;`, 10000)) ?? "KEINE MELDUNG";
    }
    const foreignContentAfter = foreignPage ? await wiki.content(foreignPage.id) : "";
    await cdp.evaluate(refreshView);
    const foreignRowAfter = await cdp.evaluate<{ desc: string; buttons: string[] } | null>(findRow(`${PREFIX}-occupied-foreign`));
    record(
      "10. Belegter Slug, fremde Seite: Übernehmen bleibt aus, Wiki unangetastet (SMOKE 13)",
      foreignRow !== null &&
        /belegt|occupied/i.test(foreignRow.desc) &&
        foreignAdoptButton &&
        /nicht übernommen|not adopted/i.test(foreignAdoptNotice) &&
        foreignContentAfter.includes("Fremd geändert") &&
        foreignRowAfter !== null &&
        /belegt|occupied/i.test(foreignRowAfter.desc),
      foreignRow === null
        ? "Zeile nicht gefunden"
        : !foreignAdoptButton
          ? `kein Übernehmen-Knopf (Zustand: "${foreignRow.desc}")`
          : `Meldung "${foreignAdoptNotice.slice(0, 60)}" · Wiki-Inhalt danach "${foreignContentAfter.slice(0, 30)}" · Zeile danach "${foreignRowAfter?.desc ?? "weg"}"`,
    );

    // --- 11. Verwaister Snapshot (SMOKE 14) ----------------------------------
    const stalePath = notePath("stale");
    await cdp.evaluate(`
      const path = ${JSON.stringify(stalePath)};
      const old = app.vault.getAbstractFileByPath(path);
      if (old) await app.vault.modify(old, "# Verwaist\\n"); else await app.vault.create(path, "# Verwaist\\n");
      return true;
    `);
    await fuehreCommandAus(cdp, stalePath, `${PLUGIN_ID}:push-current-note`);
    const stalePurged = await wiki.purge();
    await cdp.evaluate(`
      const file = app.vault.getAbstractFileByPath(${JSON.stringify(stalePath)});
      if (file) await app.vault.delete(file);
      return true;
    `);
    await cdp.evaluate(refreshView);
    const staleRow = await pollUntil<{ desc: string; buttons: string[] }>(cdp, findRow(`${PREFIX}-stale`), 8000);
    const staleForgetButton = staleRow?.buttons.some((b) => /verwerfen|discard/i.test(b)) ?? false;
    let staleForgetNotice = "";
    if (staleForgetButton) {
      await clearNotices(cdp);
      await cdp.evaluate(`
        const view = document.querySelector(".workspace-leaf-content[data-type='${STATUS_VIEW}']");
        const row = [...view.querySelectorAll(".setting-item")].find((r) => (r.textContent || "").includes(${JSON.stringify(`${PREFIX}-stale`)}));
        [...row.querySelectorAll("button")].find((b) => /verwerfen|discard/i.test(b.textContent || "")).click();
        return true;
      `);
      staleForgetNotice = (await pollUntil<string>(cdp, `const n = document.querySelector(".notice"); return n ? n.textContent : null;`, 10000)) ?? "KEINE MELDUNG";
    }
    await cdp.evaluate(refreshView);
    const staleRowAfter = await cdp.evaluate<{ desc: string; buttons: string[] } | null>(findRow(`${PREFIX}-stale`));
    record(
      "11. Verwaister Snapshot: Verwerfen räumt die Zeile ab (SMOKE 14)",
      staleRow !== null &&
        /veraltet|stale/i.test(staleRow.desc) &&
        staleForgetButton &&
        /verworfen|discarded/i.test(staleForgetNotice) &&
        staleRowAfter === null,
      staleRow === null
        ? "Zeile nicht gefunden"
        : !staleForgetButton
          ? `kein Verwerfen-Knopf (Zustand: "${staleRow.desc}", ${stalePurged} Wiki-Reste geräumt)`
          : `Meldung "${staleForgetNotice.slice(0, 60)}" · Zeile danach ${staleRowAfter === null ? "weg" : `noch da ("${staleRowAfter.desc}")`}`,
    );

    // --- 12. Kein stiller Abbruch (SMOKE 15) --------------------------------
    // Die Notiz verschwindet AM VAULT-INDEX VORBEI (adapter.remove statt
    // vault.delete) — genau die Lücke zwischen echter externer Löschung (git
    // checkout, Sync-Tool) und dem Zeitpunkt, zu dem Obsidians Dateibeobachter sie
    // bemerkt. Der Push-Klick trifft deshalb auf eine Zeile, die noch die alte Welt
    // zeigt — und darf trotzdem nicht schweigen.
    const silentPath = notePath("silent");
    await cdp.evaluate(`
      const path = ${JSON.stringify(silentPath)};
      const old = app.vault.getAbstractFileByPath(path);
      if (old) await app.vault.modify(old, "# Still\\n"); else await app.vault.create(path, "# Still\\n");
      return true;
    `);
    await fuehreCommandAus(cdp, silentPath, `${PLUGIN_ID}:push-current-note`);
    await cdp.evaluate(`
      const file = app.vault.getAbstractFileByPath(${JSON.stringify(silentPath)});
      await app.vault.modify(file, "# Still\\n\\nNoch eine Zeile.\\n");
      return true;
    `);
    await cdp.evaluate(refreshView);
    const silentRow = await pollUntil<{ desc: string; buttons: string[] }>(cdp, findRow(`${PREFIX}-silent`), 8000);
    const silentPushButton = silentRow?.buttons.some((b) => /push/i.test(b)) ?? false;
    let silentNotice = "";
    if (silentPushButton) {
      // EIN Ausdruck, keine zwei Aufrufe: zwischen "Datei entfernen" und "Knopf
      // klicken" darf kein CDP-Roundtrip liegen, sonst gewinnt fast immer der
      // Dateibeobachter und die Rennbedingung, die dieser Punkt prüft, tritt nie ein.
      await clearNotices(cdp);
      await cdp.evaluate(`
        const path = ${JSON.stringify(silentPath)};
        const file = app.vault.getAbstractFileByPath(path);
        if (file) await app.vault.adapter.remove(path);
        const view = document.querySelector(".workspace-leaf-content[data-type='${STATUS_VIEW}']");
        const row = [...view.querySelectorAll(".setting-item")].find((r) => (r.textContent || "").includes(${JSON.stringify(`${PREFIX}-silent`)}));
        [...row.querySelectorAll("button")].find((b) => /push/i.test(b.textContent || "")).click();
        return true;
      `);
      silentNotice = (await pollUntil<string>(cdp, `const n = document.querySelector(".notice"); return n ? n.textContent : null;`, 10000)) ?? "KEINE MELDUNG";
    }
    record(
      "12. Kein stiller Abbruch bei extern gelöschter Notiz (SMOKE 15)",
      silentRow !== null && silentPushButton && silentNotice !== "KEINE MELDUNG" && silentNotice.trim() !== "",
      silentRow === null
        ? "Zeile nicht gefunden"
        : !silentPushButton
          ? `kein Push-Knopf (Zustand: "${silentRow.desc}")`
          : `Meldung: "${silentNotice.slice(0, 90)}"`,
    );

    // --- (kein Prüfpunkt für den Settings-Tab) ------------------------------
    // Bewusst nicht automatisiert: `app.setting.open()` liefert das Tab-DOM nicht
    // zuverlässig her (Obsidian 1.13 baut die Liste verzögert und ohne stabilen
    // Anker), und der Nutzen wäre gering — dass der Tab rendert, sieht man beim
    // ersten Blick in die Einstellungen. Ein Prüfpunkt, der mehr Pflege kostet als
    // er trägt, macht die Suite unglaubwürdig. Bleibt Handarbeit (docs/SMOKE.md).

    // --- 13. Keine rohen i18n-Schlüssel in der Oberfläche -------------------
    // Nicht die Sprachumstellung wird geprüft (die änderte den Wirt), sondern die
    // reale Regressionsgefahr: `t()` fällt bei einem fehlenden Schlüssel auf den
    // Schlüsselnamen zurück, und dann steht "command.pushCurrent" in der
    // Befehlspalette. Im Ökosystem ist genau das am 2026-08-08 passiert, als eine
    // Kit-Statusliste wuchs und der Consumer die Schlüssel nicht nachzog.
    const rawKeys = await cdp.evaluate<string[]>(`
      const suspicious = [];
      for (const c of app.commands.listCommands()) {
        if (!c.id.startsWith(${JSON.stringify(PLUGIN_ID)})) continue;
        if (/^[a-z]+\\.[a-zA-Z.]+$/.test(c.name)) suspicious.push("Command: " + c.name);
      }
      const view = document.querySelector(".workspace-leaf-content[data-type='${STATUS_VIEW}']");
      if (view) {
        for (const el of view.querySelectorAll(".setting-item-name, .setting-item-description, button")) {
          const text = (el.textContent || "").trim();
          if (/^(view|status|notice|report|settings|removal|conflict)\\.[a-zA-Z.]+$/.test(text)) {
            suspicious.push("Ansicht: " + text);
          }
        }
      }
      return suspicious;
    `);
    record(
      "13. Keine rohen i18n-Schlüssel in Commands und Status-Ansicht",
      rawKeys.length === 0,
      rawKeys.length === 0 ? "alle Texte übersetzt" : rawKeys.slice(0, 3).join(", "),
    );

    // --- 16. Bestand uebernehmen ------------------------------------------------
    // Ausgangslage: eine Wiki-Seite, die der Vault nicht kennt. Nach dem Befehl liegt sie als Notiz
    // im Sync-Ordner, und im Wiki hat sich nichts bewegt (updatedAt gleich) — der Befehl schreibt nie.
    const importLocale = await cdp.evaluate<string>(`return app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].settings.locale;`);
    const importId = await wiki.create(`${PREFIX}-import`, `${PREFIX}-import`, "# Aus dem Wiki\n\nBestand.\n", importLocale);
    const vorImport = await wiki.find(`${PREFIX}-import`);
    const importLauf = await cdp.evaluate<{ modal: boolean; clicked: boolean }>(`
      app.commands.executeCommandById(${JSON.stringify(`${PLUGIN_ID}:import-existing`)});
      let modal = null;
      for (let i = 0; i < 50 && !modal; i++) { await new Promise((r) => setTimeout(r, 200)); modal = document.querySelector(".modal-container"); }
      if (!modal) return { modal: false, clicked: false };
      const btn = modal.querySelector("button.mod-cta");
      if (!btn) return { modal: true, clicked: false };
      btn.click();
      for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 150)); if (!document.querySelector(".modal-container")) break; }
      return { modal: true, clicked: true };
    `);
    await new Promise((r) => setTimeout(r, 2500));
    const importiert = await cdp.evaluate<{ exists: boolean; head: string }>(`
      const f = app.vault.getAbstractFileByPath(${JSON.stringify(notePath("import"))});
      if (!f) return { exists: false, head: "" };
      return { exists: true, head: (await app.vault.read(f)).slice(0, 80) };
    `);
    const nachImport = await wiki.find(`${PREFIX}-import`);
    record(
      "16. Bestand übernehmen: Wiki-Seite wird zur Notiz mit Snapshot, im Wiki wird nichts geschrieben",
      importLauf.modal && importLauf.clicked && importiert.exists && importiert.head.includes("title:")
        && nachImport?.id === importId && nachImport.updatedAt === vorImport?.updatedAt,
      !importLauf.modal
        ? "Übernahme-Dialog erschien nicht"
        : !importiert.exists
          ? "Notiz wurde nicht angelegt"
          : `Notiz da · Frontmatter ${importiert.head.includes("title:") ? "ja" : "nein"} · updatedAt ${nachImport?.updatedAt === vorImport?.updatedAt ? "unverändert" : "GEÄNDERT"}`,
    );

  } finally {
    await zustand.schliesse();
    if (istAbgebrochen()) return;
    if (stub) {
      const gesehen = stub.log();
      const nach = (o: string): number => gesehen.filter((e) => e.outcome === o).length;
      console.log(
        `\nStub-Mitschnitt: ${gesehen.length} Anfragen · ${gesehen.filter((e) => e.write).length} schreibend · `
        + `Forbidden ${nach("forbidden")} · Fehler im responseResult ${nach("result-error")} · GraphQL-Fehler ${nach("graphql-error")}`,
      );
      await stub.close().catch(() => undefined);
    }
    cdp.close();
    // Auch nach einem Abbruch mitten im Lauf kommt die Bilanz; `runDriver` macht daraus Exit 2.
    bilanz.abschluss();
  }
}

runDriver(main);
