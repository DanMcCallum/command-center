# Land.com Access — Research Spike Report

**Spec:** [specs/land-com-connect.md](../../specs/land-com-connect.md) · **Started:** 2026-07-11 · **Status:** Complete · **Open operator gates:** OT-A/OT-A′ **resolved 2026-07-12** — home browser reaches land.com, so residential egress + capture-from-browser are confirmed viable (block = datacenter-IP + curl-fingerprint, not the home IP); OT-B landed 2026-07-12 — land.com's session is **two host-only cookies** (`MarketPlaces`@www.land.com + `MarketingHub`@market.land.com, both ASP.NET Data Protection); both now merged into `auth/land_com.json`, but real-session validation is still owed (needs an unblocked egress — this box is IP-blocked)

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
Sizes are response-body bytes.

| URL | Worker box (2026-07-11T05:58:36–37Z) | Home IP curl (OT-A, 2026-07-12T05:21Z) |
|---|---|---|
| `https://www.land.com/` | **403** · 366 B | **403** · 366 B |
| `https://www.land.com/login` | **403** · 371 B | **403** · 371 B |
| `https://www.landsofamerica.com/` | **403** · 376 B | **403** · 376 B |
| `https://www.landwatch.com/` | **403** · 371 B | **403** · 371 B |

**Conclusion: the Akamai block covers the whole consumer surface from this
box.** `www.land.com` pages and the sister brands `landsofamerica.com` and
`landwatch.com` all return 403 with the same ~370-byte edge-denial body
(`<TITLE>Access Denied</TITLE>` is unmistakable). No browser-based capture or
posting can run from this box.

The 403s on `landsofamerica.com`/`landwatch.com` also close a loophole worth
noting: logging in via a sister brand instead of `www.land.com` is not an
escape hatch — the whole consumer surface is behind the same edge policy.

### Home-IP probes (OT-A / OT-A′) — resolved 2026-07-12: home IP is clean, the block is datacenter-IP + curl-fingerprint

OT-A ran from the operator's home/residential connection on 2026-07-12T05:21Z
(raw output: [`operator-input/home-probes.txt`](../../operator-input/home-probes.txt)).
The Home IP column above is now filled, and it is a **byte-for-byte match** to the
worker box: the consumer pages (`www.land.com/`, `/login`) and both sister brands
`landsofamerica.com`/`landwatch.com` all return **403** with the same ~370-byte
Akamai denial body. The residential IP is treated exactly like the datacenter IP
by this probe.

**This does not by itself kill the residential-egress premise — because OT-A is a
`curl` probe, and the thing that premise depends on is a real *browser*.** The two
are not interchangeable to Akamai:

- **The box block is IP-based** (verified 2026-07-12 from the box): sending a full
  Chrome `User-Agent` + browser `Accept*` headers changes nothing — still `403`,
  same 371-byte body, `server: AkamaiGHost`. Combined with the prior finding that
  the capture stack's headed Chromium is also blocked from the box, the datacenter
  IP is denied regardless of client.
- **The home block is, so far, only proven against `curl`.** curl and real Chrome
  present different TLS/JA3 and HTTP/2 fingerprints and header ordering; Akamai Bot
  Manager routinely 403s the curl fingerprint on a *good* IP while serving the same
  IP's real browser normally. So the home `403` is consistent with **both**:
  (i) the home IP is genuinely blocked — residential egress and capture-from-browser
  are dead, or (ii) Akamai blocks curl's fingerprint from everywhere and the
  operator's actual browser loads land.com fine from home — premise intact, and OT-A
  simply used the wrong instrument.

**OT-A′ — RESOLVED 2026-07-12, and it lands on interpretation (ii): the residential
premise holds.** The operator ran the disambiguating check from the same home
connection and reported:

- **Home browser → `https://www.land.com/login` renders the real login page** (not
  Access Denied). The operator browses land.com normally from home.
- **Local browser on the worker box → still the Akamai Access Denied page** (re-confirmed).

Putting the three data points together settles the mechanism cleanly:

| Client | From home (residential IP) | From worker box (datacenter IP) |
|---|---|---|
| `curl` | **403** (OT-A) | **403** |
| Real browser | **200 — renders** (OT-A′) | **403 — Access Denied** (OT-A′) |

The block is therefore **two independent layers**: (1) a **datacenter-IP-reputation**
block that denies *everything* from the Linode range — real browser included — which
is why the worker box is unreachable for browser posting no matter the client; and
(2) a **curl/automation-fingerprint** block that denies curl's TLS/HTTP signature
even from a clean residential IP, which is the *only* reason OT-A's home probe came
back 403. The home IP itself is **not** blocked — a real browser sails through.

**Consequence: the residential-egress and capture-from-browser families are
CONFIRMED viable, not merely assumed.** The operator's browser holds a real,
servable land.com session on the home IP; the remaining work is exactly what the
rest of this report scoped — export that session (OT-B, capture-from-browser §a) and
give the *poster* a residential egress (Tailscale exit node, Residential Egress §b)
so replay leaves from an IP Akamai serves. OT-A's scary-looking 403 was the wrong
instrument (curl), not a dead premise. The only caveat this leaves for downstream
tooling: any *automation* hitting land.com from home — a headless/scripted
Playwright run on the operator's machine, not just the box — may itself trip the
fingerprint layer that blocked curl, so capture should use a real/headed browser
profile, and a residential proxy's success depends on presenting a browser-grade
fingerprint too.

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

The comparison matrix (US-008) weighs these pairings against each other. (The
official Land.com feed API would have sidestepped the capture+egress problem
entirely, but that option was evaluated and rejected — see the decision note in
[specs/specs.md](../../specs/specs.md).)

## Residential Egress

The block is an **IP-reputation** block on the Linode datacenter range (see The
Block). The whole family of fixes here is: make the worker box's land.com traffic
*leave from an IP Akamai serves* — a residential IP — instead of the datacenter
IP. Unlike capture-from-browser (which fixes only login capture), residential
egress fixes **both** capture and posting in one move, because every land.com
request the box makes then exits through the residential path. This section costs
and scores three ways to get there. Pricing carries source URLs + fetch dates
because vendor pricing drifts (the prior spike's Steel.dev drift proves the point).

Note on scope: routing the *poster* through egress is a named follow-up
(Non-Goals). This section documents each option's attach-point and implications;
it changes no code.

### (a) WireGuard or SSH SOCKS tunnel via a device on the home network

Stand up a tunnel from the worker box to a device on the operator's home LAN (a
spare PC, a Raspberry Pi, or the operator's always-on desktop) and route land.com
traffic through it so it egresses from the home's residential IP.

- **WireGuard** — the home device runs `wg` as a peer; the worker box routes only
  land.com's address space (or all traffic, policy-routed) over the tunnel. Free
  and open source ([wireguard.com](https://www.wireguard.com/), fetched
  2026-07-11); the only cost is the home device's power and a static-ish home IP
  (or a dynamic-DNS name).
- **SSH SOCKS tunnel** — even lighter: `ssh -D 1080 -N operator@home-box` opens a
  local SOCKS5 proxy on the worker box that forwards through the home connection.
  Zero extra software beyond OpenSSH, which is already present. Best when only the
  browser needs the residential path (it does — nothing else on the box talks to
  land.com).

Scoring:

| Dimension | WireGuard | SSH SOCKS |
|---|---|---|
| Setup effort | Moderate — install `wg` both ends, exchange keys, config routes | Low — one `ssh -D` command (plus a home SSH endpoint) |
| Ops burden (home box reboots) | Tunnel drops until the home peer + `wg-quick` restart; needs a boot service + reconnect loop | Same drop; needs `autossh`/systemd to re-dial |
| Fragility | Home IP changes (ISP DHCP) break it → dynamic DNS; NAT traversal usually fine (WG roams) | Same home-IP fragility; SSH session dies on any network blip without `autossh` |
| Security exposure | Opens an inbound path into the home LAN — scope the tunnel to land.com egress only, firewall the rest | SSH key from a datacenter box to the home network — treat that key as a secret; restrict the account to port-forward only (`command="",no-pty`) |
| $/mo | **$0** (home power only) | **$0** |

### (b) Tailscale exit node on a home device

Install Tailscale on a home device and mark it an **exit node**; the worker box
(also on the tailnet) routes land.com traffic through it, egressing from the home
residential IP. This is the managed-tunnel version of (a) — Tailscale handles NAT
traversal, key rotation, and reconnect, which is exactly the fragile part of the
hand-rolled tunnels.

- **Free-tier applicability: yes.** Tailscale's **Personal** plan is free forever,
  supports up to 6 users with unlimited devices, and **includes exit nodes** in the
  core feature set — a single-operator home-device-plus-worker-box tailnet sits
  well inside the free tier ([tailscale.com/pricing](https://tailscale.com/pricing),
  fetched 2026-07-11). The paid Mullvad exit-node add-on ($5/mo per 5 devices) is a
  *different* thing — a commercial exit through Mullvad's datacenter IPs, which would
  reintroduce exactly the datacenter-IP-reputation problem and must **not** be used
  here; the free path is the operator's own home device.

Scoring:

| Dimension | Tailscale exit node (free tier) |
|---|---|
| Setup effort | Low — install Tailscale both ends, `tailscale up --advertise-exit-node` on the home box, approve it, `tailscale up --exit-node=<home>` on the worker box |
| Ops burden (home box reboots) | Lowest — Tailscale runs as a service and reconnects automatically; the exit-node advertisement persists across reboots |
| Fragility | Low — Tailscale's coordination plane handles home-IP changes and NAT; the failure mode is "home box offline" (then no egress at all), not "tunnel silently stale" |
| Security exposure | Better than raw SSH/WG — device-scoped ACLs, no inbound port opened on the home network, key rotation handled; the trade is trusting Tailscale's coordination server (control plane only; traffic is WireGuard end-to-end) |
| $/mo | **$0** on the Personal free tier |

### (c) Commercial residential-proxy service

Buy residential bandwidth from a proxy provider; land.com traffic egresses from the
provider's pool of real-ISP residential IPs. No home device to maintain — the
provider owns the residential footprint.

- **Reputable example — IPRoyal:** residential from **$1.75/GB**, pay-as-you-go,
  traffic that never expires ([iproyal.com/pricing](https://iproyal.com/pricing/),
  fetched 2026-07-11). The wider 2026 market spans budget (IPRoyal/Webshare, from
  ~$1.75/GB), mid-market (Decodo/Smartproxy ~$3–4/GB), and enterprise (Bright Data,
  Oxylabs, ~$8/GB entry) ([aimultiple.com/proxy-pricing](https://aimultiple.com/proxy-pricing),
  fetched 2026-07-11). For this workload — a handful of logins and posts per
  property, image uploads dominating bytes — traffic is low, so budget-tier
  PAYG is the right shelf; call it a few dollars a month at most.

Scoring:

| Dimension | Commercial residential proxy (IPRoyal-class) |
|---|---|
| Setup effort | Lowest — sign up, get `host:port:user:pass`, point the browser at it; nothing to host |
| Ops burden (home box reboots) | None — no home device in the path; provider owns uptime |
| Fragility | Rotating pools can hand out an IP that is *itself* flagged, or rotate mid-session and drop the login cookie's IP-binding → occasional re-auth; pick sticky/session IPs to reduce this |
| Security exposure | Land.com session cookies transit a third-party proxy operator — a real trust concern for an authenticated session; only use a provider with a clean sourcing/ToS record, and never send the land.com *password* through it (there is none to send — capture is cookie-only) |
| $/mo | ~**$2–5/mo** at this low volume ($1.75/GB × a few GB); scales with image bytes, but never signs a contract (PAYG) |

### Attaching egress to the existing stack (prose + config sketch, no code)

All three options terminate as **a proxy the browser points at** — a SOCKS5
endpoint (SSH tunnel, or WireGuard/Tailscale fronted by a local SOCKS listener) or
an HTTP proxy (commercial provider). Both the capture Chromium
(`workers/posting/capture/session.ts`) and the poster
(`workers/posting/post-*.ts`) launch Playwright Chromium, so both attach the same
two ways — and this is the point of egress: **the same proxy fixes capture and
posting.**

Playwright's first-class `proxy` option (per context or per launch) is the clean
attach point — sketch only, illustrating shape, not a change to commit:

```ts
// capture/session.ts launch (illustrative — not committed this spike):
const browser = await chromium.launch({
  headless: false,
  proxy: { server: 'socks5://127.0.0.1:1080' },        // SSH -D / WG+SOCKS
  // or: { server: 'http://res.iproyal.com:12321',      // commercial
  //       username: process.env.LANDCOM_PROXY_USER,
  //       password: process.env.LANDCOM_PROXY_PASS }   // secret, like auth/*.json
});
```

For a raw-flag equivalent (e.g. a quick research run), Chromium takes
`--proxy-server=socks5://127.0.0.1:1080` as a launch arg. A Tailscale exit node
needs **no** proxy flag at all — it is set at the OS/route layer
(`tailscale up --exit-node=<home>`), so the browser is unmodified and *all* box
traffic to land.com egresses residential; that is the least-code attach of the
three. WireGuard can likewise be route-level (policy-route land.com's subnet over
`wg0`) with no browser change, or fronted by a local SOCKS proxy if per-app scoping
is preferred. Whichever is chosen, the credential (SSH key, WG key, or proxy
user/pass) is a **secret** on the same footing as `auth/*.json` — chmod 600,
`.env.local`, never logged.

### Verdicts (US-003 rubric: no password custody · operator-tolerable expiry friction · no bot-evasion/stealth)

None of these three touch a password (land.com login stays in the operator's own
browser; egress only moves *where requests exit*), and none is bot-evasion — a
residential IP is *ordinary legitimate access from an IP Land.com serves*, exactly
what the Non-Goals require (as opposed to fingerprint spoofing or CAPTCHA solving).
They differ only on ops burden and trust:

- **Tailscale exit node — Recommended.** $0 on the free tier, lowest ops burden
  (auto-reconnect across reboots, no inbound port, ACL-scoped), and it fixes
  capture *and* posting at once. Its only prerequisite is an always-on home device,
  which the operator plausibly has. No password custody; expiry friction is nil
  (the tunnel is orthogonal to session refresh); no stealth tooling.
- **SSH SOCKS / WireGuard tunnel — Viable fallback.** Also $0 and also
  residential, but the reconnect-on-reboot and home-IP-drift handling that
  Tailscale gives for free become the operator's job (`autossh`/dynamic-DNS/systemd
  units). Choose this only if Tailscale can't be installed on the home device.
- **Commercial residential proxy — Fallback of last resort.** Zero home
  infrastructure and trivial setup, but it routes an authenticated land.com session
  through a third-party operator (a real trust cost) and its rotating IPs can
  themselves be flagged or drop mid-session. Justified only if the operator has no
  usable always-on home device. No password custody; low but nonzero $/mo; not
  stealth tooling, but the *provider's* IP sourcing must be reputable to stay on the
  right side of "ordinary legitimate access."

## Run Locally

Instead of making the server look residential, move the browser work **to** a
machine that is already residential — the operator's own computer. Two granularities:

**1. Run only the capture stack locally.** The operator runs a headed Playwright
Chromium (or the live-view capture stack) on their own machine, logs in to
land.com over their home connection — which is not blocked — and the session is
exported to `land_com.json` right there. That file is then synced to the server's
`workers/posting/auth/land_com.json` (chmod 600, over `scp`/`rsync`/Tailscale file
copy — same secret discipline as any `auth/*.json`). This is essentially the
capture-from-browser family (Capture From the User's Browser §), but with the
*whole browser* running locally rather than exporting cookies from an everyday
browser session — it captures `localStorage` and fingerprint-adjacent state a
cookie-only export misses, at the cost of the operator running a script instead of
clicking an extension.

- **The honest caveat:** this fixes **capture only**. Once `land_com.json` lands on
  the server, the *poster* still runs on the worker box and still egresses from the
  blocked datacenter IP — so it still gets `403 Access Denied` pre-auth, exactly as
  in the Replay caveat (Capture From the User's Browser §). A perfectly captured,
  freshly-synced session replayed from the datacenter IP changes nothing. **Run
  capture locally only if it is paired with a Residential Egress option for the
  poster** — otherwise it reproduces the silent logged-out-403 that opened this
  spike, just with a real cookie instead of a bogus one.

**2. Run the whole poster (or worker) locally.** Move `run-poster.sh` +
`workers/posting/post-*.ts` onto the operator's machine so both capture *and*
posting execute from the residential IP. This is the only "run locally" variant
that is self-sufficient — IP *and* browser-fingerprint class match, the
least-fragile replay of all — because nothing ever touches the datacenter IP for
land.com. The cost is architectural: the poster is no longer server-side, so it
runs only when the operator's machine is on, loses the box's cron/always-on
posting, and needs task state (`postings[]` PATCHes) to reach the dashboard API
over the network (a Tailscale tailnet makes that a localhost-like call). It also
splits the posting fleet — land_com posts locally, the other five platforms keep
posting from the box — unless the whole poster moves, which then makes *every*
platform depend on the operator's machine being up.

### Verdict (US-003 rubric: no password custody · operator-tolerable expiry friction · no bot-evasion/stealth)

- **Run capture locally — Viable, but only as half a solution.** No password
  custody (operator logs in on their own machine), no stealth tooling, and it is
  the highest-fidelity capture (real `localStorage` + native fingerprint). But it
  fixes capture alone; unpaired with egress it is worse than useless (silent
  logged-out replay). Expiry friction ≈ the capture-from-browser path plus a sync
  step. **Recommend only paired with Tailscale egress** — and if Tailscale is
  already up for egress, cookie-export capture (§a) is less friction than running a
  local browser stack, so this variant's niche is narrow.
- **Run the whole poster locally — Recommended only if server-side posting is
  abandoned for land_com.** It is the single most robust *replay* (residential IP +
  native fingerprint, no proxy in the path, no capture/egress split), no password
  custody, no stealth. But it trades away the system's server-side, always-on
  posting model and couples land_com posting to the operator's machine being on —
  a real regression from the current architecture. Prefer server-side box + a
  Residential Egress tunnel (which keeps posting on the box and automatic) unless
  the operator specifically wants land.com handled from their own machine.

## Land.com Feed API (evaluated and rejected)

Land.com publishes an official bulk XML feed API — a sanctioned, no-browser way
to manage listings, which would have sidestepped the capture and egress
problems entirely. It was evaluated in the prior spike and re-anchored here,
and subsequently **rejected (2026-07-12)**: it requires an account with a large
number of ads, which we don't have. See the decision note in
[specs/specs.md](../../specs/specs.md) — the single remaining record of that
evaluation. The browser-posting pairings above are the plan of record for
land.com.

## Session Capture & Validation (US-007)

**Status: OT-B landed 2026-07-12; after a two-domain merge the session cookies are
captured and `auth/land_com.json` is built. Real-session validation still pending an
unblocked egress.** Getting here took two passes and corrected a naming-based
misread — recorded honestly below because the lesson (land.com's auth spans two
host-only cookies on two subdomains) is load-bearing for anyone who redoes this.

**Land.com's session is TWO host-only ASP.NET Core Data Protection cookies, one per
subdomain:**

| Cookie | Domain (host-only) | Role | Format |
|---|---|---|---|
| `MarketPlaces` | `www.land.com` | Session for `www.land.com` — the poster's configured target (`login_url`/`new_listing_url` both `www.land.com`) | `CfDJ8…` (ASP.NET Core Data Protection encrypted) |
| `MarketingHub` | `market.land.com` | Session for `market.land.com` — the operator's actual ad-posting dashboard | `CfDJ8…` (ASP.NET Core Data Protection encrypted) |

Because both are **host-only**, neither appears in an export taken on the *other*
subdomain. The first OT-B export was taken on `market.land.com`, so it contained
`MarketingHub` (+ Stripe + the shared `.land.com` Akamai `bm_*`/`ak_bmsc` cookies)
but **not** `MarketPlaces`. My first-pass writeup wrongly called that export
"session-less" — it dismissed `MarketingHub` as a marketing cookie on its *name*.
That was wrong: `MarketingHub`'s value is a `CfDJ8…` Data Protection token (the same
format as `MarketPlaces`), i.e. a real session cookie. The HttpOnly guard is still
only necessary-not-sufficient (Akamai's own `bm_*` cookies are HttpOnly), but the
correct disqualifier here was never "no HttpOnly cookie" — it was "wrong subdomain,
so the *other* session cookie is missing."

**Resolution (what's now in place):** the operator supplied the `www.land.com`
export too (`MarketPlaces` + `.land.com` Akamai cookies). The two exports were
**merged** — deduping by `(name, domain, path)`, preferring the fresher `www` values
on the shared Akamai cookies — into a single 12-cookie
`operator-input/land_com-cookies.json`, then converted. `auth/land_com.json`
(chmod 600) now holds a Playwright storageState carrying **both** session cookies:
`MarketPlaces` (expires 2026-08-09, ~28 d) and `MarketingHub` (session cookie,
`expires: -1` — Playwright restores session cookies on replay). Structural checks
pass: storageState shape valid, all `sameSite` normalized to Playwright's accepted
set (`no_restriction`→`None`), `httpOnly`/`secure` preserved, `origins: []`.

**Still open — the two real caveats:**

1. **Not yet authenticated against a live land.com.** This box can't test it
   (datacenter-IP block; validation needs the operator's machine or a home tunnel,
   per the Replay caveat). Everything above is capture + structural validation, not
   proof the session is accepted. The validation run below is unchanged and still owed.
2. **A config/target question surfaced.** The poster targets
   `www.land.com/account/listings/new`, but the operator posts via the
   `market.land.com` dashboard. Both sessions are now captured, so either target is
   covered — but which one the poster *should* drive (and whether
   `www.land.com/account/listings/new` still resolves to the real new-listing flow)
   needs confirming before build. `origins: []` also means no `localStorage` was
   captured; if validation shows either session needs a `localStorage` token, redo
   that subdomain's capture via a DevTools/local-browser dump (Run Locally §1).

**Everything not gated on the export is ready:**

- The converter exists and is proven:
  [`workers/posting/research-convert-cookies.ts`](../../workers/posting/research-convert-cookies.ts)
  (throwaway, `research-*`-named, in-package so it typechecks, wired into no
  npm script or worker path). Run it with
  `cd workers/posting && npx tsx research-convert-cookies.ts` — it reads the
  OT-B drop-off by default and writes Playwright storageState to
  `auth/land_com.json`, chmod 600. It normalizes the Cookie-Editor shape per
  the conversion table above (`expirationDate` float-seconds → integer
  `expires`, absent/`session` → `-1`; `no_restriction`→`None`,
  `unspecified`→`Lax`), filters out any non-land.com cookies, and **fails
  closed** if the export contains no `HttpOnly` cookie (the signature of a
  page-script export that cannot carry the session — see the `HttpOnly`
  section). It prints only cookie names, flags, and expiry timestamps — never
  values.
- Converter mechanics were verified 2026-07-11 against a **synthetic fixture**
  (fake values, deleted after the run): output loads into a Playwright
  `chromium` context without error, chmod 600 held, and both failure guards
  (no-HttpOnly export, missing input) exit non-zero with an actionable
  message. This is a mechanics check only — it says nothing about whether a
  real land.com session authenticates.
- The validation plan, for when the export lands: convert; then load an
  authenticated land.com account page with that storageState **from an
  unblocked egress** (the operator's machine or a home tunnel per Residential
  Egress — the worker box's blocked IP is not a valid test bed, per the Replay
  caveat); save a redacted screenshot to `artifacts/`; record here which egress
  was used, whether the session was accepted (no re-login, no Access Denied),
  and cookie expiry timestamps only; then delete the raw export.

## Comparison & Recommendation

### The matrix

Every option evaluated in this report, on one page. "Fixes capture?" = gets a
working authenticated land.com session; "Fixes posting?" = lets the *poster*
reach land.com past the block. Capture-only options must be **paired** with an
egress row (the Replay caveat).

| Option (section) | Fixes capture? | Fixes posting? | Operator friction | Build effort | Ops burden | Fragility | Security | $/mo |
|---|---|---|---|---|---|---|---|---|
| **Cookie export — manual extension** (§a) | Yes (`HttpOnly` covered via `chrome.cookies`) | **No — must pair with egress** | Copy-paste per session expiry | ~Done: converter built (US-007); needs only OT-B | None | Session expiry cadence unknown until US-007 validates | Good: cookies transit only operator→repo, deleted after conversion | $0 |
| **Cookie export — MV3 extension** (§b) | Yes | **No — must pair with egress** | One click per refresh (best UX of the family) | 1–3 days (extension + dashboard receive route — production code) | Low | Same session-expiry exposure as §a | Good: TLS POST with signed upload token | $0 |
| **Bookmarklet** (§c) | **No — rejected** (page JS cannot read `HttpOnly` session cookies) | No | — | — | — | — | — | — |
| **Tailscale exit node** (Egress §b) | Yes (capture browser egresses residential) | **Yes** | None day-to-day | ~0 code: route-level, no browser change | Lowest of the tunnels: auto-reconnect, no inbound port | Low; failure mode is "home box offline" | Good: WireGuard e2e, ACL-scoped; trusts Tailscale control plane | **$0** (Personal tier) |
| **SSH SOCKS / WireGuard tunnel** (Egress §a) | Yes | **Yes** | None day-to-day | Low code, moderate config (keys, routes, boot services) | Reconnect/dyn-DNS is the operator's job | Home-IP drift + tunnel drops without babysitting | OK: inbound path into home LAN to scope carefully | $0 |
| **Commercial residential proxy** (Egress §c) | Yes | **Yes** | None day-to-day | ~0 code: Playwright `proxy` option | None (provider-owned) | Rotating IPs can be flagged or drop mid-session | **Weakest: authed session transits a third party** | ~$2–5 |
| **Run capture locally** (Run Locally §1) | Yes (highest fidelity: `localStorage` + native fingerprint) | **No — must pair with egress** | Run a script + sync the file per refresh | Low (script exists in-family) | Sync step each refresh | Narrow niche: if egress is already up, §a is less friction | Good | $0 |
| **Run whole poster locally** (Run Locally §2) | Yes | **Yes** (self-sufficient — most robust replay) | Machine must be on to post | Moderate: move poster + point it at the dashboard API remotely | Posting tied to the operator's machine uptime | Low for replay; high for the *system* (loses always-on server-side posting) | Good | $0 |

### Recommendation

**Primary: cookie export via extension (§a) paired with a Tailscale exit node
(Egress §b).** The two halves of this spike's question get separate answers
that combine into one plan:

- **Login capture (this spike's deliverable):** cookie export via extension
  (§a) — OT-B → `research-convert-cookies.ts` → `auth/land_com.json`. The
  converter is built and mechanics-proven; only the operator's export and the
  US-007 validation run remain.
- **Posting egress (the follow-up this implies):** a **Tailscale exit node** on
  a home device, route-level so capture browser and poster are fixed in one
  move with zero code change. Capture without this pairing is explicitly not a
  solution (Replay caveat). **OT-A′ confirmed the premise (2026-07-12):** the
  operator's home browser reaches land.com, so a home exit node egresses from a
  clean, servable IP — this branch and its fallback chain are viable. (One
  practical note carried from the fingerprint layer: the exit node must carry the
  *browser's* traffic; scripted/headless automation from home can still trip the
  same fingerprint block that 403'd curl in OT-A.)

**Fallback chain:** cookie export §a + Tailscale exit node → run the whole
poster locally (no always-on home device) → commercial residential proxy (last
resort — trust cost). Bookmarklet capture is rejected outright; cookie export
replayed from the unpaired worker box is the known-bad combination that must
never ship.

### What would change this decision

- **The operator's home browser is also blocked** — this trigger **did not fire**.
  OT-A′ (2026-07-12) confirmed the home browser reaches `land.com/login` normally;
  only curl is blocked from home (fingerprint layer), and the home IP is clean.
  Were this ever to change (Akamai starts denying the home IP's real browser too),
  every residential-egress and capture-from-browser row would die at once, leaving
  commercial proxy as the only path — and only if *its* pool IPs present a clean
  browser-grade fingerprint.
- **land.com adds MFA or aggressive session/IP binding** — captured sessions
  stop replaying even from residential egress; run-whole-poster-locally (same
  IP + fingerprint the session was minted on) becomes the only path.
- **No always-on home device materializes** — Tailscale drops out; the egress
  choice falls to commercial proxy or run-locally per the fallback chain.
- **US-007 validation reveals very short cookie lifetimes** — §a's per-refresh
  friction multiplies; build §b (one-click extension) to cut it to one click.

### Named follow-ups (out of this spike's scope)

- **`redirect_off` false-positive fix** — give `land_com` a *positive*
  `login_success` signal (named session cookie ANDed with `redirect_off`, which
  the config schema already supports) and/or teach
  `workers/posting/capture/detect.ts` to treat the Akamai Access Denied page as
  a hard failure; the uncommitted `sawLoginPage` guard in the working tree is
  insufficient (the denial flow touches `/login` first).
- **Posting egress** — enroll the worker box and a home device in a Tailscale
  tailnet and route land.com traffic through the home exit node
  (`tailscale up --exit-node=<home>`), fixing capture and posting with no code
  change; config sketch in Residential Egress §.
- **OT-B validation run (US-007's pending half)** — when the cookie export
  lands, run the converter and the validation plan already written in the
  Session Capture & Validation section.
