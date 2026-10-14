// Frontmatter → Wiki.js-Seitenmetadaten. Das Frontmatter selbst wird NIE gepusht
// (Spec § 3): es ist Vault-Verwaltung, in der Wiki-Seite waere es sichtbarer Muell.
// Ausgewertet werden nur title, description (Rueckfall summary), tags und wiki_published.
import { parseFrontmatter } from "../vendor/kit/frontmatter";

export interface PageMeta {
  title: string;
  description: string;
  tags: string[];
  /** Frontmatter `wiki_published`; ohne Angabe `true` (das Verhalten vor diesem Feld). */
  published: boolean;
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

const PUBLISHED_TRUE = new Set(["true", "yes", "on", "1"]);

/** Sichtbarkeit der Wiki-Seite. Fehlt das Feld oder ist es leer, gilt `true`. Ein Wert, der
 *  weder als Ja noch als Nein lesbar ist, gilt als `false`: eine Seite mit privaten Daten
 *  soll an einem Tippfehler unsichtbar bleiben, nicht online gehen. */
function asPublished(value: string | number | string[] | undefined): boolean {
  if (value === undefined) return true;
  const text = Array.isArray(value) ? value.join(",") : String(value);
  const normalized = text.trim().toLowerCase();
  if (normalized === "") return true;
  return PUBLISHED_TRUE.has(normalized);
}

/** `fallbackTitle` ist der Dateiname ohne Endung — der Titel der Wiki-Seite, wenn
 *  kein Frontmatter-`title` gesetzt ist (Spec § 3). */
export function extractPageMeta(raw: string, fallbackTitle: string): PageMeta {
  const parsed = parseFrontmatter(raw);
  const title = asString(parsed.data.title).trim();
  // `description` heisst das Feld in Wiki.js und in jedem daraus gezogenen Vault; `summary` bleibt Rueckfall.
  const description = asString(parsed.data.description).trim();
  return {
    title: title === "" ? fallbackTitle : title,
    description: description === "" ? asString(parsed.data.summary).trim() : description,
    tags: asTags(parsed.data.tags),
    published: asPublished(parsed.data.wiki_published),
    // parseFrontmatter konsumiert nur den Zeilenumbruch direkt hinter dem
    // schliessenden "---" — die im Vault uebliche Leerzeile zwischen
    // Frontmatter und Text bleibt im Body stehen. Getrimmt, sonst begaenne
    // praktisch jede gepushte Wiki-Seite mit einer Leerzeile (und bekaeme sie
    // beim Pull zurueck in den Vault).
    body: parsed.body.replace(/^\n+/, ""),
  };
}
