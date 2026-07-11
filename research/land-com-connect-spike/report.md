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

*Pending US-002 — probes of the full land.com surface (including the LandFeed
endpoints, which returned HTTP 200 from this box on 2026-07-10) and the home-IP
probe script for OT-A.*

## Capture From the User's Browser

*Pending US-003 — manual export / MV3 extension / bookmarklet designs, the
`HttpOnly` verdict, and the cookie→storageState conversion shape.*

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
