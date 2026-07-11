# PRD: Land.com Access — Research Spike

**Status:** Draft
**Date:** 2026-07-11
**Type:** Research spike — the deliverable is a report plus one validated land.com session file, not a code change to the running system.

## Introduction

On 2026-07-11 the live-view login capture for land_com stopped working: Land.com
sits behind Akamai, which hard-blocks the worker box's Linode datacenter IP with
a flat `403 Access Denied` (`errors.edgesuite.net` reference) — pre-auth,
browser-independent (plain `curl` and headed Chromium both get it), for
`www.land.com/login` and `/` alike. No login flow, however human, can get past
it from this box. The same morning also exposed a detection bug: three land_com
captures reported "capture succeeded" within ~2 seconds because the
`redirect_off: "/login"`-only signal false-positived on the Access Denied flow,
exporting a logged-out session (documented here as a finding; fixing it is a
follow-up, not this spike).

We still need to post to Land.com. This spike researches how to connect it
anyway, with special attention to the operator's idea: **let the operator log in
from their own browser (residential IP) and capture that session for the
server** — plus the other realistic families: residential egress for the
server's browser, running the capture stack locally, and Land.com's official
LandFeed XML API (already verified in depth by the previous spike, see
`research/auth-capture-spike/report.md` §2; gated on a shared key from Land.com
support).

**Deliverable:** `research/land-com-connect-spike/report.md` comparing all four
families with a recommendation, **and** a real captured session at
`workers/posting/auth/land_com.json` that demonstrably loads an authenticated
land.com page from an unblocked egress point.

## Goals

- Establish the exact scope of the Akamai block with fresh evidence: which
  land.com hosts/paths are blocked from the worker box (including the LandFeed
  endpoints, which returned HTTP 200 on 2026-07-10 — pre-block or exempt?), and
  confirm the operator's home IP is not blocked.
- Answer the headline question: can a session captured in the operator's own
  browser be turned into a working Playwright `storageState` for land_com, and
  what is the least-friction repeatable flow (manual export vs extension vs
  bookmarklet — including whether `HttpOnly` cookies kill the no-extension path)?
- Evaluate residential-egress options (home tunnel / Tailscale exit node /
  commercial residential proxy) and the run-locally option, each scored on
  effort, ops burden, fragility, security, and $/mo.
- Re-anchor the LandFeed API option against the new block (is the sanctioned
  feed endpoint reachable from the box even while the site is blocked?).
- Produce one validated artifact: `workers/posting/auth/land_com.json` (chmod
  600) captured from the operator's browser, verified to load an authenticated
  land.com page from wherever egress allows.
- End with a per-question recommendation and a "what would change this
  decision" list. Posting egress (making the *poster* reach land.com) is
  explicitly a follow-up — this spike only documents each option's posting
  implications.

## Operator tasks (human prerequisites — not Ralph stories)

- **OT-A:** From a home/residential connection, run the probe commands US-002
  prepares (curl land.com login/home/LandFeed endpoints) and paste the output
  into `research/land-com-connect-spike/operator-input/home-probes.txt`.
- **OT-B:** Log in to land.com in your own browser and export cookies following
  the instructions US-004 prepares, saving the export to
  `research/land-com-connect-spike/operator-input/` (gitignored; instructions
  will say exactly how).
- **OT-C (parallel, from the prior spike):** send the drafted LandFeed
  shared-key request email to Land.com support
  (`research/auth-capture-spike/report.md` §2 has the draft).

Stories that depend on operator input must check for it, and if absent, write
what's blocking into the report and complete the rest of the story.

## User Stories

### US-001: Scaffold the report and document the block with evidence
**Description:** As the operator, I want the report to open with hard evidence
of what broke so every option is judged against the real failure mode.

**Acceptance Criteria:**
- [x] `research/land-com-connect-spike/report.md` created with section headings: The Block, Block Scope, Capture From the User's Browser, Residential Egress, Run Locally, LandFeed API, Comparison & Recommendation
- [x] The Block section records: fresh `curl -s -o /dev/null -w "%{http_code}"` results from the worker box for `https://www.land.com/login` and `https://www.land.com/`, each with timestamp; the Akamai/edgesuite reference-page pattern; and the 2026-07-11 journal timeline (capture started → "succeeded" in ~2 s, three times)
- [x] The false-positive `redirect_off` detection bug is written up as a finding with the mechanism (Access Denied flow touched `/login` then landed on `/`) and flagged as follow-up work, referencing `workers/posting/capture/detect.ts`
- [x] A `research/land-com-connect-spike/operator-input/` dir exists with a `.gitignore` ignoring its contents except a README explaining OT-A/OT-B drop-offs
- [x] Typecheck passes (`cd workers/posting && npm run typecheck`)

### US-002: Map the block scope from the worker box and prepare home probes
**Description:** As the operator, I want to know exactly which land.com surfaces
are blocked from the server — especially whether the LandFeed endpoints still
respond — because that decides whether the sanctioned API route survives the block.

**Acceptance Criteria:**
- [x] From the worker box, record HTTP status + response size (no bodies beyond the first line) for: `https://www.land.com/`, `https://www.land.com/login`, `https://www.land.com/LandFeed/`, `https://www.land.com/LandFeed/Docs/`, `https://www.land.com/LandFeed/schemas/LandFeedSchema1.0.xsd`, `https://www.landsofamerica.com/`, and `https://www.landwatch.com/` — all in a Block Scope table with fetch timestamps
- [x] Block Scope section states the conclusion explicitly: LandFeed endpoints blocked / not blocked from the datacenter IP, and what that means for the API option
- [x] A copy-pasteable probe script (plain curl loop, no dependencies) for the same URL list is written to `research/land-com-connect-spike/home-probe.sh` for OT-A, and the report notes results are pending until OT-A lands
- [x] If `operator-input/home-probes.txt` already exists, its results are incorporated into the table (home column); otherwise the report marks the column "awaiting OT-A"
- [x] Typecheck passes

### US-003: Research the capture-from-user's-browser family
**Description:** As the operator, I want a grounded design for "log in on my own
machine, the dashboard captures the session" so I know if the idea survives
contact with cookie security (`HttpOnly`, fingerprint/IP binding) before anything
gets built.

**Acceptance Criteria:**
- [x] Section covers, with sources and fetch dates: (a) manual DevTools/extension cookie export + paste into a dashboard form; (b) a minimal MV3 extension that POSTs land.com cookies to the dashboard (PhantomBuster/Apify pattern — build on `research/auth-capture-spike/initial-research.md` §1 rather than re-researching); (c) a pure web-page/bookmarklet flow, with an explicit verdict on whether `HttpOnly` session cookies make extension-less capture impossible
- [x] Section documents the cookie→`storageState` conversion shape (Playwright storageState JSON fields) and which land.com cookie attributes must be preserved (domain, path, expiry, `HttpOnly`, `Secure`, `SameSite`)
- [x] Section states the replay caveat honestly: a session minted on the operator's home IP/fingerprint still cannot be replayed from the blocked datacenter IP — capture-from-browser only helps if paired with an egress option, and the pairing is spelled out
- [x] Each sub-option ends with a verdict line (Recommended / viable fallback / rejected because …) judged against: no password custody, operator-tolerable friction on session expiry, no bot-evasion/stealth tooling
- [x] Typecheck passes

### US-004: Write the operator cookie-export instructions (OT-B enabler)
**Description:** As the operator, I want exact, safe, step-by-step instructions
for exporting my logged-in land.com session so the validation story (US-007) has
its raw material.

**Acceptance Criteria:**
- [x] `research/land-com-connect-spike/operator-input/README.md` (committed, unlike its siblings) contains numbered steps for the chosen least-friction export method from US-003, including which browser, which cookies/domains to include, and the exact filename to save as
- [x] Instructions include the safety rules: export lands only in the gitignored `operator-input/` dir, is deleted after conversion, and cookie values are never pasted into the report, logs, or chat
- [x] The report's Capture From the User's Browser section links to the instructions and records that OT-B is now actionable
- [x] Typecheck passes

### US-005: Research residential egress and run-locally families
**Description:** As the operator, I want the "make the server look residential"
and "run it at home" options costed and compared, because they fix capture and
posting at once while the browser-capture idea fixes only capture.

**Acceptance Criteria:**
- [ ] Residential Egress section compares, with current pricing + source URLs + fetch dates: (a) WireGuard or SSH SOCKS tunnel via a device on the operator's home network; (b) Tailscale exit node on a home device (free-tier applicability stated); (c) a commercial residential-proxy service (one reputable example with $/GB); each scored on setup effort, ops burden (what breaks when the home box reboots), fragility, security exposure, and $/mo
- [ ] Section documents how each option would attach to the existing stack — Chromium `--proxy-server` / Playwright `proxy` option for the capture browser and later the poster — as prose + config sketch, no code changes
- [ ] Run Locally section covers running the capture stack (or the whole worker) on the operator's own machine and syncing `auth/land_com.json` to the server, with the honest caveat that server-side posting still hits the block unless paired with egress
- [ ] Both sections end with verdict lines against the same rubric as US-003
- [ ] Typecheck passes

### US-006: Re-anchor the LandFeed API option
**Description:** As the operator, I want the sanctioned-API option restated
against the new reality, because if the feed endpoint is exempt from the block it
likely remains the best long-term answer for land.com.

**Acceptance Criteria:**
- [ ] LandFeed section summarizes (not re-researches) the prior spike's verified findings — auth model, full-inventory-diff gotcha, photo-by-URL requirement, Corporate Account prerequisite — citing `research/auth-capture-spike/report.md` §2
- [ ] Section incorporates the US-002 probe result for the LandFeed endpoints and states plainly whether the block changes the feed's viability
- [ ] Section restates the OT-C ask (shared-key email) with the status the operator reports, and names the fallback chain if feed access is denied
- [ ] Typecheck passes

### US-007: Capture and validate a real land.com session (the spike's proof)
**Description:** As the operator, I want my exported browser session converted
into `workers/posting/auth/land_com.json` and proven to load an authenticated
land.com page, so the recommended capture path is demonstrated, not theorized.

**Acceptance Criteria:**
- [ ] If `operator-input/` contains the OT-B export: convert it to Playwright storageState at `workers/posting/auth/land_com.json`, chmod 600, using a throwaway script in `workers/posting/` (in-package so it typechecks; clearly named `research-*` and never wired into any npm script or worker path)
- [ ] Validation run: load an authenticated land.com account page using that storageState from an unblocked egress (per OT-A/US-005 findings — e.g. the operator's machine or a home tunnel if one exists by then; the worker box's blocked IP must not be the test bed) and save a redacted screenshot to `research/land-com-connect-spike/artifacts/`
- [ ] Report records the validation outcome: which egress was used, whether the session was accepted (no re-login, no Access Denied), and observed cookie lifetime metadata (expiry timestamps only — never values)
- [ ] Cookie values and storageState contents appear nowhere in the report, logs, script output, or git; the raw export file is deleted after conversion
- [ ] If OT-B input is absent, the story writes the blocked status + exact ask into the report and stops — no fabricated validation
- [ ] Typecheck passes

### US-008: Comparison matrix and recommendation
**Description:** As the operator, I want a one-page decision so I can pick the
land.com path in minutes.

**Acceptance Criteria:**
- [ ] Comparison & Recommendation section has a matrix: every evaluated option × (fixes capture?, fixes posting?, operator friction, build effort, ops burden, fragility, security, $/mo)
- [ ] A primary recommendation is stated with a 2–3 sentence rationale and a named fallback chain, explicitly separating the login-capture answer (this spike) from the posting-egress follow-up it implies
- [ ] A "what would change this decision" list (e.g. LandFeed key granted, LandFeed endpoints get blocked too, Akamai starts blocking the home IP, land.com adds MFA)
- [ ] The `redirect_off` false-positive fix and the posting-egress work are listed as named follow-ups with one-line scope each
- [ ] Typecheck passes

## Non-Goals

- **No production code changes** — no dashboard UI, API routes, or changes to
  `workers/posting/capture/*` or the poster scripts. The only new code is
  clearly-named throwaway research scripts (per the prior spike's pattern).
- **No posting-egress implementation** — routing the *poster* through
  residential egress is a follow-up; this spike only documents implications.
- **No bot-evasion tooling** — no fingerprint spoofing, stealth plugins, or
  CAPTCHA-solving services. Options must be either sanctioned (LandFeed) or
  ordinary legitimate access from an IP Land.com serves (the operator's own).
- **No fixing the `redirect_off` detection bug** — documented as a finding and
  a named follow-up only.
- **No vendor signups or payments** — pricing research only.
- **No password custody** — the operator always logs in themself; the app never
  sees or stores the land.com password. Cookie exports are transient and
  gitignored.
- **Only land_com** — the other five platforms are out of scope (none of them
  are currently blocked).

## Technical Considerations

- Build on, don't repeat: `research/auth-capture-spike/initial-research.md`
  (§1 extension pattern, §0 LandFeed) and `research/auth-capture-spike/report.md`
  (§2 LandFeed deep-dive with the draft support email). Cite; only re-verify
  what the block could have changed.
- Evidence from 2026-07-11 available to US-001: `journalctl --user -u
  capture-server` around 04:50–05:13 UTC shows the three ~2-second false
  "capture succeeded" runs and the timeline; the Akamai 403 was reproduced with
  plain curl from the box.
- The prior spike fetched the LandFeed endpoints with HTTP 200 on 2026-07-10
  from this same box — one day before the login block was observed. US-002's
  re-probe distinguishes "feed exempt from the block" from "block is new and
  total".
- `workers/posting/auth/*.json` are secrets: chmod 600, gitignored, never in
  logs or the files API. The same discipline applies to raw cookie exports in
  `operator-input/`.
- Playwright + Chromium already live in `workers/posting/` — reuse for the
  US-007 validation (from an unblocked egress) and any screenshots; throwaway
  scripts go in that package so `npm run typecheck` covers them (ESM resolves
  `playwright` relative to the script file — AGENTS.md).
- The web changes: every price/capability claim needs a source URL and fetch
  date (Steel.dev's pricing drift between the seeded research and the prior
  report proves the point).
