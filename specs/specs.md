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

## Local publish 3/3 — decommission server-side posting & live-view

**PRD:** [local-publish-3-decommission.md](local-publish-3-decommission.md) · **Shipped:** 2026-07-12 · **Series:** Part 3 of 3 — closes the local-publish series (Part 1: [job-model-agent-facing-api.md](job-model-agent-facing-api.md), Part 2: [local-publish-2-local-agent.md](local-publish-2-local-agent.md)).

**The whole series in one paragraph:** posting moved off the server because its datacenter IP is Akamai-blocked pre-auth. Part 1 replaced approve-time auto-posting with per-platform **Publish** buttons that queue publish jobs, plus a token-authed agent API (`AGENT_TOKEN`) to list/claim/download/report jobs via outbound-only polling. Part 2 built the consumer: `npm run agent` on the **operator's machine** (residential IP) polls, claims, posts with Playwright, and pops a headed login window when a session is stale — sessions are minted and stored only at `workers/posting/auth/<platform>.json` on that machine. Part 3 deleted everything that architecture stranded: the server-side Xvfb/x11vnc/websockify/noVNC live-view capture stack, the capture HTTP server and CLI, the dashboard's capture proxy routes, and the Connect UI — and replaced server-side session visibility with agent self-reporting. **The [Self-hosted live-view login capture](#self-hosted-live-view-login-capture--in-dashboard-marketplace-login) feature below is superseded**: its code no longer exists; its spec ([live-view-browser.md](live-view-browser.md)) stays as a record.

**Data model:** `AgentStatus` is now `{lastSeenAt, platforms: AgentPlatformSession[]}` where `AgentPlatformSession = {platform, hasSession, capturedAt: string|null, earliestCookieExpiry?}` (`dashboard/lib/types.ts`). `data.ts` readers/writers normalize the old `{lastSeenAt}`-only `agent-status.json` shape (`platforms: []`) — keep normalizing until no old file remains; `recordAgentSeen()` preserves the stored platforms report, `saveAgentPlatformReport()` also stamps `lastSeenAt` (a report is proof of life).

**API:** `POST /api/agent-status` (agent-token guarded) — the agent reports its sessions on startup and after every login capture, from a scan of its local `auth/` dir (names, mtimes, min cookie expiry — never values); entries are validated and rebuilt so unknown fields are never stored. `GET /api/agent-status` (browser, no token) returns the full `AgentStatus`. `GET /api/posting-auth` and the `posting-auth/connect|status|type` proxy routes are **deleted**.

**UI:** `useAgentLiveness()` (`dashboard/lib/agent-liveness.ts`) — one shared module-level poller of `GET /api/agent-status` every 15 s feeding all subscribers; online = `lastSeenAt` within `ONLINE_WINDOW_MS = 45_000` (3× the agent's *default* 15 s poll — `AGENT_POLL_SECONDS` is operator-tunable but invisible to the server, so the window is fixed). Tasks page shows an online/offline dot (hidden until the first fetch resolves); `PublishButtons` render an amber warning when offline but **still queue** on click; `PostingAuthPanel` is a read-only per-platform session view fed by the agent's report.

**Removed (Part 3):** `workers/posting/capture/{stream,server,session}.ts`, `capture-login.ts`, the `capture-server`/`capture-login` npm scripts, `checkSession` from `detect.ts` (`detectLogin`/`isLoggedIn` survive — `capture/detect.ts` is the sole `capture/` survivor and the agent's dependency), `dashboard/lib/capture-server.ts`, the `dashboard/app/api/posting-auth/` tree, and the `capture: "live-view"|"cli"` config field (`login_success` stays — it drives the agent's login detection). **No `CAPTURE_*`/`NOVNC_ROOT` env vars exist anywhere**; the operator can delete `CAPTURE_STREAM_SECRET`, `CAPTURE_PUBLIC_URL`, `CAPTURE_PORT`, `CAPTURE_VNC_PORT`, `CAPTURE_WS_PORT`, `NOVNC_ROOT` from `.env.local`, tear down the live-view tunnel ingress and any capture systemd units, and delete stale server-side `workers/posting/auth/*.json`.

**Invariants / gotchas:**
- The server never sees sessions — everything the dashboard knows about auth comes from `POST /api/agent-status`. A platform with no report yet renders as "No report from agent yet", not "no session".
- Publish-while-offline is deliberate: jobs queue and run when the agent returns; liveness is advisory only.
- Committed Playwright harnesses `verify-agent-liveness.ts` / `verify-auth-panel.ts` show the `page.route` fixture pattern for driving liveness/panel states without touching real data files.
- Ad **generation** is still server-side (`run-worker.sh` + cron) — only posting moved local.

**Extending:** a new platform is still a `Poster` entry + config entry (Part 2's rule); its session visibility comes free from the agent's auth-dir scan. Anything that needs "is the agent alive?" should consume `useAgentLiveness()`, not poll the API itself.

## Local publish 2/3 — the local poster agent

**PRD:** [local-publish-2-local-agent.md](local-publish-2-local-agent.md) · **Shipped:** 2026-07-12 · **Series:** Part 2 of 3 — consumes Part 1's publish jobs ([job-model-agent-facing-api.md](job-model-agent-facing-api.md)); Part 3 ([local-publish-3-decommission.md](local-publish-3-decommission.md)) deletes the live-view/VNC stack and server-posting remnants.

The consumer of Part 1's job queue: `npm run agent` in `workers/posting/` runs a poll loop on the **operator's machine** (residential IP — what unblocks land_com past Akamai). One job at a time, FIFO by `queuedAt`: claim → download the publish bundle into a local cache → preflight (ad-copy parse, photos, poster lookup — all **before** any browser, so a doomed job never pops a login window) → headed auth → post in that same browser context → report results over the API. Stale session → a headed Chromium pops on the operator's real desktop (posting goes `awaiting_auth`), they log in, the fresh session is saved locally, and posting continues automatically. No VNC/streaming; the laptop stays outbound-only; the agent never touches the server's filesystem.

**Agent config** (env-first, root-`.env.local` fallback): `DASHBOARD_URL` (required), `AGENT_TOKEN` (required, matches the server's), `AGENT_POLL_SECONDS` (default 15). Operator guide: `workers/posting/AGENT.md`. Sessions are minted and stored **only on the operator's machine** at `workers/posting/auth/<platform>.json` chmod 600 (`rm` to wipe a bad one); the bundle cache is `workers/posting/.agent-cache/<taskId>/` (gitignored, mirrors the `outputs/` layout).

**API:** new `POST /api/publish-jobs/report` `{taskId, platform, status, lastError?, listingUrl?, screenshotPath?}` — the status-report endpoint Part 1 deferred. Agent-token guarded, `mutateTask` inside; `status` ∈ `posting|awaiting_auth|posted|failed` (**never** `queued` — re-queueing via report would bypass the Publish endpoint's `attempts` accounting); 409 unless the existing posting is currently agent-owned (`posting`/`awaiting_auth`); `posted` stamps `postedAt` server-side. This 409 rule is also the recovery path: a job stranded in `posting`/`awaiting_auth` by a crashed agent 409-blocks re-publish — reset it by reporting `failed` with the token.

**Detection** (`workers/posting/capture/detect.ts`): new three-way `detectLogin(signal, snapshot, tracker) → 'logged_in' | 'not_logged_in' | 'blocked'`. A page titled `Access Denied` (the Akamai signature) returns `blocked` before anything else and never earns `sawLoginPage`; `redirect_off` is only honored after the tracker actually observed the login path; `cookie` + `redirect_off` together are ANDed (unit-tested, incl. the exact spike denial flow). Importable without pulling in session/stream/server/playwright — the agent imports it directly; the capture server's `checkSession` feeds it too and treats `blocked` as fail-closed.

**Agent/poster surface** (`workers/posting/`): `agent.ts` (poll loop, claim, bundle download, reporting, graceful SIGINT/SIGTERM); `agent-auth.ts` `authenticate()` (headed launch, storageState probe of `new_listing_url`, 15-min login wait, window-close → `failed`/`login cancelled`, cookie **names+expiry** logged — never values); posters refactored to drive an injected, already-authenticated page via `PostContext {page, outputDir, platform?}` in `post-common.ts` — the caller owns the browser lifecycle. `post.ts` exports `POSTERS` + `Poster` (CLI `main()` guarded by `require.main`, still works headless against `outputs/` for local dev). Proof screenshots upload via `POST /api/tasks/[id]/proof`; the server-returned `{path}` is what gets reported as `screenshotPath` (never the local cache path). Committed harnesses `verify-agent-auth.ts` / `verify-agent-post.ts` (mock marketplace + Xvfb) are the template for driving browser flows without real sites.

**Invariants / gotchas:**
- Playwright's `chromium.launch` defaults `handleSIGINT/handleSIGTERM` to true and **force-exits the process on Ctrl-C** before graceful shutdown can report the job — anywhere the agent owns shutdown, launch with both set to `false`.
- `redirect_off`-only signals can never pass the silent session probe (strict `sawLoginPage` semantics); `agent-auth` resolves valid sessions via a one-shot seeded tracker right after the deliberate `goto(login_url)` (~3 s, no operator). The denial flow can't hit it — `blocked` returns before any tracker state.
- land_com must gain a `login_success.cookie` ANDed with `redirect_off` once the first real login's names-only log line identifies the session cookie (documented in `config/posting-platforms.json` `_doc`).
- `attempts` is incremented only by the Publish endpoint; the agent never touches it. No auto-retry — a failed publish waits for the operator to click Publish again.
- The agent must never import `capture/stream.ts` (Xvfb/VNC — dies in Part 3); shared env reading is deliberately duplicated into `agent.ts` for the same reason.
- Server error strings surface verbatim as `lastError` (agent caps at one line / 300 chars) — keep them one-line.

**Extending:** a new platform = a `Poster`-interface entry in `POSTERS` plus its config entry (same as before — the agent path needs nothing else). Part 3 deletes the capture/live-view stack; the agent path already depends on none of it.

## Local publish 1/3 — publish-job model & agent-facing API

**PRD:** [job-model-agent-facing-api.md](job-model-agent-facing-api.md) · **Shipped:** 2026-07-12 · **Series:** Part 1 of 3 — Part 2 ([local-publish-2-local-agent.md](local-publish-2-local-agent.md)) builds the local poster agent; Part 3 ([local-publish-3-decommission.md](local-publish-3-decommission.md)) deletes the live-view/VNC stack and server-posting remnants.

Moves posting off the worker box (its datacenter IP is Akamai-blocked pre-auth — see the Land.com spike). The approve-time queue-everything flow and every server-side poster kickoff are **gone**: each enabled platform now gets a per-task **Publish** button that queues exactly one publish job, and a token-authed agent API lets a poster agent on the operator's machine list, claim, download, and complete jobs via outbound-only polling (no inbound port to the laptop). After Part 1, the full lifecycle is drivable with `curl`; nothing consumes jobs automatically — that is the intended state until Part 2 ships the agent.

**Data model:** `AdPosting.status` gains `'awaiting_auth'` (full set: `queued | posting | awaiting_auth | posted | failed`) for "agent has a headed browser open, waiting for operator login". New `dashboard/data/agent-status.json` `{lastSeenAt}` (gitignored runtime state, written under the data.ts mutex) records the agent's last authorized poll — for a future online/offline indicator; nothing reads it yet. New `mutateTask(id, fn)` in `dashboard/lib/data.ts`: atomic read-modify-write of one task under the existing write mutex, returning `{outcome: 'updated'|'rejected'|'not_found'}` — **all postings mutations must go through it** (`updateTask` is check-then-write and races).

**Auth:** `dashboard/lib/agent-auth.ts` exports `requireAgentToken(request): NextResponse | null` (null = authorized) — `Authorization: Bearer <AGENT_TOKEN>`, timing-safe compare over sha256 digests, env read with the same root-`.env.local` fallback as `capture-server.ts`; fails closed with 503 when `AGENT_TOKEN` is unset, 401 otherwise. `AGENT_TOKEN` is set in root `.env.local` (chmod 600, generated 2026-07-12) — same secret class as `auth/*.json`, never logged.

**API:**
- `POST /api/tasks/[id]/publish` `{platform}` — browser-called, no token. Replaces that platform's posting with `{platform, status:'queued', attempts: prev+1, queuedAt}` (stale `lastError`/`listingUrl`/`screenshotPath` intentionally dropped), preserving other platforms' entries. 400 unknown/disabled platform, 404 task, 409 while `queued`/`posting`/`awaiting_auth`; re-publishing `failed`/`posted` is the retry/repost path.
- Agent-token guarded: `GET /api/publish-jobs` → `{jobs: [{taskId, taskTitle, platform, queuedAt, attempts}]}` for all `queued` postings (stamps `lastSeenAt`); `POST /api/publish-jobs/claim` `{taskId, platform}` — atomic `queued → posting`, returns the full task, 409 if not currently queued; `GET /api/tasks/[id]/publish-bundle?platform=` → `{adCopy, photos: [repo-relative paths]}` (404 naming the path if the ad file is missing, `photos: []` when none); `POST /api/tasks/[id]/proof?platform=` body = raw PNG → writes `outputs/<taskId>/postings/<platform>.png` (validates the full 8-byte PNG magic). Platform keys must match `/^[a-z0-9_]+$/` everywhere they become filenames (traversal guard).
- `GET /api/files/[...path]`: unchanged when no `Authorization` header is sent (dashboard `<img>`/editor keep working); when one is present it must pass `requireAgentToken` — so the agent fetches photos through it with the token.

**UI:** new `dashboard/components/PublishButtons.tsx` on expanded ad-builder cards — one button per `enabled` platform: "Publish" (no entry / failed), disabled while in flight, "Publish again" when posted; errors render inline. **Approve now only approves** — `buildQueuedPostings()` and the run-poster fire are deleted from `TaskCard.tsx`. `PostingChips.tsx`: `awaiting_auth` renders as an amber "Waiting for login…" chip; Retry re-publishes via the publish route and is offered on every failed chip (the `MAX_ATTEMPTS`/auto-retry copy is gone — retries are manual).

**Removed:** `dashboard/app/api/run-poster/route.ts`, `workers/run-poster.sh`, the `# COMMAND-CENTER-POSTER` crontab install in `cron.ts` (a `LEGACY_POSTER_MARKER` strip remains so pre-retirement crontabs get scrubbed on the next install/remove), and the live crontab line itself.

**Invariants / gotchas:**
- `attempts` increments at publish (queue) time; claim never touches it, and claim does not stamp `lastSeenAt` (only the US-004 poll does).
- `PostingFailureBanner.tsx` still filters on a private `MAX_ATTEMPTS = 3` — of questionable meaning under manual re-publish; deliberately left for Part 2/3 to decide.
- Deleting a Next route breaks `tsc` via stale generated `.next/dev/types/validator.ts` + `.next/types/validator.ts` — `rm` both (typegen only, regenerated by next dev/build).
- `cron.ts` edits never retro-edit the live crontab — already-installed lines must be removed by hand.
- `workers/posting/post.ts` / `post-*.ts` are untouched — Part 2 reworks how they're invoked.
- Useful test patterns: route handlers run without a dev server (sandbox dir + `process.chdir` before dynamic import, `npx tsx --tsconfig dashboard/tsconfig.json`); kill dev servers with `fuser -k 3001/tcp`, never `pkill -f`.

**Extending:** Part 2 adds the agent loop (poll → claim → bundle → headed login+post → proof upload) plus whatever status-report endpoint the agent needs to flip `posting → awaiting_auth/posted/failed` (not built in Part 1). New agent-facing routes follow the pattern: `const denied = requireAgentToken(request); if (denied) return denied;` then `mutateTask` for any postings write.

## Land.com access — research spike (Akamai block, proposal + converter, no production changes)

**PRD:** [land-com-connect.md](land-com-connect.md) · **Shipped:** 2026-07-11 · **Type:** research spike (deliverable is a report plus a throwaway converter script; the spec'd validated session artifact is pending an operator task)

> **Decision (2026-07-12): no LandFeed.** We made a conscious decision not to use the Land.com LandFeed XML API — it requires an account with a large number of ads, which we don't have. All other references to it have been removed from the repo; this note is the single remaining record.

On 2026-07-11 Land.com's Akamai edge began hard-blocking the worker box's Linode datacenter IP **pre-auth** (flat `403 Access Denied`, `errors.edgesuite.net` reference — browser-independent, so no login flow from this box can work). This spike documents the block, maps its scope, evaluates every realistic way to still connect Land.com, and recommends a path. **No system behavior changed** — no dashboard, API, capture-stack, or poster code was touched.

**Deliverables:** `research/land-com-connect-spike/report.md` (source of truth: block evidence, scope table, four option families, comparison matrix, recommendation); `home-probe.sh` (curl probe loop for the operator's home IP); `operator-input/` (gitignored drop-off dir for operator artifacts, README has the export instructions); `workers/posting/research-convert-cookies.ts` (throwaway, in-package so it typechecks, wired into nothing — converts a Cookie-Editor JSON export to Playwright storageState at `auth/land_com.json` chmod 600, normalizes `sameSite`/`expirationDate`, filters to land.com domains, fails closed on zero-`HttpOnly` exports, never prints values).

**Key verified facts (2026-07-11, each cited in the report) that outlive the spike:**
- The Akamai block covers the whole **consumer** surface from the box — `www.land.com`, `/login`, and the sister brands `landsofamerica.com`/`landwatch.com` (no sister-site login loophole).
- `HttpOnly` session cookies are readable only via extension (`chrome.cookies`), DevTools, or CDP — never page JS. Bookmarklet/pure-web capture is impossible; any cookie-export flow must be extension- or DevTools-based.
- The `redirect_off`-only `login_success` signal **false-positives on the Access Denied flow** (three "captures succeeded" in ~2 s, each exporting a logged-out session): a negative-only redirect signal can't tell "logged in" from "any navigation off /login". Named follow-up: give `land_com` a positive cookie signal ANDed with `redirect_off` (config schema already supports it) and/or teach `capture/detect.ts` to treat the Akamai denial page as hard failure. An uncommitted `sawLoginPage` guard in the working tree is **insufficient** (the denial flow touches `/login` first).
- A session captured on a residential IP still `403`s when replayed from the blocked box IP (the block is pre-auth) — capture-from-browser only works **paired with egress** (Tailscale exit node on a home device recommended; free Personal tier, route-level, no code change) or by running the poster locally.

**Recommendation:** cookie export via extension (OT-B; converter ready) for capture + Tailscale exit node for posting egress. Fallback chain: cookie export + Tailscale → run poster locally → commercial residential proxy.

**Invariants / gotchas:**
- Raw cookie exports in `operator-input/` are secrets like `auth/*.json`: gitignored (scoped `.gitignore`, only README + itself tracked), deleted after conversion, values never in report/logs/chat.
- Operator tasks still open at ship time: **OT-A** (home-IP probes via `home-probe.sh` → `operator-input/home-probes.txt`), **OT-B** (cookie export → `operator-input/land_com-cookies.json`; then run the converter + the validation plan in the report's "Session Capture & Validation" section — no code remains to write). US-007 completed via its explicit absent-input path: blocked status recorded, nothing fabricated.
- No bot-evasion tooling anywhere in the options — everything is ordinary access from an IP Land.com serves.

**Extending:** the posting-egress follow-up defaults to the Tailscale exit node; the converter generalizes to any platform's cookie-export capture.

## Self-hosted live-view login capture — in-dashboard marketplace login

**PRD:** [live-view-browser.md](live-view-browser.md) · **Shipped:** 2026-07-11

> **Superseded (2026-07-12, Local publish 3/3):** the entire capture stack described here — session/stream/server, the capture-login CLI, the dashboard proxy routes, the Connect UI, and the `capture` config field — is deleted. Login capture now happens headed on the operator's machine via the local poster agent. Only `capture/detect.ts` (the login-success detection) survives, as the agent's dependency. This entry stays as a record of what was built.

Replaces the terminal-only `capture-login` ritual with an in-dashboard **Connect** button (the auth-capture spike's §5c self-hosted option — no hosted-browser vendor). A headed Playwright Chromium on the worker box is streamed into a sandboxed dashboard iframe (Xvfb → x11vnc → websockify → noVNC); the operator logs in on the real site (no password custody; passes Landmodo's invisible reCAPTCHA naturally); on detected success the session is exported via `context.storageState()` to `workers/posting/auth/<platform>.json`, chmod 600 — so the poster pipeline (`run-poster.sh` → `post.ts`) is untouched. Capture and posting run on the same box, so sessions replay from the IP class they were minted on.

**Config** (`config/posting-platforms.json`): each platform gains `capture: "live-view" | "cli"` (defaults `"cli"` when absent; all six platforms are `"live-view"` today) and, for live-view, `login_success: { cookie?: string, redirect_off?: string }` — signals are ANDed; detection compares `redirect_off` against the URL *pathname* only and fails closed on an empty signal. The CLI `capture-login` path still works for any platform.

**Env / secrets:** `CAPTURE_STREAM_SECRET` (OT-3, same secret class as `auth/*.json`) both signs the 10-minute live-view URL token and derives the capture-server API bearer token as `HMAC-SHA256("capture-api", secret)` — that derivation is intentionally duplicated in `dashboard/lib/capture-server.ts` because the dashboard can't import workers modules. Also: `CAPTURE_PORT` (default 4750), `CAPTURE_WS_PORT` (default 6080), `NOVNC_ROOT`, and dashboard-side `CAPTURE_SERVER_URL` (e.g. `http://127.0.0.1:4750`). Both ends read `process.env` with fallback to the **project-root** `.env.local` (Next.js only auto-loads `dashboard/.env.local`; the root file is parsed directly — see AGENTS.md).

**Worker surface** — `workers/posting/capture/` (inside the package typecheck; `npm run capture-server` starts the service):
- `session.ts` — `startSession`/`getSession`/`closeSession` + `requireLiveViewPlatform`; headed Chromium on `process.env.DISPLAY`, in-memory session map keyed by random hex id.
- `stream.ts` — Xvfb `:99` + x11vnc + websockify orchestration; single-active-session slot (second start fails closed with "capture already in progress"); missing OT-1 binaries produce a fail-closed error naming the dependency before anything spawns; teardown leaves no orphans and restores `DISPLAY`.
- `detect.ts` — pure `isLoggedIn(signal, {cookies, url})` + `checkSession(sessionId)`; on success exports storageState, chmod 600, tears down session + stream. Unit tests in `detect.test.ts`; session/stream are imported lazily so the `/tmp` compiled test build never has to resolve `playwright`.
- `server.ts` — HTTP on `CAPTURE_PORT`: `POST /capture/start {platform}`, `GET /capture/status?sessionId`, `POST /capture/cancel`; every request needs the derived Bearer token (timing-safe compare, 401 otherwise); 409 on concurrent start, 404 unknown session; exits at startup with the OT-3 message when the secret is absent.

**Dashboard surface:** `POST /api/posting-auth/connect {platform}` → `{liveViewUrl, sessionId}` and `GET /api/posting-auth/status?sessionId[&platform]` → `{loggedIn}`, both proxying the capture-server via `dashboard/lib/capture-server.ts` (503 when env config is missing, 502 unreachable, 400 non-live-view platform; the read-only `GET /api/posting-auth` is unchanged). `PostingAuthPanel.tsx` shows Connect/Re-connect for live-view platforms (cli platforms keep the terminal-snippet text), mounts the iframe with `sandbox="allow-same-origin allow-scripts"`, polls status every 3 s with a 5-minute deadline, and refreshes the saved-session display on success; errors surface as inline chips, no modal.

**Invariants / gotchas:**
- The live-view URL grants full browser control — treat as a secret (short-lived signed token, TLS tunnel only, never logged). Cookie values and storageState contents are never logged anywhere in the chain.
- One active capture session at a time, on fixed display `:99` and fixed ports — generalizing to concurrent sessions means parameterizing display/port allocation in `stream.ts`.
- Operator tasks still pending at ship time: OT-1 (this box has Xvfb + websockify but **not** x11vnc or noVNC), OT-2 (tunnel ingress for the capture port), OT-3 (`CAPTURE_STREAM_SECRET` in `.env.local`). Every code path fails closed with a clear message until they're done.
- **land_com live-view capture is dead from this box as of 2026-07-11** — Akamai blocks the datacenter IP pre-auth, and its `redirect_off`-only signal false-positives on the denial flow (see the Land.com access spike entry above for evidence, the detection follow-up, and the recommended path).
- Verification patterns that work: stub-binary-on-PATH (fake x11vnc/vnc.html + real Xvfb/websockify) for process orchestration; transient `_verify_stub` platform appended to config and restored in `finally`; Playwright must browse `http://localhost:3001`, never `127.0.0.1` (Next dev serves HTML that never hydrates cross-origin — in AGENTS.md).

**Extending:** a new platform opts in with `enabled: true` + `capture: "live-view"` + a `login_success` signal in config — zero code. Swapping the transport (neko/WebRTC, raw CDP screencast) rewrites `stream.ts` and touches session/detect/server (PRD US-002…US-005).

## Marketplace auth-capture — research spike (proposal, no implementation)

**PRD:** [auth-research.md](auth-research.md) · **Shipped:** 2026-07-10 · **Type:** research spike (deliverable is a proposal, not a code change to the running system)

A decision-ready proposal for replacing the terminal-only `capture-login` flow (see Ad posting) with an app-friendly, no-password-custody login capture for the two enabled platforms. **No system behavior changed** — no dashboard UI, API routes, `capture-login.ts`, or poster scripts were touched. The output is a document plus two throwaway research scripts.

**Deliverables (all under `research/auth-capture-spike/`):** `report.md` is the source of truth; `auth-capture-proposal.pdf` is the shareable render; `artifacts/landmodo-login.png` is the recon screenshot; `initial-research.md` is the seeded desk research the spike verified. Regenerate the PDF after editing the report with `cd workers/posting && npx tsx render-pdf.ts`.

**Scripts added to `workers/posting/`** (both are in-package so they stay in `npm run typecheck`; ESM resolves `playwright` relative to the script file, so any future Playwright helper must also live here):
- `recon-landmodo.ts` — headless, default-fingerprint Chromium recon: loads a page, full-page screenshots it, scans HTML for bot-wall/CAPTCHA vendor signatures, dumps form fields. Recon only (never submits). Reusable pattern for vetting any marketplace login.
- `render-pdf.ts` — markdown → PDF via the existing Playwright/Chromium (`page.setContent` → `page.pdf`, Letter, `printBackground`). Exports `mdToHtml` + `CSS` (guarded behind `require.main === module`) so a verifier can screenshot the HTML. The hand-rolled `mdToHtml` covers h1–h6, GFM pipe tables, ul/ol, blockquotes, hr, inline bold/`code`/links — no external markdown dep (a bare `marked` import would break the typecheck). Single-`*` italic is intentionally unhandled.

**Key verified findings (2026-07-10, each cited in the report):**
- **Land.com's bulk XML feed API was evaluated and later rejected** — it requires a Corporate Account with a large number of ads, which we don't have (see the decision note in the Land.com access spike entry above).
- **Landmodo has no posting API/bulk import** and its login carries an *invisible* Google reCAPTCHA (no hCaptcha/Turnstile/DataDome, no MFA); the page loads fine for a headless datacenter browser. This makes any scripted/credential-vault login the fragile path and a human-in-the-loop capture the clean one.
- **Recommendation:** land_com → cookie export via extension + Tailscale exit node for posting egress (the feed-API path was rejected — see the decision note above); landmodo → **Browserbase** hosted live-view ($20/mo Developer tier, bundles CAPTCHA solving), user logs in inside a dashboard iframe, state returned to workers via **CDP cookie export to `auth/<platform>.json`** (keeps `post.ts` unchanged — the low-risk path). Fallbacks: browser-extension cookie export, then self-hosted neko. Rejected: credential vault (violates no-password-custody), Apify (no better capture UX). Note Steel.dev dropped its cheap recurring tier since the seeded research — pricing drift is real; every claim in the report is dated.

**Follow-up implementation PRD is drafted inside the report (§7):** Ralph-sized stories US-201–203 (Browserbase live-view path), plus operator-task prerequisites (create a Browserbase account; decide public photo hosting) called out as *not* Ralph stories. That section is the ready-to-run spec if the proposal is accepted — it is not yet its own `specs/` PRD.

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

> **Superseded in part (2026-07-12, Local publish 1/3):** approve-time queueing, `run-poster.sh`, `POST /api/run-poster`, the poster crontab line, and the auto-retry policy described below are retired — posting is now per-site Publish jobs consumed by a local agent. The `AdPosting` data model, config, posting scripts (`capture-login`/`post`), UI chips, and secrets invariants still stand.

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
