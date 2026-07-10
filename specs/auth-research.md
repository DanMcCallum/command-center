# PRD: Marketplace Auth Capture — Research Spike

## Introduction

Capturing marketplace logins today is cumbersome: the operator must open a
terminal, run `npm run capture-login -- <platform>` (workers/posting/capture-login.ts),
log in inside a headed Chromium on the worker machine, and press Enter to save a
Playwright storageState JSON. The dashboard (components/PostingAuthPanel.tsx) can
only *display* session status and tell the user to go run the CLI. This doesn't
scale to non-technical users and is friction even for one operator.

This PRD is a **research spike, not an implementation**. The deliverable is a
**PDF proposal** that compares app-friendly auth-capture options for **Landmodo
and Land.com only** — with pricing, UX gains, reliability gains, and security
posture for each — and ends with a drafted follow-up PRD for the chosen approach.

Initial desk research is already seeded at
`research/auth-capture-spike/initial-research.md`. The spike's job is to verify
its claims (several are marked **unverified**), fill gaps with hands-on checks,
and turn it into a decision-ready proposal.

Key seeded findings to validate:
- **Land.com has an official LandFeed XML API** (account ID + shared key, HTTPS
  POST) that may eliminate browser automation for that site entirely.
- **Landmodo has no API**, so it still needs a browser session; hosted live-view
  browsers (Browserbase, Steel.dev, Anchor, Hyperbrowser) let the user log in
  inside an iframe in our own dashboard, with the session persisted for automation.

## Goals

- Produce a decision-ready comparison of auth-capture options for landmodo and
  land_com, each scored on UX, implementation effort, reliability/fragility,
  security, and monthly + per-post cost.
- Resolve every "unverified" item in the seeded research that is checkable
  without creating paid vendor accounts.
- Recommend one approach per platform, honoring the decided constraints:
  single user for now, and the user always logs in themselves (the app never
  stores marketplace passwords).
- Draft the follow-up implementation PRD (Ralph-sized stories) inside the proposal.
- Render the final proposal as a PDF the user can read and share.

## User Stories

### US-001: Scaffold the report with the current-state section
**Description:** As the operator, I want the proposal to open with an honest
description of today's capture flow and its pain points so the "before" is clear.

**Acceptance Criteria:**
- [x] `research/auth-capture-spike/report.md` created with the proposal skeleton: title, date, and section headings for Current State, Land.com, Landmodo, Hosted Live-View Browsers, Other Options, Comparison & Recommendation, Proposed Implementation PRD
- [x] Current State section describes the CLI flow by walking `workers/posting/capture-login.ts` and `dashboard/components/PostingAuthPanel.tsx` (cite both file paths)
- [x] Current State lists at least 4 concrete pain points (terminal required, must run on the worker machine, dashboard is read-only status, silent session expiry until a post fails, not usable by non-technical users)
- [x] Typecheck passes (`cd workers/posting && npm run typecheck` and `cd dashboard && npx tsc --noEmit`)

### US-002: Verify the Land.com LandFeed API
**Description:** As the operator, I want to know whether the LandFeed XML API is
actually available to my account tier, because it would remove login capture for
Land.com entirely.

**Acceptance Criteria:**
- [ ] Attempt to fetch `https://www.landsofamerica.com/LandFeed/Docs/` (and a web-archive copy if the live page errors); record HTTP status and whatever schema/auth details are obtainable
- [ ] Land.com section of `report.md` filled in: what the feed does, auth model (account ID + shared key), known schema fields, posting latency, and cost
- [ ] Section contains an explicit "Open questions for Land.com support" list (at minimum: is feed access available on our advertiser tier, and how are credentials issued) plus a ready-to-send draft email requesting feed access
- [ ] Section states the fallback if feed access is denied (keep current Playwright poster; capture via the approach chosen for Landmodo)
- [ ] Typecheck passes

### US-003: Recon the Landmodo login flow
**Description:** As the operator, I want first-hand evidence of what Landmodo's
login involves (CAPTCHA? MFA? bot walls?) so the reliability claims in the
proposal are grounded, not guessed.

**Acceptance Criteria:**
- [ ] Using the existing Playwright install in `workers/posting/`, load `https://www.landmodo.com/login` headless and save a screenshot to `research/auth-capture-spike/artifacts/landmodo-login.png`
- [ ] Record in the Landmodo section of `report.md`: presence/absence of CAPTCHA widgets or bot-protection markers in the page (e.g. reCAPTCHA/hCaptcha/Cloudflare scripts in the HTML), the login form fields observed, and whether the page loads normally for a headless datacenter-fingerprint browser
- [ ] Landmodo section confirms (with search evidence from landmodo.com pages) that no official posting API or bulk-import exists, and notes the "email their support to ask" action
- [ ] Do NOT log in or submit any form — recon only, no credentials used
- [ ] Typecheck passes

### US-004: Evaluate hosted live-view browser vendors
**Description:** As the operator, I want a verified comparison of Browserbase,
Steel.dev, Anchor, and Hyperbrowser so I can pick the best "log in inside the
dashboard" provider for Landmodo.

**Acceptance Criteria:**
- [ ] For each of Browserbase, Steel.dev, Anchor Browser, Hyperbrowser: fetch the vendor's live pricing page and live-view/persistence docs; record current prices and free-tier limits in the Hosted Live-View section of `report.md`, each with source URL and fetch date
- [ ] Section documents, per vendor: how the live-view iframe is embedded, how session/profile persistence works, and how state gets back to our workers (connectOverCDP vs cookie export to storageState)
- [ ] Section includes a projected monthly cost at two scales: 1 user (~10 posts/mo) and 20 users (~30 posts/mo each), using ~2 min per login capture and ~3 min per posting run
- [ ] Section includes an integration sketch for our stack: "Connect Landmodo" button in PostingAuthPanel → create session with persistent context → embed live-view iframe → detect successful login → persist; lists which existing files would change
- [ ] No vendor accounts are created and nothing is purchased
- [ ] Typecheck passes

### US-005: Evaluate the remaining options (extension export, Apify, self-hosted streaming, credential vault)
**Description:** As the operator, I want the alternatives fairly written up and
explicitly ruled in or out against my constraints, so the recommendation is
defensible.

**Acceptance Criteria:**
- [ ] Other Options section of `report.md` covers: (a) browser-extension cookie export from the user's own browser (PhantomBuster-style), (b) Apify (cookie-transfer tutorial, SessionPool, running the poster as an actor, current pricing from apify.com/pricing), (c) self-hosted streamed browser (neko / noVNC / CDP screencast), (d) credential vault with headless login
- [ ] Each option gets the same rubric: UX flow, build effort, reliability/fragility, security posture, cost
- [ ] Each option ends with an explicit verdict line ("Recommended / viable fallback / rejected because …") judged against the decided constraints: single user now, user logs in themselves, app never stores marketplace passwords
- [ ] Credential vault is marked rejected on the no-password-custody constraint (kept in the doc for completeness)
- [ ] Typecheck passes

### US-006: Comparison matrix and recommendation
**Description:** As the operator, I want a one-page comparison and a clear
per-platform recommendation so the decision takes minutes, not a re-read of the
whole report.

**Acceptance Criteria:**
- [ ] Comparison & Recommendation section contains a matrix table: every evaluated option × (UX, effort, reliability, security, $/mo now, $/mo at 20 users)
- [ ] A per-platform recommendation is stated: one primary approach for land_com and one for landmodo, each with a 2–3 sentence rationale and a named fallback
- [ ] A "what would change this decision" list (e.g. LandFeed access denied, Landmodo adds bot protection, vendor pricing changes)
- [ ] All UX/reliability improvements over the current CLI flow are listed explicitly (no terminal, capture from any device, in-app re-auth when expired, works for non-technical users, session survives longer via same-IP replay, etc.)
- [ ] Typecheck passes

### US-007: Draft the follow-up implementation PRD inside the proposal
**Description:** As the operator, I want the proposal to end with a ready-to-run
PRD for the recommended approach so accepting the proposal immediately unblocks
implementation.

**Acceptance Criteria:**
- [ ] Proposed Implementation PRD section contains Introduction, Goals, Non-Goals, and US-XXX user stories for the recommended per-platform approaches
- [ ] Every drafted story is Ralph-sized (describable in 2–3 sentences) and ordered by dependency (config/schema → backend → UI)
- [ ] Every drafted story has verifiable acceptance criteria including "Typecheck passes" (and browser verification for UI stories)
- [ ] Stories cover: any human prerequisite steps flagged separately (e.g. "email Land.com for feed credentials" is marked as an operator task, not a Ralph story)
- [ ] Typecheck passes

### US-008: Render the proposal as a PDF
**Description:** As the operator, I want the finished proposal as a PDF so I can
read it away from the repo and share it.

**Acceptance Criteria:**
- [ ] `report.md` converted to `research/auth-capture-spike/auth-capture-proposal.pdf` using a local tool (e.g. pandoc, or Playwright/Chromium print-to-PDF via the existing install in workers/posting — no new paid services)
- [ ] PDF is valid: file starts with `%PDF`, is larger than 20 KB, and page count is at least 5 (verifiable via `pdfinfo` or equivalent)
- [ ] Tables (vendor pricing, comparison matrix) render legibly in the PDF — verify by converting a page to an image or opening it in a browser
- [ ] `report.md` remains the source of truth; a regeneration command is noted at the top of the report
- [ ] Typecheck passes

## Non-Goals

- **No implementation** of any capture flow — no dashboard UI changes, no new API
  routes, no changes to `capture-login.ts` or the posting scripts, no browser
  extension code.
- **No vendor signups, payments, or API keys** — pricing and capability research
  only. Hands-on vendor trials belong to the follow-up PRD.
- **No credential storage** in any recommended design: the user always logs in
  themselves; the app never sees or stores marketplace passwords.
- **No multi-user build-out** — single user is fine for now; the proposal may note
  how options scale, but multi-user identity/accounts are out of scope.
- **Only landmodo and land_com** — the other four configured platforms
  (land_century, landflip, land_listings, landhub) are out of scope.
- **No logging in to marketplace accounts** during research — page recon only.

## Technical Considerations

- Seeded desk research lives at `research/auth-capture-spike/initial-research.md`;
  stories should verify and cite it rather than re-research from scratch. Items it
  marks **unverified** must be independently confirmed or clearly flagged as still
  open in the final proposal.
- Constraints already decided by the operator: single user for now; the user logs
  in themselves (no password custody); present options with price and the concrete
  UX/reliability improvements each buys.
- The repo already has Playwright + Chromium in `workers/posting/` — reuse it for
  the Landmodo recon (US-003) and the PDF render (US-008) instead of adding tools.
- `workers/posting/auth/*.json` files are secrets; the report must not embed any
  session data or file contents, only file paths.
- The web is live and changes: every price or capability claim in the report needs
  a source URL and a fetch date.
