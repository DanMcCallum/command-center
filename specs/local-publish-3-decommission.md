# PRD: Local Publish — Part 3 of 3: Decommission Server-Side Posting & Live-View

**Status:** Draft

> Series: Part 1 = publish job model · Part 2 = [local-publish-2-local-agent.md](local-publish-2-local-agent.md) · **Part 3 = this file** — implementation started 2026-07-12, after Part 2 shipped.

## Introduction

Parts 1–2 made the local agent the only consumer of publish jobs, with headed auth on the operator's real desktop. That strands the entire server-side capture apparatus: the Xvfb/x11vnc/websockify/noVNC streaming stack, the paste relay, the capture HTTP server, and the dashboard's live-view proxy routes and embed. This part deletes all of it, reworks the Settings auth panel into a read-only view fed by agent reports, and adds an agent online/offline indicator so Publish buttons aren't clicked into the void.

Deletion is the point: every line of the VNC stack that survives is a line someone will someday try to run on the box again.

## Goals

- Zero live-view/VNC code left in the repo; zero `CAPTURE_*` env vars needed.
- Settings panel shows per-platform session status as reported by the agent (which owns the sessions now), not server-side file mtimes.
- Dashboard shows whether the agent is online, and Publish warns when it isn't.
- Specs and config reflect the new architecture so the next feature doesn't build on ghosts.

## User Stories

### US-001: Agent heartbeat and session-status reporting
**Description:** As the operator, I want the dashboard to know the agent is alive and which platform sessions it holds, since the server can no longer see `auth/*.json`.

**Acceptance Criteria:**
- [x] New `POST /api/agent-status` (agent-token guarded): agent reports `{platforms: [{platform, hasSession, capturedAt, earliestCookieExpiry?}]}` on startup and after every login capture
- [x] `GET /api/publish-jobs` polling already stamps `lastSeenAt` (Part 1 US-004); expose both via `GET /api/agent-status` for the UI (browser-called, no token)
- [x] Agent (`workers/posting/agent.ts`) sends the report by scanning its local `auth/` dir (names, mtimes, expiry timestamps — never cookie values)
- [x] Typecheck passes

### US-002: Publish buttons respect agent liveness
**Description:** As the operator, I want to know before clicking Publish that nothing will happen because the agent isn't running.

**Acceptance Criteria:**
- [x] Task page surfaces agent state from `GET /api/agent-status`: online if `lastSeenAt` within 3× poll interval, else offline
- [x] Publish buttons show a warning state/tooltip when the agent is offline ("Poster agent offline — start it on your machine"); clicking still queues (job runs when the agent comes back)
- [x] Typecheck passes
- [x] Verify changes work in browser

### US-003: Rework the Settings auth panel to read-only agent reports
**Description:** As the operator, I want Settings to show each platform's session state from the agent, replacing the connect-via-live-view flow.

**Acceptance Criteria:**
- [x] `PostingAuthPanel.tsx` shows per-platform: session held or not, captured date, expiry if known — sourced from `GET /api/agent-status`
- [x] The Connect button, live-view iframe/embed, and paste-helper UI are removed; in their place, static text: sessions are established on your machine when you click Publish
- [x] `GET /api/posting-auth` no longer stats server-side `auth/*.json` (rewrite to serve agent-reported data, or delete the route in favor of `/api/agent-status`)
- [x] Typecheck passes
- [x] Verify changes work in browser

### US-004: Delete the dashboard live-view proxy layer
**Description:** As a developer, I want the capture proxy routes gone so the dashboard has no path to a capture server that no longer exists.

**Acceptance Criteria:**
- [ ] Delete `dashboard/app/api/posting-auth/connect/`, `.../status/`, `.../type/` routes and `dashboard/lib/capture-server.ts`
- [ ] `grep -r "capture-server\|CAPTURE_SERVER_URL\|liveViewUrl" dashboard/` returns no live references
- [ ] Typecheck passes

### US-005: Delete the capture/VNC stack from workers
**Description:** As a developer, I want the server-side capture apparatus removed at the root.

**Acceptance Criteria:**
- [ ] Delete `workers/posting/capture/stream.ts` and `workers/posting/capture/server.ts`; remove the `capture-server` npm script
- [ ] `capture/session.ts`: delete the VNC paste-relay init-script glue and anything referencing `DISPLAY :99`/streaming; keep (or fold into the agent) only what the agent's headed flow uses; `capture/detect.ts` survives (the agent depends on it)
- [ ] Delete `workers/posting/capture-login.ts` CLI if the agent flow fully supersedes it (it does — headed login is now the Publish path)
- [ ] `grep -r "x11vnc\|websockify\|Xvfb\|noVNC\|novnc" workers/ dashboard/` returns no live code references (specs/research docs are fine)
- [ ] `workers/posting` typecheck passes with the deletions
- [ ] Typecheck passes

### US-006: Config, env, and docs cleanup
**Description:** As a developer, I want config and specs to describe the system that actually exists.

**Acceptance Criteria:**
- [ ] `config/posting-platforms.json`: remove the `capture: "live-view"` field from all platforms (schema and any readers updated)
- [ ] Remove `CAPTURE_STREAM_SECRET`, `CAPTURE_PUBLIC_URL`, `CAPTURE_PORT`, `CAPTURE_VNC_PORT`, `CAPTURE_WS_PORT`, `NOVNC_ROOT` from all code paths and env documentation; note in the PR/progress log that the operator can delete them from `.env.local` and tear down the Cloudflare tunnel ingress for live-view
- [ ] `specs/specs.md` gets a newest-first entry summarizing the local-publish architecture (all three parts) and marking the live-view-browser spec superseded
- [ ] Note for the operator (in progress log): delete any stale `workers/posting/auth/*.json` on the server — sessions live only on the operator's machine now
- [ ] Typecheck passes

## Non-Goals

- No removal of the ad-generation worker (`workers/run-worker.sh`, `# COMMAND-CENTER-WORKER` cron) — ad copy generation stays server-side; only *posting* moved local.
- No changes to `post-landmodo.ts` / `post-land_com.ts` selector logic — verifying selectors against live forms is its own future work, done from the operator's machine.
- No enabling of the four platforms without posters.
- No historical rewrite: `specs/live-view-browser.md` and the research reports stay as records; only live code is deleted.

## Technical Considerations

- Order matters within this PRD: build the replacement reporting (US-001–US-003) before deleting what the panel currently reads (US-004–US-005), so the Settings page never points at deleted routes.
- The Cloudflare tunnel / Tailscale path that exposes the *dashboard* must survive — the agent and the operator's browser both depend on it. Only the live-view-specific ingress (`CAPTURE_PUBLIC_URL` hostname) becomes deletable.
- `detect.ts` is the one survivor of `capture/` — after US-005, consider moving it out of `capture/` (e.g. `workers/posting/detect.ts`) so the directory can be removed entirely; do it only if imports stay tidy.
