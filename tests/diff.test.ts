import { describe, expect, it } from "vitest";
import { applySelection, diffLines, groupHunks } from "../src/core/diff";

describe("diffLines", () => {
  it("markiert unveraenderte Zeilen als ctx", () => {
    expect(diffLines("a\nb", "a\nb")).toEqual([
      { kind: "ctx", text: "a" },
      { kind: "ctx", text: "b" },
    ]);
  });

  it("gibt bei einer Ersetzung erst die alte, dann die neue Zeile aus", () => {
    expect(diffLines("a\nx\nb", "a\ny\nb")).toEqual([
      { kind: "ctx", text: "a" },
      { kind: "del", text: "x" },
      { kind: "add", text: "y" },
      { kind: "ctx", text: "b" },
    ]);
  });

  it("behandelt leeren Text als null Zeilen, nicht als eine leere", () => {
    expect(diffLines("", "a")).toEqual([{ kind: "add", text: "a" }]);
  });
});

describe("groupHunks / applySelection", () => {
  it("gruppiert zusammenhaengende Aenderungen zu einem Hunk", () => {
    expect(groupHunks(diffLines("a\nx\ny\nb", "a\nb"))).toHaveLength(1);
  });

  it("uebernimmt bei selektiertem Hunk die neue Fassung", () => {
    const diff = diffLines("a\nx\nb", "a\ny\nb");
    expect(applySelection(diff, [true])).toBe("a\ny\nb");
  });

  it("behaelt bei abgewaehltem Hunk die alte Fassung", () => {
    const diff = diffLines("a\nx\nb", "a\ny\nb");
    expect(applySelection(diff, [false])).toBe("a\nx\nb");
  });
});
