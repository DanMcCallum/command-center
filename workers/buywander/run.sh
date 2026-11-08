#!/usr/bin/env bash
# BuyWander nightly deal scan, invoked by cron at 5pm Mountain.
#
# Runs `claude -p --chrome` with workers/buywander/prompt.md so Claude reads
# BuyWander and eBay sold listings inside the operator's own Chrome (already
# logged in), then posts the resulting JSON to the dashboard, which stores it,
# updates the seen list and emails the finds. See AGENTS.md ("BuyWander").
#
# Usage: run.sh            cron entry point; exits quietly unless it is 5pm
#                          in America/Denver (the crontab fires at both UTC
#                          hours that can be 17:00 Mountain).
#        run.sh --now      run regardless of the hour.
#        run.sh --dry-run  run Claude but do not post; print the JSON.
set -euo pipefail

# Sessions this script spawns must not trigger the fronts SessionEnd hook.
export FRONTS_SKIP=1
# Cron's minimal PATH lacks ~/.local/bin where `claude` lives.
export PATH="$PATH:$HOME/.local/bin"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$HERE/../.." && pwd)"
DASHBOARD_URL="${DASHBOARD_URL:-http://localhost:3000}"
RUN_HOUR="${BUYWANDER_RUN_HOUR:-17}"          # local hour in America/Denver
MODEL="${BUYWANDER_MODEL:-sonnet}"
MAX_ITEMS="${BUYWANDER_MAX_ITEMS:-25}"
TIMEOUT_SECONDS="${BUYWANDER_TIMEOUT:-1500}"  # 25 minutes
LOCKFILE="${LOCKFILE:-/tmp/command-center-buywander.lock}"
RUNS_DIR="$HERE/runs"
KEEP_RUNS=14

log() { printf '[%s] %s\n' "$(date -Iseconds)" "$*"; }

FORCE=0; DRY=0
for arg in "$@"; do
  case "$arg" in
    --now) FORCE=1 ;;
    --dry-run) DRY=1; FORCE=1 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

if [[ $FORCE -eq 0 ]]; then
  local_hour="$(TZ=America/Denver date +%H)"
  if [[ "$local_hour" != "$(printf '%02d' "$RUN_HOUR")" ]]; then
    exit 0   # the other UTC firing of the day; not 5pm Mountain
  fi
fi

exec 9>"$LOCKFILE"
if ! flock -n 9; then
  log "another scan is running (lock $LOCKFILE); skipping"
  exit 0
fi

# Shared secrets live in the project-root .env.local; nothing auto-loads it.
read_env() {
  local name="$1"
  if [[ -n "${!name:-}" ]]; then printf '%s' "${!name}"; return; fi
  [[ -f "$PROJECT_ROOT/.env.local" ]] || return 0
  sed -n -E "s/^(export[[:space:]]+)?${name}=//p" "$PROJECT_ROOT/.env.local" | head -1 | sed -E "s/^([\"'])(.*)\1\$/\2/"
}
AGENT_TOKEN="$(read_env AGENT_TOKEN)"
if [[ -z "$AGENT_TOKEN" ]]; then
  log "AGENT_TOKEN is not set; cannot talk to the dashboard"
  exit 1
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
run_dir="$RUNS_DIR/$stamp"
mkdir -p "$run_dir"
seen_file="$run_dir/seen.json"
out_file="$run_dir/output.json"
prompt_file="$run_dir/prompt.md"
log_file="$run_dir/claude.log"

log "fetching seen ids from $DASHBOARD_URL"
if ! curl -sS --fail --max-time 30 -H "Authorization: Bearer $AGENT_TOKEN" \
     "$DASHBOARD_URL/api/buywander/seen" -o "$seen_file"; then
  log "seen list unavailable; treating every lot as new"
  echo '{"ids":[]}' > "$seen_file"
fi

sed -e "s|{{OUTPUT_FILE}}|$out_file|g" \
    -e "s|{{SEEN_FILE}}|$seen_file|g" \
    -e "s|{{MAX_ITEMS}}|$MAX_ITEMS|g" \
    "$HERE/prompt.md" > "$prompt_file"

ALLOWED_TOOLS="Read,Write,mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__tabs_close_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__javascript_tool,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__get_page_text,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__find"

log "starting claude ($MODEL, max $MAX_ITEMS lots, timeout ${TIMEOUT_SECONDS}s)"
set +e
( cd "$run_dir" && timeout "$TIMEOUT_SECONDS" claude -p --chrome \
    --model "$MODEL" \
    --allowedTools "$ALLOWED_TOOLS" \
    --output-format json \
    "$(cat "$prompt_file")" > "$run_dir/claude.json" 2> "$log_file" )
status=$?
set -e
if [[ $status -ne 0 ]]; then
  log "claude exited $status; see $log_file"
fi
if [[ -s "$run_dir/claude.json" ]]; then
  python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print("claude:", d.get("subtype"), "turns", d.get("num_turns"), "cost $%.2f" % (d.get("total_cost_usd") or 0)); r=d.get("result") or ""; print("reply:", r.strip().splitlines()[-1] if r.strip() else "")' "$run_dir/claude.json" 2>/dev/null || true
fi

if [[ ! -s "$out_file" ]]; then
  log "no output file written ($out_file); nothing to post"
  exit 1
fi
if ! python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$out_file" 2>/dev/null; then
  log "output is not valid JSON: $out_file"
  exit 1
fi

if [[ $DRY -eq 1 ]]; then
  log "dry run; not posting. Output:"
  cat "$out_file"
  exit 0
fi

log "posting to $DASHBOARD_URL/api/buywander/runs"
response="$(curl -sS --max-time 120 -w '\n%{http_code}' \
  -H "Authorization: Bearer $AGENT_TOKEN" -H "Content-Type: application/json" \
  --data-binary "@$out_file" "$DASHBOARD_URL/api/buywander/runs")"
code="${response##*$'\n'}"
body="${response%$'\n'*}"
if [[ "$code" != "201" ]]; then
  log "dashboard answered $code: $body"
  exit 1
fi
python3 -c 'import json,sys; d=json.loads(sys.argv[1]); n=d.get("notify",{}); print("stored run", d.get("id"), "finds", len(d.get("finds",[])), "new", d.get("new_count"), "| push:", "sent" if n.get("sent") else ("not sent" + (": "+n["error"] if n.get("error") else " (no finds)")))' "$body"

# Keep the last few run directories for debugging.
ls -1dt "$RUNS_DIR"/*/ 2>/dev/null | tail -n +$((KEEP_RUNS + 1)) | xargs -r rm -rf
log "done"
