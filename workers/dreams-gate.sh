#!/usr/bin/env bash
# DREAMS gate: scores every platform ad file in an output directory with
# workers/dreams-score.sh (one fresh judge session per platform, run in
# parallel), merges the results into <output_dir>/dreams-scores.json, and
# prints a summary. An ad passes only when BOTH its headline and its
# description score >= DREAMS_THRESHOLD (default 9) on every platform.
#
#   workers/dreams-gate.sh <output_dir> [platform_key ...]
#       Score the named platforms (default: every <platform>.md in the
#       directory that has a "## HEADLINE" section and a config entry).
#       When a subset is named, other platforms keep their previous scores
#       from dreams-scores.json, so a re-run of only the failing ones works.
#
#   workers/dreams-gate.sh --feedback <output_dir>
#       Print the regeneration feedback (failing platforms, scores, the
#       judge's suggestions) from an existing dreams-scores.json. No scoring.
#
# Exit codes: 0 all pass, 1 at least one platform fails, 2 a platform could
# not be scored (the judge failed or a file was malformed) or nothing to score.
#
# Env: DREAMS_JUDGE_MODEL, DREAMS_THRESHOLD, DREAMS_JUDGE_TIMEOUT pass through
#      to dreams-score.sh; DREAMS_MAX_PARALLEL caps concurrent judges (default 8).
set -euo pipefail

# Sessions this script spawns must not trigger the fronts SessionEnd hook
# (workers/fronts/on-session-end.sh); hooks inherit the environment.
export FRONTS_SKIP=1

export PATH="$PATH:$HOME/.local/bin"

WORKERS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$WORKERS_DIR/.." && pwd)"
SCORER="$WORKERS_DIR/dreams-score.sh"
PLATFORMS_FILE="$PROJECT_ROOT/config/ad-platforms.json"
THRESHOLD="${DREAMS_THRESHOLD:-9}"
JUDGE_MODEL="${DREAMS_JUDGE_MODEL:-opus}"
MAX_PARALLEL="${DREAMS_MAX_PARALLEL:-8}"

usage() {
  echo "usage: $0 <output_dir> [platform_key ...]" >&2
  echo "       $0 --feedback <output_dir>" >&2
  exit 2
}

# --- Feedback mode -----------------------------------------------------------
print_feedback() {
  local scores="$1/dreams-scores.json"
  [[ -f "$scores" ]] || { echo "dreams-gate: no $scores to summarise" >&2; exit 2; }
  jq -r '
    def part(name; p):
      if p.pass then empty else
        "- " + name + " scored " + (p.score|tostring) + "/10, gate is " + (.threshold|tostring)
        + " (D " + (p.categories.D|tostring) + ", R " + (p.categories.R|tostring)
        + ", E " + (p.categories.E|tostring) + ", A " + (p.categories.A|tostring)
        + ", M " + (p.categories.M|tostring) + ", S " + (p.categories.S|tostring) + ").",
        (p.weaknesses[]? | "  - Weak: " + .),
        (p.suggestions[]? | "  - Fix: " + .)
      end;
    . as $root
    | "DREAMS gate: the ad was scored by an independent judge (" + .judge_model
      + ") and rejected. Every headline and every description must score "
      + (.threshold|tostring) + " or higher. Revise ONLY the parts listed below, using the suggestions, "
      + "then re-run workers/dreams-gate.sh on the output directory until it passes.",
      "",
      ( .platforms | to_entries[] | select(.value.pass == false) | .value as $p
        | "## " + .key + " (" + ($p.file | split("/") | last) + ")",
          ( $root | part("Headline"; $p.headline) ),
          ( $root | part("Description"; $p.description) ),
          "- Biggest opportunity: " + ($p.biggest_opportunity // ""),
          "" ),
      ( if (.errors | length) > 0 then
          "## Could not be scored", (.errors[] | "- " + .platform + ": " + .error), ""
        else empty end )
  ' "$scores"
}

if [[ "${1:-}" == "--feedback" ]]; then
  [[ -n "${2:-}" ]] || usage
  print_feedback "$2"
  exit 0
fi

OUTPUT_DIR="${1:-}"
[[ -n "$OUTPUT_DIR" && -d "$OUTPUT_DIR" ]] || usage
shift || true

for cmd in jq; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "dreams-gate: '$cmd' is not on PATH" >&2; exit 2; }
done
[[ -x "$SCORER" ]] || { echo "dreams-gate: scorer not executable: $SCORER" >&2; exit 2; }

# --- Which platforms --------------------------------------------------------
PLATFORMS=()
if [[ $# -gt 0 ]]; then
  PLATFORMS=("$@")
else
  while IFS= read -r f; do
    key=$(basename "$f" .md)
    if jq -e --arg p "$key" '.platforms[$p]' "$PLATFORMS_FILE" >/dev/null 2>&1 \
       && grep -qiE '^##[[:space:]]+HEADLINE' "$f"; then
      PLATFORMS+=("$key")
    fi
  done < <(find "$OUTPUT_DIR" -maxdepth 1 -type f -name '*.md' | sort)
fi
if [[ ${#PLATFORMS[@]} -eq 0 ]]; then
  echo "dreams-gate: no platform ad files to score in $OUTPUT_DIR" >&2
  exit 2
fi

# --- Score in parallel --------------------------------------------------------
TMP_DIR=$(mktemp -d /tmp/dreams-gate-XXXXXX)
trap 'rm -rf "$TMP_DIR"' EXIT

running=0
for p in "${PLATFORMS[@]}"; do
  (
    code=0
    "$SCORER" "$p" "$OUTPUT_DIR/$p.md" --out "$TMP_DIR/$p.json" >/dev/null 2>"$TMP_DIR/$p.err" || code=$?
    echo "$code" > "$TMP_DIR/$p.exit"
  ) &
  running=$((running + 1))
  if [[ $running -ge $MAX_PARALLEL ]]; then wait -n 2>/dev/null || true; running=$((running - 1)); fi
done
wait

# --- Merge --------------------------------------------------------------------
SCORES_FILE="$OUTPUT_DIR/dreams-scores.json"
PREVIOUS='{}'
if [[ -f "$SCORES_FILE" ]]; then
  PREVIOUS=$(jq -c '.platforms // {}' "$SCORES_FILE" 2>/dev/null || echo '{}')
fi

NEW_PLATFORMS='{}'
ERRORS='[]'
for p in "${PLATFORMS[@]}"; do
  code=$(cat "$TMP_DIR/$p.exit" 2>/dev/null || echo 2)
  if [[ "$code" == "0" || "$code" == "1" ]] && [[ -s "$TMP_DIR/$p.json" ]]; then
    NEW_PLATFORMS=$(jq -c --arg p "$p" --slurpfile r "$TMP_DIR/$p.json" '.[$p] = $r[0]' <<<"$NEW_PLATFORMS")
  else
    err=$(tail -c 400 "$TMP_DIR/$p.err" 2>/dev/null | tr '\n' ' ' || true)
    ERRORS=$(jq -c --arg p "$p" --arg e "${err:-scorer exited $code}" '. + [{platform: $p, error: $e}]' <<<"$ERRORS")
  fi
done

MERGED=$(jq -c -n \
  --argjson prev "$PREVIOUS" \
  --argjson new "$NEW_PLATFORMS" \
  --argjson errors "$ERRORS" \
  --argjson threshold "$THRESHOLD" \
  --arg model "$JUDGE_MODEL" \
  --arg at "$(date -Iseconds)" \
  '($prev + $new) as $all
   | {
       scored_at: $at,
       judge_model: $model,
       threshold: $threshold,
       platforms: $all,
       errors: $errors,
       pass: (($errors | length) == 0 and ([$all[] | .pass] | all)),
       failing: [$all | to_entries[] | select(.value.pass == false) | .key]
     }')
printf '%s\n' "$MERGED" | jq '.' > "$SCORES_FILE"

# --- Summary ------------------------------------------------------------------
jq -r '
  "DREAMS gate (threshold " + (.threshold|tostring) + ", judge " + .judge_model + ") " + .scored_at,
  "",
  "| Platform | Headline | Description | Verdict |",
  "|---|---|---|---|",
  ( .platforms | to_entries[] | .value as $p
    | "| " + .key + " | " + ($p.headline.score|tostring) + "/10 | " + ($p.description.score|tostring) + "/10 | "
      + (if $p.pass then "PASS" else "FAIL" end) + " |" ),
  ( .errors[]? | "| " + .platform + " | error | error | ERROR: " + .error + " |" ),
  "",
  (if .pass then "RESULT: PASS" else "RESULT: FAIL (" + ((.failing + [.errors[].platform]) | join(", ")) + ")" end)
' "$SCORES_FILE"

if jq -e '(.errors | length) > 0' "$SCORES_FILE" >/dev/null; then exit 2; fi
if jq -e '.pass' "$SCORES_FILE" >/dev/null; then exit 0; fi
exit 1
