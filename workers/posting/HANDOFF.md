# Handoff: marketplace posting (Landmodo, Land.com and ParcelView verified live; Land Century built, unverified)

Written 2026-10-03 at the end of a long session. Read this before touching
`workers/posting`. The repo's `AGENTS.md` has the durable rules; this file is
the state of play and the open loops.

## Where things run

- **Poster agent runs on Dan's laptop**, not this server: Asahi Linux arm64,
  Tailscale name `daniel-mbp` (100.70.149.9). Clone at
  `~/claude-accessible/dev/command-center` on `main`. It polls this server's
  dashboard at `http://100.83.155.65:3000` with `AGENT_TOKEN` from the repo-root
  `.env.local` (copied by hand, never committed). Start: `cd workers/posting &&
  npm run agent`. Updates reach it only by `git pull` plus a restart; tsx does
  not hot-reload.
- **Marketplace sessions live only on the laptop** (`workers/posting/auth/*.json`,
  gitignored, chmod 600). Landmodo and Land.com (Marketing Hub) sessions were
  both captured 2026-10-03.
- **Round trips go through Dan.** You cannot reach the laptop. Pattern that
  worked all session: push a change, Dan pulls and runs a command, pastes the
  terminal output, and scps dump files back to this server's
  `workers/posting/.agent-cache/recon/` (gitignored) with
  `scp ... mazer@mazer:~/claude/command-center/workers/posting/.agent-cache/recon/`.
  Ask for everything that does not depend on an earlier answer in one message.
- The production dashboard on port 3000 serves an old build without
  `/api/resolve-location`; the agent's "location resolver unavailable" warning
  is expected and harmless (it falls back to splitting "County, State").

## Recon tool: `recon-form.ts`

`npx tsx recon-form.ts <platform> [url] [--headed] [--login] [steps...]` on the
laptop. Dumps links, forms, controls outside forms, autocomplete suggestions,
file inputs, a screenshot and the HTML. Steps run in order, each followed by a
dump: `--click=<text>`, `--clicksel=<playwright selector>`,
`--type=<css>::<text>`, `--fill=<css>::<text>` (empty clears), `--key=<Key>`,
`--wait=<ms>`. It refuses to click labels that look like a final submit
(Publish, Submit, Pay, Save, Post, Activate, Confirm) unless that exact label
is passed with `--allow=<label>`. `--login` opens a visible window, waits for a
visible password field to disappear, saves the session.

Dumps from this session are on this server under
`workers/posting/.agent-cache/recon/` (`market_land_com_*`,
`www_land_com_*`, `_account_properties_*` for Landmodo).

## Landmodo: DONE and verified

Three unattended end-to-end runs. Live listing 411164 is public with 10
photos. Details are in `post-landmodo.ts` header, `AGENTS.md`, and
`post-landmodo.test.ts`. Known limits: 10 photos per property, 10 MB per
upload batch, property credits consumed per create (Dan saw 45 -> 44).

## Land.com: DONE and verified 2026-10-03

Listing 29013311 went live through the agent (draft finished and published
unattended; the draft itself came from a headed dry run). The public URL is
https://www.land.com/property/1-acre-in-park-county-colorado/29013311/ .
Fixes found on the way are all in `post-land_com.ts` and summarised in the
Land.com bullet in `AGENTS.md`: Draft tab for matching, photos before text,
75-char title cap, `_selected_` class for toggles, Save then reload-verify
then Publish, URL pattern fallback. What is known for certain, from dumps
and the live runs:

- The listing tool is the **Marketing Hub at `https://market.land.com/`**, a
  React single-page app. `www.land.com/account/listings/new` is an account
  settings page with no form. The hub shows its sign-in form at the root URL,
  so `config/posting-platforms.json` now points both `login_url` and
  `new_listing_url` at the hub root and uses
  `login_success.logged_in_selector = button:has-text("Add Listing")`.
- **Listing Manager grid** is ag-grid: rows `.ag-row[row-id="<listingId>"]`,
  innerText lines are `ID <id>` (title may run on without a separator),
  title, `City, ST`, `$price`, acres, date, status (For Sale / Draft / Off
  Market / Sold), tier. Tabs `Active (n)`, `Draft (n)`, `All Listings (n)`.
  Row action menu: `[data-testid="tippy-toggle-button"]` opens Edit Listing,
  Change Listing Status, Upgrade Listing, View on Land Network.
- **Account cap**: 5 Active listings, free, drafts and sold do not count. The
  poster reads `Active (n)` and refuses to create at the cap.
- **Add Listing** opens a location step at the same URL. The search box has a
  mode switch: click the `[role=button]` reading "Address", then "Lat/Long".
  Type into `#latitude` / `#longitude`, press the unlabeled search button
  right after `#longitude` (`xpath=//input[@id="longitude"]/following::button[1]`).
  Detail fields then appear: `#address` (Location Description / Street
  Address, REQUIRED, pre-filled by reverse geocode with a neighbour-style
  house number such as "565 Middle Fork Vista"), city/state/county dropdowns
  auto-filled, `#zip`, read-only lat/long, and `Confirm Location`. Confirm
  creates a Draft and navigates to `/listing/edit/<id>`.
- **Editor** (`/listing/edit/<id>`): `input[name=Price]` (masks to $35,000),
  `input[name=Acres]`, `input[name="Is Owner Financing Available"]` (hidden
  checkbox with aria-checked; click its label text), `input[name=Title]`,
  `textarea[name=Description]` (plain, maxlength 99999), read-only
  `data-testid=longform-address`, `#imageUploadText` (multiple, jpeg/png/gif/
  heic/webp), property-type and activity toggle buttons by visible text
  (pressed state not readable from the DOM; "Undeveloped" was the only one
  selected on Dan's hand-made listing), amenity checkboxes `#Amenity_<n>`,
  buttons `Save` and `Publish Changes` (`data-testid=progressButtonTestId`).
- **Parcel coordinates** for the current task came from the Park County
  parcel export (APN R0037546: 39.146135, -105.921237) and are now in the
  task metadata as `latitude` / `longitude`, with `apn`. The pin lands inside
  the lot. Dan explicitly wants coordinates, not an address, and wants the
  reverse-geocoded street removed; the poster overwrites `#address` with
  `metadata.address`, else `metadata.location_description`, else
  "<County> County, <ST>".

What the poster does, in order: read grid (All Listings); if a row matches
by title or by price + acres + state and is active, record it and stop; if
it is a Draft, open it and finish it; else check the cap and create a draft
via the Lat/Long flow; fill the editor; toggle types/activities only on a
fresh draft; upload photos (first 20, primary first) and wait for thumbnails;
`--dry-run` stops here leaving a filled draft; otherwise Publish Changes,
re-read the grid to confirm the row is active, open the row menu's "View on
Land Network" (captured as a popup) for the public URL, screenshot it.

### Answered by the live run (kept for context)

1. Whether `Publish Changes` on a draft shows a confirmation dialog, a tier
   picker, or validation beyond what the poster checks (it looks for
   `[role=alert]` and "required/invalid/must be" text, then verifies the
   grid status).
2. Whether "View on Land Network" opens a popup (handled) or navigates in
   place (handled) or does nothing (falls back to reporting the hub edit URL).
3. Whether `locator.fill` on `#latitude`/`#longitude` satisfies the React
   inputs the way the recon's keystroke typing did. If the detail fields never
   appear, switch to `pressSequentially`.
4. Photo thumbnail detection uses the "Make Cover Photo" / "Cover Photo"
   button labels seen on the existing listing's Photos tab.

### Decisions made

- **Live test.** Dan deleted the hand-made listing 28909620 (the site keeps it
  as status Deleted) and the poster created the live one. Previously: listing 28909620 (title "1 Forested Acre in Park County, CO. Nearby 1
  Acre Sold $150K buy for $35k", 35,000, 1.0 ac). The poster's matcher will
  see it (price + acres + state) and skip creation. Options offered three
  times without an answer: take 28909620 Off Market or delete it first; let
  the poster publish a duplicate and delete it after; or stop at a dry run.
- **Location description**: task metadata `location_description` =
  "Redhill Forest Filing 3, Lot 366" (set via the API; confirmed live).
- **Draft cleanup.** Recon left drafts 29006902 and 29006903 on the account
  (titles "New Listing", location 565 Middle Fork Vista). A pre-existing
  draft also exists. The matcher ignores them (no title/price match) but
  they clutter the hub. Dan has not confirmed whether the row menu offers
  Delete for drafts.

### Leftovers

- Empty drafts 29013003, 29013004, 29013020 on the hub (free; delete when
  convenient). 29013311 is the live listing.
- The poster does not top up photos on an ACTIVE listing by design; Dan added
  photos 22 and 23 (Middle Fork river shots) to 29013311 by hand.
- "View on Land Network" did not yield a URL to the poster; the pattern URL
  fallback covers it. If a future listing's URL is wrong, check the slug.

### Suggested next steps (historical, mostly done)

1. Dan pulls, restarts the agent, and runs a dry run from the laptop with
   outputs present locally:
   `DASHBOARD_URL=http://100.83.155.65:3000 npm run post -- land_com task-1790275652160-rlxk9l --dry-run`
   Because 28909620 is active, the dry run will match it and return early
   without exercising the create path. To test creation, either take
   28909620 Off Market first or temporarily set `metadata.land_com_active_cap`
   high and change the task price so the matcher misses (then restore).
2. Review the dry-run draft in the hub by hand, then Publish again from the
   dashboard for the real run. Paste the agent log; fix whatever the unknowns
   above turn up.
3. After it works, add the Land.com bullet to `AGENTS.md` next to the
   Landmodo one, and record anything new in the memory file
   `poster-agent-laptop.md`.

## ParcelView: DONE and verified live 2026-10-04

`post-parcelview.ts` was built from four recon dumps (new-property before and
after the APN search, edit-property for Nevada listing 445, properties,
account), all on this server under `.agent-cache/recon/parcelview_com_*`.
The AGENTS.md bullet has the flow. Facts worth keeping:

- Growth plan, $99/mo, 50 properties (5 used), no per-listing credit.
- Existing Nevada listings: 349, 444, 445, 549, 686 (ids in the edit URLs).
- The save handler is jQuery `$('#property-form').on('submit')` posting
  `pv3d_save_property` to admin-ajax. New property: response carries
  `redirect` to the edit page. Existing: `#pv3d-msg` says "Saved!" and the
  page reloads 500 ms later. Errors go to `#pv3d-msg` in red.
- Photos: `uploadPropertyPhotos(files)` on the hidden file input (onchange),
  refuses with an alert() unless `#pv3d-photo-copyright` is ticked, posts
  each file separately with `pv3dConfig.propertyId`, which is 0 on the new
  page, so the poster only uploads on the edit page. First photo becomes the
  cover (gold border on the thumb); `setCoverPhoto` exists if that is wrong.
- The description textarea exists only on the edit page (section 5 on the new
  page holds just the map-layer checkboxes). It has an AI generator next to
  it; the poster never touches that.
- `listing_status` options: unlisted, available, pending (Under Contract),
  sold. `listing_badge`: '', available, new, reduced, financing. `listing_kind`:
  land, residential. All three sit outside the form with form="property-form".
- Unknowns the first run will answer: whether `fill()` on the APN box and
  `selectOption` on the state select trigger the county load (the recon used
  the same calls, so probably yes); whether the new-property Save validates
  anything beyond name/state/county/acres; how long the parcel search takes
  (the recon took a few seconds, cached).

- First dry run 2026-10-04: created the property, but only 5 of 15 photos
  landed, exactly the five under 1 MB, and Dan saw no down payment or loan
  term. Photos: the poster now re-encodes anything over 900 KB in its own
  browser (canvas, 2000 px long side) and uploads one file at a time with a
  per-file check. Pricing: the site's save payload does read down_payment
  and loan_term_months, so the cause is still open; the poster now re-fills
  the whole pricing block on the edit page and logs the values it reads back
  after Save. Cause candidates: the create path on the server ignoring them,
  or Dan looking at the card / collapsed Pricing summary, which only show
  cash and monthly.
- Gotcha: tsx injects a `__name` helper into nested named functions, so a
  `page.evaluate` callback with inner arrow functions fails in the page with
  "__name is not defined". The re-encoder is kept as source text and built
  with `new Function` for that reason.

- Live result: property 726, public URL
  https://parcelview.com/listing/f5bc2a597ade461e4c2ffd61fb8d1503/ , 15
  photos, full pricing block, "Fairplay, Colorado". Published through the
  dashboard with the agent on the laptop; the posting record says
  attempts: 2, so the first attempt failed for a reason not yet seen (ask
  for the agent log). Open items after the live run: the Camping chip did
  not persist (public page said "Camping Not Allowed"); setFeatures now sets
  the checked property directly and the poster reads features back after
  Save. Dan ticks it by hand on 726. The dry run's embed hash (6741…) was
  not the published hash (f5bc…): read the hash after the final save only.

Dry run from the laptop (leaves the lot Unlisted):
`DASHBOARD_URL=http://100.83.155.65:3000 npm run post -- parcelview task-1790275652160-rlxk9l --dry-run --headed`

## Land Century: BUILT 2026-10-05, not yet run against the live admin

`post-land_century.ts` was written from the site's front-end source (the
Next.js chunk for `/admin/listings/form/[slug]`, fetched from this server)
plus a logged-out look at the live site in Chrome. The AGENTS.md bullet has
the flow and the facts. Nothing has been created on the account yet; the
first supervised dry run on the laptop answers the unknowns below.

What needs Dan first:

- A Land Century seller account on a plan (Single Listing $5/mo, Basic
  $50/mo for 30 listings, Pro $100/mo; `https://www.landcentury.com/sell`).
  If the account is not a seller account the create page shows an "Account
  update required" company form and the poster reports exactly that.
- Pull, restart the agent, and run the dry run (leaves a Draft):
  `DASHBOARD_URL=http://100.83.155.65:3000 npm run post -- land_century task-1790275652160-rlxk9l --dry-run --headed`
  The headed window bounces `/admin/...` to the home page when logged out;
  log in through the account icon (top right) > Sign In. Detection fires on
  the `apiToken` localStorage key (new `local_storage_key` signal in
  `config/posting-platforms.json`, presence only). Paste the agent log and
  the session cookie names line.

First agent run 2026-10-05 22:33 UTC: login captured through the home-page
modal (cookie names: landcentury_session plus analytics and Stripe), then
the listings read failed with "Cannot read properties of undefined
(reading 'error')": the in-page reader was built as `new Function('return '
+ string)` with a leading newline, so ASI returned undefined. Fixed (the
function is parenthesised, exported as READ_PROPERTIES_FN and unit-tested).
`landcentury_session` is the site's own session cookie; not added as a
cookie signal because it may exist logged-out too.

Second run (CLI dry run from the saved session, 2026-10-05): the listings
read worked (account has 25178, Live, 2.27 ac Wells NV, APN 011-108-042),
the create form rendered, the categories came out wrong (index-based clicks
after a re-render; now clicked by exact text and verified), and Next on
Main Info answered "Error: Unauthenticated." That message is what
`www.landcentury.com/api/admin/*` returns with no server session (checked
logged-out with curl: 400 `{"success":false,"message":"Unauthenticated."}`),
while `/api/users/me` returns `{isLoggedIn, user, token}`. So the site has
two sessions: the browser-side `apiToken` (api-prod reads, which worked) and
the server-side `landcentury_session` cookie behind the form's write routes.
The poster now runs a preflight (`/api/users/me` plus the reverse-geocoder
POST, which the Location step makes anyway) and stops before creating
anything if the server routes say Unauthenticated. `post.ts --login` runs
the agent's auth flow (headed, fresh login if stale, session saved) and
posts in that same browser, which is the next thing to try:
`DASHBOARD_URL=http://100.83.155.65:3000 npm run post -- land_century task-1790275652160-rlxk9l --dry-run --login`
after `rm auth/land_century.json`. The preflight line in the log says which
session is dead.

Third run (`--login`, fresh login, 2026-10-05 22:43): preflight said
`/api/users/me 200 isLoggedIn=true user=true token=false`, the
reverse-geocoder reached the backend (a validation error, so that route is
authenticated or public), categories came out right, and the create POST
still answered 400 "Unauthenticated." from www.landcentury.com. The client
sends no Authorization header on that call (plain axios, no defaults or
interceptors anywhere in the bundle), so the Next.js route must take the
token from its server session, which reports no top-level token. Still
open: whether the site's create works at all right now by hand, and whether
the same Playwright session accepts a hand-clicked Next (`--keep-open`
leaves the window up for exactly that). The preflight now also reports
`user.token` and `user.type`, and rejected calls log their request header
names.

Fourth run (`--login --keep-open`, saved session reused): preflight
`isLoggedIn=true user=true (type 0) token=false user.token=false`, the
reverse-geocoder returned 200 with Fairplay / Park County / Colorado, and
the create POST failed the same way three times, twice from Dan clicking
Next by hand in the Playwright window. The rejected request carried
`x-xsrf-token` (so the www routes are CSRF-protected session routes) and no
authorization header, exactly like the site's own code sends. Checked from
this server logged out: reverse-geocoder, geocoder, switch-to-seller and
GET /api/admin/properties/1 all answer the same 400 "Unauthenticated.", so
the session DOES authenticate admin POSTs; the property create/update
routes need something more, most likely the user's backend token that the
session reports as missing. Open: whether a fresh login in a normal
browser creates listings today at all (if not, the site is broken for new
sessions and this is a LandCentury support ticket), and what `/api/users/me`
reports for `token` there. `post.ts --login` now logs the status and key
names of the login flow's responses.

ROOT CAUSE (found after Dan created a listing by hand in his own Chrome
with the identical session shape: isLoggedIn true, no token, same cookie
names). The login session is a host-only `landcentury_session` cookie on
www.landcentury.com. api-prod.landcentury.com (Laravel) answers EVERY
credentialed request, even a 401, with its own anonymous
`landcentury_session` + `XSRF-TOKEN` cookies scoped to `.landcentury.com`
(checked with curl from this server). The site's own calls to api-prod pass
withCredentials=false, so a normal browser never receives those. The
poster's listing reads used `credentials: 'include'`, so from that point
the browser sent two `landcentury_session` cookies to www; `/api/users/me`
and the geocoder still read the login one, the property routes read the
anonymous one. Fix: reads send `credentials: 'omit'`, and
`dropStrayBackendCookies` removes any `.landcentury.com`-scoped
`landcentury_session` / `XSRF-TOKEN` from the context before posting (a
saved session from an earlier run may carry them). Next: rerun
`npm run post -- land_century task-1790275652160-rlxk9l --dry-run --login`.

Fifth run (after the cookie fix, 2026-10-05): Main Info created listing
26439, the Quill description landed through the react-quill instance (no
typing fallback in the log), "Get Location" reverse-geocoded 39.146135,
-105.921237 to "565 Middle Fork Vista", Fairplay, Park County, Colorado
80440 (the poster overwrites Street with location_description), 20 of 24
photos uploaded one by one, and Detailed Info failed: Zoning read "" after
the option click and its still-open dropdown intercepted the click on Road
Access. The AutoComplete picker now types the value, clicks the option by
exact title, closes the dropdown (Escape, then blur) and reads back, with
one retry; dropdowns are closed before every Next/Save/Publish click. Draft
26439 carries parcel number R0037546, so the rerun matches it and finishes
it instead of creating another.

Unknowns the first run answers (each has a fallback or a loud error):

1. Whether the react-quill instance is reachable through the React fiber
   (`QUILL_SET_HTML`); if not the poster types the description plainly and
   says so in the log.
2. What the reverse geocoder puts in State/Region (full name or code) and
   County (with or without "County"). The poster overwrites both with the
   resolver's values ("Colorado", "Park"); the site appends "County" itself
   (showcase cards read "Apache County County" where sellers typed it in).
3. Whether the Ant Design version renders `.ant-form-item-row` (the label
   selector is an xpath ancestor walk, so either layout works) and whether
   the Deed/Zoning/Road/Utilities AutoCompletes accept `fill` on
   `.ant-select-selection-search-input` (the poster logs what each reads
   back).
4. Whether Publish on step 4 needs more than the fields filled: the server
   answers with a `publishMessage` ("Missing Data" / "Listing not published")
   that the poster throws with, and `errors[]` on the record is logged.
5. The public slug format. `publicListingUrl` builds
   `/land-for-sale/<state-name>/<slug>` from the record's `slug` and
   `stateRegion`; sitemap samples show both `...-colorado-<id>` and
   `...-ms-<id>` slugs, so the slug is taken from the record, never guessed.
6. Photo cap. The uploader has none client-side; the poster sends the first
   20 (`metadata.land_century_max_photos` overrides).

Metadata the poster reads (all optional unless noted): `price_usd`,
`acreage`, `location` (required), `apn`, `latitude`/`longitude` (else a full
address and the site's geocoder), `address` or `location_description` for
Street, `city`, `zip`, `access`, `utilities`/`utilities_notes`, `zoning`,
`must_include` (financing terms), `legal_description`, `taxes_usd`,
`video_url`, `owner_finance_terms`, `owner_finance_price_usd`,
`land_century_categories`, `land_century_zoning`, `land_century_road_access`,
`land_century_utilities`, `land_century_deed_type`, `land_century_max_photos`.

## Remaining platforms on this task

landflip, land_listings, landhub have ad copy under
`workers/workspace/outputs/task-1790275652160-rlxk9l/` but no poster. Each
needs the same recon-first approach. Add the key to `POSTERS` in `post.ts`.

## Things to never do

- Never commit `.env.local`, `auth/*.json`, or anything under `.agent-cache/`.
- Never let the recon or poster press a final submit during mapping; use
  `--allow` deliberately and say so to Dan.
- Never test against port 3000 or restart it (production).
- All task writes through `/api/tasks`; PATCH replaces `metadata` wholesale,
  so send the full object back with additions.
- Do not frame or build anything as working around a site's access
  controls. The agent exists so posting happens from Dan's own machine with
  his own logins; keep it to that.
