/**
 * Lokaler Wiki.js-GraphQL-Stub für den GUI-Smoke — ein HTTP-Server auf 127.0.0.1 (Port 0)
 * im Prozess des Treibers, mit Zustand.
 *
 * ## Warum ein Stub statt einer echten Instanz
 *
 * Der Smoke braucht eine Gegenstelle mit Seiten, die sich ändern. Gegen die echte Instanz zu
 * fahren hängt an Netz, Schlüssel und einem Wiki, in das der Treiber schreibt; in der
 * Staging-Lage gibt es weder Wiki-URL noch Schlüssel, und jeder Punkt blieb „nichts gemessen“.
 * Der Stub macht die Punkte wiederholbar und ohne fremdes Konto messbar. Der Lauf wird in der
 * Bilanz als „gegen Stub“ ausgewiesen, nicht als Messung gegen Wiki.js.
 *
 * ## Was er NICHT ersetzt
 *
 * Den Beweis, dass eine echte Wiki.js-Instanz sich so verhält wie hier angenommen. Die
 * Eigenheiten unten sind aus `src/wikijs/queries.ts` und `docs/LAB.md` übernommen (am
 * 2026-08-12 gegen eine echte 2.5-Instanz gemessen), nicht neu gemessen. Dafür fährt der
 * Treiber mit `--live` gegen die in den Plugin-Einstellungen konfigurierte Instanz. Nicht
 * nachgebildet: Feldauswahl (der Stub liefert immer alle Felder), Locale- und Pfadregeln über
 * die Duplikatprüfung hinaus, Rechte je Seite, Rendering, Suche, die übrigen Operationen.
 *
 * ## Wiki.js-Eigenheiten, die er trägt (sonst misst der Smoke eine Vereinfachung)
 *
 *  - Lesen geht ohne Schlüssel; Schreiben mit falschem Schlüssel antwortet **HTTP 200** mit
 *    GraphQL-Fehler „Forbidden“ (nicht 401/403) — der Client erkennt die Absage am Wortlaut.
 *  - `update` ohne `content` → `responseResult` mit Fehler 6004 (`PageEmptyContent`).
 *  - `update` ohne `tags` ändert die Seite zuerst und scheitert dann mit dem Fehler
 *    „Cannot read properties of undefined (reading 'map')“ (Kommentar bei `UNPUBLISH_PAGE`).
 *  - `updatedAt` ändert sich bei jedem Schreibzugriff (Drift-Guard), auch beim Depublizieren.
 *  - `pages.single` ist `null` für eine unbekannte Id (extern gelöschte Seite).
 *  - Anlegen auf einen belegten Pfad scheitert im `responseResult` (der Fehlercode 2002 und
 *    der Wortlaut sind eine Annahme, nicht gemessen).
 *
 * Wie `anysource-sideloader/scripts/forge-server.ts` setzt der Stub **keine CORS-Header**: das
 * Plugin spricht über `requestUrl`, das am CORS-Modell des Renderers vorbeigeht, und ein
 * freundlicher Header würde nur verdecken, was die echte Instanz nicht schickt.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/** Eine Anfrage, wie der Stub sie gesehen hat. Der Schlüssel selbst wird nie festgehalten,
 *  nur ob er gestimmt hat. */
export interface WikiRequestLog {
  operation: string;
  /** Hat der `Authorization`-Header den erwarteten Schlüssel getragen? */
  authorized: boolean;
  /** `true` bei Mutationen. */
  write: boolean;
  /** Antwort-Art: `ok`, `forbidden`, `result-error` (Fehler im `responseResult`) oder `graphql-error`. */
  outcome: "ok" | "forbidden" | "result-error" | "graphql-error";
  /** Id, auf die sich die Anfrage bezog, falls vorhanden. */
  id: number | null;
}

export interface StubPage {
  id: number;
  path: string;
  title: string;
  description: string;
  content: string;
  tags: string[];
  isPublished: boolean;
  locale: string;
  updatedAt: string;
}

export interface RunningWikiStub {
  /** Basis-URL ohne `/graphql`, so wie sie in den Plugin-Einstellungen steht. */
  url: string;
  /** Der Schlüssel, den der Stub als gültig ansieht (ASCII, kein echter Wert). */
  apiKey: string;
  /** Mitschnitt aller GraphQL-Anfragen seit Start bzw. `clearLog()`. */
  log(): WikiRequestLog[];
  clearLog(): void;
  /** Momentaufnahme des Zustands, für Prüfungen am Stub vorbei. */
  pages(): StubPage[];
  close(): Promise<void>;
}

const FORBIDDEN = "Forbidden";
const DUPLICATE_PATH = { code: 2002, message: "Cannot create this page because an entry already exists at the same path." };
const EMPTY_CONTENT = { code: 6004, message: "Content is empty" };
const MAP_OF_UNDEFINED = "Cannot read properties of undefined (reading 'map')";

type Json = Record<string, unknown>;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

const result = (succeeded: boolean, extra: { code?: number; message?: string; slug?: string } = {}): Json => ({
  responseResult: {
    succeeded,
    errorCode: extra.code ?? 0,
    slug: extra.slug ?? (succeeded ? "ok" : "error"),
    message: extra.message ?? (succeeded ? "OK" : "Error"),
  },
});

export async function startWikiStub(apiKey = "smoke-stub-key"): Promise<RunningWikiStub> {
  const pages = new Map<number, StubPage>();
  const log: WikiRequestLog[] = [];
  let nextId = 1;
  // Streng monoton, unabhängig von der Uhr: zwei Schreibzugriffe in derselben Millisekunde
  // sollen sich trotzdem im Drift-Guard unterscheiden.
  let clock = Date.now();
  const stamp = (): string => new Date(++clock).toISOString();

  const publicPage = (p: StubPage): Json => ({ ...p, tags: p.tags.map((tag) => ({ tag })) });

  /** Welche Operation steckt im Dokument? Der Client schickt genau die sieben Dokumente aus
   *  `src/wikijs/queries.ts`, der Treiber zusätzlich eigene Lese-/Schreibzugriffe — alle mit
   *  Variablen. Erkannt wird am Feldaufruf, nicht an der Dokument-Gleichheit. */
  function operationOf(query: string): { name: string; write: boolean } {
    if (/\bpages\s*\{\s*create\s*\(/.test(query)) return { name: "create", write: true };
    if (/\bpages\s*\{\s*move\s*\(/.test(query)) return { name: "move", write: true };
    if (/\bpages\s*\{\s*delete\s*\(/.test(query)) return { name: "delete", write: true };
    const update = /\bpages\s*\{\s*update\s*\(([^)]*)\)/.exec(query);
    if (update) return { name: /isPublished:\s*false/.test(update[1] ?? "") ? "unpublish" : "update", write: true };
    if (/\bsingle\s*\(/.test(query)) {
      // PAGE_UPDATED_AT fragt nur `updatedAt`, SINGLE_PAGE und der Treiber mehr.
      return { name: /single\s*\([^)]*\)\s*\{\s*updatedAt\s*\}/.test(query) ? "updatedAt" : "single", write: false };
    }
    if (/\blist\s*\(/.test(query)) return { name: "list", write: false };
    return { name: "unbekannt", write: false };
  }

  function execute(op: string, v: Json): { data: Json } | { errors: { message: string }[] } {
    const id = typeof v.id === "number" ? v.id : null;
    switch (op) {
      case "list":
        return { data: { pages: { list: [...pages.values()].sort((a, b) => a.path.localeCompare(b.path)).map(publicPage) } } };
      case "single":
        return { data: { pages: { single: id !== null && pages.has(id) ? publicPage(pages.get(id) as StubPage) : null } } };
      case "updatedAt": {
        const p = id !== null ? pages.get(id) : undefined;
        return { data: { pages: { single: p ? { updatedAt: p.updatedAt } : null } } };
      }
      case "create": {
        const path = String(v.path ?? "");
        if ([...pages.values()].some((p) => p.path === path)) {
          return { data: { pages: { create: { ...result(false, DUPLICATE_PATH), page: null } } } };
        }
        const page: StubPage = {
          id: nextId++,
          path,
          title: String(v.title ?? ""),
          description: String(v.description ?? ""),
          content: String(v.content ?? ""),
          tags: Array.isArray(v.tags) ? (v.tags as unknown[]).map(String) : [],
          isPublished: typeof v.isPublished === "boolean" ? v.isPublished : true,
          locale: String(v.locale ?? "en"),
          updatedAt: stamp(),
        };
        pages.set(page.id, page);
        return { data: { pages: { create: { ...result(true, { slug: path }), page: { id: page.id, updatedAt: page.updatedAt } } } } };
      }
      case "update":
      case "unpublish": {
        const page = id !== null ? pages.get(id) : undefined;
        if (!page) return { data: { pages: { update: { ...result(false, { code: 6003, message: "This page does not exist." }), page: null } } } };
        // `content` fehlt → leerer Inhalt, vor jeder Änderung.
        if (typeof v.content !== "string") {
          return { data: { pages: { update: { ...result(false, EMPTY_CONTENT), page: null } } } };
        }
        page.content = v.content;
        if (typeof v.title === "string") page.title = v.title;
        if (typeof v.description === "string") page.description = v.description;
        page.isPublished = op === "unpublish" ? false : typeof v.isPublished === "boolean" ? v.isPublished : true;
        page.updatedAt = stamp();
        // `tags` fehlt → der Resolver hat die Seite schon geändert und stolpert erst danach.
        if (!Array.isArray(v.tags)) return { errors: [{ message: MAP_OF_UNDEFINED }] };
        page.tags = (v.tags as unknown[]).map(String);
        return { data: { pages: { update: { ...result(true, { slug: page.path }), page: { id: page.id, updatedAt: page.updatedAt } } } } };
      }
      case "move": {
        const page = id !== null ? pages.get(id) : undefined;
        if (!page) return { data: { pages: { move: result(false, { code: 6003, message: "This page does not exist." }) } } };
        const destination = String(v.destinationPath ?? "");
        if ([...pages.values()].some((p) => p.id !== page.id && p.path === destination)) {
          return { data: { pages: { move: result(false, DUPLICATE_PATH) } } };
        }
        page.path = destination;
        page.locale = String(v.destinationLocale ?? page.locale);
        page.updatedAt = stamp();
        return { data: { pages: { move: result(true, { slug: destination }) } } };
      }
      case "delete": {
        if (id === null || !pages.delete(id)) {
          return { data: { pages: { delete: result(false, { code: 6003, message: "This page does not exist." }) } } };
        }
        return { data: { pages: { delete: result(true) } } };
      }
      default:
        return { errors: [{ message: `Stub kennt diese Operation nicht: ${op}` }] };
    }
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== "POST" || (req.url ?? "").split("?")[0] !== "/graphql") {
      sendJson(res, 404, { error: "not found" });
      return;
    }
    let body: { query?: unknown; variables?: unknown };
    try {
      body = JSON.parse(await readBody(req)) as typeof body;
    } catch {
      sendJson(res, 400, { errors: [{ message: "Bad JSON" }] });
      return;
    }
    const query = typeof body.query === "string" ? body.query : "";
    const vars = (body.variables && typeof body.variables === "object" ? body.variables : {}) as Json;
    const { name, write } = operationOf(query);
    const authorized = req.headers.authorization === `Bearer ${apiKey}`;
    const id = typeof vars.id === "number" ? vars.id : null;

    if (write && !authorized) {
      log.push({ operation: name, authorized, write, outcome: "forbidden", id });
      sendJson(res, 200, { errors: [{ message: FORBIDDEN }], data: null });
      return;
    }
    const out = execute(name, vars);
    let outcome: WikiRequestLog["outcome"] = "ok";
    if ("errors" in out) outcome = "graphql-error";
    else if (JSON.stringify(out.data).includes('"succeeded":false')) outcome = "result-error";
    log.push({ operation: name, authorized, write, outcome, id });
    sendJson(res, 200, out);
  }

  const server: Server = createServer((req, res) => {
    void handle(req, res).catch((e: unknown) => {
      sendJson(res, 500, { errors: [{ message: e instanceof Error ? e.message : String(e) }] });
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", () => ok()));
  const port = (server.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${port}`,
    apiKey,
    log: () => log.slice(),
    clearLog: () => { log.length = 0; },
    pages: () => [...pages.values()].map((p) => ({ ...p, tags: p.tags.slice() })),
    close: () => new Promise<void>((ok) => { server.closeAllConnections?.(); server.close(() => ok()); }),
  };
}
