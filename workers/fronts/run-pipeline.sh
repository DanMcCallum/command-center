#!/usr/bin/env bash
# The detached session-end chain: summarize -> route -> what's-next per front.
#
#   workers/fronts/run-pipeline.sh <transcript.jsonl> <session_id> <cwd>
#
# FRONTS_DRY_RUN=1 works on a copy of fronts/ under /tmp (reported in the
# log) so a rehearsal never touches the real now.md files; it still posts
# to DASHBOARD_URL, so point that at a temp dev server.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
TRANSCRIPT="${1:-}"; SESSION_ID="${2:-}"; CWD="${3:-}"
[[ -n "$TRANSCRIPT" && -n "$SESSION_ID" ]] || fail "usage: run-pipeline.sh <transcript> <session_id> <cwd>"

if [[ "${FRONTS_DRY_RUN:-0}" == "1" ]]; then
  COPY=$(mktemp -d /tmp/fronts-dry-run-XXXXXX)
  cp -r "$FRONTS_DIR/." "$COPY/"
  export FRONTS_DIR="$COPY"
  log "DRY RUN: working on a copy at $COPY"
fi

# The transcript can lag the final turn by a moment.
[[ "${FRONTS_SETTLE_SECONDS:-3}" == "0" ]] || sleep "${FRONTS_SETTLE_SECONDS:-3}"
[[ -f "$TRANSCRIPT" ]] || fail "transcript not found: $TRANSCRIPT"

log "session $SESSION_ID ended (cwd=$CWD); summarizing"
MEM=$("$FRONTS_SCRIPTS_DIR/summarize-session.sh" "$TRANSCRIPT" "$SESSION_ID" "$CWD") || fail "summarize failed for $SESSION_ID"
[[ -n "$MEM" ]] || { log "session $SESSION_ID skipped by the summarizer"; exit 0; }

mapfile -t ROUTED < <("$FRONTS_SCRIPTS_DIR/route-session.sh" "$MEM") || fail "route failed for $MEM"
if [[ ${#ROUTED[@]} -eq 0 ]]; then
  log "session $SESSION_ID left unrouted; question posted"
  exit 0
fi

STATUS=0
for slug in "${ROUTED[@]}"; do
  "$FRONTS_SCRIPTS_DIR/whats-next.sh" "$slug" "$MEM" || { STATUS=$?; log "what's-next failed for $slug (exit $STATUS)"; }
done
log "session $SESSION_ID done -> ${ROUTED[*]}"
exit $STATUS
