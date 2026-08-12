import { describe, expect, it } from "vitest";
import { extractPageMeta } from "../src/core/page-meta";

describe("extractPageMeta", () => {
  it("nimmt den Frontmatter-Titel und entfernt den Frontmatter-Block aus dem Body", () => {
    const raw = ["---", "title: DNS Setup", "summary: Wie der Resolver haengt", "---", "", "# Text", ""].join("\n");
    const meta = extractPageMeta(raw, "Datei-Name");
    expect(meta.title).toBe("DNS Setup");
    expect(meta.description).toBe("Wie der Resolver haengt");
    // parseFrontmatter (Kit) schneidet den Body nur nach dem Zeilenumbruch direkt
    // hinter dem schliessenden "---" ab — die im Vault uebliche Leerzeile danach
    // bleibt im Kit-Ergebnis stehen. extractPageMeta trimmt sie bewusst hier
    // (siehe Kommentar in page-meta.ts), damit gepushte Wiki-Seiten nicht mit
    // einer Leerzeile beginnen.
    expect(meta.body).toBe("# Text\n");
  });

  it("trimmt fuehrende Leerzeilen zwischen Frontmatter und Text, laesst den Rest unangetastet", () => {
    const raw = ["---", "title: DNS Setup", "---", "", "", "# Text", "", "mehr Text", ""].join("\n");
    const meta = extractPageMeta(raw, "X");
    expect(meta.body).toBe("# Text\n\nmehr Text\n");
  });

  it("faellt ohne Frontmatter-title auf den uebergebenen Dateinamen zurueck", () => {
    const meta = extractPageMeta("# Nur Text\n", "DNS Setup");
    expect(meta.title).toBe("DNS Setup");
    expect(meta.description).toBe("");
    expect(meta.body).toBe("# Nur Text\n");
  });

  it("liest tags als Liste", () => {
    const raw = ["---", "tags:", "  - netzwerk", "  - dns", "---", "Text", ""].join("\n");
    expect(extractPageMeta(raw, "X").tags).toEqual(["netzwerk", "dns"]);
  });

  it("liest tags auch als kommagetrennten Skalar", () => {
    const raw = ["---", "tags: netzwerk, dns", "---", "Text", ""].join("\n");
    expect(extractPageMeta(raw, "X").tags).toEqual(["netzwerk", "dns"]);
  });

  it("liefert leere tags, wenn das Feld fehlt", () => {
    expect(extractPageMeta("Text\n", "X").tags).toEqual([]);
  });
});
