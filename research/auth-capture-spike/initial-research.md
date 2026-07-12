# Initial research: capturing marketplace login sessions from the app

> Seed material for the auth-capture spike (see PRD.md). Produced 2026-07-10 by a
> web-research pass. Claims marked **unverified** must be re-checked hands-on
> during the spike before they appear in the final proposal PDF.

**Context:** The command-center dashboard posts land listings to landmodo.com and
land.com via Playwright + saved `storageState` JSON. Today the operator captures a
session by running `npm run capture-login -- <platform>` in a terminal, logging in
by hand in a headed Chromium, and pressing Enter. Goal of the spike: research
user-friendly, app-initiated alternatives. 1 user today, maybe 5–20 later.

**Headline finding (later invalidated):** Land.com has an official bulk XML feed
API for programmatically adding/updating/deleting listings. That option was
evaluated and later rejected — it requires an account with a large number of ads,
which we don't have (see the decision note in specs/specs.md). Landmodo has
nothing equivalent, so a browser-session approach is needed for both sites.

---

## 0. Site-specific escape hatches (evaluate first)

### Land.com — feed API (evaluated and rejected)
- Land.com's official bulk XML feed API was evaluated and later rejected — it
  requires an account with a large number of ads, which we don't have. See the
  decision note in specs/specs.md; the detail that used to live here is removed.

### Landmodo — no API found
- Searched for API/bulk import/CSV/feed: nothing on landmodo.com; their
  seller-support page describes only manual dashboard listing creation (free tier
  ~3 listings, then ~$19.95/listing tiers). The only "Landmodo APIs" in the wild
  are third-party Apify *scrapers* (read-only). Conclusion: browser automation
  remains necessary for Landmodo. Worth one email to Landmodo support asking about
  bulk import — small operator, they may do something ad hoc — but plan as if the
  answer is no. (Upside: Landmodo is a small site with, as far as could be found,
  **no evidence of aggressive bot protection or MFA** — login-flow CAPTCHA/MFA
  behavior **unverified** from outside; check the existing capture script's
  experience.)

## 1. Browser extension: export the user's own existing session

**How modern tools do it:** PhantomBuster is the canonical example — their
Chrome/Firefox extension auto-detects session cookies (e.g. LinkedIn `li_at` +
user agent) from the user's logged-in browser; in the web app the user clicks
"Connect to LinkedIn," the extension fills the session-cookie field, done. Apify
documents the same pattern manually: their tutorial "Log in by transferring
cookies" (docs.apify.com/platform/tutorials/log-in-by-transferring-cookies) tells
users to log in normally, export cookies with an EditThisCookie-style extension as
a JSON array ("compatible with the cookie format used by Puppeteer/Headless
Chrome"), and paste them into the actor's *Initial cookies* input. Generic "Cookie
Exporter" extensions that POST cookies to a custom endpoint with an API key also
exist on the Chrome Web Store.

- **UX:** install extension once → log in to Landmodo normally → click "Connect"
  in the app → extension POSTs cookies (and optionally localStorage via a content
  script) to the API, which writes a storageState JSON. Genuinely good UX *after*
  the extension is installed; the install step is the friction.
- **Effort:** moderate. A minimal MV3 extension (`cookies` permission scoped to
  landmodo.com + land.com, one popup, one fetch to the endpoint) is ~1–3 days.
  Cookie JSON → Playwright storageState conversion is trivial. Publishing to the
  Chrome Web Store adds review latency (or sideload "unpacked" for a tiny team —
  fine at 5–20 semi-trusted users, ugly for true external users).
- **Scalability:** good for tens of users; each user exports their own session
  from their own browser/IP.
- **Security:** cookies transit the API — use TLS + short-lived signed upload
  tokens, encrypt at rest. Better than passwords (revocable, no credential reuse
  risk), worse than "session never leaves vendor infra."
- **Fragility:** the big caveat — the session was minted on the *user's* browser
  fingerprint and IP; replaying it from a server changes both, which sophisticated
  sites flag (probably fine for Landmodo). Sessions expire; the refresh story is
  "click Connect again," which the extension makes cheap. `HttpOnly` cookies are
  readable by the `chrome.cookies` API, so no gap there; localStorage-based auth
  needs a content script.
- **Cost:** ~$0 (Chrome dev account $5 one-time).

## 2. Apify

What Apify actually offers (verified via docs/search):
- **Cookie transfer tutorial** (above) — their sanctioned onboarding is exactly
  the extension/manual-export pattern; they don't ship a first-party capture
  extension, they recommend EditThisCookie-class tools. Community actors exist:
  `pocesar/login-session` ("grab a session for any website for usage on your own
  actor" — logs in with username/password inside an actor and stores a named
  session), `Cookie & Session Manager`, `Session/Login Extractor`.
- **SessionPool** (Crawlee/SDK): rotation + persistence of cookies/tokens per
  "session" (each session ≈ a user with its own cookies, proxy IP, fingerprint;
  `persistCookiesPerSession`). Designed for scraping-scale rotation, but usable as
  a per-user session store.
- **Proxies/fingerprints:** residential proxies at **$8/GB**, fingerprint
  generation built into Crawlee.
- **Running the poster as an actor:** entirely feasible — the Playwright worker
  containerized as an actor, invoked via API with `{listing, storageStateJSON or
  named session}` input. Pricing: Free plan $5 credit/mo; Starter **$29/mo**;
  compute ~**$0.20/CU** on Free/Starter (1 CU = 1 GB-RAM-hour; a Playwright run
  wants 2–4 GB, so a 3-minute post ≈ 0.1–0.2 CU ≈ $0.02–0.04/post).
- **UX:** unchanged from option 1 for capture (extension/paste); Apify replaces
  the *worker infra*, not the capture problem. Their credential-login actor is the
  option-5 pattern, not a capture pattern.
- **Effort:** porting the worker to an actor is small (a Dockerfile + input
  schema); but working workers already exist in-app, so this mostly adds a vendor.
- **Verdict:** Apify doesn't solve session *capture* any better than a DIY
  extension; it's attractive only if you also want managed
  compute/proxies/scheduling. For 1–20 users posting a few listings/day, the
  existing self-hosted worker is cheaper and simpler.

## 3. Hosted browser with embedded Live View (the "log in inside the app" pattern)

This is the purpose-built answer to the exact problem, and every major vendor now
ships it. Flow is identical across vendors: app creates a remote browser session
bound to a **persistent context/profile**, gets a **live-view URL**, embeds it in
an `<iframe>`; user logs in to Landmodo *inside the app*; session ends;
cookies/localStorage persist in the profile; later Playwright runs connect over
CDP with that profile — or you export the state into the existing storageState
files.

Vendor specifics (verified from vendor docs unless noted):

| Vendor | Live view embed | Persistence | Pricing |
|---|---|---|---|
| **Browserbase** | `sessions.debug()` → `debuggerFullscreenUrl`, iframe with sandbox attrs; read-only via `pointer-events:none`; `&navbar=false`; explicitly markets "delegate credentials — give control to the end user" and ships a **"manual MFA with Contexts"** template doing exactly this flow | **Contexts** (cookies, cache, auth state; `persist: true`) | Free: 1 br-hr/mo; **Developer $20/mo** (100 hrs, 25 concurrent, $0.12/hr after); Startup $99/mo (500 hrs, $0.10/hr); proxies $10–12/GB; CAPTCHA solving on paid tiers |
| **Anchor Browser** | `live_view_url` at session creation, iframe-embeddable, `one_time_url: true` option (headful only) for single-use security | profiles/identity ("OmniConnect") | ~**$0.05/browser-hr** + $0.01/session + $8/GB proxy + $0.01/AI step; $5 free credit; plans from $50/mo |
| **Steel.dev** (open-source core) | `debugUrl?interactive=true&showControls=true` iframe; WebRTC stream; documented human-in-the-loop guide | **Profiles** (cookies, localStorage, auth tokens, fingerprints; start session with `profileId`) | Free: $10 credit ≈ 100 br-hrs/mo; $29/mo ≈ 290 hrs; ~$0.10/br-hr; CAPTCHA + proxies included in credits; **self-hostable** (steel-browser repo, Railway template) |
| **Hyperbrowser** | live-view iframe with token auth (token expires 12 h) | Profiles (API/dashboard; fresh vs resumed) | credits: **$0.10/browser-hr**; free 1,000 credits/1 concurrent; Startup $30/mo |
| **Kernel** | live view streaming + recordings | Profiles (cookies + localStorage, Apache-2.0 open source) | pricing **unverified** (JS-rendered page); "start free" claimed |
| **Hyperbeam** | origin of the embedded-virtual-browser category (multiplayer WebRTC browsers); 10,000 free min/mo | geared to co-browsing, not automation profiles | more relevant as prior art than as a vendor |

- **UX:** best-in-class — user never leaves the app, never installs anything,
  types their password directly into the real site (the app never sees it),
  MFA/CAPTCHA during login are handled naturally by the human.
- **Effort:** low. ~1–2 days: "Connect Landmodo" button → create context+session →
  iframe → poll for login success (check a cookie or dashboard URL) → mark
  connected. Playwright workers then either run against the vendor's browsers
  (`connectOverCDP`) or pull cookies out into the current storageState pipeline
  (Browserbase/Steel expose session cookies via CDP `Network.getAllCookies` at
  minimum).
- **Scalability:** per-user contexts are the vendors' core primitive; 5–20 users
  is trivial.
- **Security:** strong — credentials go user→marketplace directly; the app stores
  only a context ID. Session state lives with the vendor (assess their SOC2;
  Browserbase advertises one). Guard the live-view URL (it grants browser
  control): short-lived, one-time where offered.
- **Fragility:** session minted and replayed on the *same* browser/IP class → much
  better cookie longevity than extension export. Vendors bundle
  stealth/fingerprints/CAPTCHA solving. Main risks: vendor lock-in, datacenter IPs
  (mitigate with their residential proxies if Landmodo ever cares).
- **Cost at this scale:** near-zero. A login capture is ~2 min of browser time; a
  posting run ~3 min. Even 20 users × 30 posts/mo ≈ 30–50 browser-hours ≈ fits in
  Browserbase's $20/mo Developer or Steel's free tier.

## 4. Self-hosted headed browser streamed to the app

Options: (a) **neko** (m1k1o/neko) — Dockerized Chromium + WebRTC, explicitly
pitched as "embed a virtual browser in your web app — open-source alternative to
Hyperbeam"; iframe-embeddable with URL credentials (`?usr=…&pwd=…`), <300 ms
latency; (b) Xvfb + x11vnc + noVNC around the existing headed Playwright script;
(c) raw CDP `Page.startScreencast` + synthesized input events over WebSocket
(what the hosted vendors build internally).

- **UX:** can match option 3 exactly once built.
- **Effort:** the catch. neko gets a viewable browser fast (a day), but you still
  must build: per-user container orchestration, profile persistence/extraction to
  storageState, session lifecycle, TURN server for WebRTC through NATs, auth
  around the stream, TLS. Realistically **1–2 weeks to solid**, plus ongoing ops.
  CDP screencast from scratch: 2–4 weeks.
- **Scalability:** each concurrent login session is a container (~1–2 GB RAM);
  fine at this scale on one VPS.
- **Security:** best data-sovereignty (nothing leaves your infra) but you own all
  of it; a leaked neko URL = full browser control.
- **Fragility:** sessions originate from your server IP (consistent thereafter —
  good); no vendor stealth/CAPTCHA help; you maintain Chromium/driver updates.
- **Cost:** a $10–40/mo VPS + your time. Only worth it if vendor dependency is
  unacceptable.

## 5. Credential vault (username/password in the app, headless login)

- **UX:** simplest possible form ("enter your Landmodo email + password"), and
  self-healing — when a session expires the worker just re-logs-in, no user
  involvement. This is what `pocesar/login-session` on Apify automates.
- **Effort:** low (login script + encrypted-at-rest secret storage, e.g. libsodium
  sealed box / KMS).
- **Security:** the weak point. The app holds reusable plaintext-equivalent
  credentials for accounts it doesn't own; users reuse passwords across sites; a
  breach of the box is a breach of their accounts everywhere. At 1 user
  (yourself) it's fine; at 5–20 *other* people it's a liability and a trust ask
  ("give this app your password") that the live-view option avoids entirely.
- **Fragility:** breaks on MFA (can't headlessly answer an email/SMS code without
  extra plumbing) and CAPTCHAs on the login form (login pages are where sites
  concentrate bot defenses; scripted logins from datacenter IPs are the classic
  trigger). **Not verified** whether Landmodo or Land.com logins currently present
  CAPTCHA/MFA — if Landmodo's login is plain (likely for a small site), this works
  today but is the most likely thing to silently break.
- **ToS:** automated login with stored credentials is the pattern most explicitly
  prohibited by typical marketplace ToS; session-reuse approaches are gray, this
  is grayer. (Specific automation clauses in Landmodo/Land.com ToS: **unverified**.)
- **Cost:** ~$0.

---

## Comparison

| | UX (non-technical user) | Build effort | 5–20 users | Security | Fragility | $/mo at this scale |
|---|---|---|---|---|---|---|
| **Hosted live-view (Browserbase/Steel/Anchor)** | excellent — login inside the app, no install | 1–2 days | built-in (contexts/profiles) | strong (no credential custody) | low (same-IP replay, stealth, CAPTCHA help) | $0–20 |
| **Extension export** | good after install; install is friction | 2–4 days + store review | fine | medium (cookies transit the API) | medium (fingerprint/IP mismatch, re-export on expiry) | ~$0 |
| **Apify (actor + session)** | same capture UX as extension/paste | small port | fine | medium | medium; managed proxies help | $0–29 + ~$0.03/post |
| **Self-hosted neko/noVNC** | can equal hosted live-view | 1–2 weeks + ops | ok on one VPS | best sovereignty, all yours to secure | medium (no stealth help) | $10–40 + time |
| **Credential vault** | simplest form; self-healing | 1–2 days | poor (trust + liability) | weakest | high (MFA/CAPTCHA at login) | $0 |

## Recommendation (initial, to be validated by the spike)

1. **Land.com: feed-API path rejected.** The official bulk XML feed API was
   evaluated and later rejected — it requires an account with a large number of
   ads, which we don't have (see the decision note in specs/specs.md). The
   Playwright browser-session path stays for Land.com.

2. **Landmodo (and any future feed-less site): hosted browser with embedded Live
   View — Browserbase or Steel.dev.** It's the exact "user logs in inside the web
   app, session persists for automation" primitive that's missing, ~1–2 days to
   integrate, near-free at this scale, and the same-browser/same-IP replay makes
   sessions far more durable than exported cookies. **Browserbase** is the most
   battle-tested and ships a template for precisely this flow (manual login/MFA
   into a persisted Context) at $20/mo; **Steel.dev** is the value/open-source
   pick (free tier likely covers this entirely; interactive iframe via
   `debugUrl?interactive=true`; self-host later to get off the vendor). Run the
   posting worker against the same vendor browser via `connectOverCDP`, or export
   cookies into the existing storageState files to keep workers unchanged.

3. **Bridge/fallback: keep the current CLI capture** while the above lands, and/or
   a minimal cookie-export extension as a break-glass path if a hosted vendor has
   an outage. Skip Apify (solves worker hosting that already exists, not capture)
   and skip self-hosted neko unless vendor dependency becomes a hard constraint —
   same result as #2 for 5–10x the effort.

**Unverified items to confirm during the spike:** (a) whether Landmodo's
login currently has CAPTCHA/MFA; (b) Kernel pricing (page is JS-rendered, no data
retrieved); (c) exact mechanics of exporting cookies out of a Browserbase Context
into local storageState (CDP `Network.getAllCookies` works generically, but a
first-party export endpoint is unverified).

**Key sources:**
- Browserbase Live View: https://docs.browserbase.com/features/session-live-view
- Browserbase manual-MFA-with-Contexts template: https://www.browserbase.com/templates/manual-mfa-with-contexts
- Browserbase pricing: https://www.browserbase.com/pricing
- Steel human-in-the-loop: https://docs.steel.dev/overview/sessions-api/human-in-the-loop
- Steel Profiles: https://steel.dev/blog/profiles
- Anchor live view: https://docs.anchorbrowser.io/advanced/browser-live-view
- Anchor pricing: https://docs.anchorbrowser.io/pricing
- Hyperbrowser live view: https://docs.hyperbrowser.ai/sessions/live-view
- Kernel Profiles: https://www.onkernel.com/docs/browsers/profiles
- Apify cookie-transfer tutorial: https://docs.apify.com/platform/tutorials/log-in-by-transferring-cookies
- Apify session management: https://docs.apify.com/sdk/js/docs/guides/session-management
- Apify pricing: https://apify.com/pricing
- apify-login-session actor: https://github.com/pocesar/apify-login-session
- PhantomBuster extension onboarding: https://support.phantombuster.com/hc/en-us/articles/24572365472786-How-to-Connect-Your-LinkedIn-Account-to-PhantomBuster
- neko self-hosted virtual browser: https://github.com/m1k1o/neko
- Hyperbeam: https://hyperbeam.com/
- Landmodo seller support: https://www.landmodo.com/seller-support
