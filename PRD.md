# PRD: Auto-Post Approved Ads to Marketplaces

## Introduction

Today the ad pipeline ends at approval: the worker generates per-platform ad copy in `workers/workspace/outputs/<taskId>/`, a human clicks **Approve** on the task card, and then manually copy-pastes each ad into the marketplace websites. This feature closes that gap: when an ad-builder task is approved, the system automatically posts the ad to the marketplaces selected in the Ad Builder form using Playwright browser automation with saved logins.

V1 targets **Landmodo** and **Land.com** only, with the architecture (per-platform config, per-platform posting scripts, per-platform status tracking) ready to add the remaining four platforms later.

## Goals

- Clicking **Approve** on an ad-builder task queues posting for every selected + enabled platform and kicks off the poster immediately
- Posting is done via Playwright driving a real browser with a saved login session per platform (no raw passwords stored)
- Each platform posting is tracked independently on the task: `queued → posting → posted | failed`, with attempt count, error message, listing URL, and a proof screenshot
- Failed postings auto-retry on subsequent poster runs, up to 3 total attempts, then stay `failed` and are flagged in the UI with a manual Retry button
- Poster also runs on the existing cron cadence so retries happen without human involvement

## User Stories

### US-001: Posting data model and platform posting config
**Description:** As a developer, I need structured types for postings and a config file describing how to post to each platform, so all later stories build on a shared schema.

**Acceptance Criteria:**
- [ ] `dashboard/lib/types.ts` adds `PostingStatus = 'queued' | 'posting' | 'posted' | 'failed'` and `AdPosting` interface: `{ platform: string; status: PostingStatus; attempts: number; queuedAt: string; postedAt?: string; lastError?: string; listingUrl?: string; screenshotPath?: string }`
- [ ] `Task` interface gains optional `postings?: AdPosting[]`
- [ ] New file `config/posting-platforms.json` with all six platform keys matching `config/ad-platforms.json`; each entry has `display_name`, `enabled`, `login_url`, `new_listing_url`. Only `landmodo` and `land_com` have `enabled: true`
- [ ] Typecheck passes

### US-002: Task API supports posting updates and queued-posting lookup
**Description:** As the poster script, I need to read tasks that have work to do and write posting status back through the existing API.

**Acceptance Criteria:**
- [ ] `PATCH /api/tasks/[id]` accepts and persists a `postings` array (full replace of the array)
- [ ] `GET /api/tasks?postable=true` returns only tasks that have at least one posting with `status === 'queued'`, or `status === 'failed'` with `attempts < 3`
- [ ] Existing task GET/PATCH behavior unchanged for tasks without postings
- [ ] Typecheck passes

### US-003: Ad output parser
**Description:** As the poster script, I need to extract the headline and description from a platform's generated Markdown file so it can be typed into the listing form.

**Acceptance Criteria:**
- [ ] New module `workers/posting/parse-ad-output.ts` exporting `parseAdOutput(outputDir: string, platform: string): { headline: string; description: string }`
- [ ] Parses the `## HEADLINE (x/y chars)` and `## DESCRIPTION (x/y chars)` sections of `<outputDir>/<platform>.md`, returning body text only (no headers, no "Why this angle" section)
- [ ] Throws a descriptive error if the file or either section is missing
- [ ] Unit test using a real sample from `workers/workspace/outputs/` passes
- [ ] Typecheck passes

### US-004: Playwright setup and login-capture script
**Description:** As the operator, I want to log in to each marketplace once in a real browser and have the session saved, so posting scripts can reuse it without storing my password.

**Acceptance Criteria:**
- [ ] `workers/posting/package.json` created with Playwright dependency; `npm install` and `npx playwright install chromium` documented in `workers/posting/README.md`
- [ ] `npm run capture-login -- <platform>` opens the platform's `login_url` (from `config/posting-platforms.json`) in a headed browser, waits for the operator to finish logging in (operator presses Enter in the terminal), then saves storage state to `workers/posting/auth/<platform>.json`
- [ ] Errors clearly if the platform key is unknown or not enabled
- [ ] Typecheck passes

### US-005: Landmodo posting script
**Description:** As the system, I want a script that posts one approved ad to Landmodo so the listing goes live without manual copy-paste.

**Acceptance Criteria:**
- [ ] `workers/posting/post-landmodo.ts` exports `postToLandmodo(task, adCopy, opts)` and is runnable via `npm run post -- landmodo <taskId>`
- [ ] Loads saved auth state from `workers/posting/auth/landmodo.json`; fails fast with a clear "login expired / missing — run capture-login" error if absent or the site shows a login page
- [ ] Fills the new-listing form using parsed headline/description plus task `metadata` (price, acreage, location/county/state)
- [ ] Uploads any images found in `workers/workspace/outputs/<taskId>/photos/` if the form has a photo field
- [ ] Saves a full-page screenshot to `workers/workspace/outputs/<taskId>/postings/landmodo.png` and returns the live listing URL after submit
- [ ] `--dry-run` flag fills the form and screenshots but does not submit
- [ ] Typecheck passes

### US-006: Land.com posting script
**Description:** As the system, I want the same posting capability for Land.com.

**Acceptance Criteria:**
- [ ] `workers/posting/post-land_com.ts` with the same interface, auth handling, photo upload, screenshot, listing-URL return, and `--dry-run` behavior as US-005
- [ ] Runnable via `npm run post -- land_com <taskId>`
- [ ] Typecheck passes

### US-007: Poster runner script and run-poster API route
**Description:** As the system, I need an orchestrator that finds queued/retryable postings, runs the right platform script, records the result, and enforces the retry policy.

**Acceptance Criteria:**
- [ ] `workers/run-poster.sh` (mirroring `run-worker.sh` conventions): `flock` lockfile, fetches `GET /api/tasks?postable=true`, and for each actionable posting sets status `posting`, increments `attempts`, runs the platform script, then PATCHes the result
- [ ] Success → `status: 'posted'`, `postedAt`, `listingUrl`, `screenshotPath`; failure → `status: 'failed'`, `lastError` with the script's error message
- [ ] Postings with `status: 'failed'` and `attempts < 3` are re-attempted on the next run; `attempts >= 3` are skipped (permanently flagged)
- [ ] Logs to `workers/logs/` following the existing log pattern
- [ ] New route `POST /api/run-poster` spawns `run-poster.sh` detached, mirroring `dashboard/app/api/run-worker/route.ts`
- [ ] Typecheck passes

### US-008: Approve queues postings and triggers the poster
**Description:** As a reviewer, when I approve an ad I want posting to start automatically for the platforms I selected in the Ad Builder.

**Acceptance Criteria:**
- [ ] In `TaskCard.tsx`, Approve on an ad-builder task (`slashCommand === 'generate-ad'` or `tags` includes `ad-builder`) also sets `postings`: one `queued` entry (attempts 0) per platform that is both in `metadata.platforms` and `enabled` in `config/posting-platforms.json`
- [ ] After the PATCH succeeds, fires `POST /api/run-poster` (fire-and-forget)
- [ ] If no selected platform is enabled, task is approved normally with no postings and no poster trigger
- [ ] Approve on non-ad tasks is unchanged
- [ ] Typecheck passes
- [ ] Verify changes work in browser

### US-009: Posting status display and manual Retry on task cards
**Description:** As a reviewer, I want to see per-platform posting progress on the task card and retry a permanently failed post after fixing the cause.

**Acceptance Criteria:**
- [ ] Task cards with `postings` show one chip per platform: gray `Queued`, blue `Posting…`, green `Posted` (linking to `listingUrl`), red `Failed`
- [ ] Failed chip shows `lastError` (tooltip or expandable) and, when `attempts >= 3`, a **Retry** button that resets that posting to `queued` with `attempts: 0` and fires `POST /api/run-poster`
- [ ] Posting chips poll/refresh with the existing task list refresh so status changes appear without a manual reload
- [ ] Typecheck passes
- [ ] Verify changes work in browser

### US-010: Poster runs on the cron schedule
**Description:** As the operator, I want retries and any stragglers processed automatically, so a transient failure heals itself without me clicking anything.

**Acceptance Criteria:**
- [ ] `dashboard/lib/cron.ts` installs a second marked crontab line (`# COMMAND-CENTER-POSTER`) running `workers/run-poster.sh` at the same interval when cron is enabled, and removes it when disabled
- [ ] `crontab -l` shows/omits the poster line after toggling cron in Settings
- [ ] Typecheck passes

### US-011: Platform auth status on Settings page
**Description:** As the operator, I want to see whether each enabled platform has a saved login session so I know when to re-run capture-login.

**Acceptance Criteria:**
- [ ] New API `GET /api/posting-auth` returns, for each enabled platform, whether `workers/posting/auth/<platform>.json` exists and its file mtime
- [ ] Settings page panel lists enabled platforms with a green "Session saved (date)" or amber "No session — run `npm run capture-login -- <platform>`" state
- [ ] Typecheck passes
- [ ] Verify changes work in browser

## Non-Goals

- No posting to the other four platforms (Land Century, LandFlip, Land Listings, LandHub) in v1 — they stay `enabled: false` in config, and their ads remain manual
- No photo sourcing or generation — the poster only uploads images a human has already placed in `outputs/<taskId>/photos/`; missing photos are not a blocker if the site allows it, otherwise the posting fails with a clear error
- No editing, updating, or delisting of already-posted listings; no sync of listing state back from the marketplaces
- No CAPTCHA solving or bot-detection evasion — if a site blocks automation, the posting fails and is flagged for manual handling
- No storage of raw marketplace passwords — only Playwright storage state captured from an interactive login
- No changes to the ad generation workflow itself (`generate-ad.md`, worker prompt building)

## Technical Considerations

- **No database:** postings live on the task record in `dashboard/data/tasks.json` via the existing atomic-write data layer (`dashboard/lib/data.ts`). Keep the poster's writes going through the API (like `run-worker.sh` does), never direct file writes, to preserve the write mutex
- **Selectors will need discovery:** the exact form selectors for Landmodo and Land.com must be captured against the live sites during US-005/US-006; keep them in one constants block per script so site changes are a one-file fix
- **Session files are secrets:** `workers/posting/auth/*.json` grants marketplace account access — exclude the directory from the dashboard's `files/[...path]` API and never log its contents. Note: `dashboard/.env.local` already contains a plaintext `DIALPAD_API_KEY`; don't add more secrets there
- **Concurrency:** one poster at a time via `flock`, matching the worker's pattern; the poster and worker use separate lockfiles so ad generation and posting don't block each other
- **Char caps are pre-enforced** by the generator (`config/ad-platforms.json`), so the poster does not re-truncate copy; if a site rejects length anyway, that surfaces as a normal failure
- Reuse existing patterns: `StatusBadge.tsx` styling for posting chips, `run-worker/route.ts` detached-spawn pattern for `run-poster`, `run-worker.sh` structure (lock, logging, API polling) for `run-poster.sh`
