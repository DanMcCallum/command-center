#!/bin/zsh
# home-probe.zsh — OT-A: zsh port of home-probe.sh for running from a
# home/residential connection. Paste the full output into
# research/land-com-connect-spike/operator-input/home-probes.txt
#
# Plain curl loop, no dependencies beyond curl + date. Records HTTP status and
# response size for the same URL list probed from the worker box (report.md,
# Block Scope). Never prints response bodies.

urls=(
  "https://www.land.com/"
  "https://www.land.com/login"
  "https://www.landsofamerica.com/"
  "https://www.landwatch.com/"
)

for url in $urls; do
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  result=$(curl -s -o /dev/null -w "%{http_code} %{size_download}" --max-time 30 "$url")
  echo "$ts | $url | $result"
done
