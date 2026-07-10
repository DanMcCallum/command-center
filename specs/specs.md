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
