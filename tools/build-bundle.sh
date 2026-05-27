#!/usr/bin/env bash
# Build a drop-in skill bundle for a profile: base + overlay − excluded = bundles/<profile>/skills
#
# Usage:
#   tools/build-bundle.sh <profile-name>
#   tools/build-bundle.sh --all
#
# Layering:
#   1. rsync skills/ (base canonical) → bundle/skills/
#   2. rsync profiles/<p>/overlays/ → bundle/skills/  (whole-file replace)
#   3. delete bundle/skills/<skill>/ for each entry in profile.json.excludeSkills
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Parse a JSON string-array field via python3 (avoids jq dependency).
read_json_array() {
  local file="$1" field="$2"
  python3 -c "import json,sys
d=json.load(open(sys.argv[1]))
for x in d.get(sys.argv[2], []) or []:
    print(x)" "$file" "$field"
}

build_one() {
  local profile="$1"
  local pdir="$ROOT/profiles/$profile"
  local bdir="$ROOT/bundles/$profile"
  [ -d "$pdir" ] || { echo "build-bundle: no such profile: $profile" >&2; return 1; }
  [ -f "$pdir/profile.json" ] || { echo "build-bundle: $pdir/profile.json missing" >&2; return 1; }

  echo "building bundle: $profile"
  rm -rf "$bdir"
  mkdir -p "$bdir/skills"

  # Layer 1 — base
  rsync -a --exclude '.gitkeep' "$ROOT/skills/" "$bdir/skills/"

  # Layer 2 — overlay
  if [ -d "$pdir/overlays" ] && find "$pdir/overlays" -mindepth 1 -not -name '.gitkeep' -print -quit | grep -q .; then
    rsync -a --exclude '.gitkeep' "$pdir/overlays/" "$bdir/skills/"
  fi

  # Layer 3 — excludeSkills (clean removal — for skills genuinely N/A in this profile)
  local excluded=()
  while IFS= read -r skill; do
    [ -z "$skill" ] && continue
    excluded+=("$skill")
    rm -rf "$bdir/skills/$skill"
  done < <(read_json_array "$pdir/profile.json" excludeSkills)

  cp "$pdir/profile.json" "$bdir/profile.json"

  local count
  count=$(find "$bdir/skills" -type f -name '*.md' | wc -l)
  echo "  → $bdir ($count skill files, ${#excluded[@]} excluded: ${excluded[*]:-none})"
}

if [ "${1:-}" = "--all" ]; then
  for p in "$ROOT/profiles"/*/; do
    name="$(basename "$p")"
    [ "$name" = "_template" ] && continue
    build_one "$name"
  done
else
  [ -z "${1:-}" ] && { echo "usage: $0 <profile-name> | --all" >&2; exit 1; }
  build_one "$1"
fi
