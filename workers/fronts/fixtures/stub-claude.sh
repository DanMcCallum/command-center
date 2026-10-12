#!/usr/bin/env bash
PROMPT=$(cat)
printf '%s' "$PROMPT" > "${STUB_PROMPT_CAPTURE:-/dev/null}"
SCHEMA=""
while [[ $# -gt 0 ]]; do case "$1" in --json-schema) SCHEMA="$2"; shift 2;; *) shift;; esac; done
if [[ "${STUB_FAIL:-0}" == "1" ]]; then echo "stub failure" >&2; exit 1; fi
if [[ "$SCHEMA" == *'"open_threads"'* ]]; then
  OUT='{"summary":"Daniel fixed the Landmodo photo upload selector and committed it.","decisions":["Use .swal2-modal as the dialog selector"],"open_threads":["Re-run against the live site"],"topics":["landmodo","poster","photos"]}'
elif [[ "$SCHEMA" == *'"fronts"'* ]]; then
  OUT="${STUB_ROUTE_JSON:-{\"fronts\":[{\"slug\":\"land-sales\",\"probability\":0.9}],\"confidence\":0.9}}"
else
  OUT='{"now_md":"# Land sales: now\n\n## Where we are\nStub state.\n\n## Next for Daniel\n- Stub next.\n","suggestions":[{"title":"Stub task","prompt":"Do the stub thing.","type":"Building","model":"sonnet"}],"questions":[{"question":"Stub question?","why_it_matters":"Because."}]}'
fi
printf '{"type":"result","is_error":false,"session_id":"stub","total_cost_usd":0.01,"result":"{}","structured_output":%s}\n' "$OUT"
