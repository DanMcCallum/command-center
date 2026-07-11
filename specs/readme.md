# Command Center — Product Requirements Document

**Version:** 1.1
**Date:** 2026-07-05
**Status:** Documents the core system as built (reverse-engineered from the implementation and original design docs)
**Scope:** Features shipped after v1.1 are summarized in [specs.md](specs.md) — read both before starting new work.

---

## 1. Overview

Command Center is a single-operator, local-first task automation system for a rural-land sales business (Montello, NV / Elko County parcels). The operator queues work in a Next.js dashboard; a cron/on-demand bash worker hands each task to the Claude Code CLI, which produces deliverables — primarily multi-platform land-sale ads — that land in a "needs review" bin for human approval before anything goes live.

**The one-sentence version:** a queue picks up tasks, hands them to Claude, and drops the output into a review bin for the operator to approve.

```
Operator creates a task (Ad Builder form, task form, or automated script)
  -> Task sits in queue as "pending"
  -> Worker fires (on-demand trigger or cron)
  -> Worker grabs the highest-priority pending task
  -> Claude does the work, writes deliverables to a workspace
  -> Task lands in "needs review"
  -> Operator reviews, approves, or sends back with feedback
  -> On approve (ad tasks): poster auto-posts to enabled marketplaces
     (specs.md -> Ad posting)
```

### Problem statement

Writing high-quality, platform-tailored land listings is repetitive, slow, and quality-inconsistent. Each parcel needs 6 different ads (one per marketplace, each with its own character caps and buyer audience), written in the operator's authentic voice, grounded in what has actually sold before. Doing this by hand takes hours per property; doing it with generic AI produces "slop" that doesn't convert.

### Solution

An autonomous Claude worker with three grounding corpora:

1. **Knowledge base** — real sold-ad copy with outcome data (days to sale, platform that produced the buyer), pattern-matched at generation time.
2. **Voice corpus** — cleaned phone-call transcripts that prime Claude on the operator's speaking cadence and word choice.
3. **Skills** — reusable prompt fragments (e.g., an anti-slop writing-quality enforcer) that slash-command workflows load at runtime.

Everything runs on one machine. No database, no auth, no cloud services, no queue infrastructure.

---

## 2. Goals and non-goals

### Goals

- Generate publish-ready, per-platform land ads from a structured property form in one click.
- Keep a human quality gate: nothing is marked complete without operator approval (the gate is optional per task type).
- Continuously improve output by feeding sold ads back into the knowledge base.
- Sound like the operator, not like AI — voice corpus + anti-slop self-critique.
- Zero infrastructure: flat JSON files, bash + cron, Claude CLI. Runs on a laptop.

### Non-goals

- Multi-user access or in-app authentication (single user; the dashboard binds to localhost, with remote access provided by a Cloudflare Access-protected tunnel at `dashboard.ownaloha.land` — auth happens at the edge, not in the app).
- Direct API posting to ad platforms — enabled platforms are instead posted via Playwright browser automation on approval (see specs.md → Ad posting); the remaining platforms are manual. Platform caps are enforced at generation time either way.
- A general project-management tool. The task queue exists to feed the Claude worker.
- Parallel task execution (one worker at a time, by design — global lockfile).

---

## 3. Users

One persona: **the operator** (owner of the land business). Technical enough to run a local dev server and edit markdown, but the day-to-day loop is entirely UI-driven: fill the Ad Builder form, review output, approve or request revision, save sold ads to the knowledge base.

---

## 4. System architecture

Three moving parts plus three supporting corpora:

| Component | What it is | Role |
|---|---|---|
| **Dashboard** (`dashboard/`) | Next.js 16 / React 19 / TypeScript / Tailwind v4 app on localhost | UI for the operator + REST API for the worker. JSON files are the database. |
| **Worker** (`workers/run-worker.sh`) | Bash script triggered by cron or the dashboard | Picks the top pending task, spawns `claude -p`, routes output to review. |
| **Cron / on-demand trigger** | System crontab entry (dashboard-managed) and `POST /api/run-worker` | Fires the worker. Both modes are active: cron runs every 5 minutes (schedule managed from `/settings`), and the Ad Builder triggers the worker immediately after creating a task. |
| **Knowledge base** (`knowledge-base/`) | Markdown corpus of sold ads + headlines + property nicknames | Read at generation time for pattern matching. |
| **Voice corpus** (`voice/`) | Raw + cleaned Dialpad call transcripts | Primes generated copy on the operator's voice. |
| **Skills** (`skills/`) | Reusable prompt fragments | Loaded by slash-command workflows (e.g., `anti-slop.md`). |

### Data flow (ad generation, the primary loop)

```
Operator fills Ad Builder form
  -> POST /api/tasks  (type: Content, priority: 1, model: opus,
                       slashCommand: generate-ad, metadata: full property form)
  -> POST /api/tasks/{id}/photos  (one call per photo, order-prefixed
                       filenames; worker fires only after all succeed)
  -> POST /api/run-worker  (spawns run-worker.sh detached)
  -> Worker claims task (status: in_progress)
  -> Worker builds prompt: system-prompt.md + generate-ad workflow
     (from ~/.claude/commands/) + task details
  -> claude -p --dangerously-skip-permissions --output-format json --model opus
  -> Claude reads knowledge-base/ads/, headlines/, voice/clean/,
     config/ad-platforms.json; drafts per-platform ads; self-critiques
     with skills/anti-slop.md; writes one .md per platform to
     workers/workspace/outputs/{task-id}/
  -> Worker PATCHes task to needs_review with completionFile + claudeNotes
  -> Operator reviews/edits files in-browser, approves or requests revision
  -> When the ad sells: "Save to knowledge base" writes a new corpus entry
```

### Key design decisions

| Decision | Rationale |
|---|---|
| JSON files, not a database | One writer at a time + atomic temp-file+rename writes = safe enough. Zero deployment overhead. |
| Script owns the state machine | Determinism over probabilism. Claude may update the task via the API, but the bash script always ensures a consistent final status. |
| `needs_review` as default end state | Nothing ships without human approval. Auto-complete is a per-task-type opt-out (whitelist in the worker script). |
| Failure → back to `pending` | Free retry: the next worker run picks the task up again. Cron is the retry mechanism. |
| Global lockfile (`flock`), one worker at a time | Simplicity; prevents resource contention. Stale locks (>35 min) are detected and reclaimed. |
| Slash commands as file injection | Reusable workflows without code changes. The task is the WHAT; the workflow file is the HOW. |
| Session resumption on revision | The worker passes `--resume {claudeSessionId}` so revisions keep the previous run's context. |

---

## 5. Functional requirements

### 5.1 Task queue and lifecycle

**Data model — Task** (`dashboard/lib/types.ts`):

```typescript
interface Task {
  id: string;                     // "task-{timestamp}-{random}", server-generated
  title: string;
  description: string;
  type: string;                   // e.g. "Content", "Research", "Admin"
  tags: string[];
  status: 'pending' | 'in_progress' | 'completed' | 'needs_review';
  priority: 1 | 2 | 3 | 4 | 5;   // 1 = highest
  model: 'sonnet' | 'opus' | 'haiku';
  acceptanceCriteria: string[];   // injected into Claude's prompt
  slashCommand: string | null;    // workflow template (~/.claude/commands/{name}.md)
  claudeNotes: string;            // worker's summary, or "[REVISION REQUESTED] ..." feedback
  completionFile: string | null;  // primary deliverable path
  workspacePath: string | null;
  parentTaskId: string | null;    // dependency chaining
  claudeSessionId: string | null; // enables --resume on revision
  captainNotes: string | null;    // human feedback
  createdAt / updatedAt / startedAt / completedAt: string | null;
  metadata: Record<string, unknown> | null;  // e.g. the Ad Builder form payload
}
```

**Status transitions (only these are valid):**

```
pending      -> in_progress    (worker claims it)
in_progress  -> needs_review   (worker succeeds)
in_progress  -> pending        (worker fails or times out — auto-retry)
needs_review -> completed      (operator approves)
needs_review -> pending        (operator requests revision)
completed    -> pending        (operator reopens)
```

**Scheduling rules:**
- Worker always picks the lowest priority number first; ties broken by oldest `createdAt`.
- A task with a `parentTaskId` pointing to a still-`pending`/`in_progress` task is skipped (task chaining — enforces sequential execution; fan-out with multiple children of one parent is supported).
- Revision: operator sets `claudeNotes` to `[REVISION REQUESTED] {feedback}` and status back to `pending`. The worker injects the feedback into the prompt with an instruction to revise the existing output, resuming the prior Claude session when available.

### 5.2 Dashboard pages

| Route | Purpose |
|---|---|
| `/` | Redirects to `/tasks`. |
| `/tasks` | Primary view. Task list polling every 30 s; filter tabs (All / Pending / In progress / Needs review / Completed) with counts; inline create form; expandable task rows showing priority dot, status badge, Claude's notes, links to output files. Actions per task: approve, request revision, delete, edit output files in a modal (`FileEditorModal`), and **Save to knowledge base** (`SaveToKbModal`). A dismissible banner surfaces permanently failed marketplace postings (specs.md → Ad photos). Supports `?focus={id}` deep links. |
| `/ad-builder` | Structured property form: location, acreage, price, access (paved / dirt-year-round / dirt-seasonal / none), utilities (power/water/septic/internet as yes/no/unknown), terrain, zoning, comps, must-include notes, buyer hint (retiree / off-gridder / investor / builder / hunter / remote-worker), target platforms, and photos (at least 1 required; drag-and-drop ordering with one starred primary). Submit creates a priority-1 opus `generate-ad` task with the form as `metadata`, uploads the photos into the task's outputs dir, then fires the worker and routes to `/tasks?focus={id}` (specs.md → Ad photos). |
| `/roadmap` | Read-only list of future-work items from `data/todos.json`; each is a ready-to-run prompt brief. |
| `/settings` | Worker scheduling via `CronConfigPanel`: on/off toggle, interval picker (over the cron-config/worker-status APIs), and a status card (last run, last task, crontab installed). Also marketplace login management via `PostingAuthPanel`: per-platform saved-session status plus an in-dashboard live-view **Connect** login flow (specs.md → Self-hosted live-view login capture). |

### 5.3 Dashboard API

All routes are `force-dynamic`; the worker script consumes the same API over `curl`.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/tasks` | All tasks, sorted by priority asc then recency. |
| POST | `/api/tasks` | Create task (requires `title`; server fills id, timestamps, defaults). |
| GET / PATCH / DELETE | `/api/tasks/{id}` | Read / partial-update / delete one task. PATCH auto-stamps `completedAt` on `status: completed` and protects `id`/`createdAt`. |
| POST | `/api/tasks/{id}/photos` | Multipart photo upload into `workers/workspace/outputs/{id}/photos/` — one file per call, order-prefixed filename required (specs.md → Ad photos). |
| GET | `/api/todos` | Roadmap items. |
| GET / PUT | `/api/cron-config` | Read / update worker schedule. PUT installs or removes the actual crontab entry (marker: `# COMMAND-CENTER-WORKER`). |
| GET | `/api/worker-status` | Cron config + whether the crontab entry is actually installed. |
| POST | `/api/run-worker` | Spawns `run-worker.sh` detached (fire-and-forget); returns pid. This is the on-demand trigger used by the Ad Builder. |
| POST | `/api/kb/ads` | Writes a new sold-ad markdown file (frontmatter + HEADLINE/DESCRIPTION) into `knowledge-base/ads/`, slugified and de-duplicated. Backs "Save to knowledge base". |
| GET / PUT | `/api/files/{...path}` | Sandboxed file browser/editor scoped to `workers/`. GET lists dirs or serves files; PUT writes edits (`.md/.txt/.json/.html/.css/.js` only). Rejects path traversal. |

**Storage:** `dashboard/data/tasks.json`, `todos.json`, `cron-config.json`. All I/O goes through `lib/data.ts` (atomic temp-file+rename writes, serialized write chain). Never import the JSON directly.

### 5.4 Worker

`workers/run-worker.sh`, invoked by cron or `POST /api/run-worker`:

1. Acquire `flock` lockfile; reclaim stale locks older than 35 min (`fuser -k`); exit silently if another worker holds it.
2. Rotate logs (delete per-run logs older than `LOG_RETENTION_DAYS`, default 14; truncate `cron.log` past ~1 MB), then log to `workers/logs/worker-{timestamp}.log` (plus rolling `cron.log`).
3. Dependency check: `curl`, `jq`, `claude`, `timeout`.
4. `GET /api/tasks`; select highest-priority eligible pending task (respecting `parentTaskId` blocking).
5. Claim: `PATCH` to `in_progress` with `startedAt`.
6. Create `workspace/outputs/{task-id}/` and `workspace/notes/{task-id}.md`.
7. Build prompt: task title + description + acceptance criteria + output paths; inject the slash-command workflow file (frontmatter stripped) as a `## Workflow` section; prepend a `## REVISION REQUESTED` section when the marker is present.
8. Run `timeout 1800 claude -p --dangerously-skip-permissions --output-format json --model {task.model} --append-system-prompt "$(cat system-prompt.md)"` (with `--resume {claudeSessionId}` for revisions). Capture and persist the new session id.
9. On success: resolve the primary completion file (README.md → index.* → report.* → output.* → first file), read notes, `PATCH` to `needs_review` — preserving any completionFile/notes Claude already set. Whitelisted slash commands may auto-`complete` instead (tasks with their own review surface).
10. On failure/timeout (exit 124): `PATCH` back to `pending` with an error note — retried on the next run.
11. Always `PUT /api/cron-config` with `lastRun` (and `lastTaskId` when a task ran).

**System prompt** (`workers/system-prompt.md`): deliverables go in the assigned output dir, notes in the notes file, never touch files outside the workspace, follow the Workflow section precisely, always end at `needs_review` (the human decides `completed`), ground work in real data, document errors.

### 5.5 Ad generation (the flagship workflow)

The `generate-ad` slash command (lives at `~/.claude/commands/generate-ad.md`, outside this repo) drives the core product loop:

- **Inputs:** the Ad Builder form payload (task `metadata`), `config/ad-platforms.json`, `knowledge-base/ads/` + `headlines/`, `voice/clean/`, `skills/anti-slop.md`, and the DREAMS rubric at `.claude/skills/dreams-ad-review/SKILL.md` (read by absolute path as a file — the headless worker never invokes skills).
- **Corpus matching:** Claude reads every file in `ads/`, ranks by similarity to the new property (location, acreage, price tier, feature overlap), and uses the top 5 as primary patterns; shorter `days_to_sale` entries get more weight. `headlines/` is used for headline craft only. Backfilled entries whose HEADLINE is just an address are excluded from headline-craft learning.
- **Platform constraints** (`config/ad-platforms.json`): per platform — display name, `headline_max` (60 for Landmodo, 100 elsewhere), `description_max` (1500), and a prose `buyer_profile` describing the marketplace audience and required angle. Generation targets 95–100% of each cap.
- **Property nickname:** each property gets a unique two-word call-attribution nickname (registry: `knowledge-base/property-nicknames.md`), appended to every description as `(Property: Nickname)` so inbound phone calls can be attributed to a listing. The tag's length is carved out of `description_max`.
- **Anti-slop pass:** after the first draft, the workflow loads `skills/anti-slop.md` and does one self-critique + rewrite to strip AI-tells and match the operator's voice.
- **DREAMS review loop:** after the anti-slop and voice passes, every platform variant (headline + description sales copy; nickname tag exempt) is audited inline against the six DREAMS categories, non-Pass variants are revised in the operator's voice, and the loop repeats until all categories pass everywhere or 3 audit cycles are used. DREAMS coaching overrides style rules when they conflict; char caps, factual grounding, and nickname-tag rules are never overridden (specs.md → DREAMS review loop).
- **Output:** one markdown file per target platform (`landmodo.md`, `land_century.md`, `land_com.md`, `landflip.md`, `land_listings.md`, `landhub.md`) with char-counted HEADLINE/DESCRIPTION sections and a "why this angle" note, plus a `README.md` index and a `dreams-review.md` scorecard (final per-platform DREAMS verdicts, cycles used, unresolved weaknesses).

### 5.6 Knowledge base feedback loop

- **`knowledge-base/ads/`** — one markdown file per sold listing: YAML frontmatter (location, acreage, price_usd, sold_on, days_to_sale, platform_sold_on, features, buyer_type, access, utilities, zoning, notes) + `# HEADLINE` + `# DESCRIPTION` (as-posted copy). ~27 entries plus `EXAMPLE.md.template`.
- **Entry paths:** (1) one-click from a task's **Save to knowledge base** modal — pre-fills property facts from the Ad Builder submission, operator adds sale outcome data and pastes the as-posted body; (2) hand-authored backfill.
- **`knowledge-base/headlines/`** — standalone headline corpus for headline-craft pattern matching.
- More entries → sharper future generations. No minimum; 3–5 strong entries already raises the floor.

### 5.7 Voice pipeline

- **`voice/fetch-dialpad.sh`** — pulls recent Dialpad call transcripts via the Dialpad API (`DIALPAD_API_KEY` / `DIALPAD_API_BASE` in `.env.local`; the only external integration in the system). Paginates calls, skips short (<60 s) and already-downloaded ones, writes `voice/raw/{date}-{callId}.txt`. When new files land, it POSTs a `clean-voice` task to the dashboard and triggers the worker.
- **`clean-voice` workflow** — for each raw transcript without a clean counterpart, produces `voice/clean/{name}.md`: fillers, false starts, and nervous repetition removed; PII scrubbed; speaker labels and the operator's sentence structure/idioms preserved; YAML frontmatter (`source`, `cleaned_on`).
- **Privacy requirement:** transcripts contain real customer PII. Clean output must be reviewed before trust; files never leave the machine — read only at ad-generation time. Sensitive transcripts (medical/financial/legal) must be deleted from both raw and clean.

---

## 6. UX / design requirements

Notion-inspired dark minimalism. The principle: **the UI is a document, not an app** — content leads, chrome gets out of the way.

- **Palette:** background `#191919`, cards `#202020`, inputs `#2F2F2F`, 1 px grayscale borders only. Accent teal `#4DAB9A` (approve/save/active). Status: pending gray, in_progress blue `#4DA3D4`, needs_review amber `#D4A04D`, completed teal. Priority dots P1 red → P5 gray. Colored labels appear only as tinted pills (`{color}20` background + solid color text).
- **Typography:** Inter; body `text-sm`, metadata `text-xs`; monospace only for IDs/timestamps/paths; weights capped at 600 in chrome.
- **Layout:** `max-w-5xl` container; tasks are bordered **rows** (not cards) with click-to-expand disclosure; real cards only for forms/settings panels.
- **Hard rules:** no drop shadows, no gradients, no `rounded-xl`+, no focus rings (teal border on focus instead), no icon-per-button, no emoji in UI, no modals for per-item detail (expansion instead — modals are reserved for the file editor and save-to-KB flows), no dense multi-column tables.

---

## 7. Technical constraints and dependencies

- **Runtime:** Node.js 20+, Linux (WSL-compatible). Dashboard on localhost (started via `start.sh` from an `@reboot` cron entry in production mode).
- **Remote access:** a Cloudflare tunnel (`cloudflared`, also started `@reboot`) publishes the dashboard at `dashboard.ownaloha.land`, gated by Cloudflare Access. The app itself has no auth — the edge is the only gate.
- **Worker deps:** `claude` CLI, `curl`, `jq`, `flock`, `timeout`, `fuser`. Optional (live-view login capture only, fail-closed when absent): `xvfb`, `x11vnc`, `websockify`, and the noVNC static client (specs.md → Self-hosted live-view login capture).
- **No database, no in-app auth, no external services** except the Dialpad API for transcript fetch and the Cloudflare tunnel for remote access. Ad platforms have no API integration — enabled ones are posted via browser automation, the rest manually (specs.md → Ad posting).
- **Timeout budget:** 30 min per task; 35 min stale-lock threshold.
- **Config:** `config/paths.json` (external directory roots — never hardcode paths) and `config/ad-platforms.json`.

---

## 8. Known issues / tech debt

- Some knowledge-base entries are backfills whose headlines are not gold-standard copy (flagged in the KB README; the generator must respect this).
- Older records in `dashboard/data/tasks.json` carry absolute `completionFile` paths under the pre-move project root. Harmless — `FileEditorModal` extracts the `workers/...` suffix when building file-API URLs — but the raw path shown in the UI is stale for those tasks.
- `lib/cron.ts` derives the project root from the dashboard process's `cwd`, so crontab entries it writes are only correct if the dashboard was started from the current repo location (a repo move requires a dashboard restart before saving the schedule).

### Resolved 2026-07-05 (v1.1)

- ~~Stale project root (`~/claude/command/command-center`) referenced from `config/paths.json`, `.claude/settings.local.json`, the `generate-ad`/`clean-voice` workflow files in `~/.claude/commands/`, and the live crontab entries~~ — all updated to `~/claude/command-center`. The stale crontab had silently stopped both the 5-minute worker schedule and the `@reboot` dashboard start after the repo was moved.
- ~~`/settings` stub; `CronConfigPanel` not mounted~~ — the panel is now mounted, making scheduled operation manageable from the UI.
- ~~Worker logs accumulate without rotation~~ — `run-worker.sh` now prunes per-run logs older than 14 days (`LOG_RETENTION_DAYS`) and caps `cron.log` at ~1 MB on every run.

---

## 9. Future work (from `/roadmap` and the design docs' extension points)

- Pipeline stages with auto-progression (completing one stage auto-creates the next).
- Scheduled task creation from external triggers (calendars, webhooks).
- Model escalation on failure (haiku/sonnet → opus retry).
- Webhook/Slack notifications when a task hits `needs_review`.
- Parallel workers via per-task claiming (replacing the global lockfile).

---

## Appendix: repository map

```
command-center/
  dashboard/            Next.js app (UI + API + JSON data files)
    app/                Routes: /, /tasks, /ad-builder, /roadmap, /settings, /api/*
    components/         TaskCard, TaskForm, SaveToKbModal, FileEditorModal,
                        CronConfigPanel, Nav, StatusBadge, PriorityIndicator,
                        PhotoPicker, PostingChips, PostingFailureBanner,
                        PostingAuthPanel (saved sessions + live-view Connect)
    lib/                types.ts, data.ts (JSON I/O), cron.ts, utils.ts,
                        capture-server.ts (proxy to the worker capture-server)
    data/               tasks.json, todos.json, cron-config.json
    start.sh            Production start (called from @reboot cron)
  workers/
    run-worker.sh       The execution engine (cron / on-demand entry point)
    run-poster.sh       Marketplace posting orchestrator (specs.md -> Ad posting)
    posting/            Playwright posting scripts; auth/ holds login sessions (secret)
      capture/          Live-view login capture: session/stream/detect/server
                        (specs.md -> Self-hosted live-view login capture)
    system-prompt.md    Claude worker operating rules
    workspace/          outputs/{task-id}/ and notes/{task-id}.md
    logs/               Per-run logs + cron.log
  knowledge-base/
    ads/                Sold-ad corpus (frontmatter + HEADLINE + DESCRIPTION)
    headlines/          Headline-craft corpus
    property-nicknames.md  Call-attribution nickname registry
  voice/
    fetch-dialpad.sh    Dialpad transcript puller (auto-creates clean-voice tasks)
    raw/  clean/        Original and cleaned call transcripts
  skills/
    anti-slop.md        Writing-quality enforcer loaded by generate-ad
  .claude/skills/
    dreams-ad-review/   DREAMS audit rubric read (as a file) by generate-ad
  config/
    paths.json          External directory roots
    ad-platforms.json   Per-platform caps + buyer profiles
    posting-platforms.json  Posting targets: enabled flags + login/new-listing URLs
  research/
    auth-capture-spike/ Auth-capture proposal: report.md + PDF + recon artifacts (specs.md -> Marketplace auth-capture)
  specs/
    readme.md           This document (core system)
    specs.md            Feature log: one summary per shipped feature + spec process
    ad-posting.md       Feature PRD: auto-post approved ads (implemented)
    ad-photos.md        Feature PRD: photo upload/ordering + failure UX (implemented)
    live-view-browser.md  Feature PRD: in-dashboard live-view login capture (implemented)
  *.md                  Original design docs (Blueprint, TLDR, Worker System Spec)
```
