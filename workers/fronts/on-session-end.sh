#!/usr/bin/env bash
# Claude Code SessionEnd hook entry point (US-007). Reads the hook JSON on
# stdin, decides in well under a second whether this session is ours to
# process, writes a processed marker, and detaches the real work
# (run-pipeline.sh) so the 1.5 s hook budget is never hit.
#
# Skips when: FRONTS_SKIP=1 is in the environment (every claude -p the worker
# or this pipeline spawns sets it, and hooks inherit the env), the session id
# was already processed, or the transcript is missing.
set -euo pipefail
export PATH="$PATH:$HOME/.local/bin"
[[ "${FRONTS_SKIP:-0}" == "1" ]] && exit 0

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="${FRONTS_STATE_DIR:-$HERE/state}"
LOG_DIR="${FRONTS_LOG_DIR:-$HERE/../logs}"
mkdir -p "$STATE_DIR/processed" "$LOG_DIR"

INPUT=$(cat)
SESSION_ID=$(jq -r '.session_id // empty' <<<"$INPUT" 2>/dev/null || true)
TRANSCRIPT=$(jq -r '.transcript_path // empty' <<<"$INPUT" 2>/dev/null || true)
CWD=$(jq -r '.cwd // empty' <<<"$INPUT" 2>/dev/null || true)
REASON=$(jq -r '.reason // "unknown"' <<<"$INPUT" 2>/dev/null || true)
[[ -n "$SESSION_ID" && -n "$TRANSCRIPT" ]] || exit 0

MARKER="$STATE_DIR/processed/$SESSION_ID"
# mkdir is atomic: a second hook firing for the same session loses the race.
mkdir "$MARKER" 2>/dev/null || exit 0
echo "$(date -Iseconds) reason=$REASON cwd=$CWD" > "$MARKER/info"

if [[ "${FRONTS_INLINE:-0}" == "1" ]]; then
  # Test and debug path: run the pipeline in the foreground.
  "$HERE/run-pipeline.sh" "$TRANSCRIPT" "$SESSION_ID" "$CWD"
  exit 0
fi

setsid nohup "$HERE/run-pipeline.sh" "$TRANSCRIPT" "$SESSION_ID" "$CWD" \
  >> "$LOG_DIR/fronts-pipeline.log" 2>&1 < /dev/null &
disown
exit 0
