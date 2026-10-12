#!/usr/bin/env bash
# What's-next pass for one front (US-006): rewrites fronts/<slug>/now.md and
# posts suggestions and questions to the dashboard review bin.
#
#   workers/fronts/whats-next.sh <slug> [memory-file ...]
#
# Memory files given here are "the sessions that just ended"; when none is
# given (the dashboard's Refresh button) the latest for the front is used.
# Per-front lock: a run that finds the lock held appends its memory files to
# locks/<slug>.pending and exits 0; the holder picks them up before it
# finishes, so every session is seen and nothing runs twice at once.
# Env: FRONTS_NEXT_MODEL (opus), FRONTS_NEXT_TIMEOUT seconds (600),
# FRONTS_NEXT_HISTORY (5 previous memory files), FRONTS_NEXT_TOOLS
# ("Read,Grep,Glob").
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_cmds claude jq curl flock

SLUG="${1:-}"; shift || true
[[ -n "$SLUG" ]] || fail "usage: whats-next.sh <slug> [memory-file ...]"
jq -e --arg s "$SLUG" '.fronts[] | select(.slug == $s and .enabled != false)' "$REGISTRY_FILE" >/dev/null 2>&1 \
  || fail "unknown or disabled front: $SLUG"
NAME=$(jq -r --arg s "$SLUG" '.fronts[] | select(.slug == $s) | .name' "$REGISTRY_FILE")
FRONT_DIR="$FRONTS_DIR/$SLUG"
NORTH="$FRONT_DIR/north-star.md"; NOW="$FRONT_DIR/now.md"
[[ -f "$NORTH" ]] || fail "missing $NORTH"
MODEL="${FRONTS_NEXT_MODEL:-opus}"; TMO="${FRONTS_NEXT_TIMEOUT:-600}"
HISTORY="${FRONTS_NEXT_HISTORY:-5}"; TOOLS="${FRONTS_NEXT_TOOLS:-Read,Grep,Glob}"
LOCK_DIR="${FRONTS_LOCK_DIR:-$FRONTS_SCRIPTS_DIR/locks}"; mkdir -p "$LOCK_DIR"
LOCK="$LOCK_DIR/$SLUG.lock"; PENDING="$LOCK_DIR/$SLUG.pending"
TOKEN=$(agent_token)
[[ -n "$TOKEN" ]] || fail "AGENT_TOKEN is not set (env or project-root .env.local)"

exec 9>"$LOCK"
if ! flock -n 9; then
  for f in "$@"; do echo "$f" >> "$PENDING"; done
  log "$SLUG busy; queued ${#@} file(s) for the running pass"
  exit 0
fi

# Memory for this front, newest first (file names start with the date).
front_memory() {
  grep -lE "^front: .*(\[|, )?${SLUG}(\]|,|$)" "$MEMORY_DIR"/*.md 2>/dev/null | sort -r || true
}

post_items() {  # post_items <json-array>
  curl -sS -o /dev/null -X POST "$DASHBOARD_URL/api/fronts/suggestions" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' --data "$1" 2>/dev/null
}

post_failure_question() {  # post_failure_question <reason>
  post_items "$(jq -n --arg front "$SLUG" --arg title "What's-next failed for $SLUG" \
    --arg body "The what's-next pass could not run: $1. now.md was left untouched. Fix the cause and press Refresh on the front page." \
    '[{frontSlug: $front, kind: "question", title: $title, body: $body}]')" \
    || log "could not post the failure question for $SLUG"
}

run_pass() {  # run_pass <new memory files...>
  local new=("$@") all prev=() f
  mapfile -t all < <(front_memory)
  if [[ ${#new[@]} -eq 0 && ${#all[@]} -gt 0 ]]; then new=("${all[0]}"); fi
  for f in "${all[@]}"; do
    local skip=0 n
    for n in "${new[@]}"; do [[ "$f" == "$n" ]] && skip=1; done
    [[ $skip -eq 0 ]] && prev+=("$f")
    [[ ${#prev[@]} -ge $HISTORY ]] && break
  done

  local now_text="" answers=""
  [[ -f "$NOW" ]] && now_text=$(cat "$NOW")
  answers=$(awk '/^## Answers from Daniel/{on=1} on && /^## / && !/^## Answers from Daniel/{exit} on{print}' "$NOW" 2>/dev/null || true)

  local prompt
  prompt=$(
    cat "$FRONTS_SCRIPTS_DIR/whats-next-prompt.md"
    echo; echo "# Front: $NAME ($SLUG)"; echo
    echo "## north-star.md (ground truth, never edit)"; echo; cat "$NORTH"; echo
    echo "## now.md (before this session)"; echo; printf '%s\n' "${now_text:-(empty)}"; echo
    if [[ ${#new[@]} -gt 0 ]]; then
      echo "## Session(s) that just ended"; echo
      for f in "${new[@]}"; do [[ -f "$f" ]] && { echo "### $(basename "$f")"; cat "$f"; echo; }; done
    else
      echo "## Session(s) that just ended"; echo; echo "(none: this is a manual refresh)"; echo
    fi
    echo "## Earlier sessions on this front (newest first)"; echo
    if [[ ${#prev[@]} -eq 0 ]]; then echo "(none)"; fi
    for f in "${prev[@]}"; do echo "### $(basename "$f")"; cat "$f"; echo; done
  )

  local schema='{"type":"object","properties":{
    "now_md":{"type":"string","description":"markdown with ## Where we are, ## Next for Daniel, ## Candidate agent work, ## Open questions"},
    "suggestions":{"type":"array","items":{"type":"object","properties":{
      "title":{"type":"string"},"prompt":{"type":"string"},
      "type":{"type":"string","enum":["Research","Content","Coaching","Building","Outreach","Admin"]},
      "model":{"type":"string","enum":["sonnet","opus","haiku"]},
      "slashCommand":{"type":"string"}},
      "required":["title","prompt","type","model"],"additionalProperties":false}},
    "questions":{"type":"array","items":{"type":"object","properties":{
      "question":{"type":"string"},"why_it_matters":{"type":"string"}},
      "required":["question","why_it_matters"],"additionalProperties":false}}
  },"required":["now_md","suggestions","questions"],"additionalProperties":false}'

  local structured
  if ! structured=$(cd "$PROJECT_ROOT" && printf '%s' "$prompt" | claude_structured "$MODEL" "$schema" "$TMO" --tools "$TOOLS"); then
    log "what's-next call failed for $SLUG; now.md untouched"
    post_failure_question "the $MODEL call failed or returned no structured output"
    return 2
  fi

  # Compose now.md: our header sections, the model's sections (minus any it
  # produced that belong to us), then the preserved Answers section.
  local body last yesterday_lines="" y f
  body=$(jq -r '.now_md' <<<"$structured" | awk '
    /^# /{next}
    /^## (Last session|Yesterday|Answers from Daniel)/{skip=1; next}
    /^## /{skip=0}
    !skip{print}')
  if [[ ${#new[@]} -gt 0 && -f "${new[0]}" ]]; then
    last="$(sed -n 's/^ended_at: *//p' "${new[0]}" | head -1 | cut -c1-16 | tr T ' ') ($(basename "${new[0]}")): $(awk '/^---$/{i++; next} i>=2 && NF {print; exit}' "${new[0]}")"
  else
    last="(manual refresh, no new session)"
  fi
  y=$(date -d yesterday +%Y-%m-%d)
  for f in $(front_memory); do
    [[ "$(basename "$f")" == "$y-"* ]] || continue
    yesterday_lines+="- $(awk '/^---$/{i++; next} i>=2 && NF {print; exit}' "$f")"$'\n'
  done
  [[ -n "$yesterday_lines" ]] || yesterday_lines="(no sessions yesterday)"$'\n'
  local tmp="$NOW.tmp.$$"
  {
    echo "# $NAME: now"; echo
    echo "## Last session"; echo "$last"; echo
    echo "## Yesterday"; printf '%s\n' "$yesterday_lines" | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}'; echo
    printf '%s\n' "$body" | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}'; echo
    if [[ -n "$answers" ]]; then printf '%s\n' "$answers"; else echo "## Answers from Daniel"; echo "(none yet)"; fi
  } > "$tmp"
  mv "$tmp" "$NOW"
  log "wrote $NOW (model=$MODEL, new=${#new[@]}, history=${#prev[@]})"

  local sid="" src=""
  if [[ ${#new[@]} -gt 0 && -f "${new[0]}" ]]; then
    sid=$(sed -n 's/^session_id: *//p' "${new[0]}" | head -1); src=$(basename "${new[0]}")
  fi
  local items
  items=$(jq -c --arg front "$SLUG" --arg sid "$sid" --arg src "$src" '
    [ (.suggestions[] | {frontSlug: $front, kind: "task", title: .title, body: .prompt, type: .type, model: .model,
        slashCommand: (.slashCommand // null), sourceSessionId: (if $sid == "" then null else $sid end),
        sourceMemoryFile: (if $src == "" then null else $src end)}),
      (.questions[] | {frontSlug: $front, kind: "question", title: .question, body: .why_it_matters,
        sourceSessionId: (if $sid == "" then null else $sid end), sourceMemoryFile: (if $src == "" then null else $src end)}) ]' <<<"$structured")
  if [[ "$(jq 'length' <<<"$items")" -gt 0 ]]; then
    post_items "$items" && log "posted $(jq 'length' <<<"$items") item(s) for $SLUG" || log "could not post suggestions for $SLUG"
  fi
}

STATUS=0
run_pass "$@" || STATUS=$?
# Anything queued while we ran gets one more pass.
while [[ -s "$PENDING" ]]; do
  mapfile -t queued < "$PENDING"; : > "$PENDING"
  log "running queued pass for $SLUG (${#queued[@]} file(s))"
  run_pass "${queued[@]}" || STATUS=$?
done
exit $STATUS
