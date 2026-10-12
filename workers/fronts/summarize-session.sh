#!/usr/bin/env bash
# Summarizes one finished Claude Code session into fronts/memory/ (US-004).
#
#   workers/fronts/summarize-session.sh <transcript.jsonl> <session_id> <cwd>
#
# Prints the memory file path on stdout. Exit 0 and prints nothing when the
# session is skipped (fewer than FRONTS_MIN_TURNS user turns, default 3; cwd
# under /tmp). Exit 2 on failure. Env: FRONTS_SUMMARY_MODEL (haiku),
# FRONTS_SUMMARY_TIMEOUT seconds (180), FRONTS_MAX_CHARS (60000).
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_cmds claude jq timeout

TRANSCRIPT="${1:-}"; SESSION_ID="${2:-}"; CWD="${3:-}"
[[ -f "$TRANSCRIPT" ]] || fail "transcript not found: $TRANSCRIPT"
MODEL="${FRONTS_SUMMARY_MODEL:-haiku}"
TMO="${FRONTS_SUMMARY_TIMEOUT:-180}"
MIN_TURNS="${FRONTS_MIN_TURNS:-3}"

EXTRACT=$("$FRONTS_SCRIPTS_DIR/extract-transcript.sh" "$TRANSCRIPT" "${FRONTS_MAX_CHARS:-60000}")
TURNS=$(jq -r '.user_turns' <<<"$EXTRACT")
[[ -n "$SESSION_ID" ]] || SESSION_ID=$(jq -r '.session_id // "unknown"' <<<"$EXTRACT")
[[ -n "$CWD" ]] || CWD=$(jq -r '.cwd // ""' <<<"$EXTRACT")

if [[ "$TURNS" -lt "$MIN_TURNS" ]]; then
  log "skip $SESSION_ID: $TURNS user turns (< $MIN_TURNS)"; exit 0
fi
case "$CWD" in
  /tmp|/tmp/*) log "skip $SESSION_ID: cwd under /tmp"; exit 0 ;;
esac

SCHEMA='{"type":"object","properties":{
  "summary":{"type":"string","description":"3 to 8 sentences: what the operator was doing, what got done, what state things were left in"},
  "decisions":{"type":"array","items":{"type":"string"}},
  "open_threads":{"type":"array","items":{"type":"string"},"description":"things left unfinished or waiting on someone"},
  "topics":{"type":"array","items":{"type":"string"},"description":"3 to 6 short topic tags"}
},"required":["summary","decisions","open_threads","topics"],"additionalProperties":false}'

PROMPT=$(cat <<EOP
You are writing a memory entry for a session the operator (Daniel) just finished in Claude Code. Write in plain past tense, third person ("Daniel asked for...", "the session built..."). Facts only, no praise. Name files, systems, and people's roles, never credentials. If the session was mostly chatter or exploration, say so in one sentence.

Working directory: $CWD
Files touched: $(jq -r '.files_touched | join(", ")' <<<"$EXTRACT")

Conversation:
$(jq -r '.text' <<<"$EXTRACT")
EOP
)

STRUCTURED=$(printf '%s' "$PROMPT" | claude_structured "$MODEL" "$SCHEMA" "$TMO" --tools "") || fail "summary call failed for $SESSION_ID"

STARTED=$(jq -r '.started_at // ""' <<<"$EXTRACT")
ENDED=$(jq -r '.ended_at // ""' <<<"$EXTRACT")
[[ -n "$ENDED" ]] || ENDED=$(date -u +%Y-%m-%dT%H:%M:%SZ)
STAMP=$(date -d "$ENDED" +%Y-%m-%d-%H%M 2>/dev/null || date +%Y-%m-%d-%H%M)
OUT="$MEMORY_DIR/${STAMP}-${SESSION_ID:0:8}.md"
mkdir -p "$MEMORY_DIR"

{
  echo "---"
  echo "session_id: $SESSION_ID"
  echo "cwd: $CWD"
  echo "started_at: $STARTED"
  echo "ended_at: $ENDED"
  echo "front: unrouted"
  echo "user_turns: $TURNS"
  echo "topics: [$(jq -r '.topics | join(", ")' <<<"$STRUCTURED")]"
  echo "---"
  echo
  jq -r '.summary' <<<"$STRUCTURED"
  if [[ $(jq '.decisions|length' <<<"$STRUCTURED") -gt 0 ]]; then
    echo; echo "## Decisions"; jq -r '.decisions[] | "- " + .' <<<"$STRUCTURED"
  fi
  if [[ $(jq '.open_threads|length' <<<"$STRUCTURED") -gt 0 ]]; then
    echo; echo "## Open threads"; jq -r '.open_threads[] | "- " + .' <<<"$STRUCTURED"
  fi
  FILES=$(jq -r '.files_touched | join(", ")' <<<"$EXTRACT")
  if [[ -n "$FILES" ]]; then echo; echo "## Files touched"; echo "$FILES"; fi
} > "$OUT"

log "wrote $OUT ($TURNS turns, model=$MODEL)"
echo "$OUT"
