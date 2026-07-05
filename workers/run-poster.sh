#!/usr/bin/env bash
# Command Center poster — invoked by cron and POST /api/run-poster.
# Finds tasks with queued (or retryable failed) ad postings and runs the
# platform posting script for each, recording the result on the task via the
# dashboard API. Separate lockfile from run-worker.sh so posting never blocks
# ad generation.
set -euo pipefail

# Cron's minimal PATH typically lacks node/npm locations.
export PATH="$HOME/.local/bin:$PATH"

# --- Configuration -----------------------------------------------------------
export DASHBOARD_URL="${DASHBOARD_URL:-http://localhost:3000}"
WORKERS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
POSTING_DIR="$WORKERS_DIR/posting"
LOCKFILE="${LOCKFILE:-/tmp/command-center-poster.lock}"
POST_TIMEOUT_SECONDS="${POST_TIMEOUT_SECONDS:-600}"      # per-posting cap
STALE_LOCK_SECONDS="${STALE_LOCK_SECONDS:-1800}"
MAX_ATTEMPTS=3
# Command that posts one ad. Run from $POSTING_DIR with <platform> <taskId>;
# contract: logs on stderr, last stdout line is a JSON PostResult
# {listingUrl, screenshotPath}, non-zero exit with message on stderr on
# failure. Overridable for testing.
POST_CMD="${POST_CMD:-./node_modules/.bin/tsx post.ts}"

# --- Helpers -----------------------------------------------------------------
log() { printf '[%s] %s\n' "$(date -Iseconds)" "$*"; }

api_get() {
  curl -sS --fail --max-time 15 "$@"
}

api_patch() {
  local id="$1"; shift
  local body="$1"; shift
  curl -sS --max-time 15 -X PATCH \
    "${DASHBOARD_URL}/api/tasks/${id}" \
    -H 'Content-Type: application/json' \
    -d "$body" || true
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    log "FATAL: required command '$1' is not on PATH"
    exit 1
  }
}

# Re-fetch the task and rewrite its posting entry for a platform with a jq
# update expression, then PATCH the full postings array back (the API replaces
# the array wholesale). Extra args are passed to jq (e.g. --arg err "...").
patch_posting() {
  local task_id="$1" platform="$2" update="$3"; shift 3
  local task postings
  if ! task=$(api_get "${DASHBOARD_URL}/api/tasks/${task_id}"); then
    log "WARN: could not re-fetch task $task_id to update posting"
    return 1
  fi
  postings=$(echo "$task" | jq -c --arg p "$platform" "$@" \
    ".postings | map(if .platform == \$p then ${update} else . end)")
  api_patch "$task_id" \
    "$(jq -n --argjson postings "$postings" '{postings: $postings}')" >/dev/null
}

# --- Step 1: Lockfile --------------------------------------------------------
exec 200>"$LOCKFILE"
if ! flock -n 200; then
  LOCK_AGE=$(( $(date +%s) - $(stat -c %Y "$LOCKFILE" 2>/dev/null || echo 0) ))
  if [[ $LOCK_AGE -gt $STALE_LOCK_SECONDS ]]; then
    echo "[$(date -Iseconds)] Stale poster lock detected (${LOCK_AGE}s old). Reclaiming."
    fuser -k "$LOCKFILE" 2>/dev/null || true
    sleep 2
    exec 200>"$LOCKFILE"
    flock -n 200 || { echo "Cannot reclaim poster lock. Exiting."; exit 1; }
  else
    # Another poster is running normally — exit silently.
    exit 0
  fi
fi
touch "$LOCKFILE"

# --- Step 2: Logging ---------------------------------------------------------
mkdir -p "$WORKERS_DIR/logs"

# Rotation: prune per-run logs past the retention window; cap poster-cron.log.
LOG_RETENTION_DAYS="${LOG_RETENTION_DAYS:-14}"
find "$WORKERS_DIR/logs" -name 'poster-*.log' -type f -mtime +"$LOG_RETENTION_DAYS" -delete 2>/dev/null || true
POSTER_CRON_LOG="$WORKERS_DIR/logs/poster-cron.log"
if [[ -f "$POSTER_CRON_LOG" && $(stat -c %s "$POSTER_CRON_LOG" 2>/dev/null || echo 0) -gt 1048576 ]]; then
  tail -c 524288 "$POSTER_CRON_LOG" > "${POSTER_CRON_LOG}.tmp" && mv "${POSTER_CRON_LOG}.tmp" "$POSTER_CRON_LOG"
fi

LOG_FILE="$WORKERS_DIR/logs/poster-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$LOG_FILE") 2>&1

log "Poster starting. dashboard=$DASHBOARD_URL"

# --- Step 3: Dependencies ----------------------------------------------------
for cmd in curl jq timeout; do require_cmd "$cmd"; done

# --- Step 4: Fetch postable tasks ---------------------------------------------
if ! TASKS_RESPONSE=$(api_get "${DASHBOARD_URL}/api/tasks?postable=true"); then
  log "ERROR: dashboard not reachable at ${DASHBOARD_URL}/api/tasks"
  exit 0
fi

TASK_IDS=$(echo "$TASKS_RESPONSE" | jq -r '.[].id')
if [[ -z "$TASK_IDS" ]]; then
  log "No postable tasks. Exiting."
  exit 0
fi

# --- Step 5: Process each actionable posting ----------------------------------
POSTED=0
FAILED=0

for TASK_ID in $TASK_IDS; do
  if ! TASK_JSON=$(api_get "${DASHBOARD_URL}/api/tasks/${TASK_ID}"); then
    log "WARN: could not fetch task $TASK_ID — skipping"
    continue
  fi

  # A postable task can still carry exhausted postings (attempts >= MAX);
  # select only the actionable ones.
  PLATFORMS=$(echo "$TASK_JSON" | jq -r --argjson max "$MAX_ATTEMPTS" '
    [.postings[]?
     | select(.status == "queued" or (.status == "failed" and .attempts < $max))
     | .platform]
    | .[]
  ')
  [[ -z "$PLATFORMS" ]] && continue

  for PLATFORM in $PLATFORMS; do
    log "Posting task $TASK_ID to $PLATFORM (claiming)..."
    patch_posting "$TASK_ID" "$PLATFORM" '.status = "posting" | .attempts += 1' || continue

    STDOUT_FILE=$(mktemp) STDERR_FILE=$(mktemp)
    POST_EXIT=0
    ERR_MSG=""
    # POST_CMD is intentionally unquoted: it is a command line, not one word.
    ( cd "$POSTING_DIR" && timeout "$POST_TIMEOUT_SECONDS" $POST_CMD "$PLATFORM" "$TASK_ID" ) \
      >"$STDOUT_FILE" 2>"$STDERR_FILE" || POST_EXIT=$?

    # Mirror the posting script's log output into ours.
    sed 's/^/    | /' "$STDERR_FILE" || true

    LISTING_URL=""
    SCREENSHOT_PATH=""
    if [[ $POST_EXIT -eq 0 ]]; then
      RESULT_JSON=$(tail -n 1 "$STDOUT_FILE")
      LISTING_URL=$(echo "$RESULT_JSON" | jq -r '.listingUrl // empty' 2>/dev/null || true)
      SCREENSHOT_PATH=$(echo "$RESULT_JSON" | jq -r '.screenshotPath // empty' 2>/dev/null || true)
      if [[ -z "$LISTING_URL" ]]; then
        POST_EXIT=1
        ERR_MSG="Posting script exited 0 but returned no listing URL (output: $(echo "$RESULT_JSON" | head -c 300))"
      fi
    elif [[ $POST_EXIT -eq 124 ]]; then
      ERR_MSG="Posting timed out after ${POST_TIMEOUT_SECONDS}s"
    else
      ERR_MSG=$(tail -n 3 "$STDERR_FILE" | tr '\n' ' ' | head -c 500)
      [[ -z "$ERR_MSG" ]] && ERR_MSG="Posting script failed with exit code $POST_EXIT and no error output"
    fi
    rm -f "$STDOUT_FILE" "$STDERR_FILE"

    if [[ $POST_EXIT -eq 0 ]]; then
      patch_posting "$TASK_ID" "$PLATFORM" \
        '.status = "posted" | .postedAt = $ts | .listingUrl = $url | .screenshotPath = $shot | del(.lastError)' \
        --arg ts "$(date -Iseconds)" --arg url "$LISTING_URL" --arg shot "$SCREENSHOT_PATH" || true
      POSTED=$((POSTED + 1))
      log "SUCCESS: $TASK_ID -> $PLATFORM posted at $LISTING_URL"
    else
      patch_posting "$TASK_ID" "$PLATFORM" \
        '.status = "failed" | .lastError = $err' \
        --arg err "$ERR_MSG" || true
      FAILED=$((FAILED + 1))
      log "FAILURE: $TASK_ID -> $PLATFORM: $ERR_MSG"
    fi
  done
done

log "Poster finished. posted=$POSTED failed=$FAILED"
