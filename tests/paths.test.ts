import { describe, expect, it } from "vitest";
import {
  findSlugCollisions,
  snapshotFileName,
  vaultPathToWikiPath,
  wikiPathToVaultPath,
} from "../src/core/paths";

import { slugify } from "../src/vendor/kit/slug";

/** Die Slug-Regel dieses Plugins: Kit-`slugify` mit `punctuation: "drop"` (Pfadstabilitaet). */
const slugifySegment = (s: string): string => slugify(s, { punctuation: "drop" });

describe("Slug-Regel (Kit slugify, punctuation drop)", () => {
  it("schreibt klein und ersetzt Leerzeichen durch Bindestriche", () => {
    expect(slugifySegment("DNS Setup")).toBe("dns-setup");
  });

  it("transliteriert Umlaute und scharfes S statt sie zu entfernen", () => {
    expect(slugifySegment("Größe Änderung Übersicht")).toBe("groesse-aenderung-uebersicht");
  });

  it("wirft alles weg, was kein Buchstabe, keine Ziffer und kein Bindestrich ist", () => {
    expect(slugifySegment("Backup (täglich!) 04:35")).toBe("backup-taeglich-0435");
  });

  it("fasst Bindestrich-Ketten zusammen und trimmt sie an den Raendern", () => {
    expect(slugifySegment("--Netzwerk – Setup--")).toBe("netzwerk-setup");
  });
});

// Seit dem Wechsel auf das Kit (code-kit 0.27) behalten Zeichen mit Kompatibilitaets-Zerlegung ihren
// Grundbuchstaben, statt geloescht zu werden. Fuer einen Wiki-Pfad mit so einem Zeichen ist das eine
// sichtbare Aenderung (im CHANGELOG): der Test haelt die neue Regel fest.
describe("Zeichen mit Zerlegung (Kit-Regel)", () => {
  it("behaelt den Grundbuchstaben statt ihn zu loeschen", () => {
    expect(vaultPathToWikiPath("_published/Čeština.md", "_published")).toBe("cestina");
    expect(vaultPathToWikiPath("_published/m² Fläche.md", "_published")).toBe("m2-flaeche");
    expect(vaultPathToWikiPath("_published/ﬁnale.md", "_published")).toBe("finale");
    expect(vaultPathToWikiPath("_published/Zürich/Café Où.md", "_published")).toBe("zuerich/cafe-ou");
  });

  it("die bisher gepinnten Pfade aendern sich nicht", () => {
    expect(vaultPathToWikiPath("_published/Backup täglich 04:35.md", "_published")).toBe("backup-taeglich-0435");
    expect(vaultPathToWikiPath("_published/Node.js Grundlagen.md", "_published")).toBe("nodejs-grundlagen");
    expect(vaultPathToWikiPath("_published/E-Mail-Sicherheitsmaßnahmen.md", "_published")).toBe("e-mail-sicherheitsmassnahmen");
  });
});

describe("vaultPathToWikiPath", () => {
  it("mappt den Pfad unterhalb der Sync-Wurzel 1:1 und wirft die Endung weg", () => {
    expect(vaultPathToWikiPath("_published/Netzwerk/DNS-Setup.md", "_published")).toBe("netzwerk/dns-setup");
  });

  it("vertraegt einen Schraegstrich am Ende der Sync-Wurzel", () => {
    expect(vaultPathToWikiPath("_published/Netzwerk/DNS-Setup.md", "_published/")).toBe("netzwerk/dns-setup");
  });

  it("gibt null zurueck fuer Dateien ausserhalb der Sync-Wurzel", () => {
    expect(vaultPathToWikiPath("10_Werkstatt/Entwurf.md", "_published")).toBeNull();
  });

  it("beachtet die Ordnergrenze — ein Praefix-Treffer reicht nicht", () => {
    expect(vaultPathToWikiPath("_published_alt/Notiz.md", "_published")).toBeNull();
  });

  it("slugifiziert jedes Segment einzeln, nicht den Gesamtpfad", () => {
    expect(vaultPathToWikiPath("_published/Netzwerk & DNS/Über uns.md", "_published")).toBe("netzwerk-dns/ueber-uns");
  });

  it("schneidet eine fremde Dateiendung ab, statt sie in den Slug zu ziehen", () => {
    expect(vaultPathToWikiPath("_published/Not-A-Page.canvas", "_published")).toBe("not-a-page");
  });

  it("laesst einen Punkt im Notiznamen unangetastet — nur die echte Endung faellt", () => {
    expect(vaultPathToWikiPath("_published/Node.js Grundlagen.md", "_published")).toBe("nodejs-grundlagen");
  });

  it("haelt eine endungslose Datei fuer endungslos", () => {
    expect(vaultPathToWikiPath("_published/LICENSE", "_published")).toBe("license");
  });
});

describe("wikiPathToVaultPath", () => {
  it("haengt den Wiki-Pfad an die Sync-Wurzel und nutzt den Titel als Dateinamen", () => {
    expect(wikiPathToVaultPath("netzwerk/dns-setup", "_published", "DNS Setup")).toBe("_published/netzwerk/DNS Setup.md");
  });

  it("faellt auf das letzte Pfadsegment zurueck, wenn der Titel leer ist", () => {
    expect(wikiPathToVaultPath("netzwerk/dns-setup", "_published", "")).toBe("_published/netzwerk/dns-setup.md");
  });

  it("entschaerft Zeichen, die in einem Dateinamen nicht vorkommen duerfen", () => {
    expect(wikiPathToVaultPath("a-b", "_published", "A: B")).toBe("_published/A- B.md");
  });

  // Der Pull benannte die Datei nach dem Titel, der Push leitet den Pfad aus dem Dateinamen
  // ab: wo slugify(Titel) nicht das letzte Pfadsegment ergibt, wanderte die Seite beim naechsten
  // Push auf einen anderen Pfad, und die alte erschien als `removed-locally`.
  it("nimmt das letzte Pfadsegment, wenn der Titel nicht zum Pfad slugifiziert", () => {
    expect(wikiPathToVaultPath("faq", "_published", "Was/Wie: Warum?")).toBe("_published/faq.md");
    expect(wikiPathToVaultPath("netzwerk/dns", "_published", "Alles ueber den Resolver")).toBe("_published/netzwerk/dns.md");
  });

  it("Round-Trip Pull -> Push: der Pfad bleibt, fuer jeden Titel", () => {
    const titles = ["DNS Setup", "Was/Wie: Warum?", "Ganz anderer Titel", "", "E-Mail Sicherheit", "  "];
    for (const title of titles) {
      const vaultPath = wikiPathToVaultPath("netzwerk/dns-setup", "_published", title);
      expect(vaultPathToWikiPath(vaultPath, "_published"), title).toBe("netzwerk/dns-setup");
    }
  });
});

describe("findSlugCollisions", () => {
  it("meldet zwei Dateien, die auf denselben Wiki-Pfad fallen", () => {
    const collisions = findSlugCollisions(
      ["_published/DNS Setup.md", "_published/dns-setup.md", "_published/Anderes.md"],
      "_published",
    );
    expect(collisions).toEqual([
      { wikiPath: "dns-setup", vaultPaths: ["_published/DNS Setup.md", "_published/dns-setup.md"] },
    ]);
  });

  it("meldet nichts, wenn alle Pfade eindeutig sind", () => {
    expect(findSlugCollisions(["_published/A.md", "_published/B.md"], "_published")).toEqual([]);
  });
});

describe("snapshotFileName", () => {
  it("ist deterministisch und endet auf .json", () => {
    expect(snapshotFileName("netzwerk/dns-setup")).toBe(snapshotFileName("netzwerk/dns-setup"));
    expect(snapshotFileName("netzwerk/dns-setup")).toMatch(/^[0-9a-f]{8}\.json$/);
  });

  it("unterscheidet verschiedene Pfade", () => {
    expect(snapshotFileName("a/b")).not.toBe(snapshotFileName("a/c"));
  });
});
