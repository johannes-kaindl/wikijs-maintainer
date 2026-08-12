// GraphQL-Transport ueber requestUrl (Spec: alles im Plugin, keine externen Helfer).
// requestUrl kennt weder Timeout noch Abort — deshalb laeuft JEDER Aufruf durch
// withTimeout aus dem Kit, mit window als Timer-Port.
import { requestUrl } from "obsidian";
import { withTimeout } from "../vendor/kit/timeout";
import type { RemotePage } from "../core/sync-plan";
import {
  CREATE_PAGE, DELETE_PAGE, LIST_PAGES, PAGE_UPDATED_AT, SINGLE_PAGE, UNPUBLISH_PAGE, UPDATE_PAGE,
} from "./queries";

export interface WikiClientOptions {
  baseUrl: string;
  token: string;
  locale: string;
  timeoutMs: number;
}

export interface PageInput {
  path: string;
  title: string;
  description: string;
  tags: string[];
  content: string;
}

export interface FetchedPage {
  id: number;
  path: string;
  title: string;
  description: string;
  content: string;
  updatedAt: string;
  /** Flach gezogen aus der `tags { tag }`-Form der API. Leere Liste statt
   *  `undefined`, weil der update-Resolver darueber stolpert (s. UNPUBLISH_PAGE). */
  tags: string[];
}

/** Fehler mit Ursache statt nur Text: die UI unterscheidet "Server sagt nein"
 *  (Meldung zeigen) von "Server schweigt" (Wiederholen anbieten). */
export class WikiError extends Error {
  constructor(
    readonly kind: "network" | "timeout" | "auth" | "graphql",
    message: string,
  ) {
    super(message);
    this.name = "WikiError";
  }
}

/** Unterfelder von ResponseStatus sind laut docs/LAB.md NICHT gemessen — nur eine
 *  begruendete Annahme (`succeeded errorCode slug message`). `assertSucceeded`
 *  unten prueft deshalb strikt auf `=== true`: fehlt das Feld oder heisst es
 *  anders, faellt der Erfolgspfad auf "fehlgeschlagen" statt auf einen falschen
 *  Erfolg. */
/** Erkennt die Berechtigungs-Absagen von Wiki.js im GraphQL-Kanal. Bewusst eng
 *  gehalten: ein zu weiter Ausdruck stufte fachliche Fehler faelschlich als
 *  Schluesselproblem ein und schickte den Nutzer auf die falsche Faehrte. */
const AUTH_MESSAGE = /\bforbidden\b|\bunauthorized\b|not authorized|invalid token|jwt/i;

interface ResponseResult {
  succeeded: boolean;
  errorCode?: number;
  slug?: string;
  message?: string;
}

export class WikiClient {
  constructor(private readonly opts: WikiClientOptions) {}

  private get endpoint(): string {
    return `${this.opts.baseUrl.replace(/\/+$/, "")}/graphql`;
  }

  private async gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const work = requestUrl({
      url: this.endpoint,
      method: "POST",
      contentType: "application/json",
      headers: { Authorization: `Bearer ${this.opts.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      throw: false,
    });

    let raced;
    try {
      raced = await withTimeout(work, this.opts.timeoutMs, window);
    } catch (err) {
      throw new WikiError("network", err instanceof Error ? err.message : String(err));
    }
    if (raced.timedOut) throw new WikiError("timeout", `Keine Antwort binnen ${this.opts.timeoutMs} ms`);

    const res = raced.value;
    if (res.status === 401 || res.status === 403) throw new WikiError("auth", `HTTP ${res.status}`);
    if (res.status >= 400) throw new WikiError("network", `HTTP ${res.status}`);

    // res.json ist im echten requestUrl ein lazy parsender Getter — bei dieser
    // Instanz (hinter Caddy) ist eine HTML-Fehlerseite bei 200 (Proxy schluckt
    // einen 502 vom neustartenden Container) der Normalfall einer Stoerung, nicht
    // die Ausnahme. Der Zugriff darf deshalb nicht ungeschuetzt bleiben: ein
    // roher SyntaxError wuerde die Zusage "Fehler sind normalisiert" brechen.
    // kind="network", nicht "graphql": die Antwort ist gar keine GraphQL-Antwort
    // (kein gueltiges JSON), sondern ein Transportweg-Problem vor der GraphQL-Ebene.
    let payload: { data?: T; errors?: { message: string }[] };
    try {
      payload = res.json as { data?: T; errors?: { message: string }[] };
    } catch (err) {
      throw new WikiError("network", err instanceof Error ? err.message : String(err));
    }
    if (payload.errors && payload.errors.length > 0) {
      const message = payload.errors.map((e) => e.message).join("; ");
      // Wiki.js meldet fehlende Berechtigung NICHT ueber den HTTP-Status, sondern mit
      // HTTP 200 und einem GraphQL-Fehler (gemessen 2026-08-12: "Forbidden" beim
      // Schreiben, "You are not authorized to view this page" beim Lesen). Ohne diese
      // Einordnung stuende in der Oberflaeche "Forbidden" — ein Wort, das dem Nutzer
      // nicht sagt, dass sein Schluessel das Problem ist.
      throw new WikiError(AUTH_MESSAGE.test(message) ? "auth" : "graphql", message);
    }
    if (payload.data === undefined) throw new WikiError("graphql", "Antwort ohne data");
    return payload.data;
  }

  /** Wiki.js meldet fachliche Fehler mit HTTP 200 im responseResult — unbehandelt
   *  sieht ein fehlgeschlagener Push wie ein gelungener aus. */
  private assertSucceeded(result: ResponseResult | undefined, what: string): void {
    if (result?.succeeded === true) return;
    throw new WikiError("graphql", `${what} fehlgeschlagen: ${result?.message ?? "unbekannter Grund"}`);
  }

  async listPages(): Promise<RemotePage[]> {
    const data = await this.gql<{ pages: { list: RemotePage[] } }>(LIST_PAGES);
    return data.pages.list;
  }

  /** `pages.single` ist `null`, wenn die Seite (z.B. im Wiki-Admin) geloescht wurde —
   *  ein ganz normaler GraphQL-Erfolg, kein Transportfehler. Ungeschuetzt dereferenziert
   *  bricht das die Zusage "Fehler sind normalisiert" mit einem rohen TypeError; deshalb
   *  hier auf `WikiError("graphql", …)` abgebildet statt eine fuenfte `kind` zu erfinden. */
  async fetchPage(id: number): Promise<FetchedPage> {
    type RawPage = Omit<FetchedPage, "tags"> & { tags: { tag: string }[] | null };
    const data = await this.gql<{ pages: { single: RawPage | null } }>(SINGLE_PAGE, { id });
    const page = data.pages.single;
    if (page === null) throw new WikiError("graphql", `Seite ${id} nicht gefunden`);
    // Die API liefert Tags als Objektliste; nach aussen ist die flache Form die
    // brauchbare — und `null` wird zur leeren Liste, weil der update-Resolver
    // ueber ein fehlendes `tags` stolpert (s. UNPUBLISH_PAGE).
    return { ...page, tags: (page.tags ?? []).map((t) => t.tag) };
  }

  async fetchUpdatedAt(id: number): Promise<string> {
    const data = await this.gql<{ pages: { single: { updatedAt: string } | null } }>(PAGE_UPDATED_AT, { id });
    if (data.pages.single === null) throw new WikiError("graphql", `Seite ${id} nicht gefunden`);
    return data.pages.single.updatedAt;
  }

  async createPage(input: PageInput): Promise<{ id: number; updatedAt: string }> {
    const data = await this.gql<{
      pages: { create: { responseResult: ResponseResult; page: { id: number; updatedAt: string } | null } };
    }>(CREATE_PAGE, { ...input, locale: this.opts.locale });
    this.assertSucceeded(data.pages.create.responseResult, "Anlegen");
    const page = data.pages.create.page;
    if (page === null) throw new WikiError("graphql", "Anlegen meldete Erfolg ohne Seite");
    return { id: page.id, updatedAt: page.updatedAt };
  }

  async updatePage(id: number, input: PageInput): Promise<{ updatedAt: string }> {
    const data = await this.gql<{
      pages: { update: { responseResult: ResponseResult; page: { updatedAt: string } | null } };
    }>(UPDATE_PAGE, { id, ...input });
    this.assertSucceeded(data.pages.update.responseResult, "Aktualisieren");
    const page = data.pages.update.page;
    if (page === null) throw new WikiError("graphql", "Aktualisieren meldete Erfolg ohne Seite");
    return { updatedAt: page.updatedAt };
  }

  /** Zweistufig, und das ist keine Umstaendlichkeit: der update-Resolver verlangt
   *  `content` und `tags` (s. UNPUBLISH_PAGE). Sie kommen aus einem FRISCHEN
   *  fetchPage, nicht aus dem Snapshot — sonst schriebe das Depublizieren eine
   *  zwischenzeitliche Aenderung im Wiki stillschweigend zurueck. */
  async unpublishPage(id: number): Promise<void> {
    const page = await this.fetchPage(id);
    const data = await this.gql<{ pages: { update: { responseResult: ResponseResult } } }>(
      UNPUBLISH_PAGE,
      { id, content: page.content, tags: page.tags },
    );
    this.assertSucceeded(data.pages.update.responseResult, "Depublizieren");
  }

  async deletePage(id: number): Promise<void> {
    const data = await this.gql<{ pages: { delete: { responseResult: ResponseResult } } }>(DELETE_PAGE, { id });
    this.assertSucceeded(data.pages.delete.responseResult, "Loeschen");
  }
}
