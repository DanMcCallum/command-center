#!/usr/bin/env bash
# Routes one memory file to its front(s) (US-005).
#
#   workers/fronts/route-session.sh <memory-file>
#
# Asks POST $DASHBOARD_URL/api/fronts/route (Jev, then haiku, then cwd), then
# decides here: top pick >= FRONTS_ROUTE_MIN (0.6) routes; a second pick
# > FRONTS_ROUTE_SECOND (0.3) routes too; otherwise the file stays
# `front: unrouted` and a question is posted to the review bin. Rewrites the
# `front:` line of the memory file and prints the routed slugs, one per line
# (nothing when unrouted).
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_cmds jq curl

FILE="${1:-}"
[[ -f "$FILE" ]] || fail "memory file not found: $FILE"
MIN="${FRONTS_ROUTE_MIN:-0.6}"; SECOND="${FRONTS_ROUTE_SECOND:-0.3}"

TOKEN=$(agent_token)
[[ -n "$TOKEN" ]] || fail "AGENT_TOKEN is not set (env or project-root .env.local)"

# Frontmatter and body.
FM=$(sed -n '/^---$/,/^---$/{ /^---$/d; p; }' "$FILE")
BODY=$(awk '/^---$/{i++; next} i>=2' "$FILE")
SESSION_ID=$(sed -n 's/^session_id: *//p' <<<"$FM" | head -1)
CWD=$(sed -n 's/^cwd: *//p' <<<"$FM" | head -1)
FILES=$(awk '/^## Files touched/{getline; print; exit}' "$FILE" | tr ',' '\n' | sed 's/^ *//; s/ *$//' | jq -R . | jq -s 'map(select(length>0))')

REQ=$(jq -n --arg summary "$BODY" --arg cwd "$CWD" --argjson files "$FILES" \
  '{summary: $summary, cwd: (if $cwd == "" then null else $cwd end), filesTouched: $files}')
RESP=$(curl -sS -X POST "$DASHBOARD_URL/api/fronts/route" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  --data "$REQ" 2>/dev/null) || fail "route request failed for $FILE"
jq -e '.fronts' <<<"$RESP" >/dev/null 2>&1 || fail "route response malformed: $(printf '%s' "$RESP" | head -c 200)"

METHOD=$(jq -r '.method' <<<"$RESP")
TOP_SLUG=$(jq -r '.fronts[0].slug // ""' <<<"$RESP")
TOP_P=$(jq -r '.fronts[0].probability // 0' <<<"$RESP")
SEC_SLUG=$(jq -r '.fronts[1].slug // ""' <<<"$RESP")
SEC_P=$(jq -r '.fronts[1].probability // 0' <<<"$RESP")

ROUTED=()
if [[ -n "$TOP_SLUG" ]] && jq -en --argjson p "$TOP_P" --argjson m "$MIN" '$p >= $m' >/dev/null; then
  ROUTED+=("$TOP_SLUG")
  if [[ -n "$SEC_SLUG" ]] && jq -en --argjson p "$SEC_P" --argjson m "$SECOND" '$p > $m' >/dev/null; then
    ROUTED+=("$SEC_SLUG")
  fi
fi

set_front_line() {
  local value="$1" tmp="$FILE.tmp.$$"
  if grep -q '^front:' "$FILE"; then
    sed "s|^front: .*|front: $value|" "$FILE" > "$tmp"
  else
    awk -v v="front: $value" 'BEGIN{n=0} /^---$/{n++; if(n==2){print v}} {print}' "$FILE" > "$tmp"
  fi
  mv "$tmp" "$FILE"
}

if [[ ${#ROUTED[@]} -eq 0 ]]; then
  set_front_line "unrouted"
  log "unrouted $(basename "$FILE") (method=$METHOD top=$TOP_SLUG@$TOP_P)"
  # Ask the operator instead of guessing. Posted under the top candidate when
  # there is one so it shows up somewhere; the answer lands in that front's now.md.
  ASK_FRONT="${TOP_SLUG:-$(jq -r '.fronts[0].slug' "$REGISTRY_FILE")}"
  Q=$(jq -n --arg front "$ASK_FRONT" --arg sid "$SESSION_ID" --arg file "$(basename "$FILE")" \
        --arg title "Which front was this session about? ($(basename "$FILE"))" \
        --arg body "$(printf 'The router could not place this session (method %s, best guess %s at %s).\n\n%s' "$METHOD" "${TOP_SLUG:-none}" "$TOP_P" "$BODY")" \
        '[{frontSlug: $front, kind: "question", title: $title, body: $body, sourceSessionId: $sid, sourceMemoryFile: $file}]')
  curl -sS -o /dev/null -X POST "$DASHBOARD_URL/api/fronts/suggestions" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' --data "$Q" 2>/dev/null \
    || log "could not post the routing question for $FILE"
  exit 0
fi

set_front_line "[$(IFS=,; echo "${ROUTED[*]}" | sed 's/,/, /g')]"
log "routed $(basename "$FILE") -> ${ROUTED[*]} (method=$METHOD top=$TOP_P second=$SEC_P)"
printf '%s\n' "${ROUTED[@]}"
