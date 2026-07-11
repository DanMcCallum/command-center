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

## LandFeed API

Land.com publishes an official **LandFeed XML API** — the sanctioned, no-browser
way to manage listings. The prior spike verified it in depth
([research/auth-capture-spike/report.md](../auth-capture-spike/report.md) §2, all
sources fetched 2026-07-10); this section **summarizes** those findings and
re-anchors them against the new Akamai block, rather than re-researching. The
headline for this spike: **the block does not touch the feed** (see Block Scope
above), so the one option here that needs no capture, no session, and no egress is
the same option that survives the block intact.

### What it is (summary of the prior spike's §2 findings)

- **Auth model — no login, no session, no cookies.** Credentials travel *inside*
  the XML body's `<channel>` element: `loa_account_id` (integer, from the Land.com
  Admin area), `loa_account_email` (the parent-account email), and
  `loa_shared_key` (a secret issued by Land.com technical staff when LandFeed is
  enabled). There is no OAuth, no browser, no cookie to expire — the shared key is
  stored the same way `workers/posting/auth/*.json` are today (gitignored, chmod
  600, never logged) but, unlike a captured session, **never needs recapturing**.
  `loa_account_password` exists in the schema but is deprecated.
- **Full-inventory-diff gotcha.** One HTTPS POST to `https://www.land.com/LandFeed/`
  carries the operator's *entire* active inventory each time. Land.com diffs it by
  the operator's own listing ID (`item.id`; `task.id` is a natural fit): a new ID
  INSERTs, an existing ID UPDATEs, and **any previously-sent ID that is absent from
  the new feed is DELETED**. The feed is authoritative — omit a listing (or a
  photo) and it disappears — so a feed integration must always send the complete
  set, not a single new ad. A `mode=test` runs full validation without touching
  live data. Listings go live in 5 min–1 hr; images in 10 min–6 hr.
- **Photo-by-URL requirement.** Photos are referenced by **public URL** —
  `item.image_link` (main) and `item.loa_photo_tour_images.image_link` (0–200 tour
  images), JPEG/GIF/PNG/BMP, ≤2 MB each, which Land.com *pulls*. This is a real
  divergence from the current poster, which uploads local files from
  `outputs/<taskId>/photos/`; adopting LandFeed means those photos must be
  reachable at a public HTTPS URL (a public photo-hosting decision the prior spike
  already flagged as an operator task, not a Ralph story).
- **Corporate Account prerequisite.** The spec lists "an active Land.com Corporate
  Account" with named Primary/Alternate technical contacts as a prerequisite — the
  single biggest unknown, since the operator's account may be a plain advertiser
  tier. This is what OT-C's email resolves.
- **Cost:** $0 beyond the existing Land.com plan — a feature of the account, not a
  metered API.

### The block does not change LandFeed's viability

The US-002 probes settle the one question the block raised. From the worker box
(the same Linode datacenter IP that gets `403 Access Denied` on every consumer
page), on 2026-07-11 the LandFeed endpoints all returned **HTTP 200 with real
content**:

| LandFeed endpoint | Worker box (2026-07-11T05:58Z) |
|---|---|
| `https://www.land.com/LandFeed/` (POST target) | **200** · 30,894 B |
| `https://www.land.com/LandFeed/Docs/` | **200** · 85,138 B |
| `https://www.land.com/LandFeed/schemas/LandFeedSchema1.0.xsd` | **200** · 8,080 B (real `<xs:schema>`) |

This matches the prior spike's 2026-07-10 result (all 200 from this same box, one
day *before* the login block appeared), so the exemption is not a fluke of timing.
**The `/LandFeed/` path is exempt from the Akamai block that kills
`www.land.com`, `/login`, and the sister brands.** Concretely: if the operator
gets a shared key, the worker box can POST the feed and manage Land.com listings
**directly, with zero egress work** — no residential tunnel, no captured session,
no run-locally split. The block that broke browser capture is simply irrelevant to
the sanctioned path. That is the strongest single fact in this report for the
land.com decision, and it is why the comparison matrix (US-008) ranks LandFeed
first when eligibility allows.

### OT-C — the shared-key email

**The ask (OT-C):** send the ready-to-go shared-key request email in
[research/auth-capture-spike/report.md](../auth-capture-spike/report.md) §2 ("Draft
email to Land.com support") to `support@land.com` (cc `sales@land.com`). It asks
four things: LandFeed eligibility on the current account tier (or whether a
Corporate Account must be created), how the `loa_shared_key` and `loa_account_id`
are issued, any cost, and schema currency.

**Status:** *not yet reported by the operator* — no OT-C confirmation has landed as
of this writing (2026-07-11). Until Land.com replies, feed access is **gated on
eligibility**: the account may already qualify, or it may need a Corporate Account
upgrade the operator has to decide on.

**Fallback chain if feed access is denied.** If LandFeed turns out to be gated to a
corporate tier the operator can't reach, land.com does *not* fall back to "nothing"
— it falls back to browser posting, which is exactly what the rest of this report
costs out:

1. **Browser capture + residential egress** — capture the session in the operator's
   own browser (Capture From the User's Browser §a), and route the poster through a
   **Tailscale exit node** on a home device (Residential Egress §b, the recommended
   egress). This keeps land_com posting server-side and automatic while making the
   box's traffic egress residential, past the block.
2. **Run the poster locally** — if no always-on home device exists for an exit node,
   move land_com posting to the operator's own (residential) machine (Run Locally
   §2), accepting the loss of server-side always-on posting.
3. **Commercial residential proxy** — last resort, only if there is no usable home
   device at all (Residential Egress §c), accepting the trust cost of routing an
   authenticated session through a third party.

LandFeed remains the **strict upgrade** the operator adopts the moment the account
qualifies: it removes the login-capture problem *and* the egress problem in one
move, at $0. The full head-to-head against the browser-posting pairings is the
comparison matrix (US-008).

## Comparison & Recommendation

*Pending US-008 — full option matrix, primary recommendation, fallback chain, and
the "what would change this decision" list.*
