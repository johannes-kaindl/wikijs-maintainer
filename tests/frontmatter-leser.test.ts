import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "../src/vendor/kit/frontmatter";

// Verhaltenswechsel mit obsidian-kit 0.90.0 (gemeinsamer Leser `locateFrontmatter`), hier festgehalten, weil der Sync-Dienst den Rumpf einer Notiz zur Seite macht.
describe("Frontmatter-Leser des Kits (0.90.0)", () => {
  it("ein leerer Block ist ein Block: der Rumpf beginnt hinter dem zweiten Zaun", () => {
    const r = parseFrontmatter("---\n---\nText\n");
    expect(r.body.replace(/^\n+/, "")).toBe("Text\n");
    expect(r.data).toEqual({});
  });
  it("der schließende Zaun ist genau `---`: mit Leerzeichen dahinter schließt er nicht, die Notiz hat dann keinen Block", () => {
    const raw = "---\ntitle: A\n---  \nText\n";
    expect(parseFrontmatter(raw).body).toBe(raw);
  });
  it("ein gewöhnlicher Block bleibt, wie er war", () => {
    const r = parseFrontmatter("---\ntitle: A\n---\nText\n");
    expect(r.data.title).toBe("A");
    expect(r.body.replace(/^\n+/, "")).toBe("Text\n");
  });
});
