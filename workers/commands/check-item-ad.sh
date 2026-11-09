#!/usr/bin/env bash
# Offline check for the item ad builder content. Never runs claude.
# Usage: workers/commands/check-item-ad.sh
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CMD="$ROOT/workers/commands/generate-item-ad.md"
INSTALLED="$HOME/.claude/commands/generate-item-ad.md"
CFG="$ROOT/config/item-ad-platforms.json"
LAND_CFG="$ROOT/config/ad-platforms.json"
fail=0
ok()   { echo "ok   $1"; }
bad()  { echo "FAIL $1"; fail=1; }

# 1. JSON parses (python -I: the files are data, not code).
for f in "$CFG" "$LAND_CFG"; do
  python3 -I -c "import json,sys; json.load(open(sys.argv[1]))" "$f" 2>/dev/null \
    && ok "json: $f" || bad "json: $f"
done

# 2. Command file has frontmatter with description and disable-model-invocation.
if [[ "$(sed -n 1p "$CMD")" == "---" ]] && sed -n '2,6p' "$CMD" | grep -q '^description:' \
   && sed -n '2,6p' "$CMD" | grep -q '^disable-model-invocation: true'; then
  ok "frontmatter"
else
  bad "frontmatter"
fi

# 3. Every platform key in the config appears in the command file.
for key in $(python3 -I -c "import json,sys; print(' '.join(json.load(open(sys.argv[1]))['platforms']))" "$CFG"); do
  grep -q "$key" "$CMD" && ok "key in command: $key" || bad "key in command: $key"
  # 4. ...and is NOT in the land config, which is what workers/dreams-gate.sh keys on.
  if python3 -I -c "import json,sys; sys.exit(0 if sys.argv[2] in json.load(open(sys.argv[1]))['platforms'] else 1)" "$LAND_CFG" "$key"; then
    bad "key leaked into config/ad-platforms.json (DREAMS gate would score it): $key"
  else
    ok "key absent from land config: $key"
  fi
done

# 5. Installed copy matches the repo source.
if [[ -f "$INSTALLED" ]] && cmp -s "$CMD" "$INSTALLED"; then ok "installed copy matches"; else bad "installed copy missing or stale ($INSTALLED)"; fi

# 6. Knowledge base files exist and the command names them.
for kb in README.md seller-terms.md listing-template.md platforms.md; do
  [[ -f "$ROOT/knowledge-base/items/$kb" ]] && grep -q "knowledge-base/items/$kb" "$CMD" \
    && ok "kb: $kb" || bad "kb: $kb (missing or not referenced)"
done

# 7. No em dashes in anything this builder owns.
if grep -rl $'\xe2\x80\x94' "$CMD" "$CFG" "$ROOT/knowledge-base/items" >/dev/null; then
  bad "em dash found"; grep -rn $'\xe2\x80\x94' "$CMD" "$CFG" "$ROOT/knowledge-base/items"
else
  ok "no em dashes"
fi

# 8. The gate keys on the land config only.
grep -q 'config/ad-platforms.json' "$ROOT/workers/dreams-gate.sh" && ! grep -q 'item-ad-platforms' "$ROOT/workers/dreams-gate.sh" \
  && ok "dreams-gate keys on config/ad-platforms.json only" || bad "dreams-gate platform file reference changed"

[[ $fail -eq 0 ]] && echo "ALL CHECKS PASSED" || { echo "CHECKS FAILED"; exit 1; }
