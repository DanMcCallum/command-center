#!/usr/bin/env bash
# Adds (or removes, with --uninstall) the global SessionEnd hook in
# ~/.claude/settings.json that runs workers/fronts/on-session-end.sh.
# Idempotent; keeps every other hook; prints the before/after diff.
#
#   workers/fronts/install-hook.sh [--uninstall] [--settings <file>]
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SETTINGS="$HOME/.claude/settings.json"; MODE=install
while [[ $# -gt 0 ]]; do
  case "$1" in
    --uninstall) MODE=uninstall; shift ;;
    --settings) SETTINGS="$2"; shift 2 ;;
    *) echo "usage: $0 [--uninstall] [--settings <file>]" >&2; exit 2 ;;
  esac
done
command -v jq >/dev/null || { echo "jq is required" >&2; exit 2; }
HOOK_CMD="$HERE/on-session-end.sh"
[[ -f "$SETTINGS" ]] || echo '{}' > "$SETTINGS"
BEFORE=$(cat "$SETTINGS")

if [[ "$MODE" == install ]]; then
  AFTER=$(jq --arg cmd "$HOOK_CMD" '
    .hooks //= {} | .hooks.SessionEnd //= [] |
    .hooks.SessionEnd |= (map(select((.hooks // []) | any(.command == $cmd) | not))
      + [{hooks: [{type: "command", command: $cmd, timeout: 10, statusMessage: "Fronts: filing this session"}]}])' <<<"$BEFORE")
else
  AFTER=$(jq --arg cmd "$HOOK_CMD" '
    if .hooks.SessionEnd then
      .hooks.SessionEnd |= map(select((.hooks // []) | any(.command == $cmd) | not))
      | if (.hooks.SessionEnd | length) == 0 then del(.hooks.SessionEnd) else . end
    else . end' <<<"$BEFORE")
fi

if [[ "$BEFORE" == "$AFTER" ]]; then echo "no change ($MODE already in effect)"; exit 0; fi
diff <(echo "$BEFORE") <(echo "$AFTER") || true
TMP="$SETTINGS.tmp.$$"; printf '%s\n' "$AFTER" > "$TMP"; mv "$TMP" "$SETTINGS"
echo "$MODE done: $SETTINGS"
