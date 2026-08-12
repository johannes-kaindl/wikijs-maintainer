// Obsidian-Markdown → Wiki.js-Markdown. Einweg: aus dem Ergebnis laesst sich das
// Original nicht zurueckrechnen — genau deshalb haelt der Snapshot beide Fassungen
// (Roh und gepusht) getrennt (Spec § 3).
import { extractPageMeta } from "./page-meta";
import { rewriteLinks, type LinkResolver } from "./links";

export interface TransformResult {
  content: string;
  title: string;
  description: string;
  tags: string[];
  unresolved: string[];
  skippedEmbeds: string[];
}

// Wiki.js 2 kennt vier Blockquote-Klassen; Obsidian kennt Dutzende Callout-Typen.
// Unbekanntes faellt auf is-info — ein Block mit falscher Farbe ist harmlos, ein
// verschluckter Block nicht.
const CALLOUT_CLASS: Record<string, string> = {
  info: "is-info", note: "is-info", abstract: "is-info", question: "is-info",
  tip: "is-success", success: "is-success", check: "is-success", done: "is-success",
  warning: "is-warning", caution: "is-warning", attention: "is-warning",
  danger: "is-danger", error: "is-danger", bug: "is-danger", failure: "is-danger",
};

const CALLOUT_HEAD_RE = /^>\s*\[!([a-zA-Z]+)\][+-]?\s*(.*)$/;

/** Wandelt jeden Callout-Block in ein Blockquote plus Klassen-Zeile. Ein Block endet
 *  an der ersten Zeile, die nicht mit `>` beginnt. */
function transformCallouts(body: string): string {
  const lines = body.split("\n");
  const out: string[] = [];
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^(?:```|~~~)/.test(line.trimStart())) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    const head = inFence ? null : CALLOUT_HEAD_RE.exec(line);
    if (head === null) {
      out.push(line);
      continue;
    }
    const kind = (head[1] ?? "info").toLowerCase();
    const title = (head[2] ?? "").trim();
    if (title !== "") out.push(`> **${title}**`);
    let j = i + 1;
    while (j < lines.length && lines[j].startsWith(">") && CALLOUT_HEAD_RE.exec(lines[j]) === null) {
      out.push(lines[j]);
      j++;
    }
    out.push(`{.${CALLOUT_CLASS[kind] ?? "is-info"}}`);
    i = j - 1;
  }
  return out.join("\n");
}

/** Der eine Eingang der Push-Richtung: Rohtext der Notiz → alles, was die
 *  create/update-Mutation braucht, plus die Befunde fuer den Sync-Report. */
export function transformForWiki(raw: string, fallbackTitle: string, resolve: LinkResolver): TransformResult {
  const meta = extractPageMeta(raw, fallbackTitle);
  const links = rewriteLinks(meta.body, resolve);
  return {
    content: transformCallouts(links.text),
    title: meta.title,
    description: meta.description,
    tags: meta.tags,
    unresolved: links.unresolved,
    skippedEmbeds: links.skippedEmbeds,
  };
}
