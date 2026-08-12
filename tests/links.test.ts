import { describe, expect, it } from "vitest";
import { rewriteLinks } from "../src/core/links";

const resolve = (target: string): string | null =>
  target === "DNS Setup" ? "netzwerk/dns-setup" : null;

describe("rewriteLinks", () => {
  it("macht aus einem Wikilink auf eine gesyncte Notiz einen absoluten Wiki-Link", () => {
    expect(rewriteLinks("siehe [[DNS Setup]] dort", resolve).text).toBe("siehe [DNS Setup](/netzwerk/dns-setup) dort");
  });

  it("behaelt den Anzeigetext aus der Pipe-Form", () => {
    expect(rewriteLinks("siehe [[DNS Setup|die Aufloesung]]", resolve).text).toBe("siehe [die Aufloesung](/netzwerk/dns-setup)");
  });

  it("haengt einen Ueberschriften-Anker als Fragment an", () => {
    expect(rewriteLinks("[[DNS Setup#Resolver]]", resolve).text).toBe("[Resolver](/netzwerk/dns-setup#resolver)");
  });

  it("laesst von einer nicht gesyncten Notiz nur den Anzeigetext stehen und zaehlt sie", () => {
    const out = rewriteLinks("siehe [[Geheimes Konzept]] hier", resolve);
    expect(out.text).toBe("siehe Geheimes Konzept hier");
    expect(out.unresolved).toEqual(["Geheimes Konzept"]);
  });

  it("nutzt bei nicht gesyncten Zielen den Anzeigetext, nicht den Notiznamen", () => {
    expect(rewriteLinks("[[Geheimes Konzept|das Konzept]]", resolve).text).toBe("das Konzept");
  });

  it("ueberspringt Embeds und meldet sie, statt sie als Link zu behandeln", () => {
    const out = rewriteLinks("Text\n![[Diagramm.png]]\nmehr", resolve);
    expect(out.text).toBe("Text\n\nmehr");
    expect(out.skippedEmbeds).toEqual(["Diagramm.png"]);
  });

  it("laesst Standard-Markdown-Links unangetastet", () => {
    expect(rewriteLinks("[extern](https://example.org)", resolve).text).toBe("[extern](https://example.org)");
  });

  it("fasst Mehrfach-Vorkommen desselben unaufloesbaren Ziels zu einem Eintrag zusammen", () => {
    const out = rewriteLinks("[[X]] und [[X]]", resolve);
    expect(out.unresolved).toEqual(["X"]);
  });

  it("laesst Wikilinks in Codebloecken in Ruhe", () => {
    const src = ["```", "[[DNS Setup]]", "```", "", "[[DNS Setup]]"].join("\n");
    const out = rewriteLinks(src, resolve);
    expect(out.text).toBe(["```", "[[DNS Setup]]", "```", "", "[DNS Setup](/netzwerk/dns-setup)"].join("\n"));
  });
});
