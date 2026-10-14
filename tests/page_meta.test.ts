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

  // Sichtbarkeit ist eine Eigenschaft der Notiz, keine Konstante des Werkzeugs: eine
  // bewusst depublizierte Seite darf durch einen spaeteren Push nicht wieder online gehen.
  it("veroeffentlicht standardmaessig (kein wiki_published)", () => {
    expect(extractPageMeta("Text\n", "X").published).toBe(true);
  });

  it("liest wiki_published: false als nicht veroeffentlicht", () => {
    const raw = ["---", "wiki_published: false", "---", "Text", ""].join("\n");
    expect(extractPageMeta(raw, "X").published).toBe(false);
  });

  it("liest wiki_published: true als veroeffentlicht", () => {
    const raw = ["---", "wiki_published: true", "---", "Text", ""].join("\n");
    expect(extractPageMeta(raw, "X").published).toBe(true);
  });

  it("erkennt Schreibvarianten (False, 'no', \"false\")", () => {
    for (const v of ["False", "FALSE", "no", "off", "0", '"false"']) {
      const raw = ["---", `wiki_published: ${v}`, "---", "Text", ""].join("\n");
      expect(extractPageMeta(raw, "X").published, v).toBe(false);
    }
    for (const v of ["True", "yes", "on", "1"]) {
      const raw = ["---", `wiki_published: ${v}`, "---", "Text", ""].join("\n");
      expect(extractPageMeta(raw, "X").published, v).toBe(true);
    }
  });

  it("behandelt einen nicht lesbaren Wert als NICHT veroeffentlicht (im Zweifel unsichtbar)", () => {
    const raw = ["---", "wiki_published: vielleicht", "---", "Text", ""].join("\n");
    expect(extractPageMeta(raw, "X").published).toBe(false);
  });

  it("ein leeres wiki_published zaehlt wie ein fehlendes (Standard: veroeffentlicht)", () => {
    const raw = ["---", "wiki_published:", "---", "Text", ""].join("\n");
    expect(extractPageMeta(raw, "X").published).toBe(true);
  });

  // Wiki.js nennt das Feld `description`; ein aus einem Wiki gezogener Vault traegt es so.
  it("liest die Beschreibung aus `description`", () => {
    const raw = ["---", "description: Aus dem Wiki", "---", "Text", ""].join("\n");
    expect(extractPageMeta(raw, "X").description).toBe("Aus dem Wiki");
  });

  it("nimmt `summary` als Rueckfall, wenn `description` fehlt", () => {
    const raw = ["---", "summary: Nur summary", "---", "Text", ""].join("\n");
    expect(extractPageMeta(raw, "X").description).toBe("Nur summary");
  });

  it("`description` gewinnt, wenn beide Felder gesetzt sind", () => {
    const raw = ["---", "summary: alt", "description: neu", "---", "Text", ""].join("\n");
    expect(extractPageMeta(raw, "X").description).toBe("neu");
  });

  it("faellt auf `summary` zurueck, wenn `description` leer ist", () => {
    const raw = ["---", "description:", "summary: Rueckfall", "---", "Text", ""].join("\n");
    expect(extractPageMeta(raw, "X").description).toBe("Rueckfall");
  });

  describe("Pflichtfelder", () => {
    const raw = ["---", "seitentyp: Anleitung", "pruefzyklus:", "tags: [a]", "leer: ''", "---", "Text", ""].join("\n");
    it("meldet nichts, wenn keine Pflichtfelder konfiguriert sind", () => {
      expect(extractPageMeta(raw, "X").missing).toEqual([]);
    });
    it("meldet fehlende UND leere Felder, in der konfigurierten Reihenfolge", () => {
      expect(extractPageMeta(raw, "X", ["seitentyp", "pruefzyklus", "autor", "leer"]).missing).toEqual(["pruefzyklus", "autor", "leer"]);
    });
    it("eine Liste als Wert zaehlt als gesetzt, eine leere Liste nicht", () => {
      const r = ["---", "tags: [a]", "keine: []", "---", "T", ""].join("\n");
      expect(extractPageMeta(r, "X", ["tags", "keine"]).missing).toEqual(["keine"]);
    });
    it("ohne Frontmatter fehlen alle konfigurierten Felder", () => {
      expect(extractPageMeta("Text\n", "X", ["seitentyp"]).missing).toEqual(["seitentyp"]);
    });
  });
});
