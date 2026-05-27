#!/usr/bin/env bash
#
# boot-servers.sh — boot core (always) and optionally web, wait for health.
#
# Usage:
#   boot-servers.sh <pidfile> [--ui]
#
# Writes PIDs to <pidfile> (one per line). Caller kills the PIDs and
# removes the file when done:
#
#   xargs -r kill < <pidfile> 2>/dev/null; rm -f <pidfile>
#
# On boot failure: tails the last 30 lines of the failing log to stderr
# and exits 1.
#
set -euo pipefail

PIDFILE="${1:?Usage: boot-servers.sh <pidfile> [--ui]}"
shift || true

UI=0
case "${1:-}" in
  --ui) UI=1 ;;
  "") ;;
  *) echo "Unknown flag: $1" >&2; exit 2 ;;
esac

CORE_LOG="/tmp/forge-test-core.log"
WEB_LOG="/tmp/forge-test-web.log"
TIMEOUT_S=60

: > "$PIDFILE"

wait_for() {
  local url="$1" pid="$2" log="$3"
  local start=$SECONDS
  until curl -fsS "$url" >/dev/null 2>&1; do
    sleep 2
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "Server $url exited before becoming healthy. Last 30 lines of $log:" >&2
      tail -30 "$log" >&2
      return 1
    fi
    if (( SECONDS - start >= TIMEOUT_S )); then
      echo "Timeout waiting for $url after ${TIMEOUT_S}s. Last 30 lines of $log:" >&2
      tail -30 "$log" >&2
      kill "$pid" 2>/dev/null || true
      return 1
    fi
  done
}

# --- Core (always) -------------------------------------------------------

(cd packages/core && nohup npm run dev > "$CORE_LOG" 2>&1 &)
# Capture the PID of the npm process via pgrep — backgrounded subshell
# loses $! to the parent. Brief sleep so pgrep can find it.
sleep 1
CORE_PID=$(pgrep -f 'npm run dev' -n | head -1 || true)
[[ -n "$CORE_PID" ]] || { echo "Could not capture core PID" >&2; exit 1; }
echo "$CORE_PID" >> "$PIDFILE"
echo "core: pid $CORE_PID, log $CORE_LOG"

wait_for "http://localhost:8080/api/version" "$CORE_PID" "$CORE_LOG" || exit 1
echo "core ready"

# --- Web (UI path only) --------------------------------------------------

if [[ "$UI" -eq 1 ]]; then
  (cd packages/web && nohup npm run dev > "$WEB_LOG" 2>&1 &)
  sleep 1
  # pgrep -n picks the newest matching process so we don't re-pick core
  WEB_PID=$(pgrep -f 'npm run dev' -n | head -1 || true)
  [[ -n "$WEB_PID" && "$WEB_PID" != "$CORE_PID" ]] \
    || { echo "Could not capture web PID" >&2; xargs -r kill < "$PIDFILE"; exit 1; }
  echo "$WEB_PID" >> "$PIDFILE"
  echo "web: pid $WEB_PID, log $WEB_LOG"

  if ! wait_for "http://localhost:3000" "$WEB_PID" "$WEB_LOG"; then
    kill "$CORE_PID" 2>/dev/null || true
    exit 1
  fi
  echo "web ready"
fi
