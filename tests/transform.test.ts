import { describe, expect, it } from "vitest";
import { transformForWiki } from "../src/core/transform";

const resolve = (target: string): string | null => (target === "A" ? "a" : null);

describe("transformForWiki", () => {
  it("macht aus einem Info-Callout ein Blockquote mit Wiki.js-Klasse", () => {
    const raw = ["> [!info] Hinweis", "> erste Zeile", "> zweite Zeile", ""].join("\n");
    expect(transformForWiki(raw, "T", resolve).content).toBe(
      ["> **Hinweis**", "> erste Zeile", "> zweite Zeile", "{.is-info}", ""].join("\n"),
    );
  });

  it("laesst die Titelzeile weg, wenn der Callout keinen Titel hat", () => {
    const raw = ["> [!warning]", "> Achtung", ""].join("\n");
    expect(transformForWiki(raw, "T", resolve).content).toBe(["> Achtung", "{.is-warning}", ""].join("\n"));
  });

  it("bildet danger und error auf is-danger ab, tip und success auf is-success", () => {
    expect(transformForWiki("> [!danger]\n> x\n", "T", resolve).content).toContain("{.is-danger}");
    expect(transformForWiki("> [!error]\n> x\n", "T", resolve).content).toContain("{.is-danger}");
    expect(transformForWiki("> [!tip]\n> x\n", "T", resolve).content).toContain("{.is-success}");
    expect(transformForWiki("> [!success]\n> x\n", "T", resolve).content).toContain("{.is-success}");
  });

  it("faellt fuer unbekannte Callout-Typen auf is-info zurueck statt den Block zu verlieren", () => {
    expect(transformForWiki("> [!quote]\n> x\n", "T", resolve).content).toContain("{.is-info}");
  });

  it("ignoriert das Klapp-Suffix des Callout-Kopfes", () => {
    expect(transformForWiki("> [!info]- Titel\n> x\n", "T", resolve).content).toContain("> **Titel**");
  });

  it("laesst ein gewoehnliches Blockquote unangetastet", () => {
    const raw = ["> nur ein Zitat", ""].join("\n");
    expect(transformForWiki(raw, "T", resolve).content).toBe(raw);
  });

  it("laesst Codebloecke, Tabellen und LaTeX unveraendert", () => {
    const raw = ["```ts", "const x = 1;", "```", "", "| a | b |", "| - | - |", "", "$$x^2$$", ""].join("\n");
    expect(transformForWiki(raw, "T", resolve).content).toBe(raw);
  });

  it("liefert Metadaten aus dem Frontmatter und pusht den Block selbst nicht mit", () => {
    const raw = ["---", "title: Echt", "tags: x", "---", "Body", ""].join("\n");
    const out = transformForWiki(raw, "Datei", resolve);
    expect(out.title).toBe("Echt");
    expect(out.tags).toEqual(["x"]);
    expect(out.content).toBe("Body\n");
  });

  it("trennt zwei aufeinanderfolgende Callouts ohne Leerzeile dazwischen", () => {
    const raw = ["> [!info] A", "> x", "> [!warning] B", "> y", ""].join("\n");
    expect(transformForWiki(raw, "T", resolve).content).toBe(
      ["> **A**", "> x", "{.is-info}", "> **B**", "> y", "{.is-warning}", ""].join("\n"),
    );
  });

  it("reicht die Link-Befunde durch", () => {
    const out = transformForWiki("[[A]] und [[B]]\n", "T", resolve);
    expect(out.content).toBe("[A](/a) und B\n");
    expect(out.unresolved).toEqual(["B"]);
  });
});
