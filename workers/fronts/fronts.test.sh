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

# 4. whats-next ---------------------------------------------------------------------
mkdir -p "$FRONTS_DIR/land-sales" "$TMP/locks"
export FRONTS_LOCK_DIR="$TMP/locks"
cp "$PROJECT_ROOT/fronts/_template/north-star.md" "$FRONTS_DIR/land-sales/north-star.md"
printf '# Land sales: now\n\n## Where we are\nOld state.\n\n## Answers from Daniel\n- 2026-10-11: Q: Keep the price? A: Yes.\n\n## Open questions\n(none yet)\n' > "$FRONTS_DIR/land-sales/now.md"
sed -i 's/^front: .*/front: [land-sales]/' "$MEM"
export STUB_PROMPT_CAPTURE="$TMP/next-prompt.txt" STUB_CURL_LOG="$TMP/curl2.log" STUB_CURL_BODIES="$TMP/curl2-bodies.log"
code=0; "$HERE/whats-next.sh" land-sales "$MEM" >/dev/null 2>&1 || code=$?
NOWF="$FRONTS_DIR/land-sales/now.md"
check "next: exits 0" test "$code" -eq 0
check "next: prompt carried the rules, the north star, the old now.md and the session" bash -c 'grep -q "ask Daniel instead of suggesting work" "$1" && grep -q "What good looks like" "$1" && grep -q "Old state" "$1" && grep -q "Landmodo photo upload selector" "$1"' _ "$STUB_PROMPT_CAPTURE"
check "next: now.md starts with the title and a Last session block naming the memory file" bash -c 'head -1 "$1" | grep -q "^# Land sales: now$" && grep -q "^## Last session" "$1" && grep -q "fixture-.md" "$1"' _ "$NOWF"
check "next: now.md has a Yesterday section" bash -c 'grep -q "^## Yesterday" "$1"' _ "$NOWF"
check "next: now.md carries the model sections" bash -c 'grep -q "^## Where we are" "$1" && grep -q "Stub state" "$1" && grep -q "^## Next for Daniel" "$1"' _ "$NOWF"
check "next: Answers from Daniel preserved" bash -c 'grep -q "^## Answers from Daniel" "$1" && grep -q "Keep the price? A: Yes" "$1"' _ "$NOWF"
check "next: suggestions and questions posted in one batch" bash -c 'grep -c "/api/fronts/suggestions" "$1" | grep -q "^1$" && grep -q "Stub task" "$2" && grep -q "Stub question" "$2" && grep -q "fixture-session-0001" "$2"' _ "$STUB_CURL_LOG" "$STUB_CURL_BODIES"
check "next: task body is the prompt, kind task; question body is why it matters" bash -c 'jq -e ".[0].kind == \"task\" and .[0].body == \"Do the stub thing.\" and .[1].kind == \"question\" and .[1].body == \"Because.\"" "$1" >/dev/null' _ "$STUB_CURL_BODIES"
unset STUB_PROMPT_CAPTURE

: > "$STUB_CURL_LOG"; : > "$STUB_CURL_BODIES"; cp "$NOWF" "$TMP/now-before-fail.md"
code=0; STUB_FAIL=1 "$HERE/whats-next.sh" land-sales "$MEM" >/dev/null 2>&1 || code=$?
check "next: model failure exits 2, now.md untouched, failure question posted" bash -c 'test "$1" -eq 2 && cmp -s "$2" "$3" && grep -q "failed for land-sales" "$4"' _ "$code" "$NOWF" "$TMP/now-before-fail.md" "$STUB_CURL_BODIES"

code=0; "$HERE/whats-next.sh" nope "$MEM" >/dev/null 2>&1 || code=$?
check "next: unknown front exits 2" test "$code" -eq 2

# Lock: a second run while the lock is held queues its file and exits 0.
( exec 9>"$TMP/locks/land-sales.lock"; flock 9; sleep 3 ) &
HOLDER=$!; sleep 0.5
code=0; "$HERE/whats-next.sh" land-sales "$MEM" >/dev/null 2>&1 || code=$?
check "next: busy front queues the file and exits 0" bash -c 'test "$1" -eq 0 && grep -q "fixture-.md" "$2"' _ "$code" "$TMP/locks/land-sales.pending"
wait $HOLDER
: > "$STUB_CURL_LOG"
"$HERE/whats-next.sh" land-sales >/dev/null 2>&1 || true
check "next: the next run drains the pending list" bash -c 'test ! -s "$1" && test "$(grep -c "/api/fronts/suggestions" "$2")" -eq 2' _ "$TMP/locks/land-sales.pending" "$STUB_CURL_LOG"
unset STUB_CURL_LOG STUB_CURL_BODIES

# 5. on-session-end hook + run-pipeline ---------------------------------------------
HOOK_IN=$(jq -n --arg t "$FIX/transcript-work.jsonl" '{session_id:"hook-session-0001", transcript_path:$t, cwd:"/home/mazer/claude/command-center", hook_event_name:"SessionEnd", reason:"clear"}')
export STUB_CURL_LOG="$TMP/curl3.log" STUB_CURL_BODIES="$TMP/curl3-bodies.log"
code=0; FRONTS_SKIP=1 "$HERE/on-session-end.sh" <<<"$HOOK_IN" || code=$?
check "hook: FRONTS_SKIP=1 exits 0 without a marker" bash -c 'test "$1" -eq 0 && test ! -e "$2"' _ "$code" "$FRONTS_STATE_DIR/processed/hook-session-0001"
code=0; FRONTS_INLINE=1 FRONTS_SETTLE_SECONDS=0 "$HERE/on-session-end.sh" <<<"$HOOK_IN" >/dev/null 2>&1 || code=$?
check "hook: processes the session inline and exits 0" test "$code" -eq 0
check "hook: processed marker written" test -d "$FRONTS_STATE_DIR/processed/hook-session-0001"
check "hook: pipeline wrote a memory file for the hook session" bash -c 'ls "$1"/memory | grep -q "hook-ses.md"' _ "$FRONTS_DIR"
check "hook: pipeline routed and ran what's-next (suggestions posted)" bash -c 'grep -q "/api/fronts/route" "$1" && grep -q "/api/fronts/suggestions" "$1"' _ "$STUB_CURL_LOG"
: > "$STUB_CURL_LOG"
code=0; FRONTS_INLINE=1 "$HERE/on-session-end.sh" <<<"$HOOK_IN" || code=$?
check "hook: same session a second time is a no-op" bash -c 'test "$1" -eq 0 && test ! -s "$2"' _ "$code" "$STUB_CURL_LOG"
code=0; "$HERE/on-session-end.sh" <<<'{"session_id":"","transcript_path":""}' || code=$?
check "hook: empty payload exits 0" test "$code" -eq 0
code=0; "$HERE/on-session-end.sh" <<<'not json' || code=$?
check "hook: garbage payload exits 0" test "$code" -eq 0
# Dry run works on a copy.
: > "$STUB_CURL_LOG"
FRONTS_DRY_RUN=1 FRONTS_SETTLE_SECONDS=0 "$HERE/run-pipeline.sh" "$FIX/transcript-work.jsonl" "dry-session-0001" "/home/mazer/claude/command-center" >"$TMP/dry.log" 2>&1 || true
check "pipeline: dry run reports a /tmp copy and leaves the real memory dir alone" bash -c 'grep -q "DRY RUN: working on a copy at /tmp/fronts-dry-run-" "$1" && ! ls "$2"/memory | grep -q "dry-sess"' _ "$TMP/dry.log" "$FRONTS_DIR"
rm -rf /tmp/fronts-dry-run-*
unset STUB_CURL_LOG STUB_CURL_BODIES

# 6. install-hook ---------------------------------------------------------------------
S="$TMP/settings.json"; echo '{"hooks":{"PreToolUse":[{"matcher":"Write","hooks":[{"type":"command","command":"x"}]}]}}' > "$S"
"$HERE/install-hook.sh" --settings "$S" >/dev/null
check "install: adds a SessionEnd entry pointing at on-session-end.sh with a timeout" bash -c 'jq -e ".hooks.SessionEnd[0].hooks[0].command | endswith(\"on-session-end.sh\")" "$1" >/dev/null && jq -e ".hooks.SessionEnd[0].hooks[0].timeout == 10" "$1" >/dev/null' _ "$S"
check "install: keeps existing hooks" bash -c 'jq -e ".hooks.PreToolUse[0].hooks[0].command == \"x\"" "$1" >/dev/null' _ "$S"
OUT=$("$HERE/install-hook.sh" --settings "$S")
check "install: second run is a no-op" bash -c 'grep -q "no change" <<<"$1" && test "$(jq ".hooks.SessionEnd | length" "$2")" -eq 1' _ "$OUT" "$S"
"$HERE/install-hook.sh" --uninstall --settings "$S" >/dev/null
check "uninstall: removes the entry and leaves other hooks" bash -c 'jq -e ".hooks.SessionEnd == null and .hooks.PreToolUse != null" "$1" >/dev/null' _ "$S"

echo; echo "passed $PASS, failed $FAIL"
[[ $FAIL -eq 0 ]]
