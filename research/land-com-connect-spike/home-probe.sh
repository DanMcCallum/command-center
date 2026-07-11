#!/bin/sh
# home-probe.sh — OT-A: run this from a home/residential connection and paste
# the full output into research/land-com-connect-spike/operator-input/home-probes.txt
#
# Plain curl loop, no dependencies beyond curl + date. Records HTTP status and
# response size for the same URL list probed from the worker box (report.md,
# Block Scope). Never prints response bodies.

for url in \
  "https://www.land.com/" \
  "https://www.land.com/login" \
  "https://www.land.com/LandFeed/" \
  "https://www.land.com/LandFeed/Docs/" \
  "https://www.land.com/LandFeed/schemas/LandFeedSchema1.0.xsd" \
  "https://www.landsofamerica.com/" \
  "https://www.landwatch.com/"
do
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  result=$(curl -s -o /dev/null -w "%{http_code} %{size_download}" --max-time 30 "$url")
  echo "$ts | $url | $result"
done
