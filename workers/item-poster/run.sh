#!/usr/bin/env bash
# Item ad auto-poster: publishes a finished item ad (BuyWander lot) to KSL
# Classifieds and Facebook Marketplace by driving the operator's own Chrome
# with `claude -p --chrome`, the same way the nightly BuyWander scan reads.
#
# The worker (workers/run-worker.sh) starts this detached right after a
# `generate-item-ad` task lands in needs_review. It can also be run by hand.
#
# Usage: run.sh <task-id>                    post every wanted platform not yet posted
#        run.sh <task-id> --platform ksl     one platform only (ksl | fb_item)
#        run.sh <task-id> --dry-run          fill the form, stop before the publish click
#
# Per platform it writes runs/<task>-<platform>-<stamp>/listing.json (title,
# price, description, category, condition, photo paths, all read from
# <workspace>/<platform>.md and the task metadata), runs Claude with the
# platform prompt, reads result.json, and records the outcome on the task as
# a `postings` entry through PATCH /api/tasks/<id>.
#
# Switches: ITEM_AUTOPOST=0 (environment or root .env.local) turns the
# worker's automatic start off; metadata.autopost=false does it per task.
# ITEM_POSTER_PLATFORMS (default "ksl fb_item"), ITEM_POSTER_MODEL (sonnet),
# ITEM_POSTER_TIMEOUT (900 s per platform).
set -euo pipefail

# Sessions this script spawns must not trigger the fronts SessionEnd hook.
export FRONTS_SKIP=1
# Cron's minimal PATH lacks ~/.local/bin where `claude` lives. Append, never prepend.
export PATH="$PATH:$HOME/.local/bin"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$HERE/../.." && pwd)"
DASHBOARD_URL="${DASHBOARD_URL:-http://localhost:3000}"
MODEL="${ITEM_POSTER_MODEL:-sonnet}"
TIMEOUT_SECONDS="${ITEM_POSTER_TIMEOUT:-900}"
PLATFORMS="${ITEM_POSTER_PLATFORMS:-ksl fb_item}"
LOCKFILE="${LOCKFILE:-/tmp/command-center-item-poster.lock}"
LOCK_WAIT_SECONDS="${ITEM_POSTER_LOCK_WAIT:-3600}"
RUNS_DIR="${ITEM_POSTER_RUNS_DIR:-$HERE/runs}"
KEEP_RUNS=30

log() { printf '[%s] %s\n' "$(date -Iseconds)" "$*"; }

TASK_ID=""; DRY=0; ONLY=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --platform) ONLY="${2:-}"; shift ;;
    -*) echo "unknown argument: $1" >&2; exit 2 ;;
    *) TASK_ID="$1" ;;
  esac
  shift
done
if [[ -z "$TASK_ID" ]]; then
  echo "usage: run.sh <task-id> [--platform ksl|fb_item] [--dry-run]" >&2
  exit 2
fi
[[ -n "$ONLY" ]] && PLATFORMS="$ONLY"

for cmd in curl jq python3 claude timeout flock; do
  command -v "$cmd" >/dev/null 2>&1 || { log "FATAL: '$cmd' is not on PATH"; exit 1; }
done

# One browser, one poster at a time. Wait instead of skipping so two ads
# generated back to back both get posted.
exec 9>"$LOCKFILE"
if ! flock -w "$LOCK_WAIT_SECONDS" 9; then
  log "another item poster held the lock for ${LOCK_WAIT_SECONDS}s; giving up on $TASK_ID"
  exit 1
fi

fetch_task() { curl -sS --fail --max-time 15 "$DASHBOARD_URL/api/tasks/$TASK_ID"; }

# Merge one posting record into the task's postings array (the PATCH replaces
# the whole array, so read the current one first).
record_posting() {
  local record="$1" current body
  current="$(fetch_task | jq -c '.postings // []')" || { log "could not re-read the task to record a posting"; return 1; }
  body="$(jq -cn --argjson cur "$current" --argjson rec "$record" \
    '{postings: ([$cur[] | select(.platform != $rec.platform)] + [$rec])}')"
  curl -sS --fail --max-time 15 -X PATCH "$DASHBOARD_URL/api/tasks/$TASK_ID" \
    -H 'Content-Type: application/json' -d "$body" >/dev/null
}

if ! TASK_JSON="$(fetch_task)"; then
  log "task $TASK_ID not readable at $DASHBOARD_URL"
  exit 1
fi
if [[ "$(jq -r '.metadata.kind // ""' <<<"$TASK_JSON")" != "item-ad-builder" ]]; then
  log "task $TASK_ID is not an item-ad-builder task; nothing to do"
  exit 0
fi
WORKSPACE_REL="$(jq -r '.workspacePath // ""' <<<"$TASK_JSON")"
WORKSPACE="$PROJECT_ROOT/${WORKSPACE_REL:-workers/workspace/outputs/$TASK_ID}"

ALLOWED_TOOLS="Read,Write,mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__tabs_close_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__javascript_tool,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__get_page_text,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__find,mcp__claude-in-chrome__form_input,mcp__claude-in-chrome__file_upload,mcp__claude-in-chrome__browser_batch"

failures=0
for platform in $PLATFORMS; do
  prompt_src="$HERE/prompt-$platform.md"
  if [[ ! -f "$prompt_src" ]]; then
    log "$platform: no prompt at $prompt_src; skipping"
    continue
  fi
  # Only platforms the task asked for.
  if ! jq -e --arg p "$platform" '(.metadata.platforms // []) | index($p)' <<<"$TASK_JSON" >/dev/null; then
    log "$platform: not in the task's platforms; skipping"
    continue
  fi
  # Re-read each time: the operator may have recorded a posting by hand meanwhile.
  TASK_JSON="$(fetch_task)" || { log "task re-read failed"; failures=$((failures+1)); continue; }
  existing="$(jq -r --arg p "$platform" '[.postings // [] | .[] | select(.platform == $p)][0] | .status // ""' <<<"$TASK_JSON")"
  if [[ "$existing" == "posted" && $DRY -eq 0 ]]; then
    log "$platform: already posted ($(jq -r --arg p "$platform" '[.postings[] | select(.platform == $p)][0].listingUrl // ""' <<<"$TASK_JSON")); skipping"
    continue
  fi
  attempts="$(jq -r --arg p "$platform" '[.postings // [] | .[] | select(.platform == $p)][0] | .attempts // 0' <<<"$TASK_JSON")"
  attempts=$((attempts + 1))
  queued_at="$(date -u +%FT%TZ)"

  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  run_dir="$RUNS_DIR/$TASK_ID-$platform-$stamp"
  mkdir -p "$run_dir"
  listing_file="$run_dir/listing.json"
  result_file="$run_dir/result.json"

  if ! python3 "$HERE/build-listing.py" "$PROJECT_ROOT" "$WORKSPACE" "$platform" "$DRY" \
        <<<"$TASK_JSON" > "$listing_file" 2> "$run_dir/build.err"; then
    err="$(head -c 400 "$run_dir/build.err")"
    log "$platform: cannot build the listing: $err"
    failures=$((failures+1))
    [[ $DRY -eq 1 ]] || record_posting "$(jq -cn --arg p "$platform" --arg q "$queued_at" --arg e "$err" --argjson a "$attempts" \
      '{platform:$p,status:"failed",attempts:$a,queuedAt:$q,lastError:$e}')" || true
    continue
  fi

  sed -e "s|{{LISTING_FILE}}|$listing_file|g" -e "s|{{RESULT_FILE}}|$result_file|g" \
      "$prompt_src" > "$run_dir/prompt.md"

  [[ $DRY -eq 1 ]] || record_posting "$(jq -cn --arg p "$platform" --arg q "$queued_at" --argjson a "$attempts" \
    '{platform:$p,status:"posting",attempts:$a,queuedAt:$q}')" || true

  log "$platform: starting claude ($MODEL, timeout ${TIMEOUT_SECONDS}s, dry=$DRY) in $run_dir"
  set +e
  ( cd "$PROJECT_ROOT" && timeout "$TIMEOUT_SECONDS" claude -p --chrome \
      --model "$MODEL" \
      --allowedTools "$ALLOWED_TOOLS" \
      --output-format json \
      "$(cat "$run_dir/prompt.md")" > "$run_dir/claude.json" 2> "$run_dir/claude.log" )
  status=$?
  set -e
  [[ $status -eq 0 ]] || log "$platform: claude exited $status; see $run_dir/claude.log"
  if [[ -s "$run_dir/claude.json" ]]; then
    python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print("claude:", d.get("subtype"), "turns", d.get("num_turns"), "cost $%.2f" % (d.get("total_cost_usd") or 0))' "$run_dir/claude.json" 2>/dev/null || true
  fi

  res_status=""; url=""; err=""
  if [[ -s "$result_file" ]] && jq -e . "$result_file" >/dev/null 2>&1; then
    res_status="$(jq -r '.status // ""' "$result_file")"
    url="$(jq -r '.listingUrl // ""' "$result_file")"
    err="$(jq -r '.error // .notes // ""' "$result_file" | head -c 500)"
  else
    err="The poster session ended without writing a result (exit $status). Check the site before retrying: the listing may be live."
  fi

  if [[ $DRY -eq 1 ]]; then
    log "$platform: dry run result: ${res_status:-none} ${url} ${err}"
    continue
  fi

  if [[ "$res_status" == "posted" && "$url" =~ ^https:// ]]; then
    record_posting "$(jq -cn --arg p "$platform" --arg q "$queued_at" --arg t "$(date -u +%FT%TZ)" --arg u "$url" --argjson a "$attempts" \
      '{platform:$p,status:"posted",attempts:$a,queuedAt:$q,postedAt:$t,listingUrl:$u}')" || true
    log "$platform: posted $url"
  elif [[ "$res_status" == "needs_login" ]]; then
    record_posting "$(jq -cn --arg p "$platform" --arg q "$queued_at" --arg e "${err:-Not logged in in Chrome.}" --argjson a "$attempts" \
      '{platform:$p,status:"awaiting_auth",attempts:$a,queuedAt:$q,lastError:$e}')" || true
    log "$platform: needs a login in Chrome: $err"
    failures=$((failures+1))
  else
    record_posting "$(jq -cn --arg p "$platform" --arg q "$queued_at" --arg e "${err:-unknown failure}" --argjson a "$attempts" \
      '{platform:$p,status:"failed",attempts:$a,queuedAt:$q,lastError:$e}')" || true
    log "$platform: failed: $err"
    failures=$((failures+1))
  fi
done

# Keep the last few run directories for debugging.
ls -1dt "$RUNS_DIR"/*/ 2>/dev/null | tail -n +$((KEEP_RUNS + 1)) | xargs -r rm -rf
log "done ($failures failed)"
[[ $failures -eq 0 ]]
