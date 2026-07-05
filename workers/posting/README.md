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

## Post an ad

With the dashboard running and a login session captured:

```bash
cd workers/posting
npm run post -- <platform> <taskId>             # e.g. landmodo task-123...
npm run post -- <platform> <taskId> --dry-run   # fill + screenshot, no submit
```

The runner fetches the task from the dashboard API (`DASHBOARD_URL`, default
`http://localhost:3000`), parses `workers/workspace/outputs/<taskId>/<platform>.md`,
fills the platform's new-listing form, uploads any images in
`outputs/<taskId>/photos/`, saves a full-page proof screenshot to
`outputs/<taskId>/postings/<platform>.png`, and prints a JSON result
(`{listingUrl, screenshotPath}`) on stdout.

Form selectors live in one `SELECTORS` block per platform script
(e.g. `post-landmodo.ts`) — when a site redesign breaks posting, that block is
the only thing to fix. The initial selectors are best-effort guesses and must
be verified against the live listing form on a first supervised run.

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
