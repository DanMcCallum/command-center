#!/usr/bin/env bash
# Pull recent Dialpad call transcripts into voice/raw/.
# Idempotent: skips calls already on disk. Re-run safely (e.g. weekly cron).
#
# Env overrides:
#   DAYS_BACK         (default 90)
#   MIN_DURATION_SEC  (default 60) — skip calls shorter than this
#   QUEUE_CLEAN       (default 1)  — POST a clean-voice task when new files land
#   DASHBOARD_URL     (default http://localhost:3000)
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RAW_DIR="$PROJECT_ROOT/voice/raw"

if [[ -f "$PROJECT_ROOT/.env.local" ]]; then
  set -a; source "$PROJECT_ROOT/.env.local"; set +a
fi
: "${DIALPAD_API_KEY:?DIALPAD_API_KEY missing from .env.local}"
: "${DIALPAD_API_BASE:=https://dialpad.com/api/v2}"

DAYS_BACK="${DAYS_BACK:-90}"
MIN_DURATION_SEC="${MIN_DURATION_SEC:-60}"
MIN_DURATION_MS=$((MIN_DURATION_SEC * 1000))
DASHBOARD_URL="${DASHBOARD_URL:-http://localhost:3000}"
QUEUE_CLEAN="${QUEUE_CLEAN:-1}"

mkdir -p "$RAW_DIR"

NOW_MS=$(($(date +%s) * 1000))
START_MS=$((NOW_MS - DAYS_BACK * 86400 * 1000))

log() { printf '[%s] %s\n' "$(date -Iseconds)" "$*" >&2; }

log "Fetching Dialpad calls (last ${DAYS_BACK}d, min ${MIN_DURATION_SEC}s)"

fetched=0
skipped_short=0
skipped_existing=0
no_transcript=0
total_examined=0
cursor=""

while :; do
  if [[ -n "$cursor" ]]; then
    url="${DIALPAD_API_BASE}/call?limit=50&started_after=${START_MS}&cursor=${cursor}"
  else
    url="${DIALPAD_API_BASE}/call?limit=50&started_after=${START_MS}"
  fi

  resp=$(curl -sS --max-time 30 \
    -H "Authorization: Bearer ${DIALPAD_API_KEY}" \
    "$url")

  page_count=$(echo "$resp" | jq '.items | length')
  total_examined=$((total_examined + page_count))

  if [[ "$page_count" -eq 0 ]]; then
    break
  fi

  while IFS= read -r call; do
    call_id=$(echo "$call" | jq -r '.call_id')
    duration_ms=$(echo "$call" | jq -r '.duration | floor')
    date_started=$(echo "$call" | jq -r '.date_started')
    direction=$(echo "$call" | jq -r '.direction')
    contact_name=$(echo "$call" | jq -r '.contact.name // "unknown"')

    date_iso=$(date -d "@$((date_started / 1000))" +%Y-%m-%d)
    out_file="${RAW_DIR}/${date_iso}-${call_id}.txt"

    if [[ "$duration_ms" -lt "$MIN_DURATION_MS" ]]; then
      skipped_short=$((skipped_short + 1))
      continue
    fi
    if [[ -f "$out_file" ]]; then
      skipped_existing=$((skipped_existing + 1))
      continue
    fi

    trans=$(curl -sS --max-time 30 \
      -H "Authorization: Bearer ${DIALPAD_API_KEY}" \
      "${DIALPAD_API_BASE}/transcripts/${call_id}")

    line_count=$(echo "$trans" | jq '(.lines // []) | map(select(.type == "transcript")) | length')

    if [[ "$line_count" -eq 0 ]]; then
      no_transcript=$((no_transcript + 1))
      continue
    fi

    {
      printf '# Call %s\n' "$call_id"
      printf '# Date: %s\n' "$date_iso"
      printf '# Direction: %s\n' "$direction"
      printf '# Duration: %ss\n' "$((duration_ms / 1000))"
      printf '# Contact: %s\n' "$contact_name"
      printf '\n'
      echo "$trans" | jq -r '
        .lines
        | map(select(.type == "transcript"))
        | .[]
        | "\(.name): \(.content)"
      '
    } > "$out_file"

    fetched=$((fetched + 1))
    log "  + ${date_iso}-${call_id} (${direction}, $((duration_ms / 1000))s, ${line_count} lines)"
  done < <(echo "$resp" | jq -c '.items[]')

  cursor=$(echo "$resp" | jq -r '.cursor // empty')
  [[ -z "$cursor" ]] && break
done

log "Done. examined=${total_examined} fetched=${fetched} skipped_short=${skipped_short} skipped_existing=${skipped_existing} no_transcript=${no_transcript}"

if [[ "$QUEUE_CLEAN" == "1" && "$fetched" -gt 0 ]]; then
  log "Queuing clean-voice task on dashboard…"
  task_body=$(jq -n --argjson n "$fetched" '{
    title: "Clean voice transcripts (\($n) new)",
    description: "Process new files in voice/raw/ into voice/clean/ using the clean-voice workflow.",
    type: "Content",
    priority: 2,
    model: "sonnet",
    slashCommand: "clean-voice",
    tags: ["voice"]
  }')
  task_resp=$(curl -sS --max-time 15 -X POST "${DASHBOARD_URL}/api/tasks" \
    -H 'Content-Type: application/json' \
    -d "$task_body" || true)
  task_id=$(echo "$task_resp" | jq -r '.id // empty' 2>/dev/null || true)
  if [[ -n "$task_id" ]]; then
    log "  task created: ${task_id}"
    curl -sS --max-time 15 -X POST "${DASHBOARD_URL}/api/run-worker" >/dev/null || true
  else
    log "  WARNING: task creation may have failed. Response: ${task_resp}"
  fi
fi
