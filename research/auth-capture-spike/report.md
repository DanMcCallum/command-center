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

**Verdict: sanctioned, browser-free path for Land.com — recommended, pending one
eligibility check with Land.com support (see open questions).** The seeded
research's headline claim holds up: Land.com publishes an official **LandFeed XML
API** that adds, updates, and deletes listings via a single authenticated HTTPS
POST, with no cookies, no browser session, and nothing to expire. If our account
qualifies, this deletes the Land.com half of the auth-capture problem at its root.

### How the doc fetch went (US-002 evidence)

| URL | Fetched | Status | Note |
|---|---|---|---|
| `https://www.landsofamerica.com/LandFeed/Docs/` | 2026-07-10 | **HTTP 500** | Still errors live, exactly as the seeded research reported. |
| `http://web.archive.org/web/20240423062829/https://www.landsofamerica.com/LandFeed/Docs/` | 2026-07-10 | **HTTP 200** | Full spec recovered here — **LandFeed API Specification, Version 2.1 (September 21, 2022)**. All details below come from this snapshot. |
| `https://www.land.com/LandFeed/Docs/` | 2026-07-10 | **HTTP 200** | The `land.com` host (vs. `landsofamerica.com`) serves the same docs page live; the 500 is host-specific, so the spec is not gone, just flaky on one hostname. |
| `https://www.land.com/LandFeed/schemas/LandFeedSchema1.0.xsd` | 2026-07-10 | **HTTP 200** | The XSD the feed is validated against is live and fetchable — real, current schema. |
| `https://www.land.com/LandFeed/states/` | 2026-07-10 | **HTTP 200** | The canonical county/city name list (names must match exactly) is live. |
| `https://www.land.com/LandFeed/` | 2026-07-10 | **HTTP 200** | The POST target endpoint responds. |

So the earlier "couldn't verify firsthand" caveat is now resolved: the full v2.1
spec, its XSD, and the supporting reference lists were all read directly.

### What the feed does

Customers "automatically add, update, and delete land listings by securely
uploading XML data to Land.com via HTTPS." One POST carries the operator's **entire**
active inventory each time; Land.com diffs it against what it already has by the
customer's own unique listing ID:

- **INSERT** — the listing ID is not yet in Land.com's system.
- **UPDATE** — the listing ID already exists; its data is overwritten.
- **DELETE** — a listing ID previously sent is **absent** from the new feed.
  *Gotcha:* this makes the feed authoritative — you must send **all** listings and
  **all** photos every time, or anything you omit is deleted. A `mode` of `test`
  runs full validation without touching live listings or images.

Processing runs 365 days/year; successfully posted data is live "within minutes."

### Auth model

Credentials travel **inside the XML body** (not headers), in the `<channel>`
element — there is no OAuth, no cookie, no session:

- `channel.loa_account_id` (integer) — the Land.com account ID (parent account for
  a corporate account). Retrievable from the Land.com Admin area.
- `channel.loa_account_email` — the email on the parent account.
- `channel.loa_shared_key` — a **secret shared key issued by Land.com technical
  staff** when LandFeed is enabled for the account. This is the credential we do
  not yet have.
- `channel.loa_account_password` — present in the schema but **deprecated**; not
  the auth path.

Transport requirements: HTTPS POST to `https://www.land.com/LandFeed/`, **TLS 1.2
or higher**, `Content-Type: text/xml`, a valid `User-Agent` header, and a correct
`Content-Length`. A prerequisite stated up front: an **active Land.com Corporate
Account**, with named Primary and Alternate technical contacts (this is the
eligibility question below — our account may be a plain advertiser, not corporate).

For our stack this is a good fit: the shared key is a secret we'd store the same
way `workers/posting/auth/*.json` are handled today (gitignored, `600`, never
logged) — but unlike a browser session it never expires and never needs
recapturing.

### Schema (key fields)

Data format is Google Base XML (an RSS 2.0 document with a `<channel>` and repeated
`<item>` elements), validated against
`https://www.land.com/LandFeed/schemas/LandFeedSchema1.0.xsd`. Fields most relevant
to how we generate ads today (`config/ad-platforms.json` + Ad Builder metadata):

| Field | XML element | Req? | Notes |
|---|---|---|---|
| Customer listing ID | `item.id` | yes | Our own unique key; drives INSERT/UPDATE/DELETE. `task.id` is a natural fit. |
| Description | `item.description` | yes | CDATA. **No HTML, no URLs, no email addresses** — those listings are rejected outright. |
| Custom listing title | `item.listing_title` | no | Up to 775 chars — the headline surface. |
| Listing status | `item.listing_status` | yes | `Available` / `Contract Pending` / `Sold`. |
| County | `item.county` | yes | Must match Land.com's county names exactly (list at `/LandFeed/states/`). |
| State | `item.state` | yes | Full name or 2-char code. |
| Closest city | `item.closest_city` | yes | |
| Lot size | `item.lot_size` | yes | Acres, ≤2 decimals; residential/commercial must be ≥1 acre. |
| Price | `item.price` | yes | Integer, no non-numeric characters. |
| Property types | `item` attribute `propertytypes` | — | Bitwise sum (Recreational Land = 4, Undeveloped Land = 32, Hunting Land = 128, etc.), max 3 types; supersedes the legacy `property_type` tag. |
| Main photo | `item.image_link` | no | One image URL (Land.com pulls it). |
| Photo tour | `item.loa_photo_tour_images.image_link` | no | 0–200 image URLs. |
| Lead routing email | `item.lead_routing_email` | no | Extra address to notify on a lead. |
| Sales comps | `item.salesdata.*` | no | Only when `listing_status = Sold`; ties into our knowledge-base sold-ad loop. |

Photos are referenced by **URL** — Land.com GETs them from links in the XML (JPEG/
GIF/PNG/BMP, ≤2 MB each, min ~300px wide). This differs from the current poster,
which uploads local files from `outputs/<taskId>/photos/`; a feed integration would
need those photos reachable at a public URL.

### Posting latency

- **Listings:** live in **5 minutes to ~1 hour** (per the spec's FAQ).
- **Images:** processed by a separate pass, typically **10 minutes to 6 hours**
  depending on count.
- Feed and image processing each email a success/warning/error report to the
  account's technical contacts; per-listing errors don't halt the rest of the feed.
  Results are verified by logging into the Property Control Center
  (`propertycontrolcenter.com`) — the same admin surface the current Playwright
  poster drives.

### Cost

**$0 beyond the Land.com listing plan the operator already pays for.** LandFeed is
a feature of an account, not a metered API — the only stated prerequisite is an
active Corporate Account and issuance of the shared key. No per-post fee, no vendor,
no infrastructure.

### Open questions for Land.com support

1. **Eligibility:** Is LandFeed available on our current account tier, or does it
   require a **Corporate Account** specifically? The spec lists "an active Land.com
   Corporate Account" as a prerequisite — the single biggest unknown, since we may
   be a standard advertiser.
2. **Credential issuance:** How is the `loa_shared_key` issued, to whom, and how is
   it rotated/revoked if leaked? (The spec says "Land.com staff will create a new
   unique key.")
3. **Account IDs:** Confirm our `loa_account_id` (and any child account IDs) from
   the Admin area, and whether a corporate parent must be created first.
4. **Cost:** Any fee or plan upgrade tied to enabling LandFeed?
5. **Photo hosting:** Since photos are ingested by URL, is there any Land.com-hosted
   upload path, or must we serve our `outputs/<taskId>/photos/` images at a public
   HTTPS URL ourselves?
6. **Schema currency:** Is `LandFeedSchema1.0.xsd` (v2.1, Sept 2022) still the
   current schema, and is the `landsofamerica.com/LandFeed/Docs/` 500 a known issue?

### Draft email to Land.com support (ready to send)

> **To:** support@land.com (cc: sales@land.com)
> **Subject:** LandFeed XML API access for my advertiser account
>
> Hello,
>
> I advertise land listings on Land.com and would like to enable the **LandFeed
> XML API** so I can add, update, and delete my listings programmatically instead
> of entering them by hand in the Property Control Center.
>
> Could you help me confirm a few things?
>
> 1. Is LandFeed available on my current account, or do I need a Corporate Account
>    to use it? If I need one, what's involved in setting that up?
> 2. How do I get my **shared key** (`loa_shared_key`) and confirm my
>    **account ID** (`loa_account_id`)?
> 3. Is there any cost or plan change associated with enabling LandFeed?
> 4. Is `LandFeedSchema1.0.xsd` (spec version 2.1, September 2022) still the current
>    schema? The docs page at `landsofamerica.com/LandFeed/Docs/` currently returns
>    an HTTP 500 error, though `land.com/LandFeed/Docs/` loads.
>
> My account email is daniel@ownaloha.land. Happy to provide my account ID or set
> up the required technical contacts.
>
> Thank you,
> Dan

### Fallback if feed access is denied

If LandFeed turns out to be gated to broker/corporate tiers we can't reach, the
fallback is to **keep the current Playwright poster for Land.com** and capture its
login session using whatever approach we choose for Landmodo (the hosted live-view
browser recommended in §4). Nothing about Land.com's posting *mechanics* changes in
that case — only the login-capture UX improves alongside Landmodo's. This keeps
Land.com functional regardless of the eligibility answer; the LandFeed API is a
strict upgrade we adopt only if the account qualifies.

**Sources** (all fetched 2026-07-10): LandFeed API Specification v2.1 via Wayback
`web.archive.org/web/20240423062829/https://www.landsofamerica.com/LandFeed/Docs/`;
live schema `https://www.land.com/LandFeed/schemas/LandFeedSchema1.0.xsd` (HTTP
200); live endpoint `https://www.land.com/LandFeed/` (HTTP 200); live docs mirror
`https://www.land.com/LandFeed/Docs/` (HTTP 200); `landsofamerica.com/LandFeed/Docs/`
(HTTP 500).

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
