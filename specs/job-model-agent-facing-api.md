# PRD: Local Publish — Part 1 of 3: Publish Job Model & Agent-Facing API

> **Series:** This is the first of three PRDs that move ad posting off the worker box and onto the operator's machine.
> - **Part 1 (this file):** server-side publish-job model, agent-facing API, per-site Publish buttons.
> - **Part 2 (queued):** [specs/local-publish-2-local-agent.md](specs/local-publish-2-local-agent.md) — the local poster agent (headed auth + post as one transaction).
> - **Part 3 (queued):** [specs/local-publish-3-decommission.md](specs/local-publish-3-decommission.md) — delete the live-view/VNC stack and server-side posting remnants.
>
> When this PRD's stories are all complete, copy Part 2 into `PRD.md` and reset `progress.txt`.

## Introduction

Land.com's Akamai edge hard-blocks the worker box's datacenter IP pre-auth (see `research/land-com-connect-spike/report.md`), killing both login capture and posting from the server. The decision: retire server-side posting entirely and run the poster on the operator's machine, from their residential IP. Posting becomes per-site: each land site gets its own **Publish** button, and clicking it authenticates (if needed) and posts the ad as one transaction on the operator's machine.

The dashboard stays on the server. A **local poster agent** (built in Part 2) polls the dashboard for publish jobs — outbound-only from the operator's machine, so no inbound port or tunnel to the laptop is needed. This PRD builds everything server-side that the agent will talk to: the publish-job state model, the agent-facing API (token-authed), the per-site Publish UI, and the removal of server-side poster pickup so the box can never grab a job meant for the agent.

**Architecture after all three parts:**

```
Operator's machine                        Linode server
┌──────────────────────────┐             ┌─────────────────────────┐
│ poster agent (poll loop) │──outbound──▶│ dashboard (Next.js)     │
│  ├─ headed Chromium      │   HTTPS     │  ├─ tasks.json          │
│  │   (login + post, one  │             │  ├─ /api/publish-jobs   │
│  │    transaction)       │             │  ├─ outputs/ + photos   │
│  └─ auth/*.json (local)  │             │  └─ per-site Publish UI │
└──────────────────────────┘             └─────────────────────────┘
```

## Goals

- Each enabled platform gets a per-task **Publish** button; clicking it queues a publish job for that one platform. This fully replaces the approve-time queue-everything flow.
- A token-authenticated agent API: list queued jobs, atomically claim one, download the ad copy + photos, report status, upload proof screenshots.
- New posting status `awaiting_auth` so the dashboard can show "waiting for you to log in" while the agent has a headed browser open.
- Server-side poster kickoff (cron + `/api/run-poster`) is removed in this part, so queued jobs are only ever consumed by the local agent.
- Part 1 is done when a publish click produces a job that can be listed, claimed, progressed, and completed end-to-end with `curl` — no agent required yet.

## User Stories

### US-001: Extend the posting state model
**Description:** As a developer, I need the `AdPosting` type to model the new per-site publish lifecycle so later stories have a schema to build on.

**Acceptance Criteria:**
- [x] `AdPosting.status` union in `dashboard/lib/types.ts` gains `'awaiting_auth'` (full set: `queued | posting | awaiting_auth | posted | failed`)
- [x] Any exhaustive switch/map over posting statuses (e.g. in `PostingChips.tsx`, `PostingFailureBanner.tsx`) handles the new value without type errors (placeholder label is fine; real UI is US-008/US-009)
- [x] Typecheck passes

### US-002: Agent token auth helper
**Description:** As a developer, I need a shared auth guard for agent-facing endpoints, since the dashboard API will now be reachable from outside localhost.

**Acceptance Criteria:**
- [x] New `dashboard/lib/agent-auth.ts` exporting `requireAgentToken(request): NextResponse | null` (null = authorized)
- [x] Reads `AGENT_TOKEN` from env with the same root-`.env.local` fallback pattern used in `dashboard/lib/capture-server.ts:31-45`
- [x] Compares `Authorization: Bearer <token>` using `crypto.timingSafeEqual`
- [x] Fails closed: if `AGENT_TOKEN` is unset, every guarded request gets 503 with a clear message
- [x] Typecheck passes

### US-003: Publish endpoint
**Description:** As an operator, clicking Publish must create a queued publish job for exactly one platform on one task.

**Acceptance Criteria:**
- [x] `POST /api/tasks/[id]/publish` with body `{platform}` (browser-called, no agent token)
- [x] 400 if the platform is not `enabled: true` in `config/posting-platforms.json`; 404 if task missing
- [x] Creates or replaces that platform's entry in `task.postings[]` as `{platform, status:'queued', attempts: prev+1, queuedAt: now}` (preserving other platforms' entries)
- [x] 409 if that platform's posting is currently `queued`, `posting`, or `awaiting_auth`
- [x] Re-publishing a `failed` or `posted` entry is allowed (that's the retry/repost path)
- [x] Typecheck passes

### US-004: List queued jobs (agent API)
**Description:** As the local agent, I need to see all queued publish jobs so I can pick up work.

**Acceptance Criteria:**
- [x] `GET /api/publish-jobs` guarded by `requireAgentToken`
- [x] Returns `{jobs: [{taskId, taskTitle, platform, queuedAt, attempts}]}` for every posting with status `queued` across all tasks
- [x] Records the poll time (e.g. `dashboard/data/agent-status.json` `{lastSeenAt}`) so the UI can later show agent online/offline
- [x] Verified with `curl`: wrong/missing token → 401; correct token → job list
- [x] Typecheck passes

### US-005: Claim a job (agent API)
**Description:** As the local agent, I need to atomically claim a queued job so a job is never picked up twice.

**Acceptance Criteria:**
- [x] `POST /api/publish-jobs/claim` with body `{taskId, platform}`, guarded by `requireAgentToken`
- [x] Uses the existing `dashboard/lib/data.ts` write mutex; flips the posting `queued → posting` and returns the full task
- [x] 409 if the posting is not currently `queued`
- [x] Verified with `curl`: claim succeeds once, second identical claim returns 409
- [x] Typecheck passes

### US-006: Publish bundle endpoint (ad copy + photo list)
**Description:** As the local agent, I need to download everything required to post — the ad copy and the photos — since I don't share a filesystem with the server anymore.

**Acceptance Criteria:**
- [ ] `GET /api/tasks/[id]/publish-bundle?platform=<key>` guarded by `requireAgentToken`
- [ ] Returns `{adCopy: <string, contents of outputs/<taskId>/<platform>.md>, photos: [<repo-relative paths servable via /api/files>]}`
- [ ] 404 with a clear message if the ad-copy file is missing; `photos: []` if the photos dir is empty
- [ ] Confirm `GET /api/files/[...path]` serves the listed photo paths with the agent token accepted (add the token check there only if the route is currently unauthenticated — do not break existing dashboard `<img>` usage)
- [ ] Verified with `curl` against a real task in `outputs/`
- [ ] Typecheck passes

### US-007: Proof screenshot upload (agent API)
**Description:** As the local agent, I need to upload the proof-of-posting screenshot so it appears in the dashboard like today.

**Acceptance Criteria:**
- [ ] `POST /api/tasks/[id]/proof?platform=<key>` guarded by `requireAgentToken`, body = PNG bytes
- [ ] Writes to `workers/workspace/outputs/<taskId>/postings/<platform>.png` (same path the old poster used, so existing screenshot display keeps working)
- [ ] Rejects non-PNG payloads and paths outside the outputs dir
- [ ] Verified with `curl --data-binary @some.png` and the file appearing on disk
- [ ] Typecheck passes

### US-008: Per-site Publish buttons on the task card
**Description:** As an operator, I want a Publish button per land site on each ad task so I control exactly what gets posted where, one site at a time.

**Acceptance Criteria:**
- [ ] `TaskCard.tsx`: for ad-builder tasks, render one Publish button per `enabled` platform (from `GET /api/posting-platforms`), each calling `POST /api/tasks/[id]/publish`
- [ ] Approve no longer queues postings: remove `buildQueuedPostings()` and the `POST /api/run-poster` call from `approve()` — Approve only approves the ad copy
- [ ] Button label reflects state: "Publish" (no entry / failed), disabled while `queued`/`posting`/`awaiting_auth`, "Publish again" when `posted`
- [ ] Typecheck passes
- [ ] Verify changes work in browser

### US-009: Posting chips reflect the new lifecycle
**Description:** As an operator, I want each site's chip to show where its publish job is, including "waiting for login".

**Acceptance Criteria:**
- [ ] `PostingChips.tsx` renders `awaiting_auth` as a distinct chip (e.g. "Waiting for login…")
- [ ] The Retry action calls `POST /api/tasks/[id]/publish` (re-queue) instead of `POST /api/run-poster`; remove the `MAX_ATTEMPTS` auto-retry copy (retries are now manual re-publishes)
- [ ] `failed` chips still surface `lastError` on hover/popover
- [ ] Typecheck passes
- [ ] Verify changes work in browser

### US-010: Retire server-side poster kickoff
**Description:** As a developer, I must make sure the worker box can never pick up a publish job, because posting from its blocked datacenter IP is the known-bad path.

**Acceptance Criteria:**
- [ ] Delete `dashboard/app/api/run-poster/route.ts` and all remaining callers
- [ ] `dashboard/lib/cron.ts` no longer installs the `# COMMAND-CENTER-POSTER` crontab line, and removes it from the crontab if present (the `# COMMAND-CENTER-WORKER` line is untouched)
- [ ] Delete `workers/run-poster.sh`
- [ ] `grep -r "run-poster" dashboard/ workers/` returns no live references (docs/specs mentions are fine)
- [ ] Typecheck passes

## Non-Goals

- No local agent yet — that is Part 2. After Part 1, publish jobs queue and are drivable via `curl`, and that's the intended state.
- No deletion of the live-view/capture stack (`workers/posting/capture/*`, `posting-auth` proxy routes, `PostingAuthPanel`) — Part 3.
- No new platform posters: only `landmodo` and `land_com` have `post-*.ts` implementations; the other four platforms stay `enabled: false` and get no Publish button.
- No LandFeed API integration (separate track, gated on OT-C).
- No password storage, CAPTCHA solving, or fingerprint/stealth tooling — ever.
- No multi-agent/multi-operator support: one agent token, one operator.

## Technical Considerations

- `dashboard/data/tasks.json` is the only posting state store; all writes must go through the existing `dashboard/lib/data.ts` mutex — never write the file directly.
- `postings[]` PATCH via `/api/tasks/[id]` is a full-array replace (`dashboard/app/api/tasks/[id]/route.ts:16-32`); endpoints that touch one platform's entry must read-modify-write the whole array under the mutex.
- The agent token is a secret on the same footing as `auth/*.json`: root `.env.local`, chmod 600, never logged. Transport security comes from however the dashboard is already exposed (Tailscale/tunnel + HTTPS); the token is defense in depth.
- Keep `workers/posting/post.ts` and `post-*.ts` untouched in this part — Part 2 reworks how they're invoked.
