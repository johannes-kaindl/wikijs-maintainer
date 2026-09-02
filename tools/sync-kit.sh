#!/bin/sh
# Re-vendor kit modules from ../obsidian-kit. Run after kit updates.
set -e

KIT=../obsidian-kit
# Zweite Quelle seit obsidian-kit 2ab1bb5 ("domaenenfreie pure-Teilmenge zieht nach
# code-kit"): viele der hier vendorten Module liegen nicht mehr unter obsidian-kit/src/pure/,
# sondern im Repo code-kit. Bis 2026-09-02 kopierte dieses Skript weiter von der alten Stelle
# und starb an `cp: No such file` — mit einem Schaden, der groesser ist als der Abbruch:
# `set -e` beendet den Lauf NACH der ersten Erfolgsmeldung, also laufen die spaeteren Bloecke
# nicht mehr mit und VENDOR.json wird gar nicht erst geschrieben. Die eine Datei, in der man
# den Vendor-Stand nachschlaegt, behauptet danach den alten — leise.
CODE_KIT=../../code-kit
VER=$(node -p "require('$KIT/package.json').version")
CODE_VER=$(node -p "require('$CODE_KIT/package.json').version" 2>/dev/null || echo "?")
SHA=$(git -C "$KIT" rev-parse --short HEAD)

# Ein pures Modul kann in drei Schichten liegen. Statt fester Zuordnung wird gesucht — die
# naechste Umschichtung im Kit soll dieses Skript nicht wieder toeten, sondern nur einen
# anderen Fundort ergeben. Ausgabe: <pfad>|<quelle>|<quell-relativer-pfad>|<version>
quelle_fuer() {
  for kandidat in \
    "$KIT/src/pure/$1.ts|obsidian-kit|src/pure/$1.ts|$VER" \
    "$CODE_KIT/src/ts/pure/$1.ts|code-kit|src/ts/pure/$1.ts|$CODE_VER" \
    "$CODE_KIT/src/ts/web/$1.ts|code-kit|src/ts/web/$1.ts|$CODE_VER"; do
    if [ -f "${kandidat%%|*}" ]; then printf '%s\n' "$kandidat"; return 0; fi
  done
  return 1
}

stamp() { # stamp <vendored-file> <quell-relativer-pfad> [<quelle> <version>]
  quelle=${3:-obsidian-kit}
  version=${4:-$VER}
  header="// vendored from $quelle@$version, $2 — do not hand-edit; re-vendor via tools/sync-kit.sh"
  printf '%s\n' "$header" | cat - "$1" > "$1.tmp"
  mv "$1.tmp" "$1"
}

mkdir -p src/vendor/kit src/vendor/kit-obsidian tests/vendor/kit

# Erst ALLE Quellen aufloesen, dann kopieren: ein fehlendes Modul ist ein Aufbaufehler und
# wird als solcher gemeldet, statt den Lauf auf halber Strecke abzubrechen.
PURE_MODULE="settings i18n timeout frontmatter diff"
for m in $PURE_MODULE; do
  quelle_fuer "$m" >/dev/null || {
    echo "FEHLER: $m.ts liegt weder in $KIT/src/pure/ noch in $CODE_KIT/src/ts/{pure,web}/." >&2
    echo "  Beide Repos muessen neben obsidian-plugins/ liegen; seit obsidian-kit 2ab1bb5" >&2
    echo "  ist code-kit die Quelle der domaenenfreien Module." >&2
    exit 2
  }
done

for m in $PURE_MODULE; do
  fund=$(quelle_fuer "$m")
  pfad=$(printf '%s' "$fund" | cut -d'|' -f1)
  quelle=$(printf '%s' "$fund" | cut -d'|' -f2)
  rel=$(printf '%s' "$fund" | cut -d'|' -f3)
  ver=$(printf '%s' "$fund" | cut -d'|' -f4)
  cp "$pfad" "src/vendor/kit/$m.ts"
  stamp "src/vendor/kit/$m.ts" "$rel" "$quelle" "$ver"
  echo "vendored $quelle@$ver/$rel -> src/vendor/kit/$m.ts"
done

for m in clock confirm folder-suggest settings_walker; do
  cp "$KIT/src/obsidian/$m.ts" "src/vendor/kit-obsidian/$m.ts"
  stamp "src/vendor/kit-obsidian/$m.ts" "src/obsidian/$m.ts"
  echo "vendored obsidian-kit@$VER/obsidian/$m.ts"
done

cp "$KIT/src/testing/obsidian-mock.ts" "tests/vendor/kit/obsidian-mock.ts"
stamp "tests/vendor/kit/obsidian-mock.ts" "src/testing/obsidian-mock.ts"

cat > src/vendor/kit/VENDOR.json <<JSON
{
  "source": "obsidian-kit",
  "version": "$VER",
  "sha": "$SHA",
  "code_kit_version": "$CODE_VER",
  "vendored": "settings.ts, i18n.ts, timeout.ts, frontmatter.ts, diff.ts",
  "note": "Verbatim snapshot aus ZWEI Quellen (obsidian-kit + code-kit); welche Datei woher stammt, sagt ihr eigener Kopf. Never hand-edit. Re-vendor via tools/sync-kit.sh. kit-obsidian/ und tests/vendor/kit/ siehe deren VENDOR.json."
}
JSON
cat > src/vendor/kit-obsidian/VENDOR.json <<JSON
{
  "source": "obsidian-kit",
  "version": "$VER",
  "sha": "$SHA",
  "vendored": "clock.ts, confirm.ts, folder-suggest.ts, settings_walker.ts",
  "note": "Verbatim snapshot. Never hand-edit. Re-vendor via tools/sync-kit.sh."
}
JSON
cat > tests/vendor/kit/VENDOR.json <<JSON
{
  "source": "obsidian-kit",
  "version": "$VER",
  "sha": "$SHA",
  "vendored": "obsidian-mock.ts",
  "note": "Verbatim snapshot. Never hand-edit. Re-vendor via tools/sync-kit.sh."
}
JSON
echo "VENDOR.json → $VER ($SHA)"
