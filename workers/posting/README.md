# workers/posting

Scripts that post approved ads to marketplaces (see PRD: Auto-Post Approved Ads).

## Typecheck

No local `node_modules` yet — the tsconfig borrows the dashboard's TypeScript and `@types/node`:

```bash
cd workers/posting
../../dashboard/node_modules/.bin/tsc -p tsconfig.json
```

## Tests

Tests use `node:test` and must be run from `workers/posting/` (they resolve the
sample worker output in `../workspace/outputs/` relative to the working directory):

```bash
cd workers/posting
../../dashboard/node_modules/.bin/tsc -p tsconfig.json --noEmit false --outDir /tmp/posting-test-build
node --test /tmp/posting-test-build/*.test.js
```
