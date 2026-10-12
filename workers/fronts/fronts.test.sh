#!/usr/bin/env bash
# Offline tests for the fronts pipeline (specs/fronts.md). A stub `claude`
# first on PATH answers every call, so no API spend; a temp fronts dir and
# state dir keep the real ones untouched.
#
#   workers/fronts/fronts.test.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$HERE/../.." && pwd)"
TMP=$(mktemp -d /tmp/fronts-test-XXXXXX)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin" "$TMP/fronts/memory" "$TMP/state" "$TMP/logs"

# --- Stub claude --------------------------------------------------------------
# Picks its answer from the --json-schema it is handed (summary vs route vs
# what's-next), records the prompt, honours STUB_FAIL=1.
cp "$HERE/fixtures/stub-claude.sh" "$TMP/bin/claude"
chmod +x "$TMP/bin/claude"
export PATH="$TMP/bin:$PATH"

# --- Stub curl -----------------------------------------------------------------
# Answers the dashboard routes the scripts call and records every POST body.
cp "$HERE/fixtures/stub-curl.sh" "$TMP/bin/curl"
chmod +x "$TMP/bin/curl"
export AGENT_TOKEN="stub-token" DASHBOARD_URL="http://stub"
export FRONTS_DIR="$TMP/fronts" FRONTS_STATE_DIR="$TMP/state" FRONTS_LOG_DIR="$TMP/logs"

PASS=0; FAIL=0
check() { local name="$1"; shift; if "$@"; then PASS=$((PASS+1)); echo "ok   $name"; else FAIL=$((FAIL+1)); echo "FAIL $name"; fi; }

FIX="$HERE/fixtures"

# 1. extract-transcript ---------------------------------------------------------
X=$("$HERE/extract-transcript.sh" "$FIX/transcript-work.jsonl")
check "extract counts real user turns only (meta and command echoes excluded)" test "$(jq -r .user_turns <<<"$X")" = 3
check "extract keeps file paths from tool calls" test "$(jq -r '.files_touched[0]' <<<"$X")" = "workers/posting/post-landmodo.ts"
check "extract drops thinking and tool results" bash -c '! grep -q "secret" <<<"$1" && ! grep -q "\"ok\"" <<<"$1"' _ "$(jq -r .text <<<"$X")"
check "extract keeps assistant text" bash -c 'grep -q "Committed as abc123" <<<"$1"' _ "$(jq -r .text <<<"$X")"
check "extract reads session id and cwd" test "$(jq -r .session_id <<<"$X")" = "fixture-session-0001" -a "$(jq -r .cwd <<<"$X")" = "/home/mazer/claude/command-center"
XC=$("$HERE/extract-transcript.sh" "$FIX/transcript-work.jsonl" 120)
check "extract caps the text and marks the omitted middle" bash -c 'grep -q "middle of the session omitted" <<<"$1"' _ "$(jq -r .text <<<"$XC")"

# 2. summarize-session -----------------------------------------------------------
export STUB_PROMPT_CAPTURE="$TMP/summary-prompt.txt"
OUT=$("$HERE/summarize-session.sh" "$FIX/transcript-work.jsonl" "" "" 2>/dev/null)
check "summarize writes a memory file and prints its path" test -f "$OUT"
check "memory file is under the fronts memory dir, named by date and session prefix" bash -c '[[ "$1" == "$2"/memory/2026-10-12-*-fixture-.md ]]' _ "$OUT" "$FRONTS_DIR"
check "memory frontmatter has front: unrouted and user_turns" bash -c 'grep -q "^front: unrouted$" "$1" && grep -q "^user_turns: 3$" "$1"' _ "$OUT"
check "memory body carries the summary and decisions" bash -c 'grep -q "fixed the Landmodo photo upload selector" "$1" && grep -q "^- Use .swal2-modal" "$1"' _ "$OUT"
check "summary prompt carried the conversation and files" bash -c 'grep -q "Fix the Landmodo poster" "$1" && grep -q "post-landmodo.ts" "$1"' _ "$STUB_PROMPT_CAPTURE"
check "summary prompt did not carry thinking blocks" bash -c '! grep -q "secret" "$1"' _ "$STUB_PROMPT_CAPTURE"
unset STUB_PROMPT_CAPTURE

OUT2=$("$HERE/summarize-session.sh" "$FIX/transcript-short.jsonl" "" "" 2>/dev/null)
check "short session (2 turns) is skipped: nothing printed, exit 0" test -z "$OUT2"
check "short session wrote no memory file" test "$(ls "$FRONTS_DIR/memory" | wc -l)" -eq 1

OUT3=$("$HERE/summarize-session.sh" "$FIX/transcript-work.jsonl" "sess-tmp" "/tmp/scratch" 2>/dev/null)
check "cwd under /tmp is skipped" test -z "$OUT3"

code=0; STUB_FAIL=1 "$HERE/summarize-session.sh" "$FIX/transcript-work.jsonl" "" "" >/dev/null 2>&1 || code=$?
check "summary call failure exits 2 and writes nothing new" test "$code" -eq 2 -a "$(ls "$FRONTS_DIR/memory" | wc -l)" -eq 1

# 3. route-session -----------------------------------------------------------------
MEM="$FRONTS_DIR/memory/2026-10-12-0904-fixture-.md"
export STUB_CURL_LOG="$TMP/curl.log" STUB_CURL_BODIES="$TMP/curl-bodies.log"
R=$("$HERE/route-session.sh" "$MEM" 2>/dev/null)
check "route: one strong pick routes to that front" test "$R" = "land-sales"
check "route: memory frontmatter rewritten to the routed front" bash -c 'grep -q "^front: \[land-sales\]$" "$1"' _ "$MEM"
check "route: request carried the summary body and cwd" bash -c 'grep -q "Landmodo photo upload selector" "$1" && grep -q "/home/mazer/claude/command-center" "$1"' _ "$STUB_CURL_BODIES"
check "route: request carried files touched" bash -c 'grep -q "post-landmodo.ts" "$1"' _ "$STUB_CURL_BODIES"

R2=$(STUB_ROUTE_JSON='{"fronts":[{"slug":"land-sales","probability":0.62},{"slug":"buyer-followup","probability":0.35}],"confidence":0.3,"method":"claude","cwdMatch":null}' "$HERE/route-session.sh" "$MEM" 2>/dev/null | tr '\n' ' ')
check "route: a second pick above 0.3 routes too" test "$R2" = "land-sales buyer-followup "
check "route: two fronts written as a list" bash -c 'grep -q "^front: \[land-sales, buyer-followup\]$" "$1"' _ "$MEM"

: > "$STUB_CURL_LOG"; : > "$STUB_CURL_BODIES"
R3=$(STUB_ROUTE_JSON='{"fronts":[{"slug":"day-job","probability":0.45},{"slug":"land-sales","probability":0.4}],"confidence":0.1,"method":"jev","cwdMatch":null}' "$HERE/route-session.sh" "$MEM" 2>/dev/null)
check "route: top pick under 0.6 leaves the session unrouted" test -z "$R3"
check "route: unrouted resets the frontmatter line" bash -c 'grep -q "^front: unrouted$" "$1"' _ "$MEM"
check "route: unrouted posts a question to the review bin" bash -c 'grep -q "/api/fronts/suggestions" "$1" && grep -Eq "\"kind\": ?\"question\"" "$2" && grep -q "Which front was this session about" "$2"' _ "$STUB_CURL_LOG" "$STUB_CURL_BODIES"
unset STUB_CURL_LOG STUB_CURL_BODIES

echo; echo "passed $PASS, failed $FAIL"
[[ $FAIL -eq 0 ]]
