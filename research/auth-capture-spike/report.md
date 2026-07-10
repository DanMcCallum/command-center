# Marketplace Auth Capture — Proposal

**Date:** 2026-07-10
**Scope:** Landmodo and Land.com only (the two posting platforms enabled in `config/posting-platforms.json`)
**Constraints (decided):** single user for now; the user always logs in themselves; the app never sees or stores marketplace passwords.

This proposal compares app-friendly alternatives to the current CLI-based login
capture, verifies the claims in the seeded desk research
(`research/auth-capture-spike/initial-research.md`), and ends with a drafted
implementation PRD for the recommended approach. Every price or capability claim
carries a source URL and fetch date, because the web changes.

---

## 1. Current State

### How login capture works today

The ad poster (`workers/run-poster.sh` → `workers/posting/post.ts`) drives a real
browser with Playwright and authenticates using a saved **storageState** JSON —
cookies plus localStorage — one file per platform at
`workers/posting/auth/<platform>.json`. Capturing that file is a manual,
terminal-only ritual implemented in `workers/posting/capture-login.ts`:

1. The operator opens a terminal **on the worker machine** and runs
   `npm run capture-login -- <platform>` from `workers/posting/`.
2. The script loads `config/posting-platforms.json`, validates that the platform
   key exists and is `enabled`, and launches a **headed** Chromium
   (`chromium.launch({ headless: false })`) pointed at the platform's
   `login_url`.
3. The operator logs in by hand inside that browser window — the script never
   touches credentials.
4. Back in the terminal, the operator presses Enter
   (`waitForEnter(...)` over stdin); the script then serializes the browser
   context via `context.storageState({ path: authPath })`, writes it to
   `workers/posting/auth/<platform>.json`, and `chmod 600`s it.

The dashboard side is `dashboard/components/PostingAuthPanel.tsx`, mounted on the
Settings page. It polls `GET /api/posting-auth` every 30 seconds and, per enabled
platform, renders exactly one of two states: "Session saved (date)" (the auth
file exists, with its mtime) or "No session — run
`npm run capture-login -- <platform>`". That is the entire in-app surface: the
panel is **display-only**. It cannot start a capture, refresh a session, or even
tell whether a saved session is still valid — only that a file exists.

### Pain points

1. **A terminal is required.** Capture is a CLI ritual (`npm run capture-login`),
   not an app action. The dashboard — the product's entire operating surface for
   everything else — can only print the command and hope.
2. **It must run on the worker machine.** The headed Chromium and the stdin
   Enter-prompt both live on the box that runs the poster. The dashboard is
   reachable remotely via the Cloudflare tunnel, but session capture is not:
   away from the machine, an expired session is unfixable.
3. **The dashboard is read-only status.** `PostingAuthPanel.tsx` shows file
   existence and mtime, nothing more. There is no "Connect" or "Re-connect"
   button, no validity check, no in-app remediation path.
4. **Sessions expire silently.** Nothing validates a saved storageState after
   capture. The first signal that a session has rotted is a **failed posting**
   (the poster fails fast with "run capture-login" when auth is missing or
   expired) — discovered after approval, when the operator expected the listing
   to go live.
5. **Not usable by non-technical users.** The flow assumes comfort with npm,
   terminals, and the repo layout. A future assistant or second user posting
   ads could not self-serve a login refresh; this caps the system at
   one technical operator.
6. **Two-context juggling.** Even for the technical operator, the flow spans a
   browser window *and* a terminal prompt that must be Enter-ed at the right
   moment — forget the terminal step and the login is lost.

What works and is worth preserving: no password custody (the operator types
credentials directly into the real site), file permissions locked to `600`, and
auth files gitignored and excluded from the file-browsing API as secrets.

---

## 2. Land.com — LandFeed XML API

*(US-002 — to be completed: verify the LandFeed docs, auth model, schema,
latency, cost; open questions for Land.com support; draft access-request email;
fallback statement.)*

---

## 3. Landmodo — login-flow recon

*(US-003 — to be completed: headless login-page recon with screenshot evidence,
CAPTCHA/bot-protection markers, form fields observed, API/bulk-import absence
confirmation.)*

---

## 4. Hosted Live-View Browsers

*(US-004 — to be completed: verified pricing and live-view/persistence docs for
Browserbase, Steel.dev, Anchor Browser, and Hyperbrowser; cost projections at 1
and 20 users; integration sketch for PostingAuthPanel.)*

---

## 5. Other Options

*(US-005 — to be completed: browser-extension cookie export, Apify, self-hosted
streamed browser, credential vault — same rubric each, explicit verdict lines.)*

---

## 6. Comparison & Recommendation

*(US-006 — to be completed: option × criteria matrix, per-platform
recommendation with fallback, "what would change this decision" list, explicit
UX/reliability gains over the current CLI flow.)*

---

## 7. Proposed Implementation PRD

*(US-007 — to be completed: Introduction / Goals / Non-Goals / Ralph-sized user
stories for the recommended per-platform approaches, with operator-task
prerequisites flagged separately.)*
