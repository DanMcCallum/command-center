# workers/posting

Scripts that post approved ads to marketplaces (see PRD: Auto-Post Approved Ads).

## Setup

```bash
cd workers/posting
npm install
npx playwright install chromium
```

## Capture a login session

Posting scripts reuse a saved browser session per platform — no passwords are
stored. To capture one (repeat whenever a session expires):

```bash
cd workers/posting
npm run capture-login -- <platform>   # e.g. landmodo or land_com
```

A headed Chromium window opens on the platform's login page. Log in by hand,
then press Enter in the terminal. The session is saved to
`workers/posting/auth/<platform>.json`.

**`auth/*.json` files are secrets** — they grant marketplace account access.
The directory is gitignored; never expose it via the dashboard files API or
logs.

## Typecheck

```bash
cd workers/posting
npm run typecheck
```

## Tests

Tests use `node:test` and must be run from `workers/posting/` (they resolve the
sample worker output in `../workspace/outputs/` relative to the working directory):

```bash
cd workers/posting
npm test
```
