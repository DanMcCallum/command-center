#!/usr/bin/env bash
# DREAMS scorer: grades ONE platform ad file (headline and description
# separately, 1 to 10 each) in a fresh, tool-less `claude -p` session that
# sees only the rubric, the platform's constraints, and the copy.
#
#   workers/dreams-score.sh <platform_key> <ad-file.md> [--out <scores.json>]
#
# Prints the score JSON to stdout (and to --out when given). Exit codes:
#   0  both scores >= threshold
#   1  at least one score below threshold
#   2  could not score (bad file, missing section, judge call failed)
#
# Env: DREAMS_JUDGE_MODEL (default opus), DREAMS_THRESHOLD (default 9),
#      DREAMS_JUDGE_TIMEOUT seconds (default 300).
set -euo pipefail

# Sessions this script spawns must not trigger the fronts SessionEnd hook
# (workers/fronts/on-session-end.sh); hooks inherit the environment.
export FRONTS_SKIP=1

export PATH="$PATH:$HOME/.local/bin"

WORKERS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$WORKERS_DIR/.." && pwd)"
RUBRIC_FILE="$PROJECT_ROOT/.claude/skills/dreams-ad-review/SKILL.md"
JUDGE_PROMPT_FILE="$WORKERS_DIR/dreams-judge-prompt.md"
PLATFORMS_FILE="$PROJECT_ROOT/config/ad-platforms.json"

JUDGE_MODEL="${DREAMS_JUDGE_MODEL:-opus}"
THRESHOLD="${DREAMS_THRESHOLD:-9}"
JUDGE_TIMEOUT="${DREAMS_JUDGE_TIMEOUT:-300}"

usage() { echo "usage: $0 <platform_key> <ad-file.md> [--out <scores.json>]" >&2; exit 2; }

PLATFORM="${1:-}"; AD_FILE="${2:-}"; OUT_FILE=""
[[ -n "$PLATFORM" && -n "$AD_FILE" ]] || usage
shift 2
while [[ $# -gt 0 ]]; do
  case "$1" in
    --out) OUT_FILE="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done

fail() { echo "dreams-score: $*" >&2; exit 2; }

for cmd in claude jq timeout; do
  command -v "$cmd" >/dev/null 2>&1 || fail "required command '$cmd' is not on PATH"
done
[[ -f "$AD_FILE" ]] || fail "ad file not found: $AD_FILE"
[[ -f "$RUBRIC_FILE" ]] || fail "rubric not found: $RUBRIC_FILE"
[[ -f "$JUDGE_PROMPT_FILE" ]] || fail "judge prompt not found: $JUDGE_PROMPT_FILE"
[[ -f "$PLATFORMS_FILE" ]] || fail "platform config not found: $PLATFORMS_FILE"

# --- Extract a `## NAME (x/y chars)` section body: runs to the next heading.
# Mirrors workers/posting/parse-ad-output.ts so the judge grades exactly what
# the poster will publish.
extract_section() {
  local name="$1"
  awk -v name="$name" '
    BEGIN { on = 0; found = 0 }
    on && /^#{1,6}[[:space:]]/ { exit }
    on { print; next }
    !on && tolower($0) ~ ("^##[[:space:]]+" tolower(name) "([^a-z]|$)") { on = 1; found = 1; next }
    END { if (!found) exit 3 }
  ' "$AD_FILE"
}

HEADLINE=$(extract_section HEADLINE | sed -e '/./,$!d' | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}') \
  || fail "missing '## HEADLINE' section in $AD_FILE"
DESCRIPTION=$(extract_section DESCRIPTION | sed -e '/./,$!d' | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}') \
  || fail "missing '## DESCRIPTION' section in $AD_FILE"
[[ -n "$HEADLINE" ]] || fail "'## HEADLINE' section is empty in $AD_FILE"
[[ -n "$DESCRIPTION" ]] || fail "'## DESCRIPTION' section is empty in $AD_FILE"

# The call-attribution tag is metadata, never graded.
DESCRIPTION=$(printf '%s' "$DESCRIPTION" | sed -E '$ s/[[:space:]]*\(Property: [^)]*\)[[:space:]]*$//')

# --- Platform constraints ----------------------------------------------------
PLATFORM_JSON=$(jq -c --arg p "$PLATFORM" '.platforms[$p] // empty' "$PLATFORMS_FILE")
[[ -n "$PLATFORM_JSON" ]] || fail "platform '$PLATFORM' is not in $PLATFORMS_FILE"
DISPLAY_NAME=$(jq -r '.display_name // ""' <<<"$PLATFORM_JSON")
HEADLINE_MAX=$(jq -r '.headline_max // "unknown"' <<<"$PLATFORM_JSON")
DESCRIPTION_MAX=$(jq -r '.description_max // "unknown"' <<<"$PLATFORM_JSON")
FORMAT=$(jq -r '.format // "standard"' <<<"$PLATFORM_JSON")
BUYER_PROFILE=$(jq -r '.buyer_profile // ""' <<<"$PLATFORM_JSON")
HEADLINE_LEN=${#HEADLINE}
DESCRIPTION_LEN=${#DESCRIPTION}

# --- Build the judge prompt --------------------------------------------------
PROMPT_FILE=$(mktemp /tmp/dreams-judge-XXXXXX.md)
trap 'rm -f "$PROMPT_FILE"' EXIT
{
  cat "$JUDGE_PROMPT_FILE"
  printf '\n\n---\n\n# Rubric\n\n'
  # Drop the skill frontmatter; the body is the rubric.
  awk 'BEGIN{fm=0} NR==1 && /^---[[:space:]]*$/ {fm=1; next} fm && /^---[[:space:]]*$/ {fm=0; next} fm {next} {print}' "$RUBRIC_FILE"
  printf '\n\n---\n\n# Platform\n\n'
  printf -- '- Key: %s\n- Display name: %s\n- Format: %s\n- Headline cap: %s characters (this headline is %s)\n- Description cap: %s characters (this description is %s, tag removed)\n- Buyer profile: %s\n' \
    "$PLATFORM" "$DISPLAY_NAME" "$FORMAT" "$HEADLINE_MAX" "$HEADLINE_LEN" "$DESCRIPTION_MAX" "$DESCRIPTION_LEN" "$BUYER_PROFILE"
  printf '\n---\n\n# HEADLINE (score this on its own)\n\n```\n%s\n```\n' "$HEADLINE"
  printf '\n# DESCRIPTION (score this on its own)\n\n```\n%s\n```\n' "$DESCRIPTION"
  printf '\nScore both pieces now. Return only the JSON object.\n'
} > "$PROMPT_FILE"

PART_SCHEMA='{
  "type":"object",
  "properties":{
    "score":{"type":"integer","minimum":1,"maximum":10},
    "categories":{
      "type":"object",
      "properties":{
        "D":{"type":"integer","minimum":1,"maximum":10},
        "R":{"type":"integer","minimum":1,"maximum":10},
        "E":{"type":"integer","minimum":1,"maximum":10},
        "A":{"type":"integer","minimum":1,"maximum":10},
        "M":{"type":"integer","minimum":1,"maximum":10},
        "S":{"type":"integer","minimum":1,"maximum":10}
      },
      "required":["D","R","E","A","M","S"]
    },
    "strengths":{"type":"array","items":{"type":"string"}},
    "weaknesses":{"type":"array","items":{"type":"string"}},
    "suggestions":{"type":"array","items":{"type":"string"}}
  },
  "required":["score","categories","strengths","weaknesses","suggestions"]
}'
SCHEMA=$(jq -c -n --argjson part "$PART_SCHEMA" '{
  type:"object",
  properties:{ headline:$part, description:$part, biggest_opportunity:{type:"string"} },
  required:["headline","description","biggest_opportunity"]
}')

# --- Run the judge in a fresh session, no tools ------------------------------
JUDGE_EXIT=0
RAW=$(timeout "$JUDGE_TIMEOUT" claude -p \
  --model "$JUDGE_MODEL" \
  --tools "" \
  --output-format json \
  --json-schema "$SCHEMA" \
  < "$PROMPT_FILE" 2>&1) || JUDGE_EXIT=$?
[[ $JUDGE_EXIT -eq 0 ]] || fail "judge call failed (exit $JUDGE_EXIT): $(printf '%s' "$RAW" | tail -c 600)"

STRUCTURED=$(jq -c '.structured_output // empty' <<<"$RAW" 2>/dev/null || true)
if [[ -z "$STRUCTURED" ]]; then
  # Fallback: the result text may itself be the JSON object.
  STRUCTURED=$(jq -r '.result // empty' <<<"$RAW" 2>/dev/null | jq -c '.' 2>/dev/null || true)
fi
[[ -n "$STRUCTURED" ]] || fail "judge returned no structured output: $(printf '%s' "$RAW" | tail -c 600)"
jq -e '.headline.score and .description.score' <<<"$STRUCTURED" >/dev/null 2>&1 \
  || fail "judge output is missing scores: $STRUCTURED"

SESSION_ID=$(jq -r '.session_id // ""' <<<"$RAW")
COST=$(jq -r '.total_cost_usd // 0' <<<"$RAW")

RESULT=$(jq -c \
  --arg platform "$PLATFORM" \
  --arg file "$AD_FILE" \
  --arg model "$JUDGE_MODEL" \
  --arg session "$SESSION_ID" \
  --arg at "$(date -Iseconds)" \
  --argjson threshold "$THRESHOLD" \
  --argjson cost "$COST" \
  --argjson hlen "$HEADLINE_LEN" \
  --argjson dlen "$DESCRIPTION_LEN" \
  '{
    platform: $platform,
    file: $file,
    scored_at: $at,
    judge_model: $model,
    judge_session_id: $session,
    judge_cost_usd: $cost,
    threshold: $threshold,
    headline: (.headline + {chars: $hlen, pass: (.headline.score >= $threshold)}),
    description: (.description + {chars: $dlen, pass: (.description.score >= $threshold)}),
    biggest_opportunity: .biggest_opportunity,
    pass: (.headline.score >= $threshold and .description.score >= $threshold)
  }' <<<"$STRUCTURED")

if [[ -n "$OUT_FILE" ]]; then
  printf '%s\n' "$RESULT" | jq '.' > "$OUT_FILE"
fi
printf '%s\n' "$RESULT"

if jq -e '.pass' <<<"$RESULT" >/dev/null; then exit 0; else exit 1; fi
