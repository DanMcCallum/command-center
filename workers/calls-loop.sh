#!/usr/bin/env bash
# Ralph loop runner for specs/calls-dashboard.md.
#
# Usage (from the command-center root, inside tmux):
#   workers/calls-loop.sh            # up to 30 iterations
#   workers/calls-loop.sh 5          # up to 5 iterations
#
# Each iteration spawns a fresh `claude -p` with specs/calls-dashboard-loop.md
# as the prompt. The PRD and progress-calls-dashboard.txt are the only memory.
# The loop stops when an iteration appends CALLS DASHBOARD COMPLETE to the
# progress log, or after the iteration cap. FRONTS_SKIP=1 keeps these sessions
# out of the fronts session-end pipeline (see AGENTS.md).

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MAX_ITER="${1:-30}"
MODEL="${CALLS_LOOP_MODEL:-opus}"
PROMPT_FILE="specs/calls-dashboard-loop.md"
PROGRESS="progress-calls-dashboard.txt"
LOG="workers/logs/calls-loop.log"

mkdir -p workers/logs
if [ ! -f "$PROMPT_FILE" ]; then
  echo "missing $PROMPT_FILE" >&2
  exit 1
fi
if ! command -v claude >/dev/null 2>&1; then
  export PATH="$PATH:$HOME/.local/bin"
fi

for i in $(seq 1 "$MAX_ITER"); do
  if grep -q "CALLS DASHBOARD COMPLETE" "$PROGRESS" 2>/dev/null; then
    echo "[$(date -Is)] complete marker found; stopping before iteration $i" | tee -a "$LOG"
    break
  fi
  echo "[$(date -Is)] iteration $i of $MAX_ITER (model $MODEL)" | tee -a "$LOG"
  FRONTS_SKIP=1 claude -p --model "$MODEL" --dangerously-skip-permissions \
    "$(cat "$PROMPT_FILE")" >> "$LOG" 2>&1
  status=$?
  echo "[$(date -Is)] iteration $i exited $status" | tee -a "$LOG"
  if [ "$status" -ne 0 ]; then
    sleep 30
  fi
done

if grep -q "CALLS DASHBOARD COMPLETE" "$PROGRESS" 2>/dev/null; then
  echo "[$(date -Is)] CALLS DASHBOARD COMPLETE" | tee -a "$LOG"
else
  echo "[$(date -Is)] stopped without the complete marker; read $PROGRESS" | tee -a "$LOG"
fi
