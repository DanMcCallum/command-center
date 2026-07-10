# Feature Log

One summary per shipped feature. Read this **and** [readme.md](readme.md) (the core-system PRD) before starting new work — together they are enough context to build a new feature from its PRD alone. Open a feature's full PRD (`specs/<feature>.md`) only when the new work modifies that feature.

## Process: adding a feature spec

1. **Plan:** write the PRD as `specs/<feature>.md` (Introduction / Goals / User Stories with acceptance criteria / Non-Goals / Technical Considerations). Header: `**Status:** Draft`.
2. **Build:** implement against the PRD, checking off acceptance criteria as they land.
3. **Ship:** when the feature is done —
   - Add a summary section to this file (see the entries below for the shape): what it does, the data-model / API / config / script surface it added, key files, invariants and gotchas, and how to extend it.
   - Fix any statements in `readme.md` that the feature made false (non-goals, architecture claims, data-flow, repo map). Do **not** fold full feature detail into `readme.md` — this file carries it.
   - Update the PRD header to `**Status:** Implemented (<date>)` and leave it in `specs/` as the deep-dive reference.

**What goes where:** a fact belongs in the summary here if an unrelated future feature could need it (schema fields, API routes, secrets, lockfiles, reusable patterns). It stays in the PRD if it only matters when changing that feature (form selectors, per-story acceptance criteria, story-level sequencing).

---

## Marketplace auth-capture — research spike (proposal, no implementation)

**PRD:** [auth-research.md](auth-research.md) · **Shipped:** 2026-07-10 · **Type:** research spike (deliverable is a proposal, not a code change to the running system)

A decision-ready proposal for replacing the terminal-only `capture-login` flow (see Ad posting) with an app-friendly, no-password-custody login capture for the two enabled platforms. **No system behavior changed** — no dashboard UI, API routes, `capture-login.ts`, or poster scripts were touched. The output is a document plus two throwaway research scripts.

**Deliverables (all under `research/auth-capture-spike/`):** `report.md` is the source of truth; `auth-capture-proposal.pdf` is the shareable render; `artifacts/landmodo-login.png` is the recon screenshot; `initial-research.md` is the seeded desk research the spike verified. Regenerate the PDF after editing the report with `cd workers/posting && npx tsx render-pdf.ts`.

**Scripts added to `workers/posting/`** (both are in-package so they stay in `npm run typecheck`; ESM resolves `playwright` relative to the script file, so any future Playwright helper must also live here):
- `recon-landmodo.ts` — headless, default-fingerprint Chromium recon: loads a page, full-page screenshots it, scans HTML for bot-wall/CAPTCHA vendor signatures, dumps form fields. Recon only (never submits). Reusable pattern for vetting any marketplace login.
- `render-pdf.ts` — markdown → PDF via the existing Playwright/Chromium (`page.setContent` → `page.pdf`, Letter, `printBackground`). Exports `mdToHtml` + `CSS` (guarded behind `require.main === module`) so a verifier can screenshot the HTML. The hand-rolled `mdToHtml` covers h1–h6, GFM pipe tables, ul/ol, blockquotes, hr, inline bold/`code`/links — no external markdown dep (a bare `marked` import would break the typecheck). Single-`*` italic is intentionally unhandled.

**Key verified findings (2026-07-10, each cited in the report):**
- **Land.com has a working LandFeed XML API** (`land.com/LandFeed/`, spec v2.1 via Wayback; XSD + states endpoints live). Credentials travel *inside* the XML (`loa_account_id` + `loa_account_email` + `loa_shared_key`); the shared key is issued by Land.com staff and requires an active Corporate Account. The feed is authoritative — omitting a listing DELETES it, so send the full set every time; a test mode exists. Latency 5 min–6 hr. $0 beyond an existing plan. **Gated on the operator emailing Land.com for a shared key** (draft email is in the report).
- **Landmodo has no posting API/bulk import** and its login carries an *invisible* Google reCAPTCHA (no hCaptcha/Turnstile/DataDome, no MFA); the page loads fine for a headless datacenter browser. This makes any scripted/credential-vault login the fragile path and a human-in-the-loop capture the clean one.
- **Recommendation:** land_com → LandFeed API (fallback: hosted live-view); landmodo → **Browserbase** hosted live-view ($20/mo Developer tier, bundles CAPTCHA solving), user logs in inside a dashboard iframe, state returned to workers via **CDP cookie export to `auth/<platform>.json`** (keeps `post.ts` unchanged — the low-risk path). Fallbacks: browser-extension cookie export, then self-hosted neko. Rejected: credential vault (violates no-password-custody), Apify (no better capture UX). Note Steel.dev dropped its cheap recurring tier since the seeded research — pricing drift is real; every claim in the report is dated.

**Follow-up implementation PRD is drafted inside the report (§7):** Ralph-sized stories US-101–104 (LandFeed path) and US-201–203 (Browserbase live-view path), plus operator-task prerequisites (email Land.com; create a Browserbase account; decide public photo hosting) called out as *not* Ralph stories. That section is the ready-to-run spec if the proposal is accepted — it is not yet its own `specs/` PRD.

**Invariants / gotchas:**
- The report embeds **no** session data or `auth/*.json` contents — file paths only (those files are secrets, per Ad posting).
- No vendor accounts, payments, or logins were made; every price/capability claim carries a source URL + fetch date because vendor pricing drifts.
- Verification tooling on this box: no pandoc/pdfinfo/wkhtmltopdf — Playwright print-to-PDF is the only local render path, and PDF page count is counted from the `/Kids` page tree, not `pdfinfo`. WebFetch cannot reach `web.archive.org` (use `curl` + tag-strip) and returns only `<title>` on JS-heavy marketing pages (fetch the static docs page or WebSearch instead).

**Extending:** accepting the proposal means promoting §7 into a real `specs/<feature>.md` PRD and building it; `recon-landmodo.ts` generalizes to recon any new marketplace, and `render-pdf.ts` renders any repo markdown to a shareable PDF.

## Ad photos — upload, ordering, and submission-failure UX

**PRD:** [ad-photos.md](ad-photos.md) · **Shipped:** 2026-07-10

The Ad Builder form now requires at least one photo per ad request. Users attach images (jpg/jpeg/png/webp/gif, ≤15 MB each), reorder them by drag-and-drop, and star one as primary; on submit the photos are uploaded into `workers/workspace/outputs/<taskId>/photos/` **before** the worker is fired. Order and primary choice are encoded entirely in filenames — primary gets prefix `00_`, the rest `01_`, `02_`… in gallery order — because the poster's `listPhotos()` sorts by name and uploads in array order. Zero changes to the platform posting scripts' upload mechanics.

**Data model:** no new `Task` fields. `task.metadata` gains `photoCount: number` and `primaryPhoto: string` (display/debugging only — filenames are the ordering source of truth; never add a parallel ordering field).

**API additions:** `POST /api/tasks/[id]/photos` — `multipart/form-data`, one `file` per request plus a `filename` field that must already match `/^[0-9]{2}_[\w.-]+$/` (the client generates the prefix and sanitizes the name). 404 for unknown task; 400 for traversal (`/`, `\`, `..`), disallowed extension, >15 MB, or bad pattern. Writes only inside `outputs/<taskId>/photos/`; returns `{filename, size}`. App Router `request.formData()` handles 15 MB bodies with no route config.

**Submit flow (Ad Builder):** `POST /api/tasks` → sequential photo uploads → `POST /api/run-worker` → redirect to `/tasks?focus=<id>`, with worker + redirect gated on every upload succeeding. On failure: per-thumbnail error state, uploads continue past failures, "Retry failed uploads" re-sends only failed files against the **same** taskId (flaky uploads can never create duplicate tasks), or the user removes failed photos and continues with ≥1 uploaded. Task-create failure shows an inline error and attempts zero uploads.

**Poster preflight:** `requirePhotos()` in `workers/posting/post-common.ts`, called from `post.ts` before `parseAdOutput` and any browser launch — a photo-less task fails in ~2 s with `lastError` exactly `No photos found in outputs/<taskId>/photos — upload photos and Retry` (and no `screenshotPath`, since no browser ran).

**UI:** `dashboard/components/PhotoPicker.tsx` (thumbnail grid, HTML5 drag-and-drop, primary star, per-file errors); `PostingChips.tsx` — failed chips open a popover (full `lastError`, attempts of 3, screenshot link via `/api/files`, Retry inside the popover at 3 attempts; `MAX_ATTEMPTS` const lives here); `PostingFailureBanner.tsx` on `/tasks` — dismissible amber banner when any posting is `failed` with `attempts >= 3`, dismissal in `sessionStorage` as a set of `taskId:platform` keys so a NEW permanent failure reappears it.

**Invariants / gotchas:**
- The `NN_` filename prefix is the entire ordering mechanism; gaps in the sequence are fine (`listPhotos()` only sorts). Already-uploaded names are frozen — retry/removal never recomputes them.
- Photo uploads use the dedicated route, not `files/[...path]` (that stays GET/PUT-text only).
- `run-poster.sh` joins the last 3 stderr lines into `lastError` — operator-facing errors must be one line to survive verbatim.
- v1 is create-time only: no photo add/remove/reorder after submit; the workaround is editing `outputs/<taskId>/photos/` on disk.
- Verification: port 3000 serves stale production code — always use `npx next dev -p 3001`. Playwright verification scripts must live inside `workers/posting/` (ESM resolves `playwright` relative to the script file). Faking `GET /api/tasks` with `page.route` fixtures is the cleanest isolation from the shared `tasks.json` that cron/worker/poster also touch.
- `?focus=<id>` is not actually consumed anywhere in the dashboard yet (readme's deep-link claim is aspirational) — links with that href remain the contract.

**Extending:** per-platform photo rules belong in submit-time validation plus the upload route; post-submit photo management needs a new UI surface but can reuse the same route and filename contract.

## Ad posting — auto-post approved ads to marketplaces

**PRD:** [ad-posting.md](ad-posting.md) · **Shipped:** 2026-07-10 · **v1 platforms:** Landmodo, Land.com

When an ad-builder task (`slashCommand === 'generate-ad'` or tag `ad-builder`) is **approved**, the dashboard queues one posting per platform that is both selected in the task's `metadata.platforms` and `enabled` in config, then fires the poster. Postings are executed by Playwright driving a real browser with a saved login session — no marketplace APIs, no stored passwords.

**Data model** (`dashboard/lib/types.ts`): `Task.postings?: AdPosting[]` where `AdPosting = { platform, status: 'queued'|'posting'|'posted'|'failed', attempts, queuedAt, postedAt?, lastError?, listingUrl?, screenshotPath? }`. PATCH replaces the whole `postings` array.

**API additions:**
- `GET /api/tasks?postable=true` — tasks with a `queued` posting, or `failed` with `attempts < 3`
- `POST /api/run-poster` — spawns `run-poster.sh` detached (same pattern as `run-worker`)
- `GET /api/posting-auth` — per enabled platform: does `workers/posting/auth/<platform>.json` exist + mtime (backs the Settings auth panel)
- `GET /api/posting-platforms` — serves the config (client components can't import `config/` directly; see AGENTS.md)

**Config:** `config/posting-platforms.json` — all six platform keys matching `ad-platforms.json`, each with `display_name`, `enabled`, `login_url`, `new_listing_url`. Only `landmodo` and `land_com` are enabled in v1.

**Poster runner:** `workers/run-poster.sh` — mirrors `run-worker.sh` (flock, logs to `workers/logs/`) but with its **own lockfile**, so posting and ad generation never block each other. Per actionable posting: set `posting`, increment `attempts`, run the platform script, PATCH the result. All writes go through the API, never direct file edits. Retry policy: `failed` with `attempts < 3` is retried on every run; at 3 attempts it stays `failed` until the operator clicks **Retry** on the task card (resets to `queued`, `attempts: 0`). Cron: `dashboard/lib/cron.ts` installs a second crontab line (marker `# COMMAND-CENTER-POSTER`) at the worker's interval when cron is enabled.

**Posting scripts:** `workers/posting/` is its own npm package (Playwright, chromium).
- `npm run capture-login -- <platform>` — headed browser, operator logs in once, storage state saved to `auth/<platform>.json`
- `npm run post -- <platform> <taskId>` — loads auth state (fails fast with "run capture-login" if missing/expired), fills the listing form from `parse-ad-output.ts` (extracts HEADLINE/DESCRIPTION from `outputs/<taskId>/<platform>.md`) + task metadata, uploads photos from `outputs/<taskId>/photos/`, screenshots to `outputs/<taskId>/postings/<platform>.png`, returns the listing URL. `--dry-run` fills but doesn't submit.
- Site selectors live in one constants block per script — a marketplace redesign is a one-file fix.

**UI:** per-platform status chips on task cards (gray Queued / blue Posting… / green Posted linking to the listing / red Failed with error + Retry); Settings page shows saved-session status per enabled platform.

**Invariants / gotchas:**
- `workers/posting/auth/*.json` are **secrets** (marketplace sessions) — gitignored, excluded from the `files/[...path]` API, never logged.
- `POST /api/tasks` drops unknown fields; `postings` must be attached via PATCH after create.
- Char caps are enforced at generation time (`config/ad-platforms.json`); the poster never truncates.
- No CAPTCHA solving or bot-detection evasion — a blocked site is a normal `failed` posting.

**Adding a platform:** set `enabled: true` + URLs in `posting-platforms.json`, run `capture-login`, write `post-<platform>.ts` with the same interface as `post-landmodo.ts`. Nothing else changes.

## DREAMS review loop — inline sales-quality audit in ad generation

**PRD:** [dreams-validation.md](dreams-validation.md) · **Shipped:** 2026-07-10

After the existing headline-craft, anti-slop, and voice passes, the `generate-ad` workflow now audits every platform variant — headline plus the description's sales-copy portion (nickname tag exempt) — against the six DREAMS categories (Scott Todd framework), revises non-Pass variants in the operator's voice, and re-audits, until every category is `Pass` on every platform or 3 audit cycles are used. Entirely a workflow-prompt change: no worker-script, dashboard, API, or data-model surface.

**Files:**
- `~/.claude/commands/generate-ad.md` (**outside the repo, not git-tracked**) — input 9 (the DREAMS rubric), `Step 6 — DREAMS audit` (audit → revise → re-audit loop), and Output-section additions. Pre-feature backup: `workers/workspace/notes/generate-ad.md.bak-2026-07-10`.
- `.claude/skills/dreams-ad-review/SKILL.md` — the rubric. The headless worker reads it **by absolute path as a file**, never via Skill-tool invocation (project-skill discovery depends on cwd, which the worker doesn't guarantee). It is a coaching skill ("do NOT rewrite") — used as an audit rubric only; the generator revises its own copy.

**Output surface** (per `workers/workspace/outputs/{task-id}/`): new `dreams-review.md` deliverable — cycles used (`N/3`), final platform × six-category verdict table, unresolved-weaknesses list ("None" when clean). `README.md` Variants table gains a `DREAMS` column (`Pass` / `2 weak`); each per-platform file gains a one-line `## DREAMS` section; `notes.md` carries the per-cycle audit logs (`## DREAMS audit — cycle <N>` blocks + why unresolved categories couldn't be fixed).

**Invariants / gotchas:**
- Verdicts are `Pass | Weak | Missing` only — no numeric scoring.
- **Precedence:** DREAMS coaching overrides anti-slop, voice-check, and headline-craft *style* rules; platform char caps, the 90–100% `content_budget` window, no-invented-facts, and all nickname-tag rules are absolute — a DREAMS fix may never introduce a fact not in the task metadata (missing facts are logged as unresolvable instead).
- Anti-slop still runs exactly once; DREAMS cycles never re-trigger it. The nickname tag is appended exactly once, after the final cycle, so `content_budget` math is unchanged. Char budgets are re-verified after every revision.
- Each cycle is one scorecard pass over all platforms (no per-variant sub-loops) to keep 3 cycles inside the 30-min task timeout.
- Example text in workflow templates gets copied verbatim into deliverables — keep it free of em dashes and other banned tells.

**Extending:** grading criteria live in the skill's `SKILL.md`; cycle count, verdict scale, and precedence are Step 6 edits in the workflow file. A future review pass should copy this pattern: rubric read by absolute path, generator revises its own copy in the operator's voice, nickname tag exempt, budgets re-verified after each revision.
