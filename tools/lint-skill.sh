#!/usr/bin/env bash
# Scan skill markdown for project/user-specific or secret-shaped tokens.
# Defaults to scanning skills/ + profiles/*/overlays/; pass paths to override.
#
# Exit non-zero on any hit. Allowlist (EXAMPLE_ALLOW) covers obvious example
# markers so docs prose like `https://example.com` or the zero-UUID don't trip.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGETS=("$@")
[ ${#TARGETS[@]} -eq 0 ] && TARGETS=("$ROOT/skills" "$ROOT/profiles")

# Deny patterns: "label|perl-regex". Whole-match (per `grep -oP`) is what gets
# checked against EXAMPLE_ALLOW before being reported.
DENY=(
  "real-uuid|\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b"
  "long-mixed-token|\b(?=[a-z0-9]{20,}\b)(?=[a-z0-9]*[a-z])(?=[a-z0-9]*[0-9])[a-z0-9]+\b"
  "bearer-token|Bearer\s+[A-Za-z0-9._-]{20,}"
  "secret-assign|(?i)(password|api[_-]?key|secret|access[_-]?token)\s*[:=]\s*\S{6,}"
  "host-sidcorp|[a-z0-9.-]*sidcorp\.co"
  "host-anhome|[a-z0-9.-]*anhome\.app"
  "host-musetools|[a-z0-9.-]*musetools\.com"
  "host-grytt|[a-z0-9.-]*grytt\.co"
  "host-canawan|[a-z0-9.-]*canawan\.com"
  "host-tailscale|[a-z0-9.-]+\.ts\.net"
  "project-anhome|(?i)\banhome\b"
  "project-jarvis|(?i)\bjarvis\b"
  "project-forge-dev|(?i)\bforge-dev\b"
  "project-musetools|(?i)\bmusetools\b"
  "project-sidcorp|(?i)\bsidcorp\b"
  "ip-v4|\b(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(?:\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}\b"
)

# Example markers — substrings matched by DENY that are explicitly examples,
# not real values. Use literal alternatives separated by `|`.
EXAMPLE_ALLOW='^(00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff|example\.com|your-domain\.com|example\.org)$'

FAIL=0
total=0
for path in "${TARGETS[@]}"; do
  [ -e "$path" ] || continue
  while IFS= read -r -d '' f; do
    case "$f" in *.md) ;; *) continue ;; esac
    total=$((total+1))
    for entry in "${DENY[@]}"; do
      label="${entry%%|*}"
      pat="${entry#*|}"
      # grep -noP gives "lineno:match" per hit
      while IFS= read -r hit; do
        match="${hit#*:}"
        # whole-match allowlist
        if echo "$match" | grep -qP "$EXAMPLE_ALLOW"; then continue; fi
        rel="${f#$ROOT/}"
        echo "DENY [$label] $rel:$hit"
        FAIL=1
      done < <(grep -noP "$pat" "$f" 2>/dev/null || true)
    done
  done < <(find "$path" -type f -name '*.md' -print0)
done

echo ""
if [ "$FAIL" -ne 0 ]; then
  echo "lint-skill: found denied tokens (above)."
  echo "  Replace with placeholders (see conventions/placeholders.md) or obvious examples."
  exit 1
fi
echo "lint-skill: clean ($total markdown file(s) scanned)"
