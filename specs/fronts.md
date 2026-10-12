# PRD: Fronts (proactive, per-lane "what's next" for the operator)

**Status:** Implemented (2026-10-12); the SessionEnd hook itself is installed by the operator with `workers/fronts/install-hook.sh` after a real `/clear` rehearsal (see specs.md → Fronts)
**Date:** 2026-10-11
**Source:** Roman Colman, "Combinatorial Ralph Loops and Proactive Fronts" (Trajectory Engineers, recorded about 2026-10-08), the section from 50:50 to the end. Transcript: `operator-input/fronts-lecture-2026-10-08/transcript-fronts-section.md`.

## Introduction

A **front** is one of the handful of things the operator works on every day (Roman: "everyone has a specific capped amount of things that they do in their day to day, that can be broken into categories"). Each front is two markdown files:

- `north-star.md`: hand-written by the operator, immutable to agents. What the thing is, what good looks like, a few reference examples. Lean enough to inject into any Claude session with `@`.
- `now.md`: dynamic, agent-maintained. Where we are, what happened in the last session, what is next. Also injected at the start of a session ("what's next? let's figure out what's next").

The system that keeps `now.md` honest is a **session-end pipeline**. When a Claude Code session ends, a hook (1) summarizes the session into a persistent memory file, (2) asks a cheap model which front (lane) the session belonged to, usually one, sometimes two, and (3) for that front spawns a `claude -p` that is given the session summary, `north-star.md`, `now.md`, and the recent memory for that front, and answers two questions: **what's next for the operator** and **what could an autonomous agent do**. A second pass rewrites `now.md`. Suggestions land in the dashboard's review bin as ready-to-run prompts; the operator reads them, adds notes, and clicks Approve, which "reverse maps" the suggestion into a pending task that the existing worker picks up. One rule Roman added after watching the first version suggest nonsense: **if it isn't obvious, or there are blockers the operator can answer, ask the operator instead of suggesting work.** Those open questions show up in the same review bin, the operator dictates an answer, and the next run has it.

Why this matters here: the command center already has the back half (task queue, worker, needs review, approval). What it lacks is the front half, something that knows what the operator is working on across repos and sessions and proposes the next piece of work in context. Roman's framing: "it's not only an organizational tool, it's also an autonomous tool," and "you're never gonna get a one-size-fits-all system that can do this; you have to have a system that you built yourself." So the fronts themselves, and every north star, are the operator's homework (lecture 1:18:57 to 1:21:16), not something this feature generates.

Decisions confirmed by the operator on 2026-10-12 (the options considered are listed at the end):
- Fronts live in the command-center repo under `fronts/<slug>/`, registry in `config/fronts.json`. Sessions in other repos (`followupdominator`, `land-ad-pipeline`, the job) still route here, because the hook is global.
- Five fronts: `land-sales`, `buyer-followup`, `land-ad-pipeline`, `day-job`, `ai-concierge`.
- Suggestions and questions are a new record type (`front-suggestions.json`), not tasks, until approved. Approval creates a real task through `POST /api/tasks` so the worker, DREAMS gate, and review flow stay untouched. They are reviewed on the front's own page and also appear as pseudo-cards inside the Tasks page's Needs review filter.
- The SessionEnd hook is global (`~/.claude/settings.json`): every Claude Code session on this box routes to a front.
- Lane routing uses Jev (TypeSafe Choice, already wired in `dashboard/lib/typesafe.ts`) with a `claude -p --model haiku` structured-output fallback when no key is configured. Summaries use haiku, the "what's next" pass uses opus. Roman named "a haiku agent or Jev" for routing.
- The nightly usage-aware autopilot that picks approved tasks up on its own when the plan has spare capacity is a follow-up spec, not part of this one.

## Goals

- Every Claude Code session on this machine that lasts more than a few turns leaves a dated summary in `fronts/memory/` and updates exactly the front(s) it belonged to. Nothing routes to the wrong front silently: low-confidence routing becomes a question for the operator.
- After a session ends, within about five minutes the front's `now.md` reflects it, and the dashboard shows new suggestions or questions for that front.
- Approving a suggestion creates a pending task (with the operator's notes folded into the description) and fires the worker, with no manual copying.
- The operator spends review time in one place: the Tasks page shows how many front suggestions and questions are waiting, and the Fronts page is where they are handled.
- The whole pipeline is testable offline with a stub `claude` (same pattern as `workers/dreams-gate.test.sh`) and never touches production tasks during tests.
- Cost per session end stays under about a dollar (one haiku summary, one Jev or haiku route, one opus pass per routed front) and never runs twice for the same session.

## User Stories

### US-001: Front registry and directory scaffold
**Description:** As the operator, I want a fixed place to write each front's north star so the rest of the system has something to read.

**Acceptance Criteria:**
- [x] `config/fronts.json` exists with an array of fronts: `{ "slug", "name", "description", "cwdHints": [], "enabled": true }`. `description` is one paragraph written for the router ("this session belongs here when ..."). `cwdHints` are repo paths that bias routing (e.g. `~/claude/followupdominator`).
- [x] `fronts/README.md` explains the two files per front, who writes which, and that agents never edit `north-star.md`.
- [x] `fronts/_template/north-star.md` and `fronts/_template/now.md` exist. The north-star template has headings: What this is, What good looks like, References (few-shot examples, paths or links), Boundaries (what an agent must never do here). The now template has: Last session, Where we are, Next for Daniel, Candidate agent work, Answers from Daniel, Open questions.
- [x] Seed directories are created for the five fronts the operator chose on 2026-10-12, with the template copied in and a `TODO: hand-write` marker on the first line of each `north-star.md`; the operator replaces them by hand. Registry entries and routing hints:
  - `land-sales`: listings, ad generation, DREAMS gate, posters, photos. `cwdHints`: `~/claude/command-center` (default when nothing else matches inside this repo).
  - `buyer-followup`: eBay sales and messages, inquiries, Investment Dominator, PATLive intake, payment rails. `cwdHints`: `~/claude/followupdominator`, `~/claude/command-center/workers/patlive-intake`, `~/claude/command-center/operator-input`.
  - `land-ad-pipeline`: the operator-agnostic rebuild. `cwdHints`: `~/claude/land-ad-pipeline`.
  - `day-job`: tickets and project work at the operator's employer. `cwdHints`: left empty in the seed; the operator fills in the work repo paths, and anything under them is routed here before Jev is asked (client code never leaves the summary step).
  - `ai-concierge`: the concierge practice, business plan, podcast playbook. `cwdHints`: `~/claude/command-center/research/ai-concierge`, `~/claude-accessible/dev/bwai-transcripts`.
- [x] `fronts/memory/` exists with a `.gitkeep`. Memory files are committed (they are the system's long-term context), but anything matching `fronts/memory/*-private.md` is gitignored for sessions the operator marks private.
- [x] `dashboard/lib/fronts.ts` exports `getFronts()` (registry merged with file mtimes and a 300-character `now.md` excerpt), `getFront(slug)` (north star text, now text, last 10 memory entries for that front, parsed from frontmatter), `writeNorthStar(slug, text)`, `writeNow(slug, text)`. All file access goes through `path.resolve(process.cwd(), '..')` like the other config readers (AGENTS.md rule).
- [x] Typecheck passes

### US-002: Suggestion and question records with an API
**Description:** As the operator, I want suggestions and questions stored as their own records so they can wait for review without polluting the task queue.

**Acceptance Criteria:**
- [x] `dashboard/data/front-suggestions.json` holds `FrontSuggestion[]`: `{ id, frontSlug, kind: 'task' | 'question', title, body, sourceSessionId, sourceMemoryFile, status: 'open' | 'approved' | 'dismissed' | 'answered', operatorNotes?, answer?, taskId?, createdAt, resolvedAt? }`. Type added to `dashboard/lib/types.ts`.
- [x] Reads and writes go through `dashboard/lib/data.ts` using the same write mutex as tasks.
- [x] `GET /api/fronts/suggestions?front=<slug>&status=open` lists; `POST /api/fronts/suggestions` accepts an array (the pipeline posts a batch) and drops unknown fields; `PATCH /api/fronts/suggestions/<id>` handles `{ status: 'dismissed' }`, `{ status: 'answered', answer }`, and `{ status: 'approved', operatorNotes }`.
- [x] Approving a `task` suggestion calls `createTask` with `title`, `description` = suggestion body plus an `## Operator notes` section when notes were given, `type` from the suggestion (default `Building`), `priority` 3, `model` from the suggestion (default `sonnet`), `tags: ['front:<slug>']`, `metadata.frontSlug`, `metadata.suggestionId`; stores the new `taskId` on the suggestion; and fires the worker the same way `/api/run-worker` does.
- [x] POST from the pipeline is guarded by the same bearer check as the publish-job routes (`dashboard/lib/agent-auth.ts`), so a stray process cannot fill the review bin.
- [x] Unit test in `dashboard/lib/` for the approve mapping (suggestion in, task fields out).
- [x] Typecheck passes

### US-003: Front read and write API
**Description:** As the dashboard, I need routes for front content so client components never touch the filesystem.

**Acceptance Criteria:**
- [x] `GET /api/fronts` returns the registry with `nowExcerpt`, `nowUpdatedAt`, `lastSessionAt`, `openSuggestions`, `openQuestions` per front.
- [x] `GET /api/fronts/<slug>` returns north star, now, and the last 10 memory entries (`{ file, date, cwd, summary }`).
- [x] `PUT /api/fronts/<slug>/north-star` and `PUT /api/fronts/<slug>/now` write the file (operator edits). `now` writes keep the file's `## Answers from Daniel` section intact unless the body includes it.
- [x] Unknown slug returns 404; slugs are validated against the registry, never used to build a path directly.
- [x] Typecheck passes

### US-004: Session summary script
**Description:** As the pipeline, I need a session turned into a short memory file so routing and "what's next" have something cheap to read.

**Acceptance Criteria:**
- [x] `workers/fronts/summarize-session.sh <transcript.jsonl> <session_id> <cwd>` extracts user and assistant text (tool results and tool-call bodies dropped, file paths touched kept as a list), caps the input at about 60k characters by keeping the first and last thirds, and runs one tool-less `claude -p --model haiku --json-schema` session that returns `{ summary, decisions[], files_touched[], open_threads[], user_turns }`.
- [x] Writes `fronts/memory/<YYYY-MM-DD>-<HHMM>-<session_id_prefix>.md` with frontmatter (`session_id`, `cwd`, `started_at`, `ended_at`, `front: unrouted`, `user_turns`) and the summary body, and prints the path on stdout.
- [x] Sessions with fewer than 3 user turns are skipped (exit 0, nothing written). Sessions whose cwd is `/tmp` or whose first user turn starts with the worker's system-prompt marker are skipped.
- [x] Scripts append `~/.local/bin` to PATH (never prepend) so a stub `claude` earlier on PATH wins in tests.
- [x] `workers/fronts/fronts.test.sh` covers this script with a stub `claude` and a fixture transcript (no API spend).

### US-005: Lane routing
**Description:** As the pipeline, I need to know which front a session belonged to without reading it myself.

**Acceptance Criteria:**
- [x] `POST /api/fronts/route` (bearer-guarded) takes `{ summary, cwd, files_touched }` and returns `{ fronts: [{ slug, probability }], confidence, method: 'jev' | 'claude' | 'cwd' }`.
- [x] Uses `dashboard/lib/typesafe.ts` with one Choice question whose criteria are the registry descriptions plus a `none` option; state is the summary, cwd, and the files list. A `cwdHints` match adds a deterministic bias in code (not in the prompt).
- [x] When `isConfigured()` is false, falls back to a `claude -p --model haiku --json-schema` call with the same options; when both fail, returns `none`.
- [x] Thresholding lives in `workers/fronts/route-session.sh`: top pick at or above 0.6 routes; a second pick above 0.3 also routes (Roman: "typically it's one, but sometimes it can be two"); otherwise the session is filed as `unrouted` and a `question` suggestion is posted ("Which front was this session about?") with the summary as body. The memory file's `front:` frontmatter is updated with the result.
- [x] Covered by `fronts.test.sh` with a stubbed API response.
- [x] Typecheck passes

### US-006: "What's next" pass and now.md rewrite
**Description:** As the operator, I want each routed front to end up with a fresh `now.md` and concrete, reviewable suggestions or questions.

**Acceptance Criteria:**
- [x] `workers/fronts/whats-next.sh <slug> <memory-file>` builds a prompt from: the front's `north-star.md`, current `now.md` (including `## Answers from Daniel`), the new memory file, and the previous 5 memory files for that front. Instruction text lives in `workers/fronts/whats-next-prompt.md` and says, in this order: first spawn a subagent to research `fronts/memory/` for this front if more context is needed; answer "what's next for Daniel" and "what could an autonomous agent do end to end"; **if it isn't obvious, or there are blockers Daniel can answer, ask Daniel instead of suggesting work**; never edit `north-star.md`; keep suggestions to things the existing worker can do with a prompt (a slash command from `~/.claude/commands` may be named).
- [x] Runs `claude -p --model opus --json-schema` with tools limited to Read, Grep, Glob on `fronts/` and returns `{ now_md, suggestions: [{ title, prompt, type, model, slashCommand? }], questions: [{ question, why_it_matters }] }`.
- [x] Writes `now.md` from `now_md`, preserving the `## Answers from Daniel` section and prepending a `## Last session` block with the memory file's date and summary; keeps a `## Yesterday` line (Roman shows a "what I did yesterday" flow) computed in code from memory files dated the previous day.
- [x] Posts suggestions and questions to `POST /api/fronts/suggestions` in one batch; de-duplicates against open suggestions for the front by normalized title.
- [x] Per-front lock file in `workers/fronts/locks/<slug>.lock` with a 20-minute coalesce window: a second session ending inside the window appends its memory file to a pending list and the next run reads them all.
- [x] Logs to `workers/logs/fronts-<date>.log`; a failed opus run leaves `now.md` untouched and posts one question ("What's-next failed for <slug>: <reason>") so nothing fails silently.
- [x] Covered by `fronts.test.sh` with a stub `claude` returning a fixture JSON.

### US-007: Session-end hook and installation
**Description:** As the operator, I want all of this to happen on its own when I close or `/clear` a session.

**Acceptance Criteria:**
- [x] `workers/fronts/on-session-end.sh` reads the hook JSON on stdin (`session_id`, `transcript_path`, `cwd`, `reason`), exits immediately when `FRONTS_SKIP=1` is in the environment (set by `workers/run-worker.sh`, the DREAMS gate scripts, and every `workers/fronts/*.sh` so pipeline sessions never recurse), and otherwise detaches a background runner (`setsid nohup`) that chains summarize, route, and what's-next, so the hook itself returns in under a second.
- [x] A per-session marker in `workers/fronts/state/processed/<session_id>` prevents double runs when the hook fires twice.
- [ ] (operator step) `workers/fronts/install-hook.sh` adds a `SessionEnd` entry to `~/.claude/settings.json` with `jq` (idempotent, keeps existing hooks, prints the diff) and `--uninstall` removes it. The hook is global because fronts span repos.
- [x] A dry-run mode (`FRONTS_DRY_RUN=1`) runs the chain against a copy of the fronts directory under `/tmp` and posts to `DASHBOARD_URL` (default `http://localhost:3000`), so it can be exercised against a temp `next dev -p 3001` as described in AGENTS.md.
- [x] `fronts.test.sh` covers the skip rules and the processed marker.

### US-008: Fronts list page
**Description:** As the operator, I want one page that shows every front and what is waiting on each.

**Acceptance Criteria:**
- [x] `Nav.tsx` gains a `Fronts` item between Tasks and Roadmap.
- [x] `/fronts` renders one card per enabled front: name, `now.md` excerpt, "last session" relative time, and two counters (suggestions, questions) that link to the front page. Disabled fronts are listed under a collapsed "Inactive" heading.
- [x] Empty state when the registry is empty points at `fronts/README.md`.
- [x] Typecheck passes
- [x] Verify changes work in browser

### US-009: Front detail page
**Description:** As the operator, I want to read and edit a front's two files and see its recent sessions in one place.

**Acceptance Criteria:**
- [x] `/fronts/<slug>` shows `north-star.md` (rendered markdown, Edit opens the existing `FileEditorModal` and saves through `PUT .../north-star`), `now.md` (rendered, with "updated <relative time>" and an Edit for manual corrections), and a Recent sessions list (date, cwd basename, first line of the summary; click expands the full memory entry).
- [x] A "Copy @ paths" button copies `@fronts/<slug>/north-star.md @fronts/<slug>/now.md` for pasting into a new Claude session (the lecture's "inject both with the at symbol").
- [x] Typecheck passes
- [x] Verify changes work in browser

### US-010: Review suggestions and answer questions
**Description:** As the operator, I want to approve, annotate, dismiss, or answer what the front proposed, from the front page.

**Acceptance Criteria:**
- [x] On `/fronts/<slug>`, a Suggestions section lists open `task` suggestions with title, the full prompt (collapsed), a notes textarea, and Approve and Dismiss buttons. Approve PATCHes `approved` with notes, shows the new task id with a link to `/tasks`, and removes the card.
- [x] A Questions section lists open `question` suggestions with the question, why it matters, an answer textarea, and Answer. Answering PATCHes `answered` and appends `- <date>: Q: ... A: ...` to the front's `## Answers from Daniel` section in `now.md`.
- [x] A "Refresh what's next" button calls `POST /api/fronts/<slug>/refresh`, which spawns `whats-next.sh` detached (same pattern as `/api/run-worker`), and the page polls `/api/fronts/<slug>` until `nowUpdatedAt` changes.
- [x] Typecheck passes
- [x] Verify changes work in browser

### US-011: Needs-review integration on the Tasks page
**Description:** As the operator, I want front suggestions and questions to show up inside the Tasks page's Needs review view, since that is where I already spend review time.

**Acceptance Criteria:**
- [x] `/tasks` shows a compact strip above the list (pattern: `PostingFailureBanner`) reading "Fronts: N suggestions, M questions waiting" with per-front links, hidden when both are zero. Data from `GET /api/fronts`.
- [x] With the "Needs review" filter active, open suggestions and questions render as pseudo-cards (`FrontSuggestionCard`, visually distinct from `TaskCard`: front name chip, kind label, no status badge) interleaved before the `needs_review` tasks, newest first. The filter count includes them ("Needs review 7" = 4 tasks + 3 front items).
- [x] A pseudo-card carries the same controls as US-010 (notes + Approve, Dismiss, or Answer) and calls the same PATCH route; after an action the card disappears and the task list reloads so an approved suggestion shows up as a pending task.
- [x] The "All" filter does not show pseudo-cards (they are not tasks); only "Needs review" does.
- [x] Task cards created from a suggestion show a `front:<slug>` tag chip linking back to the front page.
- [x] Typecheck passes
- [x] Verify changes work in browser

### US-012: Documentation and feature log
**Description:** As a future session, I need the shipped shape recorded where the repo expects it.

**Acceptance Criteria:**
- [x] `specs/specs.md` gains a Fronts summary (data model, API routes, scripts, hook install, invariants: agents never write `north-star.md`; `FRONTS_SKIP`; lock window; bearer guard on pipeline POSTs).
- [x] `specs/readme.md` repo map and data-flow updated (new `fronts/` directory, new nav item, the SessionEnd hook as a fourth trigger next to cron and on-demand).
- [x] `AGENTS.md` gains the testing recipe (stub `claude`, `FRONTS_DRY_RUN`, temp `next dev -p 3001`, what to delete afterwards).
- [x] This PRD's header set to `**Status:** Implemented (<date>)`.

## Non-Goals

- No automatic generation of `north-star.md`. The operator hand-writes every front (lecture homework). Seeds are templates with a TODO marker.
- No nightly usage-aware autopilot (Roman's "under 36 hours to reset and over 60% usage left, pick up approved tasks in a worktree"). Follow-up spec: `specs/fronts-autopilot.md`.
- No voice input in the dashboard. Answers are typed; the operator's local dictation tool already types into any textarea.
- No multi-user, no editing fronts from the phone beyond what the existing tunnel already allows.
- No routing of sessions from other machines (the poster laptop). Only this box's `~/.claude/settings.json` gets the hook.
- No changes to the worker, the DREAMS gate, or the task schema beyond the `tags` and `metadata` fields already supported.
- No assistant-authored edits to `north-star.md`, ever, including "small fixes".

## Technical Considerations

- **Hook mechanics (checked against the Claude Code docs, 2026-10-11).** `SessionEnd` receives `session_id`, `transcript_path`, `cwd`, `hook_event_name`, and `reason` on stdin; `reason` is one of `clear`, `resume`, `logout`, `prompt_input_exit`, `other`. It fires on `/clear`, exit, `/resume` switches, and on SIGTERM for `claude -p` runs; a terminal closed with SIGHUP is not documented, so do not count on it. **The default SessionEnd budget is 1.5 seconds**, not the usual 600, and a per-hook `timeout` raises it to at most 60 seconds. That is why `on-session-end.sh` must only write the processed marker and detach (`setsid nohup ... &`, stdio closed) before exiting. The docs also offer `"async": true` on a command hook, but they do not say whether children survive the parent's exit, so US-007 must test detachment against a real `/clear` before the hook is installed. Hooks inherit the parent environment, which makes `FRONTS_SKIP=1` a reliable recursion guard for every `claude -p` the worker and the pipeline spawn. `claude -p --bare` would also skip hooks, but it skips settings and slash commands too, so the worker keeps the env guard instead. Docs: https://code.claude.com/docs/en/hooks#sessionend
- **Transcript format.** `transcript_path` is a JSONL file under `~/.claude/projects/<cwd-slug>/<session-id>.jsonl`, one JSON object per message, tool use, or metadata entry. The docs call the entry shape internal and subject to change, so the extractor in US-004 must be defensive (keep any `role: user|assistant` text blocks it can find, ignore the rest) and ship with a scrubbed fixture from a real short session so a format change shows up as a failing test, not as empty summaries. The transcript can lag the final turn by a moment; the detached runner should wait a few seconds before reading it.
- **Structured output.** `claude -p --output-format json --json-schema '<schema>'` returns the validated object in the `structured_output` field of the JSON result (`result` holds the text, plus `session_id`, `usage`, `total_cost_usd`). Scripts read `jq '.structured_output'` and treat a missing field as a failure.
- **Usage for the follow-up autopilot.** There is no documented usage API or hook field. The status line script receives `rate_limits.five_hour` and `rate_limits.seven_day` (`used_percentage`, `resets_at`) for Pro/Max accounts after the first response in a session, so the supported-ish route is a status line script that persists those values to a file (Roman: "it's in the status line"). Record that in `specs/fronts-autopilot.md` when it is written.
- **Writes through the API.** The pipeline never edits `dashboard/data/*.json` directly (AGENTS.md mutex rule). It POSTs suggestions and PATCHes memory routing results; file writes under `fronts/` are the pipeline's own and do not go through the dashboard.
- **Models and cost.** Summary: haiku, tool-less, a few cents. Route: Jev (sub-cent) or haiku. What's next: opus with read-only tools on `fronts/`, roughly 30 to 90 seconds and well under a dollar. Keep the judge-model lesson from the DREAMS gate in mind: haiku is fine for extraction and routing, not for the "what's next" judgment.
- **Reuse.** `FileEditorModal` for editing, `PostingFailureBanner` for the Tasks strip, `formatRelative` from `dashboard/lib/utils.ts`, `createTask` and the run-worker spawn code, `readProjectEnvVar` for `AGENT_TOKEN` and `TYPESAFE_API_KEY`, the stub-`claude` test harness from `workers/dreams-gate.test.sh`.
- **Privacy.** Memory files summarize everything the operator did in a session, including client work. Keep them in the repo (private GitHub) but give the operator a `-private.md` suffix convention that is gitignored, and never post full transcripts to the dashboard.
- **Ordering.** US-001 to US-003 are pure data and API, safe to build and test without any hook installed. US-004 to US-006 are scripts testable offline. US-007 is the only story that changes the machine's global Claude config, so it goes last among the backend stories and is installed by hand after a dry run against a temp dev server.

## Decisions record

Options put to the operator on 2026-10-11, answered 2026-10-12: fronts 1C (own list: land-sales, buyer-followup, land-ad-pipeline, day-job, ai-concierge), hook scope 2A (global), suggestion surface 3B (Fronts page plus pseudo-cards in the Tasks page's Needs review filter), routing 4A (Jev with haiku fallback), autopilot 5A (separate follow-up spec). The stories above already reflect them.
