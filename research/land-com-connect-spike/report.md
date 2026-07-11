# Land.com Access — Research Spike Report

**Spec:** [specs/land-com-connect.md](../../specs/land-com-connect.md) · **Started:** 2026-07-11 · **Status:** In progress

On 2026-07-11 the live-view login capture for `land_com` stopped working: Land.com's
Akamai edge hard-blocks the worker box's Linode datacenter IP pre-auth. This report
documents the block with evidence, maps its scope, evaluates every realistic way to
connect Land.com anyway, and (US-007) validates a real captured session. Prior art:
[research/auth-capture-spike/report.md](../auth-capture-spike/report.md) — cited, not
repeated.

---

## The Block

### Direct probes from the worker box

Fresh `curl -s -o /dev/null -w "%{http_code}"` results, run from the worker box
(Linode datacenter IP, hostname `45-33-58-61.ip.linodeusercontent.com`):

| Timestamp (UTC) | URL | HTTP status |
|---|---|---|
| 2026-07-11T05:54:34Z | `https://www.land.com/login` | **403** |
| 2026-07-11T05:54:34Z | `https://www.land.com/` | **403** |

The block is **pre-auth and browser-independent**: plain `curl` (above) and the
capture stack's headed Chromium both receive it, for the login page and the home
page alike. No login flow, however human, can get past it from this box — the
denial happens before any application logic runs.

### The Akamai reference-page pattern

Both URLs return the standard Akamai edge denial page (fetched 2026-07-11T05:55Z;
reference IDs rotate per request):

```html
<HTML><HEAD>
<TITLE>Access Denied</TITLE>
</HEAD><BODY>
<H1>Access Denied</H1>
You don't have permission to access "http://www.land.com/login" on this server.<P>
Reference #18.4b5ed617.1783749332.2e87662b
<P>https://errors.edgesuite.net/18.4b5ed617.1783749332.2e87662b</P>
</BODY></HTML>
```

Identifying marks: `<TITLE>Access Denied</TITLE>`, a `Reference #18.…` code, and a
pointer to `errors.edgesuite.net` — `edgesuite.net` is Akamai's edge-network domain,
so this is Akamai's edge refusing the connection on Land.com's behalf (IP-reputation
class blocking of datacenter ranges), not a Land.com application response.

### Journal timeline — the morning it broke (2026-07-11 UTC)

From `journalctl --user -u capture-server`:

| Time (UTC) | Event |
|---|---|
| 04:50:48 | `landmodo` capture **succeeded** (legitimate — operator logged in via live view; `auth/landmodo.json` written) |
| 04:50:55 | `land_com` capture started (session `212ea062…`) |
| 04:50:57 | "capture succeeded" — **2 s** after start |
| 04:51:04 | `land_com` capture started (session `ed2a56bd…`) |
| 04:51:05 | "capture succeeded" — **1 s** after start |
| 04:51:11 | `land_com` capture started (session `8e8b3f9b…`) |
| 04:51:13 | "capture succeeded" — **2 s** after start |
| ~04:57 | The bogus `auth/land_com.json` was deleted (auth dir mtime 04:57; file absent since — only `landmodo.json` remains) |
| 04:58:31 | `land_com` capture started, cancelled at 04:58:54 |
| 05:12:42 | `land_com` capture started; no success line follows |

Three consecutive `land_com` captures reported success within ~2 seconds of
starting — humanly impossible for a login flow — and each exported a **logged-out**
session. No credentials were ever entered; the browser never got past Akamai's
Access Denied page.

### Finding: `redirect_off`-only detection false-positives on the Access Denied flow

**Mechanism.** `land_com`'s login-success signal in `config/posting-platforms.json`
is `{ "redirect_off": "/login" }` — a purely *negative* signal with no cookie check
ANDed in. Detection (`isLoggedIn` in
[`workers/posting/capture/detect.ts`](../../workers/posting/capture/detect.ts))
reports logged-in as soon as the page URL's pathname no longer contains `/login`.
On 2026-07-11 the capture session navigated to `https://www.land.com/login`, got
Akamai's Access Denied flow — which touched `/login` and then landed on `/` — and
the pathname `/` doesn't contain `/login`, so detection declared success ~2 s after
start and `checkSession` exported `context.storageState()` of a browser that had
never logged in.

**Root cause.** A negative-only redirect signal can't distinguish "logged in and
navigated away from the login page" from "*any* navigation away from the login
page", including error flows. It was safe only as long as every path off `/login`
implied a successful login.

**Status.** Documented finding; **fixing it is named follow-up work, not this
spike** (per the spec's non-goals). Note for whoever picks it up: the working tree
holds an uncommitted partial mitigation in `checkSession` (only honor `redirect_off`
after the session has actually been seen *on* the login page), but it would **not**
have prevented this failure — the Access Denied flow does touch `/login` before
landing on `/`. The real fix is a *positive* signal for `land_com` (e.g. a named
session cookie ANDed with `redirect_off`, which the config schema already supports)
and/or teaching detection to recognize the Akamai denial page as a hard failure.

---

## Block Scope

Probes run from the worker box (same Linode datacenter IP as The Block section)
with `curl -s -o /dev/null -w "%{http_code} %{size_download}" --max-time 30`.
Sizes are response-body bytes; bodies were inspected only to the first line, to
classify 200s as real content vs. a disguised denial page.

| URL | Worker box (2026-07-11T05:58:36–37Z) | Home IP (OT-A) |
|---|---|---|
| `https://www.land.com/` | **403** · 366 B | awaiting OT-A |
| `https://www.land.com/login` | **403** · 371 B | awaiting OT-A |
| `https://www.land.com/LandFeed/` | **200** · 30,894 B | awaiting OT-A |
| `https://www.land.com/LandFeed/Docs/` | **200** · 85,138 B | awaiting OT-A |
| `https://www.land.com/LandFeed/schemas/LandFeedSchema1.0.xsd` | **200** · 8,080 B | awaiting OT-A |
| `https://www.landsofamerica.com/` | **403** · 376 B | awaiting OT-A |
| `https://www.landwatch.com/` | **403** · 371 B | awaiting OT-A |

First-line checks of the three 200s: the two `/LandFeed/` HTML pages return a
normal `<!DOCTYPE html>` document (not the Akamai `Access Denied` page — its
~370-byte body and `<TITLE>Access Denied</TITLE>` are unmistakable), and the
`.xsd` returns the actual schema (`<?xml version="1.0" …><xs:schema …>`).

**Conclusion: the LandFeed endpoints are NOT blocked from the datacenter IP.**
The Akamai block covers the consumer site — `www.land.com` pages and the sister
brands `landsofamerica.com` and `landwatch.com` (all 403 with the same
edge-denial body) — but the `/LandFeed/` path is exempt, consistent with the
2026-07-10 probes from the prior spike. This means the sanctioned LandFeed API
route survives the block intact: if the operator obtains a shared key (OT-C),
the worker box can push listings to Land.com directly, with no egress work at
all. The block only kills browser-based capture and posting from this box.

The 403s on `landsofamerica.com`/`landwatch.com` also close a loophole worth
noting: logging in via a sister brand instead of `www.land.com` is not an
escape hatch — the whole consumer surface is behind the same edge policy.

### Home-IP probes (OT-A)

A copy-pasteable probe script for the same URL list is at
[`home-probe.sh`](home-probe.sh) (plain `curl` loop, no dependencies, prints no
response bodies). **OT-A:** run it from a home/residential connection and paste
the output into `operator-input/home-probes.txt` (see the
[operator-input README](operator-input/README.md)). The Home IP column above is
pending until OT-A lands; the working assumption — the operator browses
land.com normally from home — is unverified until then.

## Capture From the User's Browser

The operator's idea: instead of the server's browser logging in (which Akamai now
blocks), let the operator log in from **their own** browser on their residential
IP, and capture that already-authenticated session for the server to replay. This
section grounds that idea against cookie security before anything gets built. Prior
art: [`research/auth-capture-spike/initial-research.md`](../auth-capture-spike/initial-research.md)
§1 (the PhantomBuster/Apify extension pattern) — built on here, not re-researched.

### The `HttpOnly` question decides everything

Session cookies on real login flows are almost always flagged `HttpOnly` — that is
the whole point of the flag: the cookie is sent on every HTTP request but is
**invisible to page JavaScript**. Verified 2026-07-11:

- `document.cookie` and the newer `CookieStore.getAll()` **cannot** read `HttpOnly`
  cookies — by design, this is a client-side-script security boundary, not a
  Land.com-specific measure ([MDN / Chrome for Developers, chrome.cookies
  reference](https://developer.chrome.com/docs/extensions/reference/api/cookies),
  fetched 2026-07-11).
- The extension `chrome.cookies` API **can** read `HttpOnly` cookies — it is an
  "elevated privilege" API explicitly documented to expose `HttpOnly` cookie data
  to the extension ([Chromium cookies-API design
  doc](https://www.chromium.org/developers/design-documents/extensions/proposed-changes/apis-under-development/proposal-chrome-extensions-cookies-api/),
  fetched 2026-07-11).
- DevTools (Application → Cookies) and any CDP `Network.getAllCookies` client also
  see `HttpOnly` cookies — DevTools runs above the page-script boundary.

So the dividing line for the three sub-options below is simply: does the mechanism
run with page-script privileges (blind to `HttpOnly`) or with
extension/DevTools/CDP privileges (sees everything)?

### (a) Manual DevTools / cookie-export-extension → paste into a dashboard form

The operator opens land.com logged in, then either reads cookies out of **DevTools
→ Application → Cookies** by hand, or (far less error-prone) uses an
off-the-shelf cookie-export extension — Cookie-Editor or the EditThisCookie class
of tool, which export the current site's cookies as a JSON array in the
Puppeteer/Playwright-compatible shape (this is exactly Apify's sanctioned "Log in
by transferring cookies" onboarding, cited in the prior spike). Because those
extensions use `chrome.cookies`, they capture `HttpOnly` session cookies too. The
JSON is then pasted into a dashboard textarea; a converter (US-007's throwaway
script) turns it into `auth/land_com.json`.

- **Friction:** one-time per session-expiry — open the site, click the extension,
  copy, paste. No install for the DevTools variant (but hand-copying multi-cookie
  JSON is fiddly and easy to get wrong); one small install for the extension
  variant. No dashboard/API code required beyond a paste box and the converter.
- **Password custody:** none — the operator logs in themselves; only cookies move.
- **Verdict: Recommended for this spike.** It is the lowest-effort path that
  actually works against `HttpOnly` cookies, needs zero production-code change
  (matches the spike's non-goals), and the export→convert→validate flow is exactly
  what US-004 (instructions) and US-007 (validation) exercise. The one caveat is
  that it is manual on every session refresh; option (b) is the upgrade if that
  friction ever bites.

Step-by-step operator instructions for this method (US-004) are in the
[operator-input README](operator-input/README.md#ot-b--landcom-cookie-export):
which browser, the Cookie-Editor export flow, the exact drop-off filename
(`land_com-cookies.json`), and the safety rules. **OT-B is now actionable** —
once the export lands in `operator-input/`, US-007 converts and validates it.

### (b) Minimal MV3 extension that POSTs land.com cookies to the dashboard

The PhantomBuster pattern from the prior spike (§1): a purpose-built Manifest V3
extension with the `cookies` permission scoped to `land.com` (plus
`landsofamerica.com`/`landwatch.com` if any auth rides the sister domains), one
popup with a "Connect Land.com" button, and a single `fetch` that POSTs
`chrome.cookies.getAll({domain})` to a dashboard endpoint over TLS with a
short-lived signed upload token. The dashboard converts and writes
`auth/land_com.json`. Because it uses `chrome.cookies`, `HttpOnly` is a non-issue.

- **Friction:** one-time install (sideloaded "unpacked" is fine for a single
  operator; Chrome Web Store review only matters if this ever serves external
  users), then re-capture is one click — the cheapest refresh story of the three.
- **Password custody:** none — same as (a).
- **Effort:** ~1–3 days (extension + a dashboard receive/convert route). That is
  **production code and out of scope for this spike** (non-goals forbid new
  dashboard/API surface); it is the natural productization if the manual path in
  (a) proves too tedious at the operator's real refresh cadence.
- **Verdict: Viable fallback / the future upgrade path.** Best UX of the family,
  but more build than this spike allows. Recommend only if session churn makes
  (a)'s per-refresh copy-paste annoying.

### (c) Pure web-page / bookmarklet flow (no extension)

A bookmarklet or a dashboard-hosted page that tries to read the operator's
land.com cookies from JavaScript — `document.cookie` — and POST them back. This is
the "no install at all" dream.

- **Verdict: Rejected — technically impossible for this use case.** A bookmarklet
  runs with **page-script privileges**, so `document.cookie` cannot see the
  `HttpOnly` session cookies that authenticate land.com (verified above). It would
  capture only non-`HttpOnly` cookies, which do not carry the session, producing an
  `auth/land_com.json` that fails to authenticate — the same silent
  logged-out-export failure that started this spike. A cross-origin page can't read
  another origin's cookies at all, and `SameSite` blocks them from riding a
  cross-site POST regardless. There is no extension-less capture path for
  `HttpOnly` session cookies; this is a hard browser security boundary, not a
  Land.com quirk.

### Cookie → Playwright `storageState` conversion shape

The poster loads sessions via Playwright `storageState` JSON. The converter must
emit exactly this shape (verified against the [Playwright
BrowserContext](https://playwright.dev/docs/api/class-browsercontext) /
[Authentication](https://playwright.dev/docs/auth) docs, fetched 2026-07-11):

```json
{
  "cookies": [
    { "name": "...", "value": "...", "domain": ".land.com", "path": "/",
      "expires": 1793456000, "httpOnly": true, "secure": true, "sameSite": "Lax" }
  ],
  "origins": [
    { "origin": "https://www.land.com", "localStorage": [ { "name": "...", "value": "..." } ] }
  ]
}
```

Every cookie attribute must survive the round-trip or replay fails:

- **`domain`** — preserve the leading-dot form (`.land.com`) for host-wildcard
  cookies exactly as exported; a wrong domain means the cookie is never sent.
- **`path`** — usually `/`; keep whatever the export shows.
- **`expires`** — Unix time in **seconds** (not ms); a session cookie with no
  expiry serializes as `-1`. This is the only lifetime metadata US-007 may record
  (expiry timestamps only, never values).
- **`httpOnly`** — must be carried through; the session cookies will have it set,
  and only the extension/DevTools export can supply it (see the `HttpOnly`
  verdict). Cookie-export extensions map their `hostOnly`/`httpOnly` fields
  straight across.
- **`secure`** — true for land.com session cookies (HTTPS-only).
- **`sameSite`** — normalize to Playwright's accepted set `"Strict" | "Lax" |
  "None"`; exporters sometimes emit `"no_restriction"`/`"unspecified"`/`"None"`
  which must be mapped (`no_restriction`→`None`, `unspecified`/absent→`Lax`) or
  Playwright rejects the state file.
- **`localStorage`** — capture it too if land.com stores any auth token there; the
  `chrome.cookies` API does **not** read `localStorage`, so a pure cookie export
  misses it. If the validation in US-007 shows cookies alone authenticate, the
  `origins` array can be empty; if not, a content-script/DevTools `localStorage`
  dump is needed. `sessionStorage` is deliberately out — Playwright omits it (it is
  tab-scoped and ephemeral).

### Replay caveat — capture alone is not enough

This is the honest limit of the whole family. A session captured in the operator's
browser is minted against the operator's **home/residential IP and browser
fingerprint**. Replaying it from the worker box does not help, because the worker
box's Linode datacenter IP is hard-blocked by Akamai **pre-auth** (see The Block):
the poster's request never reaches the point where the cookie would be validated —
it gets the same `403 Access Denied` a logged-out request gets. Capturing a perfect
session changes nothing about *where it is replayed from*.

**Therefore capture-from-browser only helps when paired with an unblocked egress
for the poster.** The pairings, spelled out:

1. **Capture-from-browser + residential egress (US-005).** The operator exports the
   session; the poster replays it through a home tunnel / Tailscale exit node /
   residential proxy so its requests leave from an IP Akamai serves. This is the
   pairing that makes browser automation viable for land.com at all.
2. **Capture-from-browser + run-locally (US-005).** The operator runs the poster on
   their own machine (same residential IP the session was minted on) — the
   least-fragile replay because IP *and* fingerprint class match, at the cost of the
   poster no longer being server-side.
3. **Capture-from-browser + worker box, unpaired — does not work.** Listed only to
   be explicit: exported session, replayed from the blocked datacenter IP, still
   `403`s. This is the combination to avoid.

The alternative that sidesteps the whole capture+egress problem is the LandFeed API
(US-006), whose endpoint is *not* blocked from the box — no session, no egress. The
comparison matrix (US-008) weighs that against these pairings.

## Residential Egress

*Pending US-005 — home tunnel / Tailscale exit node / commercial residential proxy,
costed and scored.*

## Run Locally

*Pending US-005 — running the capture stack (or the whole worker) on the operator's
machine and syncing the session to the server.*

## LandFeed API

*Pending US-006 — the sanctioned-API option re-anchored against the block; deep
dive already verified in [research/auth-capture-spike/report.md](../auth-capture-spike/report.md) §2.*

## Comparison & Recommendation

*Pending US-008 — full option matrix, primary recommendation, fallback chain, and
the "what would change this decision" list.*
