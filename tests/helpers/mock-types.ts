// Typ-Sicht auf den vendorten Obsidian-Mock. Zur Laufzeit ersetzt vitest `obsidian` durch den
// Mock (tests/__mocks__/obsidian.ts); fuer tsc bleiben die echten Typen aus `obsidian` stehen,
// und die kennen weder `Notice.instances` noch einen TFile-Konstruktor mit Pfad. Diese Sicht
// haelt die Casts an einer Stelle statt in jedem Test.
import { Notice, TFile, type PluginManifest } from "obsidian";

type TFileCtor = new (path: string) => TFile;
const MockTFile = TFile as unknown as TFileCtor;

/** Eine Datei mit Pfad, wie der Mock sie baut. */
export function makeFile(path = ""): TFile {
  return new MockTFile(path);
}

/** Die vom Mock aufgezeichneten Notices. */
export const notices = (Notice as unknown as { instances: Array<{ message: unknown }> }).instances;

export function makeManifest(id: string): PluginManifest {
  return { id, name: "x", version: "0.0.0", minAppVersion: "1.8.7", author: "test", description: "test" };
}
