#!/usr/bin/env bash
# Show how a profile's overlay diverges from the base canonical set.
# Usage: tools/diff-overlay.sh <profile-name>
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROFILE="${1:-}"
[ -z "$PROFILE" ] && { echo "usage: $0 <profile-name>" >&2; exit 1; }
OVL="$ROOT/profiles/$PROFILE/overlays"
[ -d "$OVL" ] || { echo "no overlay dir: $OVL" >&2; exit 1; }

cd "$OVL"
files="$(find . -type f -name '*.md' | sed 's|^\./||' | sort)"
if [ -z "$files" ]; then
  echo "(no overlay files — profile uses base as-is)"
  exit 0
fi
while IFS= read -r rel; do
  base="$ROOT/skills/$rel"
  if [ -f "$base" ]; then
    echo "=== $rel — overrides base ==="
    diff -u "$base" "$OVL/$rel" || true
  else
    echo "=== $rel — NEW (no base counterpart) ==="
  fi
  echo ""
done <<<"$files"
