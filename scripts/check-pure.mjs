// `src/core/` muss frei von obsidian-Importen bleiben — das ist die Zusicherung,
// dass die Rechenlogik ohne Obsidian testbar ist.
//
// Bewusst ein Script statt eines grep-Einzeilers in package.json: der Einzeiler
// hatte nur `from '…'` mit einfachen Anfuehrungszeichen erfasst und war damit
// gegen den eigenen Code (doppelte Anfuehrungszeichen) wirkungslos.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "src/core";
const FORBIDDEN = /(?:from|import)\s*\(?\s*["'](obsidian)(\/[^"']*)?["']/;

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

// src/core existiert im Scaffold-Stand (Task 1) noch nicht — kommt erst mit der
// core/obsidian-Trennung in einem spaeteren Task. Bis dahin ist "nichts zu pruefen"
// das korrekte gruene Ergebnis, kein Fehler.
if (!existsSync(ROOT)) {
  console.log(`check:pure: ${ROOT} existiert noch nicht — nichts zu pruefen`);
  process.exit(0);
}

const offenders = walk(ROOT)
  .filter((file) => file.endsWith(".ts"))
  .filter((file) => FORBIDDEN.test(readFileSync(file, "utf8")));

if (offenders.length > 0) {
  console.error("src/core darf kein obsidian importieren:");
  for (const file of offenders) console.error(`  ${file}`);
  process.exit(1);
}

console.log(`check:pure: ${ROOT} ist frei von obsidian`);
