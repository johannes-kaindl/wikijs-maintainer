// [[Wikilink]]-Umschreibung. Der Wiki-Leser hat den Vault nicht — ein Link auf eine
// nicht veroeffentlichte Notiz muss deshalb verschwinden statt ins Leere zu zeigen;
// er wird auf seinen Anzeigetext reduziert und im Sync-Report gezaehlt (Spec § 3).

/** Ziel eines Wikilinks → Wiki-Pfad ohne fuehrenden Slash, oder `null` wenn die
 *  Notiz nicht gesynct wird. */
export type LinkResolver = (target: string) => string | null;

export interface LinkRewrite {
  text: string;
  unresolved: string[];
  skippedEmbeds: string[];
}

const FENCE_RE = /^(?:```|~~~)/;

/** `#Ueberschrift` → `#ueberschrift`: Wiki.js baut Anker aus der kleingeschriebenen
 *  Ueberschrift mit Bindestrichen. */
function anchor(heading: string): string {
  return heading.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function rewriteLine(line: string, resolve: LinkResolver, out: LinkRewrite): string {
  // Embeds zuerst: `![[…]]` ist kein Link, und ein spaeterer Wikilink-Pass wuerde
  // die inneren Klammern faelschlich als solchen lesen.
  let result = line.replace(/!\[\[([^\]]+)\]\]/g, (_m, inner: string) => {
    const target = inner.split("|")[0].trim();
    if (!out.skippedEmbeds.includes(target)) out.skippedEmbeds.push(target);
    return "";
  });

  result = result.replace(/\[\[([^\]]+)\]\]/g, (_m, inner: string) => {
    const [rawTarget = "", rawLabel] = inner.split("|");
    const [target = "", heading] = rawTarget.split("#");
    const cleanTarget = target.trim();
    const label = (rawLabel ?? heading ?? cleanTarget).trim();
    const wikiPath = cleanTarget === "" ? null : resolve(cleanTarget);
    if (wikiPath === null) {
      if (!out.unresolved.includes(cleanTarget)) out.unresolved.push(cleanTarget);
      return label;
    }
    const fragment = heading === undefined || heading.trim() === "" ? "" : `#${anchor(heading)}`;
    return `[${label}](/${wikiPath}${fragment})`;
  });

  return result;
}

/** Zeilenweise, weil Codebloecke ausgespart bleiben muessen: ein `[[…]]` in einem
 *  Beispiel-Block ist Inhalt, kein Link. */
export function rewriteLinks(body: string, resolve: LinkResolver): LinkRewrite {
  const out: LinkRewrite = { text: "", unresolved: [], skippedEmbeds: [] };
  let inFence = false;
  const lines = body.split("\n").map((line) => {
    if (FENCE_RE.test(line.trimStart())) {
      inFence = !inFence;
      return line;
    }
    return inFence ? line : rewriteLine(line, resolve, out);
  });
  out.text = lines.join("\n");
  return out;
}
