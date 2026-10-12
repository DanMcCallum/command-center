#!/usr/bin/env bash
URL=""; DATA=""; OUT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --data|-d) DATA="$2"; shift 2;;
    -o) OUT="$2"; shift 2;;
    -H|-X) shift 2;;
    http*|https*) URL="$1"; shift;;
    *) shift;;
  esac
done
printf '%s\n' "$URL" >> "${STUB_CURL_LOG:-/dev/null}"
printf '%s\n' "$DATA" >> "${STUB_CURL_BODIES:-/dev/null}"
DEFAULT_ROUTE='{"fronts":[{"slug":"land-sales","probability":0.9}],"confidence":0.9,"method":"jev","cwdMatch":null}'
case "$URL" in
  */api/fronts/route) RESP="${STUB_ROUTE_JSON:-$DEFAULT_ROUTE}";;
  */api/fronts/suggestions) RESP='{"added":[{"id":"fs-stub"}],"skipped":0}';;
  *) RESP='{}';;
esac
if [[ -n "$OUT" ]]; then printf '%s' "$RESP" > "$OUT"; else printf '%s' "$RESP"; fi
