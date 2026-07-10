#!/usr/bin/env bash
# Command Center worker — invoked by cron.
# Picks the highest-priority pending task, hands it to Claude, and updates
# the task with the result. See specs in the project root for the full design.
set -euo pipefail

# Cron's minimal PATH typically lacks ~/.local/bin where `claude` lives.
export PATH="$HOME/.local/bin:$PATH"

# --- Configuration -----------------------------------------------------------
DASHBOARD_URL="${DASHBOARD_URL:-http://localhost:3000}"
WORKERS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$WORKERS_DIR/.." && pwd)"
LOCKFILE="${LOCKFILE:-/tmp/command-center-worker.lock}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-1800}"      # 30 minutes
STALE_LOCK_SECONDS="${STALE_LOCK_SECONDS:-2100}" # 35 minutes
SLASH_COMMANDS_DIR="${SLASH_COMMANDS_DIR:-$HOME/.claude/commands}"

# Slash commands whose tasks should auto-complete (skip needs_review).
AUTO_COMPLETE_COMMANDS=()

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

# --- Step 1: Lockfile --------------------------------------------------------
exec 200>"$LOCKFILE"
if ! flock -n 200; then
  LOCK_AGE=$(( $(date +%s) - $(stat -c %Y "$LOCKFILE" 2>/dev/null || echo 0) ))
  if [[ $LOCK_AGE -gt $STALE_LOCK_SECONDS ]]; then
    echo "[$(date -Iseconds)] Stale lock detected (${LOCK_AGE}s old). Reclaiming."
    fuser -k "$LOCKFILE" 2>/dev/null || true
    sleep 2
    exec 200>"$LOCKFILE"
    flock -n 200 || { echo "Cannot reclaim lock. Exiting."; exit 1; }
  else
    # Another worker is running normally — exit silently.
    exit 0
  fi
fi
touch "$LOCKFILE"

# --- Step 2: Logging ---------------------------------------------------------
mkdir -p "$WORKERS_DIR/logs"

# Rotation: prune per-run logs past the retention window; cap cron.log at ~1 MB.
LOG_RETENTION_DAYS="${LOG_RETENTION_DAYS:-14}"
find "$WORKERS_DIR/logs" -name 'worker-*.log' -type f -mtime +"$LOG_RETENTION_DAYS" -delete 2>/dev/null || true
CRON_LOG="$WORKERS_DIR/logs/cron.log"
if [[ -f "$CRON_LOG" && $(stat -c %s "$CRON_LOG" 2>/dev/null || echo 0) -gt 1048576 ]]; then
  tail -c 524288 "$CRON_LOG" > "${CRON_LOG}.tmp" && mv "${CRON_LOG}.tmp" "$CRON_LOG"
fi

LOG_FILE="$WORKERS_DIR/logs/worker-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$LOG_FILE") 2>&1

log "Worker starting. project=$PROJECT_ROOT dashboard=$DASHBOARD_URL"

# --- Step 3: Dependencies ----------------------------------------------------
for cmd in curl jq claude timeout; do require_cmd "$cmd"; done

# --- Helper: update worker-state last-run regardless of outcome --------------
update_worker_state() {
  local task_id="${1:-}"
  local body
  if [[ -n "$task_id" ]]; then
    body=$(jq -n --arg ts "$(date -Iseconds)" --arg id "$task_id" \
      '{lastRun: $ts, lastTaskId: $id}')
  else
    body=$(jq -n --arg ts "$(date -Iseconds)" '{lastRun: $ts}')
  fi
  curl -sS --max-time 10 -X PUT "${DASHBOARD_URL}/api/worker-state" \
    -H 'Content-Type: application/json' -d "$body" >/dev/null || true
}

# --- Step 4: Fetch tasks -----------------------------------------------------
if ! TASKS_RESPONSE=$(api_get "${DASHBOARD_URL}/api/tasks"); then
  log "ERROR: dashboard not reachable at ${DASHBOARD_URL}/api/tasks"
  update_worker_state ""
  exit 0
fi

# --- Step 5: Select highest-priority pending task respecting dependencies ----
BLOCKED_PARENTS=$(echo "$TASKS_RESPONSE" | jq -c \
  '[.[] | select(.status == "pending" or .status == "in_progress") | .id]')

TASK_JSON=$(echo "$TASKS_RESPONSE" | jq -c --argjson blocked "$BLOCKED_PARENTS" '
  [
    .[]
    | select(.status == "pending")
    | select(
        (.parentTaskId == null) or (.parentTaskId == "")
        or (([.parentTaskId] | inside($blocked)) | not)
      )
  ]
  | sort_by(.priority, .createdAt)
  | first
  // empty
')

if [[ -z "$TASK_JSON" || "$TASK_JSON" == "null" ]]; then
  log "No eligible pending tasks. Exiting."
  update_worker_state ""
  exit 0
fi

TASK_ID=$(echo "$TASK_JSON" | jq -r '.id')
TASK_TITLE=$(echo "$TASK_JSON" | jq -r '.title')
TASK_DESCRIPTION=$(echo "$TASK_JSON" | jq -r '.description // ""')
TASK_PRIORITY=$(echo "$TASK_JSON" | jq -r '.priority')
TASK_MODEL=$(echo "$TASK_JSON" | jq -r '.model // "sonnet"')
TASK_SLASH_COMMAND=$(echo "$TASK_JSON" | jq -r '.slashCommand // ""')
TASK_SESSION_ID=$(echo "$TASK_JSON" | jq -r '.claudeSessionId // ""')
TASK_NOTES=$(echo "$TASK_JSON" | jq -r '.claudeNotes // ""')
TASK_CRITERIA=$(echo "$TASK_JSON" | jq -r '
  if (.acceptanceCriteria | length) == 0 then "_(none specified)_"
  else (.acceptanceCriteria | map("- " + .) | join("\n"))
  end
')

log "Selected task: $TASK_ID (P$TASK_PRIORITY) — $TASK_TITLE"

# --- Step 6: Claim the task --------------------------------------------------
api_patch "$TASK_ID" "$(jq -n --arg ts "$(date -Iseconds)" \
  '{status: "in_progress", startedAt: $ts}')" >/dev/null

# --- Step 7: Workspace -------------------------------------------------------
OUTPUT_DIR="$WORKERS_DIR/workspace/outputs/${TASK_ID}"
NOTES_FILE="$WORKERS_DIR/workspace/notes/${TASK_ID}.md"
mkdir -p "$OUTPUT_DIR" "$(dirname "$NOTES_FILE")"

# Update workspacePath on the task so the dashboard knows where to look.
api_patch "$TASK_ID" "$(jq -n --arg p "workers/workspace/outputs/${TASK_ID}" \
  '{workspacePath: $p}')" >/dev/null

# --- Step 8: Build the prompt ------------------------------------------------
SYSTEM_PROMPT_FILE="${WORKERS_DIR}/system-prompt.md"
SYSTEM_PROMPT=$(cat "$SYSTEM_PROMPT_FILE")

REVISION_BLOCK=""
if [[ "$TASK_NOTES" == \[REVISION\ REQUESTED\]* ]]; then
  REV_FEEDBACK="${TASK_NOTES#\[REVISION REQUESTED\]}"
  REV_FEEDBACK="${REV_FEEDBACK# }"
  REVISION_BLOCK=$(cat <<EOF

## REVISION REQUESTED

The operator reviewed your previous output and is requesting changes.
Address this feedback:

${REV_FEEDBACK}

Previous output is in: ${OUTPUT_DIR}
Revise the existing deliverable — do not start from scratch.
EOF
)
fi

WORKFLOW_BLOCK=""
if [[ -n "$TASK_SLASH_COMMAND" ]]; then
  WORKFLOW_FILE="${SLASH_COMMANDS_DIR}/${TASK_SLASH_COMMAND}.md"
  if [[ -f "$WORKFLOW_FILE" ]]; then
    # Strip leading YAML frontmatter (--- ... ---) so skill-control fields
    # like `disable-model-invocation` don't leak into the prompt.
    WORKFLOW_CONTENT=$(awk '
      BEGIN { in_fm = 0; done = 0 }
      NR == 1 && /^---[[:space:]]*$/ { in_fm = 1; next }
      in_fm && /^---[[:space:]]*$/ { in_fm = 0; done = 1; next }
      in_fm { next }
      { print }
    ' "$WORKFLOW_FILE")
    WORKFLOW_BLOCK=$(printf '\n## Workflow\n\n%s\n' "$WORKFLOW_CONTENT")
  else
    log "WARN: slashCommand '${TASK_SLASH_COMMAND}' has no file at $WORKFLOW_FILE"
  fi
fi

UPDATE_HINT="curl -s -X PATCH ${DASHBOARD_URL}/api/tasks/${TASK_ID} -H 'Content-Type: application/json' -d '{\"status\":\"needs_review\",\"claudeNotes\":\"<summary>\",\"completionFile\":\"<path>\"}'"

PROMPT=$(cat <<EOF
# ${TASK_TITLE}

${TASK_DESCRIPTION}

## Acceptance Criteria
${TASK_CRITERIA}
${REVISION_BLOCK}${WORKFLOW_BLOCK}

---

## Output
- Deliverables directory: ${OUTPUT_DIR}
- Notes file: ${NOTES_FILE}
- When done, update the task via the API:
  ${UPDATE_HINT}
EOF
)

# --- Step 9: Spawn Claude ----------------------------------------------------
CLAUDE_ARGS=(
  -p
  --dangerously-skip-permissions
  --output-format json
  --model "$TASK_MODEL"
  --append-system-prompt "$SYSTEM_PROMPT"
)

if [[ -n "$TASK_SESSION_ID" ]]; then
  CLAUDE_ARGS+=(--resume "$TASK_SESSION_ID")
  log "Resuming Claude session $TASK_SESSION_ID"
fi

log "Spawning Claude (model=$TASK_MODEL, timeout=${TIMEOUT_SECONDS}s)"
CLAUDE_EXIT=0
CLAUDE_OUTPUT=$(timeout "$TIMEOUT_SECONDS" claude "${CLAUDE_ARGS[@]}" "$PROMPT" 2>&1) || CLAUDE_EXIT=$?

# --- Step 10: Capture session id ---------------------------------------------
NEW_SESSION_ID=""
if [[ -n "$CLAUDE_OUTPUT" ]]; then
  NEW_SESSION_ID=$(echo "$CLAUDE_OUTPUT" | jq -r '.session_id // empty' 2>/dev/null || true)
fi
if [[ -n "$NEW_SESSION_ID" ]]; then
  api_patch "$TASK_ID" "$(jq -n --arg sid "$NEW_SESSION_ID" '{claudeSessionId: $sid}')" >/dev/null
fi

# --- Step 11: Handle outcome -------------------------------------------------
if [[ $CLAUDE_EXIT -ne 0 ]]; then
  ERROR_NOTE="Worker failed with exit code $CLAUDE_EXIT."
  if [[ $CLAUDE_EXIT -eq 124 ]]; then
    ERROR_NOTE="Worker timed out after ${TIMEOUT_SECONDS} seconds."
  fi
  log "FAILURE: $ERROR_NOTE"
  # Append last 1000 chars of Claude output for debugging.
  if [[ -n "$CLAUDE_OUTPUT" ]]; then
    TAIL=$(echo "$CLAUDE_OUTPUT" | tail -c 1000)
    ERROR_NOTE="$ERROR_NOTE Last output: $TAIL"
  fi
  api_patch "$TASK_ID" "$(jq -n --arg note "$ERROR_NOTE" \
    '{status: "pending", claudeNotes: $note}')" >/dev/null
  update_worker_state "$TASK_ID"
  exit 0
fi

# --- Success path ------------------------------------------------------------
# Find the primary completion file in the output directory.
COMPLETION_FILE=""
for candidate in "$OUTPUT_DIR"/README.md "$OUTPUT_DIR"/index.* "$OUTPUT_DIR"/report.* "$OUTPUT_DIR"/output.*; do
  if [[ -f "$candidate" ]]; then
    COMPLETION_FILE="workers/workspace/outputs/${TASK_ID}/$(basename "$candidate")"
    break
  fi
done
if [[ -z "$COMPLETION_FILE" ]]; then
  FIRST_FILE=$(find "$OUTPUT_DIR" -maxdepth 1 -type f 2>/dev/null | head -n 1)
  if [[ -n "$FIRST_FILE" ]]; then
    COMPLETION_FILE="workers/workspace/outputs/${TASK_ID}/$(basename "$FIRST_FILE")"
  fi
fi

CLAUDE_NOTES="Task completed. Check the output directory."
if [[ -f "$NOTES_FILE" ]]; then
  CLAUDE_NOTES=$(head -c 2000 "$NOTES_FILE")
fi

# Pull current task state so we don't clobber values Claude already set.
EXISTING=$(api_get "${DASHBOARD_URL}/api/tasks/${TASK_ID}" || echo '{}')
EXISTING_COMPLETION=$(echo "$EXISTING" | jq -r '.completionFile // ""')
EXISTING_NOTES=$(echo "$EXISTING" | jq -r '
  if .claudeNotes == null or .claudeNotes == "" then ""
  elif (.claudeNotes | startswith("[REVISION REQUESTED]")) then ""
  else .claudeNotes
  end
')
EXISTING_STATUS=$(echo "$EXISTING" | jq -r '.status // ""')

FINAL_COMPLETION="${EXISTING_COMPLETION:-$COMPLETION_FILE}"
FINAL_NOTES="${EXISTING_NOTES:-$CLAUDE_NOTES}"

# Auto-complete logic.
FINAL_STATUS="needs_review"
for cmd in "${AUTO_COMPLETE_COMMANDS[@]:-}"; do
  if [[ -n "$cmd" && "$TASK_SLASH_COMMAND" == "$cmd" ]]; then
    FINAL_STATUS="completed"
    break
  fi
done

# If Claude already moved the task to completed (and that's allowed), respect it.
if [[ "$EXISTING_STATUS" == "completed" && "$FINAL_STATUS" == "completed" ]]; then
  FINAL_STATUS="completed"
fi

UPDATE_BODY=$(jq -n \
  --arg status "$FINAL_STATUS" \
  --arg completion "$FINAL_COMPLETION" \
  --arg notes "$FINAL_NOTES" \
  '{status: $status, completionFile: (if $completion == "" then null else $completion end), claudeNotes: $notes}')

if [[ "$FINAL_STATUS" == "completed" ]]; then
  UPDATE_BODY=$(echo "$UPDATE_BODY" | jq --arg ts "$(date -Iseconds)" '. + {completedAt: $ts}')
fi

api_patch "$TASK_ID" "$UPDATE_BODY" >/dev/null
log "SUCCESS: task $TASK_ID -> $FINAL_STATUS"

# --- Step 12: Update cron config ---------------------------------------------
update_worker_state "$TASK_ID"

log "Worker finished cleanly."
