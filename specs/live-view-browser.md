# PRD: Self-Hosted Live-View Login Capture

## Introduction

The auth-capture research (`research/auth-capture-spike/report.md`) recommends renting
a **hosted live-view browser** (Browserbase/Steel/Anchor/Hyperbrowser, §4; Apify, §5b)
so the operator can log in to a marketplace inside a dashboard iframe and the poster
reuses the resulting session. This PRD **duplicates that capability in our own repo**
instead of renting it — the report's §5c "self-hosted streamed browser" option.

The chosen build (see the decisions below) is **noVNC around the existing headed
Playwright browser**: reuse the headed Chromium that `capture-login.ts` already
launches, run it inside a virtual framebuffer on the worker machine, stream that
framebuffer to the dashboard over VNC-in-the-browser (Xvfb → x11vnc → websockify →
noVNC), and embed it in an interactive iframe. The operator logs in inside the iframe
(passing Landmodo's invisible reCAPTCHA naturally, per report §3); on success the same
`context.storageState()` call the CLI ritual already uses writes
`workers/posting/auth/<platform>.json`, so **the poster and `post.ts` stay unchanged**.

**Decisions carried into this PRD** (from the clarifying questions):

- **Approach:** noVNC + existing headed Playwright *(the approach question was left to
  recommendation; noVNC was chosen because it reuses `capture-login.ts` and its
  storageState export, runs on the worker box, and is generic across any `login_url`).*
  Switching to neko/WebRTC or raw CDP screencast would rewrite US-002…US-005.
- **Deployment:** the existing worker machine, exposed through the current Cloudflare
  tunnel. No new host; the session is minted on the same IP class the poster replays
  from (report's same-IP-replay reliability win).
- **Scope:** all browser-capture platforms — `landmodo` plus the four disabled
  platforms (`land_century`, `landflip`, `land_listings`, `landhub`) and `land_com` as
  a fallback — anything with a `login_url`. The mechanism is generic and config-gated
  per platform.
- **State handoff:** export cookies/localStorage into the existing
  `workers/posting/auth/<platform>.json` storageState file. `post.ts` and the posters
  are untouched (report's low-risk path).

## Goals

- Replace the terminal-only capture ritual (`npm run capture-login -- <platform>`,
  headed Chromium + stdin-Enter on the worker box) with an in-dashboard **Connect**
  button reachable from any device via the existing Cloudflare tunnel.
- Build the live-view capability entirely in-repo with **no hosted-browser vendor and
  no recurring vendor fee** — only the worker machine we already run.
- Keep the capture mechanism **generic**: any platform with a `login_url` opts in with a
  single `capture: "live-view"` config flag.
- Persist captured sessions into the existing `auth/<platform>.json` storageState files
  so **the poster pipeline (`workers/run-poster.sh` → `post.ts`) is unchanged**.
- Preserve every security property of the current flow: no password custody (the
  operator types credentials into the real site), auth files `600` and gitignored,
  secrets never logged and never exposed via the files API.
- Detect login success proactively (a real re-auth action) instead of discovering a
  dead session via a failed post.

## Operator Tasks (prerequisites — NOT Ralph stories)

Human/infra steps Ralph cannot do. Each gates specific stories; code below can be built
and typechecked with these absent, failing closed with a clear message.

- **OT-1 — Install streaming deps on the worker machine.** Install `xvfb`, `x11vnc`,
  `websockify`, and the `noVNC` static client (e.g. `apt-get install xvfb x11vnc
  websockify novnc`), and confirm Playwright's Chromium launches **headed** under an
  Xvfb display. **Gates US-003/US-004 live streaming.**
- **OT-2 — Expose the capture-server through the Cloudflare tunnel.** Add a tunnel
  ingress hostname (e.g. `capture.<domain>` → `localhost:<CAPTURE_PORT>`) so the
  live-view iframe URL is reachable from a remote browser. **Gates remote use in
  US-007;** local browser verification works without it.
- **OT-3 — Generate `CAPTURE_STREAM_SECRET`.** Create a random secret in `.env.local`
  (same secret class as `auth/*.json`) used to sign short-lived live-view URL tokens.
  **Gates US-005/US-006 token issuance.**

## User Stories

### US-001: Add capture-mode config + login-success signal
**Description:** As a developer, I need per-platform config that says which platforms use
self-hosted live-view capture and how to detect a successful login, so the rest of the
system can branch on it without hardcoding platform names.

**Acceptance Criteria:**
- [x] Each platform in `config/posting-platforms.json` gains `capture: "live-view" | "cli"`; set `"live-view"` for `landmodo`, `land_century`, `landflip`, `land_listings`, `landhub`, and `land_com`; the field defaults to `"cli"` when absent
- [x] Each `"live-view"` platform gains a `login_success` object `{ cookie?: string, redirect_off?: string }` (e.g. Landmodo: `{ redirect_off: "/login" }`)
- [x] The `PlatformConfig` interface in `workers/posting/capture-login.ts` and `PostingPlatformConfig` in `dashboard/app/api/posting-platforms/route.ts` gain the two optional fields (optional = existing CLI platforms keep validating)
- [x] `GET /api/posting-platforms` serves the new fields so the client can branch on `capture` without importing config directly (per AGENTS.md)
- [x] Typecheck passes (`cd workers/posting && npm run typecheck` and `cd dashboard && npx tsc --noEmit`)

### US-002: Capture-session manager (headed Chromium under a display)
**Description:** As a developer, I need a module that launches a headed Chromium bound
to a virtual display, navigates it to a platform's `login_url`, and tracks the live
context by session id, so a login can happen remotely instead of at a stdin prompt.

**Acceptance Criteria:**
- [ ] New `workers/posting/capture/session.ts` exports `startSession(platformKey)` that launches `chromium.launch({ headless: false })` (inheriting `process.env.DISPLAY`), opens a context + page, navigates to the platform's `login_url` from config, and returns a `{ sessionId, platformKey }`
- [ ] Sessions are tracked in an in-memory map keyed by `sessionId`; `getSession(id)` exposes the live `context`/`page`, and `closeSession(id)` closes the browser and removes it
- [ ] Reuses `AUTH_DIR` from `workers/posting/post-common.ts` (no new auth-path constant); does not write any file yet (export happens in US-004)
- [ ] Rejects a platform that is not `enabled` or not `capture: "live-view"` with a one-line error
- [ ] Typecheck passes (`cd workers/posting && npm run typecheck`)

### US-003: Streaming bridge (Xvfb → x11vnc → websockify → noVNC)
**Description:** As a developer, I need to stream the capture session's display into the
browser and return an embeddable, token-guarded live-view URL, so the operator can see
and control the login inside an iframe.

**Acceptance Criteria:**
- [ ] New `workers/posting/capture/stream.ts` starts an Xvfb display, `x11vnc` on it, and `websockify` bridging a WebSocket port to x11vnc, and returns a noVNC client URL carrying a short-lived signed token (HMAC with `CAPTURE_STREAM_SECRET`)
- [ ] The capture session's Chromium (US-002) launches against that same `DISPLAY`, so the login page is what the stream shows
- [ ] **Single active capture session at a time** (single-operator constraint): a second concurrent start fails closed with a clear "capture already in progress" message; the display/port is documented as fixed for the single session
- [ ] Missing `xvfb`/`x11vnc`/`websockify` binaries (OT-1 absent) produce a clear fail-closed error naming the missing dependency — no crash, no partial stream
- [ ] Tearing down the session stops Xvfb, x11vnc, and websockify (no orphan processes)
- [ ] Typecheck passes (`cd workers/posting && npm run typecheck`)

### US-004: Login-success detection + storageState export
**Description:** As a developer, I need to detect when the operator has finished logging
in and persist the session into the poster's existing auth file, so posting reuses it
with no change to `post.ts`.

**Acceptance Criteria:**
- [ ] New `workers/posting/capture/detect.ts` exports a pure predicate `isLoggedIn(signal, { cookies, url })` returning a boolean from the `login_success` signal (cookie present and/or URL no longer on `redirect_off`), plus a `checkSession(sessionId)` that reads the live context's cookies + current URL and applies it
- [ ] On success, it calls `context.storageState({ path: <AUTH_DIR>/<platform>.json })`, `chmod 600`s the file (mirroring `capture-login.ts`), then tears down the session + stream (US-003)
- [ ] Cookie values and storageState contents are never logged
- [ ] A unit check (`workers/posting/capture/detect.test.ts`, runnable via `npm test`) covers `isLoggedIn` for cookie-signal, redirect-signal, and not-yet-logged-in cases
- [ ] Typecheck passes (`cd workers/posting && npm run typecheck`)

### US-005: Capture-server HTTP surface on the worker
**Description:** As a developer, I need a small HTTP service on the worker machine that
starts a capture (session + stream) and reports login status, so the dashboard can drive
it over localhost/tunnel.

**Acceptance Criteria:**
- [ ] New `workers/posting/capture/server.ts` serves on `CAPTURE_PORT` (env, default e.g. 4750): `POST /capture/start { platform }` validates the platform is enabled + `capture: "live-view"`, starts US-002 + US-003, and returns `{ sessionId, liveViewUrl }`
- [ ] `GET /capture/status?sessionId=…` runs US-004 detection and returns `{ loggedIn: boolean }`; `POST /capture/cancel { sessionId }` tears down
- [ ] Requests are guarded by a shared token derived from `CAPTURE_STREAM_SECRET`; requests without it get `401`, and the service fails closed at startup with a clear message when the secret is absent (OT-3 gate) — no secret is logged or returned
- [ ] A `capture-server` script is added to `workers/posting/package.json`
- [ ] Typecheck passes (`cd workers/posting && npm run typecheck`)

### US-006: Dashboard connect + status proxy routes
**Description:** As a developer, I need dashboard API routes that proxy to the worker
capture-server, so the browser never talks to the capture-server directly and the
success signal/secret handling stays server-side.

**Acceptance Criteria:**
- [ ] New `dashboard/app/api/posting-auth/connect/route.ts` handles `POST { platform }`, calls the capture-server `POST /capture/start` (base URL + token from env), and returns `{ liveViewUrl, sessionId }`
- [ ] New `dashboard/app/api/posting-auth/status/route.ts` handles `GET ?sessionId=…`, proxies `/capture/status`, and returns `{ loggedIn }`
- [ ] Both routes reject platforms whose config `capture` is not `"live-view"`, and fail closed with a clear (non-secret) message when the capture-server base URL or token env var is absent
- [ ] The existing read-only `GET /api/posting-auth` (file-exists + mtime) is left working and unchanged
- [ ] Typecheck passes (`cd dashboard && npx tsc --noEmit`)

### US-007: "Connect" UI in PostingAuthPanel
**Description:** As an operator, I want a Connect button that opens the live-view login
in the dashboard and refreshes the saved-session status when I finish, so I never touch
a terminal.

**Acceptance Criteria:**
- [ ] `dashboard/components/PostingAuthPanel.tsx` renders a **Connect** (or **Re-connect** when a session already exists) button only for `capture: "live-view"` platforms; `"cli"` platforms keep today's read-only "run capture-login" text
- [ ] Clicking Connect calls `POST /api/posting-auth/connect`, embeds the returned `liveViewUrl` in a sandboxed interactive `<iframe>` (`sandbox="allow-same-origin allow-scripts"`), and polls `GET /api/posting-auth/status` until `loggedIn: true`, then tears down the iframe and refreshes the saved-session display
- [ ] Error and timeout states (session-create failed, capture-server unreachable, login not detected within N minutes) are surfaced in-panel using the existing status-chip styling — no new modal
- [ ] **Browser verification:** with the dashboard dev server running, load `/settings`, confirm the Connect button renders for `landmodo` and the iframe mounts on click (mock the connect route if OT-1/OT-2 are not yet done)
- [ ] Typecheck passes (`cd dashboard && npx tsc --noEmit`)

## Non-Goals

- **No hosted-browser vendor.** This PRD is the in-repo alternative to Browserbase/
  Steel/Anchor/Hyperbrowser/Apify — none of those SDKs or accounts are used.
- **No credential vault / stored passwords** (report §5d, rejected) — the operator
  always logs in themselves; the app never sees a marketplace password.
- **No neko/WebRTC and no raw CDP screencast.** noVNC-over-websockify is the chosen
  transport; a WebRTC (neko) or CDP-screencast build is explicitly out of scope.
- **No concurrent / multi-user capture.** One active capture session at a time, single
  operator; per-user container orchestration and a TURN server are out of scope.
- **No change to `post.ts` or the per-platform posters.** State handoff is via the
  existing `auth/<platform>.json` storageState file only.
- **No Land.com LandFeed XML API work.** That is a separate transport path (report §2);
  here `land_com` only uses live-view capture as a fallback if it needs a session.
- **No ad-copy/generation changes** — this is purely login capture; DREAMS and char
  caps stay in `config/ad-platforms.json` / generate-ad.

## Technical Considerations

- **Reuse:** `workers/posting/capture-login.ts` (headed-Chromium + `context.storageState`
  + `chmod 600` pattern), `workers/posting/post-common.ts` (`AUTH_DIR`,
  `requireAuthState`), the read-only `dashboard/app/api/posting-auth/route.ts`, and the
  `PostingPlatformConfig` type from `dashboard/app/api/posting-platforms/route.ts`.
- **The live-view URL grants full browser control** — treat it as a secret: short-lived
  signed token (US-003), served only over the TLS Cloudflare tunnel (OT-2), and never
  logged.
- **Same-IP replay:** the capture browser and the poster run on the same worker box, so
  the persisted session is replayed from the same IP class it was minted on — the
  reliability advantage the report flags over the extension path (§5a).
- **Single active session** keeps display/port management trivial (one fixed Xvfb
  display), which is acceptable under the single-operator constraint and can be
  generalized later.
- **Typecheck commands differ:** `workers/posting` has an `npm run typecheck` script;
  the dashboard has none — use `npx tsc --noEmit`.
- **Sequencing:** config (US-001) → capture session (US-002) → streaming (US-003) →
  detection/export (US-004) → capture-server (US-005) → dashboard API (US-006) → UI
  (US-007). OT-1/OT-3 gate live streaming/token issuance; OT-2 gates remote iframe use.
