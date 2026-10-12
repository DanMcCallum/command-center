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
cat > "$TMP/bin/claude" <<'STUB'
#!/usr/bin/env bash
PROMPT=$(cat)
printf '%s' "$PROMPT" > "${STUB_PROMPT_CAPTURE:-/dev/null}"
SCHEMA=""
while [[ $# -gt 0 ]]; do case "$1" in --json-schema) SCHEMA="$2"; shift 2;; *) shift;; esac; done
if [[ "${STUB_FAIL:-0}" == "1" ]]; then echo "stub failure" >&2; exit 1; fi
if [[ "$SCHEMA" == *'"open_threads"'* ]]; then
  OUT='{"summary":"Daniel fixed the Landmodo photo upload selector and committed it.","decisions":["Use .swal2-modal as the dialog selector"],"open_threads":["Re-run against the live site"],"topics":["landmodo","poster","photos"]}'
elif [[ "$SCHEMA" == *'"fronts"'* ]]; then
  OUT="${STUB_ROUTE_JSON:-{\"fronts\":[{\"slug\":\"land-sales\",\"probability\":0.9}],\"confidence\":0.9}}"
else
  OUT='{"now_md":"# Land sales: now\n\n## Where we are\nStub state.\n\n## Next for Daniel\n- Stub next.\n","suggestions":[{"title":"Stub task","prompt":"Do the stub thing.","type":"Building","model":"sonnet"}],"questions":[{"question":"Stub question?","why_it_matters":"Because."}]}'
fi
printf '{"type":"result","is_error":false,"session_id":"stub","total_cost_usd":0.01,"result":"{}","structured_output":%s}\n' "$OUT"
STUB
chmod +x "$TMP/bin/claude"
export PATH="$TMP/bin:$PATH"
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

echo; echo "passed $PASS, failed $FAIL"
[[ $FAIL -eq 0 ]]
