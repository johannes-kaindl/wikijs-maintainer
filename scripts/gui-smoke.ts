/**
 * GUI-Smoke-Treiber — fährt die mechanisch entscheidbaren Punkte aus `docs/SMOKE.md`
 * gegen ein **laufendes** Obsidian und eine **echte** Wiki.js-Instanz.
 *
 * Warum getrackt (CORE-TEST-02 b): Der erste Hand-Durchlauf am 2026-08-12 kam bis
 * Punkt 11 und fand dort einen echten Fehler — `pages.update` verlangt `content` und
 * `tags`, obwohl das Schema sie als optional führt. Kein Unit-Test konnte das sehen,
 * weil keiner gegen eine echte Instanz läuft. Eine Prüfung, die nur von Hand
 * existiert, wird beim nächsten Release nicht wieder gefahren.
 *
 * Was er prüft, das die vitest-Suite strukturell nicht kann: den echten
 * Settings-Tab, die echte Status-Ansicht im DOM, und vor allem die **echten
 * Antworten von Wiki.js** — dort saßen beide bisher gefundenen Fehler.
 *
 * ## Voraussetzung
 *
 * Obsidian muss mit offenem Debug-Port laufen (der einzige Handgriff, der Handarbeit
 * bleibt — die App muss dafür neu gestartet werden):
 *
 * ```bash
 * osascript -e 'quit app "Obsidian"'
 * open -a Obsidian --args --remote-debugging-port=9222
 * ```
 *
 * Dann, mit deployter Plugin-Version:
 *
 * ```bash
 * npm run smoke:gui -- --vault 70_CodingTraces
 * npm run smoke:gui -- --vault 70_CodingTraces --keep   # Testnotizen stehen lassen
 * ```
 *
 * ⚠️ Der Treiber schreibt in die konfigurierte Wiki-Instanz. Er legt ausschließlich
 * Seiten unter dem Präfix `zz-smoke-` an und löscht sie im `finally` wieder — auch
 * nach einem Abbruch. Er fasst keine andere Seite an.
 *
 * ⚠️ Chromium drosselt das Rendering nicht-fokussierter Fenster: ohne Fokus bleibt das
 * DOM leer und man debuggt ein Phantom (CORE-TEST-02).
 */


import { execFileSync } from "node:child_process";

const PLUGIN_ID = "wikijs-maintainer";
const STATUS_VIEW = "wikijs-status";

/** Alle Wiki-Pfade und Vault-Dateien des Smokes tragen dieses Präfix. Das ist die
 *  Zusicherung an den Maintainer: der Treiber fasst nichts an, was nicht ihm gehört —
 *  und das `finally` weiß, was es aufräumen darf. */
const PREFIX = "zz-smoke";

// --- CDP-Minimalbrücke ------------------------------------------------------
// Node ≥21 bringt `WebSocket` global mit — keine Dependency nötig.

interface CdpTarget {
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

interface CdpResponse {
  id?: number;
  result?: { result?: { value?: unknown }; exceptionDetails?: { text?: string } };
  error?: { message?: string };
}

class Cdp {
  private nextId = 1;
  private readonly pending = new Map<number, { ok: (v: CdpResponse) => void; fail: (e: Error) => void }>();

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event: MessageEvent) => {
      const message = JSON.parse(String(event.data)) as CdpResponse;
      if (message.id === undefined) return; // Event, kein Antwort-Frame
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.error) waiter.fail(new Error(message.error.message ?? "CDP-Fehler"));
      else waiter.ok(message);
    });
  }

  static async attach(port: number, vault?: string): Promise<Cdp> {
    let targets: CdpTarget[];
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      targets = (await response.json()) as CdpTarget[];
    } catch {
      throw new Error(
        `Kein Debug-Port auf ${port}. Obsidian mit --remote-debugging-port=${port} neu starten ` +
          `(siehe Kopfkommentar).`,
      );
    }

    // Das Hauptfenster ist die Seite mit Obsidians app-Schema; Popouts und DevTools
    // tragen andere URLs. Ohne diese Auswahl landet man im falschen Renderer.
    const pages = targets.filter(
      (t) => t.type === "page" && t.url.startsWith("app://obsidian.md") && t.webSocketDebuggerUrl,
    );
    if (pages.length === 0) {
      const seen = targets.map((t) => `${t.type} ${t.url}`).join("\n  ") || "(keine)";
      throw new Error(`Kein Obsidian-Fenster unter den Targets gefunden:\n  ${seen}`);
    }

    // Mehrere offene Vaults sind der Normalfall, nicht die Ausnahme. Blind das erste
    // Fenster zu nehmen hiesse, den Smoke im falschen Vault zu fahren — und der
    // Fehlschlag saehe aus wie ein Plugin-Defekt ("Plugin nicht aktiv"). Der Titel
    // traegt den Vault-Namen ("<Notiz> - <Vault> - Obsidian x.y.z").
    const matching = vault
      ? pages.filter((t) => t.title.toLowerCase().includes(vault.toLowerCase()))
      : pages;
    if (matching.length === 0) {
      throw new Error(
        `Kein Fenster passt zu --vault ${vault}. Offen:\n  ${pages.map((t) => t.title).join("\n  ")}`,
      );
    }
    if (matching.length > 1) {
      throw new Error(
        `Mehrere Obsidian-Fenster offen — mit --vault <name> eines waehlen:\n  ` +
          matching.map((t) => t.title).join("\n  "),
      );
    }
    const page = matching[0];
    // Der Filter oben garantiert die URL, der Typ nicht — der Guard haelt beides zusammen.
    if (!page.webSocketDebuggerUrl) throw new Error(`Fenster ohne Debugger-URL: ${page.title}`);
    console.log(`Fenster: ${page.title}`);

    const socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("WebSocket-Verbindung fehlgeschlagen")), {
        once: true,
      });
    });
    return new Cdp(socket);
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<CdpResponse> {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((ok, fail) => {
      this.pending.set(id, { ok, fail });
      setTimeout(() => {
        if (!this.pending.delete(id)) return;
        fail(new Error(`Zeitüberschreitung: ${method}`));
      }, 30_000);
    });
  }

  /** Ausdruck im Renderer auswerten. Wirft die Renderer-Ausnahme weiter, statt sie
   *  als `undefined` zu verschlucken — sonst liest sich ein kaputter Ausdruck wie ein
   *  fehlgeschlagener Prüfpunkt. */
  async evaluate<T>(expression: string): Promise<T> {
    const message = await this.send("Runtime.evaluate", {
      expression: `(async () => { ${expression} })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    const details = message.result?.exceptionDetails;
    if (details) throw new Error(`Renderer: ${details.text ?? "Ausnahme"}`);
    return message.result?.result?.value as T;
  }

  close(): void {
    this.socket.close();
  }
}

// --- Prüfpunkte -------------------------------------------------------------

interface Check {
  name: string;
  passed: boolean;
  detail: string;
}

const results: Check[] = [];

function record(name: string, passed: boolean, detail: string): void {
  results.push({ name, passed, detail });
  console.log(`${passed ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

/** Im Renderer: warten, bis `check()` wahr wird (Rendering ist asynchron). */
const waitFor = (body: string, timeoutMs = 8000): string => `
  const deadline = Date.now() + ${timeoutMs};
  while (Date.now() < deadline) {
    const value = (() => { ${body} })();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
`;

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
      `{ pages { list(orderBy: PATH) { id path title isPublished } } }`,
    );
    return data.pages.list;
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
  document.querySelectorAll(".notice").forEach((n) => n.remove());
  app.commands.executeCommandById(${JSON.stringify(commandId)});
  const deadline = Date.now() + ${timeoutMs};
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 150));
    const notice = document.querySelector(".notice");
    if (notice) return notice.textContent || "(leere Meldung)";
  }
  return "KEINE MELDUNG binnen ${timeoutMs} ms";
`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`);
    return index === -1 ? undefined : argv[index + 1];
  };
  const port = Number(flag("port") ?? 9222);
  const keep = argv.includes("--keep");
  const vault = flag("vault");

  console.log(`GUI-Smoke — Obsidian auf Port ${port}`);
  const cdp = await Cdp.attach(port, vault);

  // Außerhalb des try: das `finally` muss auch nach einem Abbruch mitten im Lauf
  // zurückschreiben können, sonst bleibt der Vault im Smoke-Zustand stehen.
  let previousApiKey: string | null = null;
  let wiki: Wiki | null = null;

  try {
    // Ohne Fokus drosselt Chromium den Renderer. `Page.bringToFront` genügt auf macOS
    // NICHT — es holt das Fenster innerhalb der App nach vorn, nicht die App nach vorn.
    await cdp.send("Page.bringToFront");
    if (process.platform === "darwin") {
      try {
        execFileSync("osascript", ["-e", 'tell application "Obsidian" to activate']);
        await new Promise((resolve) => setTimeout(resolve, 1500));
      } catch {
        console.log("  (Hinweis: `osascript activate` schlug fehl — Fenster ggf. von Hand nach vorn holen)");
      }
    }

    const vaultName = await cdp.evaluate<string>(`return window.app?.appId ? app.vault.getName() : "";`);
    if (!vaultName) throw new Error("Obsidians `app` ist im Renderer nicht erreichbar.");
    console.log(`Vault: ${vaultName}\n`);

    const plugin = await cdp.evaluate<{ ok: boolean; version?: string; baseUrl?: string; syncRoot?: string; hasKey?: boolean }>(`
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      if (!p) return { ok: false };
      return { ok: true, version: p.manifest.version, baseUrl: p.settings.baseUrl,
               syncRoot: p.settings.syncRoot, hasKey: Boolean(p.settings.apiKey) };
    `);
    if (!plugin.ok) throw new Error(`Plugin ${PLUGIN_ID} ist nicht aktiv. Erst deployen.`);
    if (!plugin.baseUrl || !plugin.hasKey) {
      throw new Error("Wiki-URL oder API-Schlüssel fehlen in den Plugin-Einstellungen.");
    }
    // Das Plugin neu laden, statt auf den Zufall zu setzen: Obsidian haelt den zuvor
    // geladenen `main.js` im Speicher, ein frisches `npm run deploy` erreicht den
    // laufenden Renderer also NICHT. Ohne diesen Schritt misst der Smoke einen
    // aelteren Stand als den, der auf der Platte liegt — am 2026-08-12 lief genau
    // deshalb ein bereits behobener Fehler noch dreimal als rot durch.
    await cdp.evaluate(`
      await app.plugins.disablePlugin(${JSON.stringify(PLUGIN_ID)});
      await app.plugins.enablePlugin(${JSON.stringify(PLUGIN_ID)});
      return true;
    `);
    await new Promise((r) => setTimeout(r, 1200));
    console.log(`Plugin ${plugin.version} · Wiki ${plugin.baseUrl} · Sync-Ordner ${plugin.syncRoot} (neu geladen)\n`);

    // Der Schlüssel bleibt im Node-Prozess und wird nie ausgegeben.
    const token = await cdp.evaluate<string>(
      `return app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].settings.apiKey;`,
    );
    wiki = new Wiki(plugin.baseUrl, token);
    previousApiKey = token;

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
    const push1 = await cdp.evaluate<string>(runCommand(notePath("push"), `${PLUGIN_ID}:push-current-note`));
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
    const push2 = await cdp.evaluate<string>(runCommand(notePath("push"), `${PLUGIN_ID}:push-current-note`));
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
      await app.fileManager.renameFile(file, ${JSON.stringify(`${PREFIX}-push-entfernt.md`)});
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

    const collision = await cdp.evaluate<{ block: boolean; button: boolean } | null>(
      waitFor(`
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
        return { block: true, button: hasPush };
      `),
    );
    record(
      "4. Slug-Kollision: Warnblock da, Push für die Zeile gesperrt",
      collision !== null && collision.block && !collision.button,
      collision === null ? "Block oder Zeile nicht gefunden" : `Push-Knopf ${collision.button ? "noch da" : "weg"}`,
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
    const ambiguous = await cdp.evaluate<{ block: boolean; button: boolean } | null>(
      waitFor(`
        const view = document.querySelector(".workspace-leaf-content[data-type='${STATUS_VIEW}']");
        if (!view) return null;
        const block = view.querySelector(".wikijs-ambiguous");
        if (!block) return null;
        const rows = [...view.querySelectorAll(".setting-item")];
        const row = rows.find((r) => (r.textContent || "").includes(${JSON.stringify(`${PREFIX}-a/doppel`)}));
        if (!row) return null;
        const hasPush = [...row.querySelectorAll("button")].some((b) => /push|senden/i.test(b.textContent || ""));
        return { block: true, button: hasPush };
      `, 12000),
    );
    record(
      "5. Mehrdeutiger Name: Hinweisblock da, Push bleibt möglich",
      ambiguous !== null && ambiguous.block && ambiguous.button,
      ambiguous === null ? "Block oder Zeile nicht gefunden" : `Push-Knopf ${ambiguous.button ? "da" : "fehlt"}`,
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
    const authNotice = await cdp.evaluate<string>(
      runCommand(`${root}/${PREFIX}-auth.md`, `${PLUGIN_ID}:push-current-note`),
    );
    record(
      "6. Falscher Schlüssel: Meldung benennt die Authentifizierung",
      /401|403|auth|schlüssel|key|berecht/i.test(authNotice),
      authNotice.slice(0, 90),
    );

    await cdp.evaluate(`
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      p.settings.apiKey = ${JSON.stringify(previousApiKey)};
      await p.saveSettings();
      return true;
    `);

    // --- (kein Prüfpunkt für den Settings-Tab) ------------------------------
    // Bewusst nicht automatisiert: `app.setting.open()` liefert das Tab-DOM nicht
    // zuverlässig her (Obsidian 1.13 baut die Liste verzögert und ohne stabilen
    // Anker), und der Nutzen wäre gering — dass der Tab rendert, sieht man beim
    // ersten Blick in die Einstellungen. Ein Prüfpunkt, der mehr Pflege kostet als
    // er trägt, macht die Suite unglaubwürdig. Bleibt Handarbeit (docs/SMOKE.md).

    // --- 8. Keine rohen i18n-Schlüssel in der Oberfläche --------------------
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
      "8. Keine rohen i18n-Schlüssel in Commands und Status-Ansicht",
      rawKeys.length === 0,
      rawKeys.length === 0 ? "alle Texte übersetzt" : rawKeys.slice(0, 3).join(", "),
    );

  } finally {
    // Aufräumen darf nie am Ergebnis hängen: auch ein abgebrochener Lauf gibt Vault
    // und Wiki so zurück, wie er sie vorgefunden hat.
    if (previousApiKey !== null) {
      await cdp
        .evaluate(`
          const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
          p.settings.apiKey = ${JSON.stringify(previousApiKey)};
          await p.saveSettings();
          return true;
        `)
        .catch(() => undefined);
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
    cdp.close();
  }

  const failed = results.filter((check) => !check.passed);
  console.log(`\n${results.length - failed.length}/${results.length} grün`);
  if (failed.length > 0) {
    console.log("Rot:");
    for (const check of failed) console.log(`  - ${check.name}: ${check.detail}`);
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(`\nAbbruch: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
