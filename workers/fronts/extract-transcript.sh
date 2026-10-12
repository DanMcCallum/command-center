#!/usr/bin/env bash
# Turns a Claude Code transcript (JSONL) into one JSON object:
#   { session_id, cwd, started_at, ended_at, user_turns, files_touched: [],
#     text }   (text = the conversation as "User: ... / Assistant: ..." lines)
#
#   workers/fronts/extract-transcript.sh <transcript.jsonl> [max_chars]
#
# The transcript entry format is internal to Claude Code and may change, so
# this stays defensive: it keeps any user/assistant text it recognises and
# ignores everything else. Tool results and tool-call bodies are dropped;
# file paths from Edit/Write/Read calls are kept as files_touched. User
# entries that are slash-command echoes or meta caveats are not turns.
set -euo pipefail
FILE="${1:-}"; MAX="${2:-60000}"
[[ -f "$FILE" ]] || { echo "extract-transcript: no such file: $FILE" >&2; exit 2; }

jq -s --argjson max "$MAX" '
  def utext:
    if (.message.content|type) == "string" then .message.content
    elif (.message.content|type) == "array" then
      ([.message.content[] | select(.type=="text") | .text] | join("\n"))
    else "" end;
  def is_meta_user:
    (.isMeta == true)
    or (utext | test("^\\s*<(command-name|local-command-caveat|command-message|local-command-stdout|system-reminder)"));
  map(select(.type == "user" or .type == "assistant")) as $msgs
  | [ $msgs[] | select(.type=="user") | select(is_meta_user|not)
      | select((utext|length) > 0) ] as $turns
  | [ $msgs[] | select(.type=="assistant") | .message.content[]? | select(.type=="tool_use")
      | .input | (.file_path // .notebook_path // .path // empty) | strings ] | unique as $files
  | ( [ $msgs[]
        | if .type=="user" then
            (if (is_meta_user|not) and ((utext|length) > 0) then "User: " + utext else empty end)
          else
            ([.message.content[]? | select(.type=="text") | .text] | join("\n")
             | if length > 0 then "Assistant: " + . else empty end)
          end ] | join("\n\n") ) as $full
  | ( if ($full|length) > $max then
        ($full[0:($max/2|floor)]) + "\n\n[... middle of the session omitted ...]\n\n" + ($full[-($max/2|floor):])
      else $full end ) as $text
  | { session_id: ($msgs[0].sessionId // null),
      cwd: ($msgs[0].cwd // null),
      started_at: ([$msgs[].timestamp // empty] | min),
      ended_at: ([$msgs[].timestamp // empty] | max),
      user_turns: ($turns|length),
      files_touched: $files,
      text: $text }
' "$FILE"
