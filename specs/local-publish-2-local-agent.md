# PRD: Local Publish — Part 2 of 3: The Local Poster Agent

> **Status: QUEUED — do not implement until Part 1 (publish job model & agent API) is complete.**
> When Part 1 ships, copy this file's contents into `PRD.md` and reset `progress.txt`.
> Series: Part 1 = publish job model (was `PRD.md`) · **Part 2 = this file** · Part 3 = [local-publish-3-decommission.md](local-publish-3-decommission.md)

## Introduction

Part 1 gave the dashboard per-site Publish buttons that queue jobs into a token-authenticated agent API. This part builds the consumer: a **local poster agent** that runs on the operator's machine (residential IP — which is what unblocks land_com past Akamai). The agent polls the dashboard for queued jobs, and for each job runs **auth and posting as one transaction in one browser**: it loads the saved session, verifies it's actually logged in, pops up a headed Chromium window for the operator to log in when it isn't, saves the fresh session locally, and then posts the ad in that same browser context. No VNC, no streaming, no paste relay — the browser is on the operator's real desktop.

The agent lives in this repo (`workers/posting/agent.ts`) so it typechecks and evolves with the posters, but it *runs* on the operator's machine with `DASHBOARD_URL` pointing at the server (Tailscale address or the existing tunnel hostname) and `AGENT_TOKEN` matching the server's.

## Goals

- One command (`npm run agent` in `workers/posting/`) starts a poll loop on the operator's machine.
- Publish click on the dashboard → within one poll interval the agent claims the job, downloads ad copy + photos, and posts — with a headed login step only when the saved session is invalid.
- Session validation is trustworthy: an Akamai "Access Denied" page or a still-on-login-page state must never be mistaken for logged-in (the failure that burned us in the land-com spike).
- All state the dashboard shows (posting status, `lastError`, `listingUrl`, proof screenshot) round-trips through the Part 1 API — the agent never needs the server's filesystem.
- Sessions (`auth/*.json`) are minted and stored **only on the operator's machine**, chmod 600.

## User Stories

### US-001: Agent scaffold and poll loop
**Description:** As an operator, I want a single command that starts the agent so setup is trivial.

**Acceptance Criteria:**
- [x] New `workers/posting/agent.ts` + npm script `"agent": "tsx agent.ts"` in `workers/posting/package.json`
- [x] Config from env with root-`.env.local` fallback: `DASHBOARD_URL` (required), `AGENT_TOKEN` (required), `AGENT_POLL_SECONDS` (default 15); exits with a clear message if a required var is missing
- [x] Loop: `GET /api/publish-jobs` every poll interval; logs job count; processes at most one job at a time (no concurrent browsers)
- [x] Ctrl-C exits cleanly mid-poll
- [x] Verified by running against a local dashboard (`DASHBOARD_URL=http://localhost:3000`) with a queued job visible in the log
- [x] Typecheck passes

### US-002: Claim job and download the publish bundle
**Description:** As the agent, I need the ad copy and photos locally before I can post, since the server's filesystem isn't mine.

**Acceptance Criteria:**
- [x] On seeing a queued job: `POST /api/publish-jobs/claim`; on 409, skip (someone else got it)
- [x] Downloads `publish-bundle` ad copy and every photo into a local cache dir (`workers/posting/.agent-cache/<taskId>/`, gitignored) mirroring the `outputs/<taskId>/` layout (`<platform>.md`, `photos/`)
- [x] Photo downloads verified byte-identical to the server files (size check is sufficient)
- [x] On any download failure: PATCH the posting to `failed` with a `lastError` naming what failed, and continue the loop
- [x] Verified end-to-end against a local dashboard with a real task from `outputs/`
- [x] Typecheck passes

### US-003: Reusable, hardened login detection
**Description:** As a developer, I need `isLoggedIn` usable outside the capture server, and hardened so error pages can never read as success — the exact failure mode from the land-com spike.

**Acceptance Criteria:**
- [x] `workers/posting/capture/detect.ts`'s `isLoggedIn` is importable and used by the agent without pulling in the capture server/stream modules
- [x] New hard-failure check: a page whose title is `Access Denied` (the Akamai denial signature) is reported as a distinct `blocked` result, never as logged-in
- [x] `redirect_off` is only honored after the session has actually been observed on the login page (`sawLoginPage` semantics), and this is unit-tested with the Akamai denial flow (`/login` → denial → `/`) asserting NOT logged in
- [x] `login_success` supporting `cookie` AND `redirect_off` together still works (config schema already supports it)
- [x] Typecheck passes

### US-004: Auth as part of the transaction (headed login)
**Description:** As an operator, when I click Publish and my session is stale, I want a browser window to just pop up on my machine; I log in, and posting continues automatically.

**Acceptance Criteria:**
- [ ] Agent launches headed Chromium (`headless: false`, operator's real display — no Xvfb) with `auth/<platform>.json` storageState when the file exists
- [ ] Session probe: navigate to the platform's `new_listing_url` (or `login_url`), evaluate US-003 detection; valid session skips login entirely
- [ ] If not logged in: PATCH posting to `awaiting_auth`, navigate to `login_url`, poll detection until logged in (no timeout shorter than 10 minutes — humans are slow) or the operator closes the window (→ `failed`, `lastError: 'login cancelled'`)
- [ ] On login success: save `context.storageState()` to local `workers/posting/auth/<platform>.json`, chmod 600, and PATCH posting back to `posting`
- [ ] A `blocked` detection result fails the job with a `lastError` that names the Akamai block
- [ ] Cookie values are never logged (names and expiry timestamps only)
- [ ] Typecheck passes

### US-005: Post in the same browser context and report results
**Description:** As the agent, after auth I post the ad in the same browser and push every result the dashboard needs back over the API.

**Acceptance Criteria:**
- [ ] `POSTERS[platform]` from `post.ts` is invoked with the already-authenticated context and the local cache paths (refactor `post-common.ts` path helpers to accept a base dir instead of hardcoding `workers/workspace/outputs`)
- [ ] Success: PATCH posting to `posted` with `postedAt` + `listingUrl`; upload the proof screenshot via `POST /api/tasks/[id]/proof`
- [ ] Failure: PATCH `failed` with `lastError` (truncated to a reasonable length), screenshot of the failure state uploaded when the page is still open
- [ ] The browser closes when the job finishes, success or failure
- [ ] The existing standalone `post.ts <platform> <taskId>` CLI still typechecks (it may keep reading `outputs/` directly for local dev)
- [ ] Typecheck passes

### US-006: Positive login signal for land_com
**Description:** As a developer, I want land_com's login detection to require a positive signal, so the `redirect_off`-only false positive can never recur.

**Acceptance Criteria:**
- [ ] On every successful login capture, the agent logs the session's cookie **names** (never values) so the operator can identify land_com's session cookie
- [ ] `config/posting-platforms.json` documents (comment file or `specs/`) that `land_com` must get a `cookie` signal ANDed with `redirect_off` once the name is known from the first real login
- [ ] Detection treats a `login_success` with both `cookie` and `redirect_off` as AND (both required) — covered by a unit test
- [ ] Typecheck passes

### US-007: Operator setup guide
**Description:** As the operator, I want a short doc that gets the agent running on my machine without archaeology.

**Acceptance Criteria:**
- [ ] `workers/posting/AGENT.md`: prerequisites (Node version, `npm install`, `npx playwright install chromium`), the three env vars with an example `.env.local`, how to point `DASHBOARD_URL` at the server (Tailscale or tunnel hostname), where sessions live locally, and how to wipe a bad session (`rm auth/<platform>.json`)
- [ ] Includes the security notes: `AGENT_TOKEN` and `auth/*.json` are secrets, chmod 600, never committed (confirm `.gitignore` covers `.agent-cache/` and `auth/`)
- [ ] A "first publish" walkthrough: start agent → click Publish on the dashboard → expect the browser popup → log in → watch the chip go `awaiting_auth → posting → posted`
- [ ] Typecheck passes

## Non-Goals

- No deletion of the VNC/live-view stack or `posting-auth` proxy routes — Part 3 (the agent must not *depend* on them, but they can still exist).
- No new platform posters — `landmodo` and `land_com` only.
- No parallel job execution, job priorities, or scheduling — one job at a time, FIFO by `queuedAt`.
- No auto-retry — a failed publish waits for the operator to click Publish again.
- No packaging/installer for the agent (no binaries, no auto-update) — `git pull` + `npm run agent` is the deployment story.
- No LandFeed, no CAPTCHA solving, no stealth/fingerprint tooling, no password storage.

## Technical Considerations

- The agent runs on the operator's machine but Ralph develops it on the server: acceptance tests run against `DASHBOARD_URL=http://localhost:3000`. Real posting to land sites can't be exercised from the box (land_com is IP-blocked; that's the whole point) — stories are verified up to the browser-launch boundary plus unit tests on detection.
- Reuse `capture/session.ts`'s platform-config loading if convenient, but do not import `capture/stream.ts` (Xvfb/VNC) anywhere in the agent path — it dies in Part 3.
- `attempts` semantics: incremented by the Publish endpoint (Part 1 US-003), not by the agent.
- Keep the poll loop dumb: no websockets, no server push. 15s latency on a human-initiated action is fine and keeps the laptop outbound-only.
