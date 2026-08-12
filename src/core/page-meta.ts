// Frontmatter → Wiki.js-Seitenmetadaten. Das Frontmatter selbst wird NIE gepusht
// (Spec § 3): es ist Vault-Verwaltung, in der Wiki-Seite waere es sichtbarer Muell.
// Ausgewertet werden nur title, summary und tags.
import { parseFrontmatter } from "../vendor/kit/frontmatter";

export interface PageMeta {
  title: string;
  description: string;
  tags: string[];
  body: string;
}

function asString(value: string | number | string[] | undefined): string {
  if (value === undefined) return "";
  return Array.isArray(value) ? value.join(", ") : String(value);
}

function asTags(value: string | number | string[] | undefined): string[] {
  if (value === undefined) return [];
  const list = Array.isArray(value) ? value : String(value).split(",");
  return list.map((tag) => tag.trim()).filter((tag) => tag !== "");
}

/** `fallbackTitle` ist der Dateiname ohne Endung — der Titel der Wiki-Seite, wenn
 *  kein Frontmatter-`title` gesetzt ist (Spec § 3). */
export function extractPageMeta(raw: string, fallbackTitle: string): PageMeta {
  const parsed = parseFrontmatter(raw);
  const title = asString(parsed.data.title).trim();
  return {
    title: title === "" ? fallbackTitle : title,
    description: asString(parsed.data.summary).trim(),
    tags: asTags(parsed.data.tags),
    // parseFrontmatter konsumiert nur den Zeilenumbruch direkt hinter dem
    // schliessenden "---" — die im Vault uebliche Leerzeile zwischen
    // Frontmatter und Text bleibt im Body stehen. Getrimmt, sonst begaenne
    // praktisch jede gepushte Wiki-Seite mit einer Leerzeile (und bekaeme sie
    // beim Pull zurueck in den Vault).
    body: parsed.body.replace(/^\n+/, ""),
  };
}
