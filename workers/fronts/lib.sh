#!/usr/bin/env bash
# Shared bits for the fronts pipeline (specs/fronts.md). Source, don't run.
#
# Every script that sources this exports FRONTS_SKIP=1 so any `claude -p` it
# spawns does not trigger the SessionEnd hook again (hooks inherit the env).
# PATH is appended, never prepended, so a stub `claude` earlier on PATH wins
# in workers/fronts/fronts.test.sh while cron still finds the real one.
set -euo pipefail

export PATH="$PATH:$HOME/.local/bin"
export FRONTS_SKIP=1

FRONTS_SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$FRONTS_SCRIPTS_DIR/../.." && pwd)"
FRONTS_DIR="${FRONTS_DIR:-$PROJECT_ROOT/fronts}"
MEMORY_DIR="$FRONTS_DIR/memory"
REGISTRY_FILE="${FRONTS_REGISTRY:-$PROJECT_ROOT/config/fronts.json}"
STATE_DIR="${FRONTS_STATE_DIR:-$FRONTS_SCRIPTS_DIR/state}"
LOG_DIR="${FRONTS_LOG_DIR:-$PROJECT_ROOT/workers/logs}"
DASHBOARD_URL="${DASHBOARD_URL:-http://localhost:3000}"

mkdir -p "$STATE_DIR" "$LOG_DIR"

log() {
  local line="[$(date -Iseconds)] [$(basename "${BASH_SOURCE[1]:-fronts}")] $*"
  echo "$line" >&2
  echo "$line" >> "$LOG_DIR/fronts-$(date +%Y%m%d).log" 2>/dev/null || true
}

fail() { log "ERROR: $*"; exit 2; }

require_cmds() {
  local c
  for c in "$@"; do
    command -v "$c" >/dev/null 2>&1 || fail "required command '$c' is not on PATH"
  done
}

# AGENT_TOKEN from the environment or the project-root .env.local (never logged).
agent_token() {
  if [[ -n "${AGENT_TOKEN:-}" ]]; then printf '%s' "$AGENT_TOKEN"; return; fi
  local f="$PROJECT_ROOT/.env.local"
  [[ -f "$f" ]] || return 0
  sed -n 's/^\(export \)\{0,1\}AGENT_TOKEN=//p' "$f" | head -1 | sed 's/^"\(.*\)"$/\1/; s/^'"'"'\(.*\)'"'"'$/\1/'
}

# claude_structured <model> <schema-json> <timeout-seconds> [extra claude args...]
# Prompt on stdin. Prints the validated structured_output object, or exits 2.
claude_structured() {
  local model="$1" schema="$2" tmo="$3"; shift 3
  local raw structured
  raw=$(timeout "$tmo" claude -p --model "$model" --output-format json --json-schema "$schema" "$@" 2>/dev/null) || {
    log "claude -p failed (model=$model, exit $?)"; return 2; }
  structured=$(jq -c '.structured_output // empty' <<<"$raw" 2>/dev/null || true)
  if [[ -z "$structured" ]]; then
    log "claude -p returned no structured_output: $(printf '%s' "$raw" | tail -c 300 | tr '\n' ' ')"
    return 2
  fi
  printf '%s' "$structured"
}

# Expand a leading ~ in a path (registry cwdHints are written with ~).
expand_tilde() { printf '%s' "${1/#\~/$HOME}"; }
