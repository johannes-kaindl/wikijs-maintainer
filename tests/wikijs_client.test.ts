import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestUrl } from "obsidian";
import type { MockFn } from "./vendor/kit/obsidian-mock";
import { WikiClient, WikiError } from "../src/wikijs/client";

// Testumgebung ist "node" (vitest.config.ts) — es gibt kein globales `window`.
// client.ts nutzt window als Timer-Port fuer withTimeout; ohne diesen Stub wirft
// bereits das Lesen des Bezeichners `window` eine ReferenceError, bevor der
// eigentliche Timeout ueberhaupt zum Tragen kaeme.
vi.stubGlobal("window", { setTimeout, clearTimeout });

const OPTS = { baseUrl: "https://wiki.example.org/", token: "K", locale: "de", timeoutMs: 5000 };

function reply(body: unknown, status = 200): void {
  (requestUrl as unknown as MockFn).mockImplementation(() =>
    Promise.resolve({ status, json: body, text: JSON.stringify(body) }),
  );
}

describe("WikiClient", () => {
  beforeEach(() => {
    (requestUrl as unknown as MockFn).mockClear();
  });

  it("spricht /graphql und schickt den Bearer-Token", async () => {
    reply({ data: { pages: { list: [] } } });
    await new WikiClient(OPTS).listPages();
    const call = (requestUrl as unknown as MockFn).mock.calls[0]?.[0] as {
      url: string;
      method: string;
      headers: Record<string, string>;
    };
    expect(call.url).toBe("https://wiki.example.org/graphql");
    expect(call.method).toBe("POST");
    expect(call.headers.Authorization).toBe("Bearer K");
  });

  it("liefert die Seitenliste als RemotePage[]", async () => {
    reply({ data: { pages: { list: [{ id: 3, path: "a/b", title: "T", updatedAt: "2026-01-01T00:00:00Z" }] } } });
    const pages = await new WikiClient(OPTS).listPages();
    expect(pages).toEqual([{ id: 3, path: "a/b", title: "T", updatedAt: "2026-01-01T00:00:00Z" }]);
  });

  it("wirft WikiError kind=auth bei 401", async () => {
    reply({}, 401);
    await expect(new WikiClient(OPTS).listPages()).rejects.toMatchObject({ kind: "auth" });
  });

  it("wirft WikiError kind=graphql und traegt die Server-Meldung", async () => {
    reply({ errors: [{ message: "Unknown field" }] });
    await expect(new WikiClient(OPTS).listPages()).rejects.toMatchObject({
      kind: "graphql",
      message: expect.stringContaining("Unknown field"),
    });
  });

  it("meldet ein fehlgeschlagenes responseResult als Fehler statt es zu verschlucken", async () => {
    reply({ data: { pages: { create: { responseResult: { succeeded: false, message: "Path exists" }, page: null } } } });
    await expect(
      new WikiClient(OPTS).createPage({ path: "a", title: "T", description: "", tags: [], content: "x" }),
    ).rejects.toMatchObject({ kind: "graphql", message: expect.stringContaining("Path exists") });
  });

  it("gibt bei Erfolg id und updatedAt der neuen Seite zurueck", async () => {
    reply({
      data: { pages: { create: { responseResult: { succeeded: true }, page: { id: 9, updatedAt: "2026-02-02T00:00:00Z" } } } },
    });
    const created = await new WikiClient(OPTS).createPage({ path: "a", title: "T", description: "", tags: [], content: "x" });
    expect(created).toEqual({ id: 9, updatedAt: "2026-02-02T00:00:00Z" });
  });

  it("liest fuer den Drift-Guard nur updatedAt", async () => {
    reply({ data: { pages: { single: { updatedAt: "2026-03-03T00:00:00Z" } } } });
    expect(await new WikiClient(OPTS).fetchUpdatedAt(9)).toBe("2026-03-03T00:00:00Z");
  });

  it("wirft kind=timeout, wenn die Antwort laenger braucht als erlaubt", async () => {
    (requestUrl as unknown as MockFn).mockImplementation(() => new Promise(() => undefined));
    const client = new WikiClient({ ...OPTS, timeoutMs: 10 });
    await expect(client.listPages()).rejects.toMatchObject({ kind: "timeout" });
  });

  it("wirft kind=network, wenn requestUrl selbst fehlschlaegt", async () => {
    (requestUrl as unknown as MockFn).mockImplementation(() => Promise.reject(new Error("ECONNREFUSED")));
    await expect(new WikiClient(OPTS).listPages()).rejects.toMatchObject({ kind: "network" });
  });

  it("normalisiert einen nicht-JSON-Antwortkoerper (z.B. Proxy-Fehlerseite bei 200) zu WikiError", async () => {
    // Obsidians echtes requestUrl legt .json als lazy parsenden Getter aus. Eine
    // 502-HTML-Seite hinter Caddy bei neustartendem Container ist der Normalfall
    // dieser Instanz, nicht die Ausnahme — der Getter wirft dann SyntaxError statt
    // ein Objekt zu liefern. Der vendorte Mock bildet .json sonst als vorgefertigte
    // Eigenschaft nach, deshalb hier bewusst ein eigener werfender Getter.
    (requestUrl as unknown as MockFn).mockImplementation(() =>
      Promise.resolve({
        status: 200,
        get json() {
          throw new SyntaxError("Unexpected token < in JSON at position 0");
        },
        text: "<html>502 Bad Gateway</html>",
      }),
    );
    await expect(new WikiClient(OPTS).listPages()).rejects.toMatchObject({ kind: "network" });
  });

  it("WikiError traegt kind als eigenes Feld", () => {
    const err = new WikiError("auth", "nope");
    expect(err).toBeInstanceOf(Error);
    expect(err.kind).toBe("auth");
  });

  // Important 3(b): Wiki.js liefert `pages.single: null` fuer eine geloeschte Seite.
  // Ungeschuetzt dereferenziert der Client das (`data.pages.single.updatedAt`) und wirft
  // einen rohen TypeError statt eines normalisierten WikiError — bricht "Fehler sind
  // normalisiert". Die Haertung gilt fuer fetchPage UND fetchUpdatedAt, nicht nur fuer
  // den remote-deleted-Fall in SyncService.
  it("fetchUpdatedAt auf eine geloeschte Seite (single: null) wirft WikiError statt TypeError", async () => {
    reply({ data: { pages: { single: null } } });
    await expect(new WikiClient(OPTS).fetchUpdatedAt(9)).rejects.toMatchObject({ kind: "graphql" });
  });

  it("fetchPage auf eine geloeschte Seite (single: null) wirft WikiError statt TypeError", async () => {
    reply({ data: { pages: { single: null } } });
    await expect(new WikiClient(OPTS).fetchPage(9)).rejects.toMatchObject({ kind: "graphql" });
  });
});

describe("WikiClient.unpublishPage — Wiki.js verlangt content und tags", () => {
  // Gemessen am 2026-08-12 gegen die echte Instanz: `pages.update` deklariert
  // `content` und `tags` im Schema als optional, der Resolver besteht aber auf
  // beiden. Fehlt `content`, antwortet er mit `PageEmptyContent` (6004); fehlt
  // `tags`, wirft er intern `Cannot read properties of undefined (reading 'map')`
  // — und zwar NACHDEM er die Seite bereits geaendert hat. Die Introspektion aus
  // docs/LAB.md konnte das nicht zeigen; nur der Aufruf gegen die Instanz.
  beforeEach(() => {
    (requestUrl as unknown as MockFn).mockClear();
  });

  it("holt die Seite und schickt ihren aktuellen Inhalt samt tags zurueck", async () => {
    const calls: Record<string, unknown>[] = [];
    (requestUrl as unknown as MockFn).mockImplementation((opts: { body: string }) => {
      const body = JSON.parse(opts.body) as { query: string; variables: Record<string, unknown> };
      calls.push(body.variables);
      if (body.query.includes("single")) {
        return Promise.resolve({
          status: 200,
          json: { data: { pages: { single: { id: 5, path: "a", title: "T", description: "",
            content: "der aktuelle Wiki-Text", updatedAt: "T1", tags: [{ tag: "eins" }, { tag: "zwei" }] } } } },
        });
      }
      return Promise.resolve({
        status: 200,
        json: { data: { pages: { update: { responseResult: { succeeded: true }, page: { updatedAt: "T2" } } } } },
      });
    });

    await new WikiClient(OPTS).unpublishPage(5);

    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({ id: 5, content: "der aktuelle Wiki-Text", tags: ["eins", "zwei"] });
  });

  it("schickt den FRISCH geholten Inhalt, nicht einen mitgegebenen — sonst dreht das Depublizieren eine fremde Aenderung zurueck", async () => {
    let updateContent: unknown = null;
    (requestUrl as unknown as MockFn).mockImplementation((opts: { body: string }) => {
      const body = JSON.parse(opts.body) as { query: string; variables: Record<string, unknown> };
      if (body.query.includes("single")) {
        return Promise.resolve({
          status: 200,
          json: { data: { pages: { single: { id: 5, path: "a", title: "T", description: "",
            content: "INZWISCHEN IM WIKI GEAENDERT", updatedAt: "T9", tags: [] } } } },
        });
      }
      updateContent = body.variables.content;
      return Promise.resolve({
        status: 200,
        json: { data: { pages: { update: { responseResult: { succeeded: true }, page: { updatedAt: "T9" } } } } },
      });
    });

    await new WikiClient(OPTS).unpublishPage(5);

    expect(updateContent).toBe("INZWISCHEN IM WIKI GEAENDERT");
  });

  it("meldet einen leeren tags-Wert als leere Liste statt als undefined", async () => {
    let updateTags: unknown = "nicht gesetzt";
    (requestUrl as unknown as MockFn).mockImplementation((opts: { body: string }) => {
      const body = JSON.parse(opts.body) as { query: string; variables: Record<string, unknown> };
      if (body.query.includes("single")) {
        return Promise.resolve({
          status: 200,
          json: { data: { pages: { single: { id: 5, path: "a", title: "T", description: "",
            content: "x", updatedAt: "T1", tags: null } } } },
        });
      }
      updateTags = body.variables.tags;
      return Promise.resolve({
        status: 200,
        json: { data: { pages: { update: { responseResult: { succeeded: true }, page: { updatedAt: "T2" } } } } },
      });
    });

    await new WikiClient(OPTS).unpublishPage(5);

    expect(updateTags).toEqual([]);
  });
});

describe("WikiClient — Auth-Fehler kommen bei Wiki.js über den GraphQL-Kanal", () => {
  // Gemessen 2026-08-12: Ein ungueltiger Schluessel fuehrt NICHT zu HTTP 401/403.
  // Wiki.js antwortet mit HTTP 200 und einem GraphQL-Fehler "Forbidden" (beim
  // Schreiben) bzw. "You are not authorized to view this page" (beim Lesen). Ohne
  // Sonderbehandlung landet das als kind:"graphql" — und die Oberflaeche sagt dem
  // Nutzer "Forbidden", statt ihn auf den Schluessel zu stossen.
  beforeEach(() => {
    (requestUrl as unknown as MockFn).mockClear();
  });

  const replyWithGraphqlError = (message: string): void => {
    (requestUrl as unknown as MockFn).mockImplementation(() =>
      Promise.resolve({ status: 200, json: { errors: [{ message }] } }),
    );
  };

  it("erkennt \"Forbidden\" als Authentifizierungsproblem", async () => {
    replyWithGraphqlError("Forbidden");
    await expect(new WikiClient(OPTS).listPages()).rejects.toMatchObject({ kind: "auth" });
  });

  it("erkennt die Lese-Ablehnung als Authentifizierungsproblem", async () => {
    replyWithGraphqlError("You are not authorized to view this page.");
    await expect(new WikiClient(OPTS).listPages()).rejects.toMatchObject({ kind: "auth" });
  });

  it("laesst einen fachlichen GraphQL-Fehler weiterhin graphql sein", async () => {
    replyWithGraphqlError('Unknown field "foo" on type "PageQuery".');
    await expect(new WikiClient(OPTS).listPages()).rejects.toMatchObject({ kind: "graphql" });
  });
});
