# PRD: Calls dashboard (re-home the followupdominator operator UI in the command center)

**Status:** Draft
**Date:** 2026-10-12
**Inventory:** [calls-dashboard-inventory.md](calls-dashboard-inventory.md) (every route of the HTML dashboard, its data, its service calls, and its writes)
**Progress log:** `progress-calls-dashboard.txt` at the command-center root
**Loop prompt:** [calls-dashboard-loop.md](calls-dashboard-loop.md), run by `workers/calls-loop.sh`

## Introduction

`~/claude/followupdominator` is a Python/FastAPI call-tracking service: a Dialpad webhook comes in, a durable SQLite queue and seven asyncio loops turn calls into Investment Dominator (ID) CRM tasks, and the live call pop reaches the browser over Server-Sent Events (SSE). Today it also serves its own server-rendered operator dashboard at `https://calls.ownaloha.land` behind a shared password. The command center (this repo, Next.js on port 3000, behind Cloudflare Access at `https://dashboard.ownaloha.land`) is where the operator already works.

This feature re-homes that operator dashboard inside the command center as a `/calls` section, so there is one UI behind Cloudflare Access, while the Python service keeps doing what only it can do: receive the webhook, run the queue and loops, and talk to ID.

Target architecture (decided by the operator, not up for debate inside the loop):

1. **followupdominator exposes a JSON API** under `/api/v1/*`, guarded by a bearer token (`CALLS_API_TOKEN`, 32 bytes hex, in `.credentials/dashboard.env`; already generated and mirrored into the command-center root `.env.local` on 2026-10-12). Every piece of data or action the HTML dashboard uses today gets an endpoint. The HTML pages stay untouched and keep working until cutover. The API reuses `DashboardDeps`, `CallLookupService`, and the note choke point; it never duplicates logic.
2. **The command center gets a `/calls` section.** Server routes under `dashboard/app/api/calls/*` proxy to the Python API (`CALLS_API_URL`, default `http://127.0.0.1:8100`) with the token read through `readProjectEnvVar('CALLS_API_TOKEN')`. The token never reaches a client component. Pages are client components that fetch those routes, like `/fronts`.
3. **Call pops stay real-time.** `GET /api/calls/events` is a streaming route handler that re-emits the Python SSE stream with heartbeats; the `/calls` page reconnects and re-fetches recent calls on every (re)connect, as the Python client does now. This has to work through the Cloudflare tunnel; it is the riskiest piece and is built and measured before the pages that depend on it.
4. **Cutover is a config flip.** When the operator signs off, nginx on `calls.ownaloha.land` stops routing anything but `/webhook/dialpad` and `/healthz` (a prepared config in `deploy/`, applied by the operator with sudo). Removing the Python HTML dashboard is a later loop.

## Goals

- Every view and action of the HTML dashboard (inventory tables) is reachable at `https://dashboard.ownaloha.land/calls/...` with the same data and the same write semantics (same idempotency keys, same outbox path, same ID outcomes).
- A synthetic inbound call injected into a hermetic dev stack pops on the `/calls` page within 5 seconds, end to end through the Next.js relay, and a note logged on that pop produces exactly one task in the fake ID client.
- Both test suites stay green and gain coverage for everything new: pytest for the API (auth, payload shapes, idempotency, HTML routes unchanged), node tests for the command-center client and mappers, and one automated browser e2e script that starts everything, drives Chromium, and tears everything down.
- The Python service's production behavior is unchanged until the operator restarts it, and even then only new token-guarded routes are added.
- Cutover readiness: the nginx cutover config and its revert exist and are documented; the manual integration test is scripted for the operator; docs in both repos describe the new shape.

## User Stories

### US-001: Inventory the HTML dashboard
**Description:** As the loop, I need an exact map of what the HTML dashboard renders and writes so the API contract is complete and nothing is guessed.

**Acceptance Criteria:**
- [x] `specs/calls-dashboard-inventory.md` lists every route in `app/dashboard.py` and every JSON route in `app/webhook_receiver.py` with inputs, rendered data, service calls, ID writes, and read-only versus write-choke-point classification.
- [x] The ops strip badges and their alarm thresholds are tabulated (needed to color the strip identically in React).
- [x] The pop payload kinds and fields published on `/events` are tabulated.
- [x] The dev and test surface is recorded, including that `run_receiver_dev.py` starts no background loops and `build_service` has no `enable_dev_replay` parameter.
- [x] Technical Considerations below reflect what was found (done 2026-10-12 by the prep session; baselines: pytest 265 green, ruff clean, tsc clean, npm test 48/50 with the two known ebay-html failures).

### US-002: API token in the Python service
**Description:** As the command center, I need a bearer token that gates the JSON API, failing closed when unset.

**Acceptance Criteria:**
- [x] `app/config.py` gains `calls_api_token() -> str | None` reading `CALLS_API_TOKEN` from `dashboard.env` (env var wins, like every accessor).
- [x] New module `app/api_v1.py` with `require_api_token(request, expected) -> Response | None`: returns a 503 JSON `{error: "CALLS_API_TOKEN is not configured"}` when `expected` is None or empty; otherwise accepts `Authorization: Bearer <token>` and, for `GET` routes only, `?token=<token>`; compares with `hmac.compare_digest` on sha256 digests of both sides; returns 401 JSON `{error: "Unauthorized"}` on missing or wrong token; returns None when authorized. Mirrors command-center `dashboard/lib/agent-auth.ts`.
- [x] `register_api(app, deps, *, token)` exists (empty for now beyond `GET /api/v1/ping` returning `{ok: true}`), is called from `build_service` and `scripts/run_receiver_dev.py` with `config.calls_api_token()`, and is NOT registered in the test apps that assert the HTML routes are unchanged.
- [x] Tests in `tests/test_api_v1.py`: unset token gives 503; missing header 401; wrong token 401; right header 200; right `?token=` on GET 200; `?token=` on a POST route is ignored (401). The token value never appears in any response body or log line (assert on captured logs).
- [x] `pytest -q` and `ruff check app scripts tests` clean.

### US-003: Recent calls, SSE stream, and the ping frame
**Description:** As the `/calls` page, I need the live feed and the reconnect re-fetch under the token.

**Acceptance Criteria:**
- [x] `GET /api/v1/calls/recent?limit=` returns the same `{events: [...]}` payload as `/calls/recent` (shared helper, not copied SQL), token-guarded.
- [x] `GET /api/v1/events` streams the same frames as `/events` (`id:` and `data:` lines, `: keepalive` every `sse_heartbeat` seconds, headers `Cache-Control: no-cache` and `X-Accel-Buffering: no`), token-guarded via header or `?token=`, subscribing to `app.state.broadcast`, ending when the client disconnects. `register_api` receives the heartbeat value from `create_app` (store it on `app.state.sse_heartbeat`).
- [x] `POST /api/v1/dev/ping` (token-guarded, always registered, no database write) publishes `{kind: "ping", sent_at: <epoch seconds float>}` on the broadcast and returns `{ok: true, seq}`. This is the harmless frame used for latency measurement.
- [x] Tests (live uvicorn fixture, as in `test_sse_delivery.py`): a ping published after subscribing arrives on `/api/v1/events` with the right `seq`; unauthorized stream request is 401; `?token=` works for EventSource-style clients; `/api/v1/calls/recent` shape matches `/calls/recent` for the same rows.
- [x] `pytest -q` and ruff clean.

### US-004: Read endpoints for records
**Description:** As the contacts, properties, record, and search pages, I need the ID proxies and the local index search as JSON.

**Acceptance Criteria:**
- [ ] `GET /api/v1/contacts?start=` returns `{rows: [...], next_start: <int | null>}` using `id_client.list_contacts(start, range=50)`; `next_start` is set when 50 rows came back.
- [ ] `GET /api/v1/properties?status=0&start=` returns `{rows, next_start, status}` using `id_client.list_properties`.
- [ ] `GET /api/v1/record/{table}/{id}` returns `{table, id, record: {...non-empty fields...}, nickname: <str | null>, history: [{task_id, title, status, task_type, start_ts, end_ts}]}`; 404 JSON for an unknown table or a record ID does not have.
- [ ] `GET /api/v1/search?q=` returns `{records: [{record_table, record_id, display_name, address, apn, status}], nicknames: [{nickname, slug, score, property_id}]}` using the same LIKE query (max 25) and `nicknames.search(q)`; empty `q` returns empty lists.
- [ ] `GET /api/v1/nicknames/search?q=` returns `{matches: [{nickname, slug, score, property_id}]}` via `lookup.search_nicknames` (503 JSON when `deps.lookup` is None), and `GET /api/v1/nicknames/property/{id}` returns `{nickname, slug, property_id}` or 404.
- [ ] Tests with `FakeIDClient` from `test_dashboard.py` (promote the fakes to `tests/fakes.py` so the API tests and the e2e runner can import them): shapes above, pagination marker, 404 paths, HTML routes still render the same bodies as before (snapshot a couple of existing assertions).
- [ ] `pytest -q` and ruff clean.

### US-005: Tasks, ops, and agents read endpoints
**Description:** As the tasks page, the ops strip, and the agents page, I need their data as JSON.

**Acceptance Criteria:**
- [ ] `GET /api/v1/tasks` returns `{tasks: [{task_id, title, status, task_type, start_ts, end_ts, overdue: bool}], now}` from `task_index.open_tasks()`, overdue computed server-side as `start_ts < now`.
- [ ] `GET /api/v1/ops` returns `ops_summary(deps)` plus `badges: [{label, text, level: "ok" | "warn" | "alarm"}]` computed with the inventory thresholds (so the React strip cannot drift from the Python one) plus `dead_letters: [{id, event_key, kind, attempts, last_error, finished_at}]`.
- [ ] `GET /api/v1/agents` returns `{agents: [{dialpad_user_id, name, id_user_id, sms_number, is_default}], default_key: "*", dialpad_users: [{id, name, number}] | null, dialpad_error: <str | null>}`; 503 JSON when `deps.agents` is None.
- [ ] Tests: badge levels at each threshold edge (0 and 1 dead letters, 25 and 26 outbox, 50 and 51 backlog, sync never, 7199 s, 7201 s), health flag and sync error badges, agents with and without a DialPad client error.
- [ ] `pytest -q` and ruff clean.

### US-006: Write endpoints
**Description:** As the note form, attribute, dial, and agents pages, I need the writes to go through the exact same choke points as the HTML forms.

**Acceptance Criteria:**
- [ ] The note-building logic of `POST /notes` (payload construction, status validation, follow-up default, `_close_redundant_fallback`) is extracted into one function `submit_note(deps, *, note, client_uuid, call_id, status, follow_up, caller, contact_id, property_id) -> NoteOutcome` used by BOTH the HTML route and the API, so there is still one choke point.
- [ ] `POST /api/v1/notes` (JSON body: `note` required, `client_uuid` optional, `call_id` optional, `status`, `follow_up`, `caller`, `contact_id`, `property_id`) returns `{enqueued, event_key, outbox_id, call_id, client_uuid, first_manual_note, fallback_already_fired, fallback_close: "queued" | "not_delivered_yet" | "unreadable" | null}`; 400 on an empty note. A second call with the same `client_uuid` returns `enqueued: false` and creates no second outbox row.
- [ ] `GET /api/v1/outbox/{id}` returns `{id, event_key, kind, status: "pending" | "done" | "dead_letter", attempts, last_error, task_id: <int | null>}` where `task_id` is parsed from `result.task.t_id` when done. This is how the UI shows the ID task id after the outbox loop delivers (there is no synchronous id).
- [ ] `POST /api/v1/attribute` (JSON: `number` required, `caller_fname` required, `caller_lname`, `slug` optional, `call_id`) returns `{contact_id, property_id, slug, indexed_number, unresolved_slug: bool}`; errors map to 404 `{error: "unknown nickname slug"}` (KeyError), 409 `{error: <LookupError text>, hint: "the contact may exist in ID without being indexed; check contacts before retrying"}`, 502 `{error: "Investment Dominator did not respond; nothing was created"}` (TransientApiError), 400 when number or first name is missing.
- [ ] `POST /api/v1/dial` (JSON: `phone` required, `property_id` int required) returns `{intent_id, phone, property_id, nickname: <str | null>, window_minutes: 15}`; 400 on a bad property id.
- [ ] `POST /api/v1/agents` (JSON: `dialpad_user_id` required, `name`, `id_user_id`, `sms_number`) returns the resulting agent row; `POST /api/v1/agents/delete` (JSON: `dialpad_user_id`) returns `{removed: bool}`; both 503 when `deps.agents` is None.
- [ ] Tests use the fakes from `tests/fakes.py` extended with `create_contact`, `create_task`, `update_task` recorders: idempotent note (same uuid twice is one outbox row), note after a fired fallback queues the close update, outbox status before and after a `process_once`, attribute happy path indexes the number and returns the recovered id, attribute error mapping for all three exceptions, dial records an intent, agents upsert and delete. The HTML `POST /notes` test still passes unchanged.
- [ ] `pytest -q` and ruff clean.

### US-007: API documentation
**Description:** As the command-center stories, I need a written contract with example payloads to build against, since OpenAPI stays disabled.

**Acceptance Criteria:**
- [ ] `docs/api-v1.md` in followupdominator documents every `/api/v1/*` endpoint: method, path, auth, query or body fields with types and defaults, one example request and one example response (synthetic data only, never values from the real database), error statuses, and for `/api/v1/events` the frame format, the keepalive interval, every pop `kind` with its fields, and the reconnect rule (re-fetch `/api/v1/calls/recent` on every connect).
- [ ] The examples are the fixtures the command-center client tests will copy; the doc says so and names `dashboard/lib/calls-types.ts` as the TypeScript twin.
- [ ] `README.md` in followupdominator gains two sentences under Architecture pointing at the API and this doc.
- [ ] Nothing in the doc or the commit contains a token or a real phone number or name.

### US-008: Hermetic Python e2e runner
**Description:** As the browser e2e script and the relay latency test, I need a full service (all loops) that talks to fakes instead of ID and Dialpad, exposes `/dev/replay`, and records what the fake ID client was asked to write.

**Acceptance Criteria:**
- [ ] `app/service.py:build_service` gains `enable_dev_replay: bool = False`, passed through to `create_app`; `scripts/run_service.py` never sets it (docstring updated accordingly).
- [ ] `scripts/run_e2e_dev.py <port> <db_path> <record_log_path>` builds the service with: a scratch SQLite database at `db_path` (created fresh), `FakeIDClient` from `tests/fakes.py` (contacts, properties, create_contact that appends a recoverable contact, create_task and update_task returning increasing fake `t_id` values, list_tasks returning the created ones), a fake DialPad client (`list_users`, `send_sms` no-op recorder, `aclose`), `enable_dev_replay=True`, token from `CALLS_API_TOKEN` in the environment, `session_secret` and `password` set to throwaway values so `/dev/replay`'s session check can be satisfied with a minted cookie (the runner prints the cookie value on stdout as `SESSION=<token>`), webhook secret throwaway, no registry path, no alert number. The sync job runs against the fake and must not crash (empty task list is fine).
- [ ] Every fake ID write (create_contact, create_task, update_task) is appended as one JSON line to `record_log_path` with the full payload, so an external script can assert "exactly one task with this note".
- [ ] The runner seeds the phone index and nickname table directly at startup with synthetic rows: contact 7 "Jane Buyer" at `+15305550123`, property 5692 at `12 Montello Rd` with nickname "Test Meadow" (slug `test-meadow`) resolved to 5692, so a replayed ringing from `+15305550123` is a `matched` pop and a ringing from `+15305550199` is a `miss`.
- [ ] `tests/test_e2e_runner.py` imports the runner's `build_e2e_service()` and, with the live uvicorn fixture, proves: replaying a ringing event produces a pop on `/api/v1/events` within 5 s, posting a note on that `call_id` through `/api/v1/notes` leads to exactly one `create_task` line in the record log within 10 s (the outbox loop runs every 5 s), and `/api/v1/outbox/{id}` then reports `done` with the fake task id.
- [ ] `pytest -q` and ruff clean; the production `build_service` call sites are unchanged apart from the new default parameter.

### US-009: Command-center calls client and types
**Description:** As the proxy routes, I need one typed, server-only client for the Python API with error mapping.

**Acceptance Criteria:**
- [ ] `dashboard/lib/calls-types.ts` declares TypeScript types for every response in `docs/api-v1.md` (`RecentCall`, `PopEvent` union by `kind`, `RecordDetail`, `SearchResult`, `OpsSummary` with `badges`, `AgentRow`, `NoteOutcome`, `OutboxStatus`, `AttributeOutcome`, `DialOutcome`, ...).
- [ ] `dashboard/lib/calls-client.ts` exports `callsApi` with one function per endpoint, plus `callsBaseUrl()` (`CALLS_API_URL` from `readProjectEnvVar`, default `http://127.0.0.1:8100`) and `callsToken()` (`readProjectEnvVar('CALLS_API_TOKEN')`). Every request sets the bearer header, uses `AbortSignal.timeout(8000)` for reads and 20 s for writes, and `cache: 'no-store'`.
- [ ] Error mapping is a pure function `mapCallsError(err | response) -> { status, body: { error, hint? } }` unit-tested: connection refused or timeout gives 502 `{error: "call service unreachable"}`; upstream 503 (token unset) gives 502 `{error: "call service is not configured for the API"}`; upstream 401 gives 500 `{error: "call service token mismatch"}` (never 401, which would read as an Access problem); 400, 404, 409, 502 from upstream are forwarded with their JSON body.
- [ ] Mapper unit tests in `dashboard/lib/calls-client.test.ts` use fixture payloads copied verbatim from `docs/api-v1.md` and a fake `fetch` injected through a `deps` parameter; the token never appears in a thrown error message (assert).
- [ ] `cd dashboard && npx tsc --noEmit` clean; `npm test` has no new failures.

### US-010: Proxy routes
**Description:** As the pages, I need `/api/calls/*` routes in Next.js for every endpoint, with the token kept server-side.

**Acceptance Criteria:**
- [ ] Routes exist and are `force-dynamic`: `GET /api/calls/recent`, `GET /api/calls/contacts`, `GET /api/calls/properties`, `GET /api/calls/record/[table]/[id]`, `GET /api/calls/search`, `GET /api/calls/nicknames/search`, `GET /api/calls/nicknames/property/[id]`, `GET /api/calls/tasks`, `GET /api/calls/ops`, `GET /api/calls/agents`, `POST /api/calls/notes`, `GET /api/calls/outbox/[id]`, `POST /api/calls/attribute`, `POST /api/calls/dial`, `POST /api/calls/agents`, `POST /api/calls/agents/delete`, `POST /api/calls/dev/ping`. Query strings are forwarded as-is; JSON bodies are forwarded as-is; responses come back through `mapCallsError`.
- [ ] When the Python service is down every route answers 502 with the plain `{error: "call service unreachable"}` body within the client timeout.
- [ ] Verified against a temp `next dev -p 3001` started with `DASHBOARD_URL=http://localhost:3001 CALLS_API_URL=http://127.0.0.1:8101 CALLS_API_TOKEN=<throwaway>` and `scripts/run_e2e_dev.py 8101 ...`: each GET returns the upstream JSON, a note POST creates an outbox row, and with the Python runner stopped the routes return 502. The log of this check goes in the progress file. Also verified: a response never includes the token (grep the proxied bodies and headers).
- [ ] `tsc` clean.

### US-011: SSE relay and local latency measurement
**Description:** As the `/calls` page, I need the pop stream re-emitted by Next.js so the browser only ever talks to the command center.

**Acceptance Criteria:**
- [ ] `dashboard/app/api/calls/events/route.ts`: `force-dynamic`, opens `GET <CALLS_API_URL>/api/v1/events` with the bearer header, returns a `Response` with a `ReadableStream` that forwards upstream bytes unchanged, writes `: heartbeat\n\n` every 15 s of its own, and sets `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no`. When the browser disconnects (`request.signal`), the upstream fetch is aborted. When upstream is unreachable, the response is a 502 JSON (not a hanging stream); when upstream closes mid-stream, the relay sends `event: upstream-closed\ndata: {}\n\n` and ends so the browser's EventSource reconnects.
- [ ] `dashboard/lib/sse-relay.ts` holds the stream plumbing as a pure function over a `ReadableStream` input (unit test: heartbeat injection, upstream-close frame, abort propagation using a fake upstream).
- [ ] Local latency measured and recorded: with the e2e runner on 8101 and `next dev -p 3001`, a Node script `workers/calls-e2e/measure-latency.mjs <events-url> <ping-url>` opens the relay as an SSE client (plain `fetch` reader, no browser), posts `/api/calls/dev/ping`, and prints the milliseconds between `sent_at` in the frame and receipt. Run it 5 times; the median goes in the progress log. Target under 500 ms locally.
- [ ] The same script, run with `https://dashboard.ownaloha.land/api/calls/events` and the matching ping URL, is the tunnel measurement; it needs an Access session, so `workers/calls-e2e/TUNNEL-LATENCY.md` documents the browser-console variant (an `EventSource('/api/calls/events')` plus `fetch('/api/calls/dev/ping', {method: 'POST'})` snippet that logs the latency) for the operator to paste after the production Python service is restarted with the API. The loop files this under `## Questions for Daniel` as an operator step and records the number when it is pasted back. Target under 3 s.
- [ ] `tsc` clean, `npm test` no new failures.

### US-012: Nav item and the `/calls` page
**Description:** As the operator, I want the live call pop view in the command center.

**Acceptance Criteria:**
- [ ] `components/Nav.tsx` gains `{ href: '/calls', label: 'Calls' }` after Fronts.
- [ ] `dashboard/app/calls/page.tsx` (client component) renders: `components/CallsOpsStrip.tsx` at the top (one chip per badge from `/api/calls/ops`, colors by `level`, link to `/calls/ops`, re-fetched every 30 s, shows "call service unreachable" in red on 502), a pops panel, and the recent calls table (when, call id, state, number) from `/api/calls/recent`, with an "Attribute caller" link on each row carrying `call_id` and number, and a "Log note" button that opens the note form prefilled with the call id.
- [ ] `components/CallPop.tsx` renders one pop per `kind` exactly as the inventory describes: matched (record link, stale marker), ambiguous (candidate list with links), miss and outbound-miss (link to `/calls/attribute?call_id=&number=`), outbound (property link), ping frames are ignored except for a tiny "stream ok" timestamp in the strip.
- [ ] `dashboard/lib/use-call-stream.ts` hook: opens `EventSource('/api/calls/events')`, prepends pops, on every `open` (first connect and every reconnect) re-fetches `/api/calls/recent`, on `error` shows "reconnecting" in the strip and lets EventSource retry; the hook is unit-testable through an injected EventSource constructor (test: the recent fetch fires on open, pops prepend, reconnect triggers the re-fetch again).
- [ ] Nav shows the new entry on every page; `/calls` renders with an empty recent list and the strip when the Python runner is up, and the unreachable state when it is down.
- [ ] Verify in the browser against 3001 (Playwright from `workers/posting/node_modules`, `http://localhost:3001`): page loads, a replayed ringing on 8101 pops within 5 s, killing the Python runner flips the strip to unreachable, restarting it recovers within 30 s without reloading the page. Screenshots in `/tmp`, summary in the progress log.
- [ ] `tsc` clean.

### US-013: Note form and record detail
**Description:** As the operator, I want to log a call note from the pop and from a record page and see the ID task id when it lands.

**Acceptance Criteria:**
- [ ] `components/CallNoteForm.tsx`: fields contact id, property id, note (required), status (Not Started, Working, Completed; default Completed), follow-up date; generates `client_uuid` once at mount; disables the submit button while in flight; posts to `/api/calls/notes`; shows the outcome line ("logged", "duplicate submit", fallback-close message) and then polls `/api/calls/outbox/{id}` every 3 s for up to 60 s until `status` is `done` (shows "ID task <task_id>") or `dead_letter` (shows the error in red, links to `/calls/ops`).
- [ ] `dashboard/app/calls/record/[table]/[id]/page.tsx`: nickname line, record fields table (non-empty only), task history table, and the note form prefilled with the record id; 404 state for unknown records; the record page is linked from pops, search results, contacts, and properties.
- [ ] Browser verification on 3001: submit a note from a pop, see the outbox id, see the fake task id appear within 10 s; submit the same form twice quickly and confirm one outbox row (`/api/calls/outbox` ids); open a record page for contact 7 and property 5692 from the e2e seed.
- [ ] `tsc` clean.

### US-014: Contacts, properties, tasks, and search pages
**Description:** As the operator, I want the list and search views.

**Acceptance Criteria:**
- [ ] `/calls/contacts` (paged by `start`, Next page when `next_start`), `/calls/properties` (status filter input with the "0 = all" hint, paging), `/calls/tasks` (open tasks, overdue rows tinted, due date), `/calls/search` (query box with autofocus; record matches table and nickname matches list; "Attribute them" link carrying `q`).
- [ ] All four handle 502 with the unreachable message and never throw on an empty result.
- [ ] Browser verification on 3001 against the e2e runner: each page renders the seed data; search "Meadow" finds the nickname; search "Buyer" finds the contact row; pagination link appears only when 50 rows come back (assert absent with the seed).
- [ ] `tsc` clean.

### US-015: Attribute and dial pages
**Description:** As the operator, I want to bridge an unknown caller to a property and pre-tag an outbound call.

**Acceptance Criteria:**
- [ ] `/calls/attribute?call_id=&number=&q=`: scripted prompt line, nickname search (via `/api/calls/nicknames/search`), each match with an attribute form (first name required, last name), the "create contact, no property" form; on success shows the contact link, property link, the unresolved-slug warning when `property_id` is null, and the note form prefilled (call_id, contact_id, property_id, caller=number). The three error statuses render their messages (409 includes the duplicate-risk hint and a link to `/calls/contacts`).
- [ ] `/calls/dial?property_id=&phone=`: shows the nickname prompt from `/api/calls/nicknames/property/{id}` when a property id is present; the form posts to `/api/calls/dial` and shows the confirmation with the 15 minute window and the nickname to say.
- [ ] Browser verification on 3001 with the e2e runner: attribute a miss pop from `+15305550199` to "Test Meadow" with first name "Synthetic"; the record log shows one `create_contact`; the confirmation links to the new contact; dial with property 5692 shows "Test Meadow"; a replayed outbound connected to that number pops as `outbound` with property 5692.
- [ ] `tsc` clean.

### US-016: Agents and ops pages
**Description:** As the operator, I want the agent mapping admin and the ops drill-down.

**Acceptance Criteria:**
- [ ] `/calls/agents`: mapping table (default row marked), edit link prefilling the form, delete button (confirm inline, not with `window.confirm`), add/update form posting to `/api/calls/agents`, the DialPad users table or the error line, the explanatory text about the `*` default row.
- [ ] `/calls/ops`: last sync age, sync error and warning, health flags, dead-letter table with the explanatory paragraph; the strip's "detail" link lands here.
- [ ] Browser verification on 3001: add an agent row, edit it, delete it (record counts through `/api/calls/agents`); ops page renders with zero dead letters and after forcing one in the scratch database (insert a `dead_letter` outbox row through sqlite3 in the scratch db) shows it and the strip turns red.
- [ ] `tsc` clean.

### US-017: Link both ways
**Description:** As the operator, I want calls, records, tasks, and the fronts registry to point at each other.

**Acceptance Criteria:**
- [ ] After a note is delivered, the note form's "ID task <id>" line links to the record page of the contact or property it was logged against, and the record page's history table (which comes from the local task-link index after the next sync walk) shows the task; the recent calls table row for that call shows a "note logged" marker derived from `/api/calls/recent` (the Python side adds `has_manual_note: bool` per event by checking the `{call_id}:manual_note` claim; one small addition to the shared recent helper with a test).
- [ ] `config/fronts.json`: the `buyer-followup` description mentions the calls section (`/calls` in the command center, call pops, notes, attribution) and `cwdHints` gains `~/claude/command-center/dashboard/app/calls`.
- [ ] `pytest -q`, ruff, `tsc` clean.

### US-018: Automated browser e2e script
**Description:** As the loop and the operator, I want one command that proves the whole chain on a clean machine state.

**Acceptance Criteria:**
- [ ] `workers/calls-e2e/run.sh`: creates a temp dir; starts `scripts/run_e2e_dev.py 8101 <tmp>/e2e.db <tmp>/id-writes.jsonl` with a throwaway `CALLS_API_TOKEN`; starts `npx next dev -p 3001` from `dashboard/` with `DASHBOARD_URL=http://localhost:3001 CALLS_API_URL=http://127.0.0.1:8101 CALLS_API_TOKEN=<same>`; waits for both health checks; runs `workers/calls-e2e/e2e.mjs` (Playwright from `workers/posting/node_modules`, headless Chromium, `http://localhost:3001`) through the steps: load `/calls`; inject a ringing from `+15305550123` via `POST /dev/replay` (session cookie from the runner's stdout) and assert a matched pop within 5 s; submit a note on it and assert within 15 s that `id-writes.jsonl` holds exactly one `create_task` with that note text and the page shows the fake task id; search "Jane" and open the contact record; run attribute for a miss ringing from `+15305550199` with nickname "Test Meadow" and assert one `create_contact`; run dial for 5692; load `/calls/ops` and assert the strip is green; stop the Python runner and assert the strip shows unreachable within 35 s.
- [ ] Prints `PASS`/`FAIL` per step, exits non-zero on any failure, kills exactly the pids it started (never by pattern), deletes the temp dir and any `workers/logs/*e2e*` files it created, and leaves `dashboard/data/*.json` untouched (assert with a checksum before and after).
- [ ] Refuses to run when port 3001 or 8101 is already in use (prints which).
- [ ] A clean run on this box passes; the output is pasted into the progress log.

### US-019: Cutover config and revert
**Description:** As the operator, I want the nginx flip prepared so cutover is a copy and a reload, with a documented way back.

**Acceptance Criteria:**
- [ ] `deploy/nginx-calls-cutover.conf` in followupdominator: the same server blocks as `nginx-followupdominator.conf` (certbot lines kept, hardening headers kept) but only `location = /webhook/dialpad` and `location = /healthz` proxy to 8100; every other path returns 404 with an empty body; no `/events` or `/login` blocks remain. A comment at the top explains that `/api/v1/*` is intentionally NOT exposed on this host (the command center talks to 8100 on localhost).
- [ ] `deploy/cutover.sh` prints the exact sudo commands to apply (copy to sites-available, `nginx -t`, reload) and `deploy/cutover.sh --revert` prints the commands to restore `nginx-followupdominator.conf`; neither script runs sudo itself.
- [ ] `DEPLOY.md` gains a "Cutover to the command center" section: prerequisites (manual test passed, production service restarted with the API, `CALLS_API_TOKEN` mirrored), the apply steps, the verification curls (`/healthz` 200 or 503, `/login` 404, webhook still accepted by a real call), and the revert.
- [ ] `nginx -t` cannot run without root here, so the config is validated by a pytest that parses it with a tiny brace-matcher and asserts exactly two proxied locations and no `proxy_buffering off` block (`tests/test_deploy_configs.py`).

### US-020: Docs, manual test script, feature log
**Description:** As future sessions and the operator, I need the docs to describe the new shape and the operator test to be scripted.

**Acceptance Criteria:**
- [ ] `specs/calls-dashboard-manual-test.md` scripts the ten operator steps from the handoff (laptop and phone load, real inbound call pop within 2 s, note with follow-up lands in ID within a minute, ring-out missed task, unknown caller plus nickname attribution, dial pre-tag, search and record pages, tab kill and reconnect, 30 s Python stop and recovery, side-by-side comparison with `calls.ownaloha.land`), each with the expected result and a blank for the observed result, plus the cleanup list for the `[TEST]` records.
- [ ] `specs/specs.md` gains a "Calls dashboard" entry in the established shape (what it does, surface added in both repos, invariants and gotchas, how to extend, operator steps outstanding).
- [ ] `specs/readme.md`: pages table gains `/calls` and its subpages, the API table gains the `/api/calls/*` family in one row, the repo map gains `app/calls`, `lib/calls-*`, `workers/calls-e2e/`, and the spec list gains this PRD.
- [ ] `AGENTS.md` gains one bullet: dev Python port recipe (`scripts/run_e2e_dev.py 8101 ...`), token mirroring rule (same `CALLS_API_TOKEN` in both files), the e2e command, and the "never restart 8100 yourself" reminder.
- [ ] followupdominator `README.md` Architecture paragraph mentions the JSON API, the command-center UI, and that the HTML dashboard is on its way out; `DEPLOY.md` already updated in US-019.
- [ ] This PRD's status line becomes `**Status:** Implemented (<date>); operator steps outstanding: production restart, tunnel latency number, manual test, nginx cutover`.
- [ ] `## Questions for Daniel` in the progress log lists only operator steps.

## Non-Goals

- Removing the Python HTML dashboard, its password login, or the `fud_session` cookie (next loop, after a week on the new UI).
- Changing the Dialpad webhook, the event worker, the outbox, the sweeper, the sync job, ID write rules, backups, or alerts.
- Multi-user auth or per-user permissions; Cloudflare Access remains the gate.
- Moving the service off port 8100 or off `calls.ownaloha.land` (the webhook needs 443 there).
- Restyling beyond the command center's existing look (dark theme, Tailwind classes already in use).

## Technical Considerations

### Hard rules (the loop must obey these every iteration)

- **Port 3000 is production.** Develop against `npx next dev -p 3001` started with `DASHBOARD_URL=http://localhost:3001`; never restart 3000. Rebuild and restart of 3000 is an operator step.
- **The Python service on 8100 is production.** Use `scripts/run_e2e_dev.py` on 8101 (US-008) or `scripts/run_receiver_dev.py` on another port. Never kill processes by pattern; never restart 8100 yourself; when a restart is needed, write it under `## Questions for Daniel` with the exact crontab line to relaunch (`crontab -l | grep run_service`).
- **Investment Dominator writes are live.** Only the `[API TEST]` property 5693 may be written to during testing, and every write is read back and diffed. The e2e stack uses fakes and never touches ID.
- **Never run `git clean` in followupdominator.** The production database and `.credentials/` live inside the working tree.
- **Do not touch** `/webhook/dialpad`, the event worker, the outbox delivery logic, the sweeper, or the sync job beyond the one `has_manual_note` read in US-017. `/healthz` stays public.
- **All command-center task writes go through `/api/tasks`.** No direct edits to `dashboard/data/*.json`.
- **Secrets never appear** in logs, fixtures, commit messages, docs, or API responses. Phone numbers and names from the real database never go into fixtures; synthesize them (the e2e seed uses `+1530555xxxx` numbers and "Jane Buyer").
- **Commit per story by explicit paths** in each repo (both trees carry unrelated uncommitted operator files; leave them alone). End every commit message with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- **No em dashes anywhere** (a hook blocks file writes containing one; the Python source already contains some in strings, so describe those strings instead of quoting them).
- **Each iteration is one story**, and each story fits one context window. Tests cited by a story are run before its boxes are checked.

### Findings from the recon that shape the design

- The HTML dashboard is one function, `register_dashboard(app, deps)`, over a `DashboardDeps` dataclass; the API is a sibling `register_api(app, deps, token=...)` over the same deps object. Where the HTML route holds logic worth sharing (notes, ops summary, recent calls, badge thresholds), the logic moves into a plain function both call. Where it only formats HTML, the API calls the service object directly.
- `create_app` in `webhook_receiver.py` owns `/events`, `/calls/recent`, `/healthz`, `/webhook/dialpad`, and the optional `/dev/replay`; the API versions of the first two live in `api_v1.py` and read `app.state.db` and `app.state.broadcast`.
- A note submission returns an outbox receipt, never an ID task id. The id appears in `outbox.result` (`task.t_id`) after the outbox loop (every 5 s) delivers. Hence `GET /api/v1/outbox/{id}` and client polling.
- `run_receiver_dev.py` starts no loops, so replayed events never become pops there. The e2e runner is a new script over `build_service` with `enable_dev_replay` (US-008). Production `run_service.py` never enables replay.
- `/dev/replay` is session-gated (cookie or `?token=` with the session secret), not API-token-gated; the e2e runner prints a minted session token so the script can call it. Keep it that way: it is dev-only and the session code is not being removed in this loop.
- `PopBroadcast.publish` adds `seq`; the SSE frame id is that `seq`. The relay forwards bytes unchanged, so `Last-Event-ID` semantics are preserved even though nobody uses them yet.
- Python SSE keepalive is 25 s; the relay adds its own 15 s heartbeat so the Cloudflare tunnel (100 s idle default) and any proxy in between never see a silent stream.
- Cloudflare Access fronts `dashboard.ownaloha.land`; the tunnel ingress is `http://localhost:3000` (`~/.cloudflared/config.yml`). Streaming responses pass through cloudflared without special config; the measurement in US-011 confirms it.
- `readProjectEnvVar` reads `process.env` first, then the root `.env.local`; e2e and dev runs pass `CALLS_API_URL` and `CALLS_API_TOKEN` on the command line so production values are never used by a dev server.
- The existing agent-token guard (`dashboard/lib/agent-auth.ts`) is the model for `require_api_token` (sha256 both sides, `compare_digest`, 503 when unset).
- Command-center unit tests run with `node --import tsx --test lib/*.test.ts`; fakes are injected through function parameters, not module mocking.
- Browser verification uses Playwright from `workers/posting/node_modules`, always `http://localhost:<port>` (Next dev blocks its own chunks on `127.0.0.1`), polling the API for state rather than waiting on DOM timing; the first hit of a route compiles for about 10 s.
- The Python service has no systemd unit yet; it runs from an `@reboot` crontab line with `setsid nohup`. The restart recipe in the handoff is the only approved one and is operator-run.
- Known pre-existing failures: `dashboard/lib/ebay-html.test.ts` (2 tests) fail because a live workspace sample was edited; unrelated to this work and not to be fixed here.

### Order and dependencies

US-002 to US-008 are Python-only and can land without the command center. US-009 to US-011 are command-center plumbing that only needs `docs/api-v1.md` and the e2e runner. US-012 to US-017 are pages, each verified against 3001 plus the e2e runner on 8101. US-018 wraps everything in one script. US-019 and US-020 are docs and cutover prep. Nothing depends on a later story. The production Python restart (operator) is needed only for the tunnel measurement and the manual test, not for any story's checkboxes.
