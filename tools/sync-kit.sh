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
CODE_KIT="${CODE_KIT_DIR:-../../libs/code-kit}"
# CORE-META-22: gelesen wird aus einer FESTEN REF, nicht aus dem Arbeitsstand des
# Nachbar-Repos. Ein `cp` aus dessen Worktree koppelt dieses Repo an einen fremden HEAD —
# wer nebenan etwas ausprobiert, landet hier im Vendor, und VENDOR.json behauptet trotzdem
# eine Version. Default ist die package.json-Version der Quelle; ein Upgrade ist damit eine
# BEWUSSTE Handlung (`KIT_REF=0.31.0 sh tools/sync-kit.sh`).
# Feste Default-Pins (Absicht, 2026-09-26): beide Quellen stehen laengst weiter (Kit 0.43.0, code-kit 0.7.0),
# dieses Repo bleibt fuer die uebrigen Module auf seinem Stand — ein Routinelauf soll nicht mitheben.
VER="${KIT_REF:-0.30.0}"
CODE_VER="${CODE_KIT_REF:-0.5.0}"
# Zweiter Pin, ebenfalls Absicht: help-setting.ts (Hilfe-Zeile, UI-STANDARD 8) kam mit Kit 0.43.0 und
# haengt an keinem anderen Modul. Vorlage: epub-exporter/tools/sync-kit.sh (877eb2c).
KIT_HELP_REF="${KIT_HELP_REF:-0.43.0}"
for paar in "$KIT|$VER" "$KIT|$KIT_HELP_REF" "$CODE_KIT|$CODE_VER"; do
  repo=${paar%%|*}; ref=${paar##*|}
  git -C "$repo" rev-parse --verify --quiet "$ref^{commit}" >/dev/null || {
    echo "FEHLER: Ref '$ref' existiert nicht in $repo." >&2
    echo "  Entweder ist die Version dort ungetaggt, oder KIT_REF/CODE_KIT_REF setzen." >&2
    exit 2
  }
done
SHA=$(git -C "$KIT" rev-parse --short "$VER^{commit}")
HELP_SHA=$(git -C "$KIT" rev-parse --short "$KIT_HELP_REF^{commit}")
git -C "$KIT" cat-file -e "$KIT_HELP_REF:src/obsidian/help-setting.ts" 2>/dev/null || {
  echo "FEHLER: src/obsidian/help-setting.ts fehlt in $KIT@$KIT_HELP_REF." >&2; exit 2; }

# Ein pures Modul kann in drei Schichten liegen. Statt fester Zuordnung wird gesucht — die
# naechste Umschichtung im Kit soll dieses Skript nicht wieder toeten, sondern nur einen
# anderen Fundort ergeben. Ausgabe: <pfad>|<quelle>|<quell-relativer-pfad>|<version>
# Ausgabe: <repo>|<ref>|<quelle>|<quell-relativer-pfad>|<version>
quelle_fuer() {
  for kandidat in \
    "$KIT|$VER|obsidian-kit|src/pure/$1.ts|$VER" \
    "$CODE_KIT|$CODE_VER|code-kit|src/ts/pure/$1.ts|$CODE_VER" \
    "$CODE_KIT|$CODE_VER|code-kit|src/ts/web/$1.ts|$CODE_VER"; do
    repo=$(printf '%s' "$kandidat" | cut -d'|' -f1)
    ref=$(printf '%s' "$kandidat" | cut -d'|' -f2)
    rel=$(printf '%s' "$kandidat" | cut -d'|' -f4)
    # In der REF nachsehen, nicht im Worktree: sonst faende die Suche eine Datei, die der
    # Lesevorgang danach nicht bekommt.
    if git -C "$repo" cat-file -e "$ref:$rel" 2>/dev/null; then
      printf '%s\n' "$kandidat"; return 0
    fi
  done
  return 1
}

# In eine .tmp lesen und erst bei Erfolg verschieben. Eine Ausgabe-Umleitung legt die
# Zieldatei an, BEVOR der Lesebefehl laeuft — scheitert er, bleibt ein Torso zurueck, der
# mit Stempelzeile wie ein gueltiges Vendoring aussieht.
hole() { # hole <repo> <ref> <quell-pfad> <ziel>
  git -C "$1" show "$2:$3" > "$4.tmp" || { rm -f "$4.tmp"; return 1; }
  mv "$4.tmp" "$4"
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
  repo=$(printf '%s' "$fund" | cut -d'|' -f1)
  ref=$(printf '%s' "$fund" | cut -d'|' -f2)
  quelle=$(printf '%s' "$fund" | cut -d'|' -f3)
  rel=$(printf '%s' "$fund" | cut -d'|' -f4)
  ver=$(printf '%s' "$fund" | cut -d'|' -f5)
  hole "$repo" "$ref" "$rel" "src/vendor/kit/$m.ts" || {
    echo "FEHLER: $ref:$rel nicht lesbar in $repo" >&2; exit 2; }
  stamp "src/vendor/kit/$m.ts" "$rel" "$quelle" "$ver"
  echo "vendored $quelle@$ver/$rel -> src/vendor/kit/$m.ts"
done

for m in clock confirm folder-suggest settings_walker; do
  hole "$KIT" "$VER" "src/obsidian/$m.ts" "src/vendor/kit-obsidian/$m.ts" || {
    echo "FEHLER: $VER:src/obsidian/$m.ts nicht lesbar" >&2; exit 2; }
  stamp "src/vendor/kit-obsidian/$m.ts" "src/obsidian/$m.ts"
  echo "vendored obsidian-kit@$VER/obsidian/$m.ts"
done

hole "$KIT" "$KIT_HELP_REF" "src/obsidian/help-setting.ts" "src/vendor/kit-obsidian/help-setting.ts" || {
  echo "FEHLER: $KIT_HELP_REF:src/obsidian/help-setting.ts nicht lesbar" >&2; exit 2; }
stamp "src/vendor/kit-obsidian/help-setting.ts" "src/obsidian/help-setting.ts" obsidian-kit "$KIT_HELP_REF"
echo "vendored obsidian-kit@$KIT_HELP_REF/obsidian/help-setting.ts"

hole "$KIT" "$VER" "src/testing/obsidian-mock.ts" "tests/vendor/kit/obsidian-mock.ts" || {
  echo "FEHLER: $VER:src/testing/obsidian-mock.ts nicht lesbar" >&2; exit 2; }
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
  "vendored": "clock.ts, confirm.ts, folder-suggest.ts, settings_walker.ts, help-setting.ts (Kit $KIT_HELP_REF, $HELP_SHA)",
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
