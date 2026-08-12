import { describe, expect, it } from "vitest";
import { collectLocalPages } from "../src/obsidian/vault-source";

function fakeVault(files: Record<string, string>) {
  const list = Object.keys(files).map((path) => ({ path, basename: path.split("/").pop()!.replace(/\.md$/, ""), extension: "md" }));
  return {
    getMarkdownFiles: () => list,
    cachedRead: (file: { path: string }) => Promise.resolve(files[file.path] ?? ""),
  };
}

describe("collectLocalPages", () => {
  it("nimmt nur Dateien unterhalb der Sync-Wurzel", async () => {
    const vault = fakeVault({ "_published/A.md": "x", "Entwurf/B.md": "y" });
    const out = await collectLocalPages(vault as never, "_published");
    expect(out.pages.map((p) => p.wikiPath)).toEqual(["a"]);
  });

  it("loest einen Wikilink auf eine andere gesyncte Notiz auf, egal in welcher Reihenfolge gelesen wird", async () => {
    const vault = fakeVault({ "_published/A.md": "siehe [[B]]", "_published/B.md": "ziel" });
    const out = await collectLocalPages(vault as never, "_published");
    const a = out.pages.find((p) => p.wikiPath === "a");
    expect(a?.transformed).toBe("siehe [B](/b)");
  });

  it("entschaerft einen Wikilink auf eine nicht gesyncte Notiz und meldet ihn", async () => {
    const vault = fakeVault({ "_published/A.md": "siehe [[Geheim]]", "Entwurf/Geheim.md": "z" });
    const out = await collectLocalPages(vault as never, "_published");
    expect(out.pages[0]?.transformed).toBe("siehe Geheim");
    expect(out.meta.get("a")?.unresolved).toEqual(["Geheim"]);
  });

  it("meldet Slug-Kollisionen, statt eine der Dateien stillschweigend zu verlieren", async () => {
    const vault = fakeVault({ "_published/DNS Setup.md": "x", "_published/dns-setup.md": "y" });
    const out = await collectLocalPages(vault as never, "_published");
    expect(out.collisions).toHaveLength(1);
  });

  it("nimmt den Dateinamen als Titel, wenn kein Frontmatter-title da ist", async () => {
    const vault = fakeVault({ "_published/DNS Setup.md": "x" });
    const out = await collectLocalPages(vault as never, "_published");
    expect(out.meta.get("dns-setup")?.title).toBe("DNS Setup");
  });

  it("loest einen mehrdeutigen Basisnamen nicht auf, sondern meldet ihn als unresolved", async () => {
    const vault = fakeVault({
      "_published/A.md": "siehe [[Uebersicht]]",
      "_published/Netzwerk/Uebersicht.md": "netz",
      "_published/Server/Uebersicht.md": "server",
    });
    const out = await collectLocalPages(vault as never, "_published");
    const a = out.pages.find((p) => p.wikiPath === "a");
    expect(a?.transformed).toBe("siehe Uebersicht");
    expect(out.meta.get("a")?.unresolved).toEqual(["Uebersicht"]);
  });

  it("meldet einen mehrdeutigen Basisnamen mit beiden beteiligten Vault-Pfaden", async () => {
    const vault = fakeVault({
      "_published/A.md": "siehe [[Uebersicht]]",
      "_published/Netzwerk/Uebersicht.md": "netz",
      "_published/Server/Uebersicht.md": "server",
    });
    const out = await collectLocalPages(vault as never, "_published");
    expect(out.ambiguousNames).toEqual([
      {
        name: "Uebersicht",
        vaultPaths: ["_published/Netzwerk/Uebersicht.md", "_published/Server/Uebersicht.md"],
      },
    ]);
  });

  it("loest trotz mehrdeutigem Basisnamen die volle Pfadform auf", async () => {
    const vault = fakeVault({
      "_published/A.md": "siehe [[_published/Netzwerk/Uebersicht]]",
      "_published/Netzwerk/Uebersicht.md": "netz",
      "_published/Server/Uebersicht.md": "server",
    });
    const out = await collectLocalPages(vault as never, "_published");
    const a = out.pages.find((p) => p.wikiPath === "a");
    expect(a?.transformed).toBe("siehe [_published/Netzwerk/Uebersicht](/netzwerk/uebersicht)");
  });

  it("meldet keine Mehrdeutigkeit bei eindeutigem Basisnamen", async () => {
    const vault = fakeVault({ "_published/A.md": "siehe [[B]]", "_published/B.md": "ziel" });
    const out = await collectLocalPages(vault as never, "_published");
    expect(out.ambiguousNames).toEqual([]);
    const a = out.pages.find((p) => p.wikiPath === "a");
    expect(a?.transformed).toBe("siehe [B](/b)");
  });

  it("loest bei mehrdeutigem Basisnamen die kuerzeste disambiguierende Pfadform auf (Obsidian shortest-path-Default)", async () => {
    const vault = fakeVault({
      "_published/A.md": "siehe [[Netzwerk/Uebersicht]] und [[Archiv/Uebersicht]]",
      "_published/Netzwerk/Uebersicht.md": "netz",
      "_published/Archiv/Uebersicht.md": "archiv",
    });
    const out = await collectLocalPages(vault as never, "_published");
    const a = out.pages.find((p) => p.wikiPath === "a");
    expect(a?.transformed).toBe(
      "siehe [Netzwerk/Uebersicht](/netzwerk/uebersicht) und [Archiv/Uebersicht](/archiv/uebersicht)",
    );
  });

  it("laesst den mehrdeutigen Basisnamen selbst weiterhin unresolved, auch wenn die Suffix-Formen aufloesen", async () => {
    const vault = fakeVault({
      "_published/A.md": "siehe [[Uebersicht]]",
      "_published/Netzwerk/Uebersicht.md": "netz",
      "_published/Archiv/Uebersicht.md": "archiv",
    });
    const out = await collectLocalPages(vault as never, "_published");
    const a = out.pages.find((p) => p.wikiPath === "a");
    expect(a?.transformed).toBe("siehe Uebersicht");
    expect(out.meta.get("a")?.unresolved).toEqual(["Uebersicht"]);
  });

  it("registriert auch mittlere Suffix-Formen fuer tief liegende, konfliktfreie Dateien", async () => {
    const vault = fakeVault({
      "_published/A.md": "siehe [[Team/Netzwerk/Setup]] und [[Setup]]",
      "_published/Team/Netzwerk/Setup.md": "ziel",
    });
    const out = await collectLocalPages(vault as never, "_published");
    const a = out.pages.find((p) => p.wikiPath === "a");
    expect(a?.transformed).toBe(
      "siehe [Team/Netzwerk/Setup](/team/netzwerk/setup) und [Setup](/team/netzwerk/setup)",
    );
  });

  it("loest sowohl die volle als auch die kurze disambiguierende Pfadform auf (Einstellung 'Absolute path in vault')", async () => {
    const vault = fakeVault({
      "_published/A.md": "voll [[_published/Netzwerk/Uebersicht]], kurz [[Netzwerk/Uebersicht]]",
      "_published/Netzwerk/Uebersicht.md": "netz",
      "_published/Archiv/Uebersicht.md": "archiv",
    });
    const out = await collectLocalPages(vault as never, "_published");
    const a = out.pages.find((p) => p.wikiPath === "a");
    expect(a?.transformed).toBe(
      "voll [_published/Netzwerk/Uebersicht](/netzwerk/uebersicht), kurz [Netzwerk/Uebersicht](/netzwerk/uebersicht)",
    );
  });
});
