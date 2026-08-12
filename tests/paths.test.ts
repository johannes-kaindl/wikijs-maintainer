import { describe, expect, it } from "vitest";
import {
  findSlugCollisions,
  slugifySegment,
  snapshotFileName,
  vaultPathToWikiPath,
  wikiPathToVaultPath,
} from "../src/core/paths";

describe("slugifySegment", () => {
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
});

describe("wikiPathToVaultPath", () => {
  it("haengt den Wiki-Pfad an die Sync-Wurzel und nutzt den Titel als Dateinamen", () => {
    expect(wikiPathToVaultPath("netzwerk/dns-setup", "_published", "DNS Setup")).toBe("_published/netzwerk/DNS Setup.md");
  });

  it("faellt auf das letzte Pfadsegment zurueck, wenn der Titel leer ist", () => {
    expect(wikiPathToVaultPath("netzwerk/dns-setup", "_published", "")).toBe("_published/netzwerk/dns-setup.md");
  });

  it("entschaerft Zeichen, die in einem Dateinamen nicht vorkommen duerfen", () => {
    expect(wikiPathToVaultPath("faq", "_published", "Was/Wie: Warum?")).toBe("_published/Was-Wie- Warum.md");
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
