#!/usr/bin/env bash
# Browser e2e for the /calls section (specs/calls-dashboard.md US-018).
#
# Usage (from anywhere):
#   workers/calls-e2e/run.sh
#
# Starts a hermetic stack and drives it with headless Chromium:
#   - followupdominator `scripts/run_e2e_dev.py` on 8101 (fake ID and DialPad,
#     scratch db and record log in a temp dir, throwaway CALLS_API_TOKEN),
#   - `npx next dev -p 3001` from dashboard/ pointed at 8101 with the same token,
#   - workers/calls-e2e/e2e.mjs (Playwright from workers/posting/node_modules).
# Prints PASS/FAIL per step and exits non-zero on any failure. Kills only the
# pids it started, deletes its temp dir and any new workers/logs/*e2e* files,
# and checks that dashboard/data/*.json is unchanged. Never touches 3000, 8100
# or Investment Dominator.
#
# Env overrides: FUD_ROOT (default ~/claude/followupdominator).

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FUD_ROOT="${FUD_ROOT:-$HOME/claude/followupdominator}"
PY_PORT=8101
WEB_PORT=3001
FAILED=0

pass() { echo "PASS $*"; }
fail() { echo "FAIL $*"; FAILED=1; }

port_busy() { ss -ltnH "sport = :$1" | grep -q .; }

busy=()
port_busy "$WEB_PORT" && busy+=("$WEB_PORT")
port_busy "$PY_PORT" && busy+=("$PY_PORT")
if [ "${#busy[@]}" -gt 0 ]; then
  echo "refusing to run: port(s) ${busy[*]} already in use" >&2
  exit 2
fi
if [ ! -x "$FUD_ROOT/.venv/bin/python" ]; then
  echo "refusing to run: $FUD_ROOT/.venv/bin/python not found (set FUD_ROOT)" >&2
  exit 2
fi

TMP="$(mktemp -d /tmp/calls-e2e.XXXXXX)"
TOKEN="$(openssl rand -hex 32)"
PY_PID=""
NEXT_PID=""

# Files this run must leave alone. worker-state.json and front-suggestions.json
# are rewritten by the production worker cron and fronts hook on 3000, so a
# change there only fails the run when the dev server served a request that
# could have written them.
DATA_SUMS="$TMP/data-before.sha256"
(cd "$ROOT/dashboard/data" && sha256sum ./*.json) > "$DATA_SUMS"
LOGS_BEFORE="$TMP/logs-before.txt"
(cd "$ROOT/workers/logs" 2>/dev/null && ls -1 | grep -i e2e) > "$LOGS_BEFORE" || true

wait_port_free() {
  local port="$1" i
  for i in $(seq 1 50); do
    port_busy "$port" || return 0
    sleep 0.2
  done
  return 1
}

cleanup() {
  if [ -n "$NEXT_PID" ] && kill -0 "$NEXT_PID" 2>/dev/null; then
    kill -- "-$NEXT_PID" 2>/dev/null
    for _ in $(seq 1 25); do kill -0 "$NEXT_PID" 2>/dev/null || break; sleep 0.2; done
    kill -9 -- "-$NEXT_PID" 2>/dev/null
  fi
  if [ -n "$PY_PID" ] && kill -0 "$PY_PID" 2>/dev/null; then
    # SIGTERM leaves the runner serving open SSE streams (see the progress log).
    kill -9 "$PY_PID" 2>/dev/null
  fi
  wait_port_free "$WEB_PORT" || echo "WARN port $WEB_PORT still in use after cleanup" >&2
  wait_port_free "$PY_PORT" || echo "WARN port $PY_PORT still in use after cleanup" >&2

  if [ -d "$ROOT/workers/logs" ]; then
    (cd "$ROOT/workers/logs" && ls -1 | grep -i e2e) 2>/dev/null | while read -r f; do
      grep -qxF "$f" "$LOGS_BEFORE" || rm -f -- "$ROOT/workers/logs/$f"
    done
  fi
  rm -rf -- "$TMP"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# Python runner. exec keeps $! equal to the server pid.
(
  cd "$FUD_ROOT" || exit 1
  CALLS_API_TOKEN="$TOKEN" exec .venv/bin/python scripts/run_e2e_dev.py \
    "$PY_PORT" "$TMP/e2e.db" "$TMP/id-writes.jsonl"
) > "$TMP/python.log" 2>&1 &
PY_PID=$!
disown "$PY_PID"  # e2e.mjs SIGKILLs it; no "Killed" job notice

# next dev in its own session (the background subshell is not a group leader,
# so setsid does not fork and $! is the group id), so killing the group also
# takes next-server and its children.
(
  cd "$ROOT/dashboard" || exit 1
  DASHBOARD_URL="http://localhost:$WEB_PORT" CALLS_API_URL="http://127.0.0.1:$PY_PORT" \
    CALLS_API_TOKEN="$TOKEN" exec setsid npx next dev -p "$WEB_PORT"
) > "$TMP/next.log" 2>&1 &
NEXT_PID=$!

http_code() { curl -s -o /dev/null -m 60 -w '%{http_code}' "$1"; }

ok=0
for _ in $(seq 1 60); do
  code="$(http_code "http://127.0.0.1:$PY_PORT/healthz")"
  if [ "$code" = 200 ] || [ "$code" = 503 ]; then ok=1; break; fi
  kill -0 "$PY_PID" 2>/dev/null || break
  sleep 0.5
done
SESSION="$(sed -n 's/^SESSION=//p' "$TMP/python.log" | head -n 1)"
if [ "$ok" = 1 ] && [ -n "$SESSION" ]; then
  pass "python runner healthy on $PY_PORT (healthz $code)"
else
  fail "python runner did not come up on $PY_PORT"
  tail -n 20 "$TMP/python.log" | grep -v '^SESSION=' >&2
  exit 1
fi

ok=0
for _ in $(seq 1 90); do
  code="$(http_code "http://localhost:$WEB_PORT/api/calls/recent")"
  if [ "$code" = 200 ]; then ok=1; break; fi
  kill -0 "$NEXT_PID" 2>/dev/null || break
  sleep 1
done
if [ "$ok" = 1 ]; then
  pass "next dev healthy on $WEB_PORT (/api/calls/recent 200)"
else
  fail "next dev did not come up on $WEB_PORT (last code $code)"
  tail -n 20 "$TMP/next.log" >&2
  exit 1
fi

# First hit of a route compiles for seconds; warm the pages so the browser's
# timed assertions measure the app, not the compiler.
for p in /calls /calls/search /calls/record/contact/7 /calls/attribute /calls/dial /calls/ops; do
  http_code "http://localhost:$WEB_PORT$p" > /dev/null
done

E2E_BASE="http://localhost:$WEB_PORT" \
  E2E_PY_BASE="http://127.0.0.1:$PY_PORT" \
  E2E_SESSION="$SESSION" \
  E2E_RECORD_LOG="$TMP/id-writes.jsonl" \
  E2E_PY_PID="$PY_PID" \
  E2E_SHOTS=/tmp \
  node "$ROOT/workers/calls-e2e/e2e.mjs" || FAILED=1

# The token must never reach a log.
for f in python.log next.log; do
  if grep -qF "$TOKEN" "$TMP/$f"; then fail "token found in $f"; else pass "token absent from $f"; fi
done

# Stop the stack before the data check so nothing is mid-write.
cleanup_servers() {
  kill -- "-$NEXT_PID" 2>/dev/null
  kill -9 "$PY_PID" 2>/dev/null
  wait_port_free "$WEB_PORT" && wait_port_free "$PY_PORT"
}
if cleanup_servers; then pass "stopped the pids it started; ports $WEB_PORT and $PY_PORT free"; else fail "ports still in use after stopping"; fi

changed="$(cd "$ROOT/dashboard/data" && sha256sum --quiet -c "$DATA_SUMS" 2>/dev/null | sed -n 's/^\.\/\(.*\): FAILED$/\1/p')"
data_ok=1
for f in $changed; do
  case "$f" in
    worker-state.json|front-suggestions.json)
      if grep -qE '/api/(fronts|worker)' "$TMP/next.log"; then
        fail "dashboard/data/$f changed and the dev server served a request that writes it"; data_ok=0
      else
        echo "NOTE dashboard/data/$f changed by the production cron or fronts hook on 3000 (no such request on $WEB_PORT)"
      fi
      ;;
    *) fail "dashboard/data/$f changed"; data_ok=0 ;;
  esac
done
[ "$data_ok" = 1 ] && pass "dashboard/data/*.json untouched by this run"

if [ "$FAILED" = 0 ]; then echo "E2E PASS"; else echo "E2E FAIL"; fi
exit "$FAILED"
