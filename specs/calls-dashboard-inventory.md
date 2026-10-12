# Calls dashboard inventory (followupdominator HTML dashboard, as of 2026-10-12)

Written for `specs/calls-dashboard.md` US-001. Source files: `~/claude/followupdominator/app/dashboard.py` (959 lines, `register_dashboard(app, deps)`) and `app/webhook_receiver.py` (357 lines, `create_app(...)`). Every route below is session-gated by the `fud_session` HMAC cookie (`verify_session`, also accepted as `?token=`) except where marked public. Investment Dominator is abbreviated ID.

## Service objects the dashboard reaches for (`DashboardDeps`, `app/dashboard.py:94`)

| Field | Type | Used by |
|---|---|---|
| `outbox` | `TaskWriteOutbox` | notes (choke point), ops strip/ops (`stats()`, `dead_letters()`, raw SQL on `raw_events` and `sync_meta` through `outbox._conn`) |
| `phone_index` | `PhoneIndexRepository` | search (raw SQL on `phone_index` through `phone_index._conn`) |
| `nicknames` | `PropertyNicknameRepository` | record detail, dial, search (`for_property`, `search`) |
| `intents` | `OutboundIntentRepository` | dial (`record`) |
| `task_index` | `TaskLinkIndex` | record detail (`tasks_for`), tasks (`open_tasks`) |
| `id_client` | `IDClient` | contacts, properties, record detail (`list_contacts`, `list_properties`, `get_property`, `get_contact`) |
| `agents` | `AgentDirectory` or None | agents (`all_agents`, `resolve`, `upsert`, `remove`); None disables the page |
| `dialpad_client` | `DialPadClient` or None | agents (`list_users`, best effort) |
| `lookup` | `CallLookupService` or None | attribute (`search_nicknames`, `attribute_by_nickname`, `quick_create_contact`); None disables the page |
| `password`, `session_secret` | str or None | login only; the JSON API replaces these with `CALLS_API_TOKEN` |

`webhook_receiver.create_app` keeps `app.state.db` (sqlite connection), `app.state.broadcast` (`PopBroadcast`), `app.state.event_queue`, `app.state.background_tasks` (production only).

## HTML routes in `app/dashboard.py`

| Route | Inputs | Data rendered | Service calls | ID writes | Class |
|---|---|---|---|---|---|
| `GET /login`, `POST /login`, `POST /logout` | form `password` | login page, sets or clears `fud_session` | `hmac.compare_digest` against `deps.password` | none | auth (not ported; Cloudflare Access plus the API token replace it) |
| `GET /` Call Pop | none | ops strip; `#pops` filled by `EventSource('/events')`; recent table from `fetch('/calls/recent')` showing `received_at`, `call_id`, `state`, `payload.external_number`; each pop gets the note form; `miss` and `outbound-miss` pops link to `/attribute?call_id=&number=` | none server-side (client JS only) | none | read-only |
| `GET /contacts?start=` | `start` (page of 50) | table: id (link to record), first+last name, type, phone, cell, email; Next page link when 50 rows | `id_client.list_contacts(start, range=50)` | none | read-only (live ID proxy) |
| `GET /properties?status=&start=` | `status` (ID status id or group, `0` = all), `start` | table: property_id (link), property_status, property_apn, address line (address, city, state, zip), owner first+last | `id_client.list_properties(status, start, range=50)` | none | read-only (live ID proxy) |
| `GET /record/{table}/{id}` | `table` in property or contact, int id | nickname line (property only), every non-empty field of the live record, task history table (task_id, title, status, start date) from the local index, note form prefilled with the record id | `id_client.get_property` or `get_contact`, `task_index.tasks_for(table, id)`, `nicknames.for_property(id)` | none | read-only (plus the shared note form) |
| `GET /tasks` | none | open tasks (Not Started or Working) table: task_id, title, status, due (start date); `overdue` class when `start_ts < now` | `task_index.open_tasks()` | none | read-only |
| `GET /dial?property_id=&phone=` | optional `property_id`, `phone` | nickname prompt ("Mention during the call"), form (phone required, property_id required) | `nicknames.for_property(property_id)` | none | read-only |
| `POST /dial` | form `phone`, `property_id` (int) | confirmation: intent recorded, 15 minute window, nickname to say | `intents.record(raw_number, property_id)`, `nicknames.for_property` | none (local `outbound_call_intents` row) | **write choke point** (local only) |
| `GET /search?q=` | `q` | record matches table (record link, display_name, address, apn, status; max 25) from `phone_index` columns `display_name LIKE`, `address LIKE`, `apn LIKE`; nickname matches list (`nickname`, score, property link or unresolved slug); link to `/attribute?q=` | raw SQL on `phone_index`, `nicknames.search(q)` (limit 5, min_score 0.55) | none | read-only |
| `GET /attribute?call_id=&number=&q=` | optional `call_id`, `number`, `q` | scripted prompt, nickname search results each with an attribute form (slug hidden, caller first name required, last name), plus a "create contact, no property" form | `lookup.search_nicknames(q)` | none | read-only (404-equivalent message when `deps.lookup` is None) |
| `POST /attribute` | form `call_id`, `number` (required), `slug` (optional), `caller_fname` (required), `caller_lname` | confirmation with contact link, property link, unresolved-slug warning, then the note form prefilled (call_id, contact_id, property_id, caller=number) | `lookup.attribute_by_nickname(slug, number, fname, lname)` or `lookup.quick_create_contact(number, fname, lname)` | **yes**: `IDClient.create_contact` (buyer, type 2), then `list_contacts` pages to recover the id, then `phone_index.upsert` | **write choke point** (synchronous ID write) |
| `GET /agents?edit=` | optional `edit` (dialpad_user_id) | mapping table (dialpad_user_id with default marker, name, id_user_id, sms_number, edit link, delete form), add/edit form, DialPad users table (id, display_name or first_name, first phone number) or an error line | `agents.all_agents()`, `agents.resolve(edit)`, `dialpad_client.list_users()` (exceptions rendered as text) | none | read-only |
| `POST /agents` | form `dialpad_user_id` (required), `name`, `id_user_id`, `sms_number` | redirect to `/agents` | `agents.upsert(...)` | none (local `agents` row) | **write choke point** (local only) |
| `POST /agents/delete` | form `dialpad_user_id` | redirect to `/agents` | `agents.remove(id)` | none (local) | **write choke point** (local only) |
| `GET /ops` | none | last successful sync age, sync error, sync warning, health flags list (key: value), dead-letter table (event_key, kind, last_error, finished_at) | `ops_summary(deps)`, `outbox.dead_letters()` | none | read-only |
| `POST /notes` | form `client_uuid` (generated at form render), `call_id` (defaults to `dash-<uuid>`), `caller`, `contact_id`, `property_id`, `note` (required), `status` (Not Started, Working, Completed; default Completed), `follow_up` (ISO date, default today) | "Note logged" or "duplicate submit" line, plus whether the redundant fallback task is being closed | builds a `TaskPayload` (title is `Call`, the date as MM/DD/YYYY, and the caller number, joined by the dash separator the code already uses; description is the note plus a `(call id: ...)` line; task_type `Note`; status; start = end = follow_up; contact_id; property_id); `outbox.record_manual_note(call_id, client_uuid, payload)`; when `receipt.enqueued and receipt.fallback_already_fired`: `_close_redundant_fallback` reads the fallback outbox row and `outbox.enqueue_task_update(event_key=f"{call_id}:close_fallback", ...)` | **yes, asynchronously**: the outbox loop delivers `create_task` (and the optional `update_task`) to ID; the ID task id lands in `outbox.result` JSON as `task.t_id` after delivery | **write choke point** (the design section 4 idempotent path) |

The ops strip (`ops_strip_html`) is rendered on every authed page from `ops_summary(deps)`:

| Badge | Value | Alarm (red) when | Warn (amber) when |
|---|---|---|---|
| dead letters | `outbox.stats()["outbox_dead_letter"]` | `> 0` | |
| outbox queue | `stats["outbox_pending"]` | `> 25` | |
| event backlog | `COUNT(raw_events WHERE processed_at IS NULL)` | `> 50` | |
| last sync | `now - sync_meta.last_success_at` (formatted: under 90 as seconds, under 5400 as minutes, else hours) or "never" | `None` or `> 7200` s | |
| health: `<key>` | one badge per `health_flags` row | always | |
| sync error | `sync_meta.last_error` non-empty | always | |
| sync warning | `sync_meta.last_warning` non-empty | | always |

## JSON routes in `app/webhook_receiver.py`

| Route | Auth | Inputs | Output | Notes |
|---|---|---|---|---|
| `POST /webhook/dialpad` | JWT HS256 signature plus freshness | DialPad JWT body | `{ok, event_id}` or `{ok: false, reason}` with 400/401 | **do not touch** |
| `GET /dev/replay`, `POST /dev/replay` | session | JSON body or form `payload` with `call_id`, `state`, `direction`, `external_number`, `internal_number`, ... | `{ok, event_id, dev_replay: true}` | only when `create_app(enable_dev_replay=True)` (dev runner). Stamps `event_timestamp` and goes through the same persist-and-nudge path as a real webhook, so with the background loops running it produces real pops and auto-tasks |
| `GET /healthz` | public | none | `{ok, unprocessed_events, dead_letters, health_flags: [keys], sync_age_seconds, loops_alive}`; 503 when not ok | external uptime monitor; stays public |
| `GET /events` | session (cookie or `?token=`) | none | `text/event-stream`; frames `id: <seq>\ndata: <json>\n\n`; `: keepalive\n\n` every 25 s; headers `Cache-Control: no-cache`, `X-Accel-Buffering: no` | reads `app.state.broadcast.subscribe()`; ends when `request.is_disconnected()` |
| `GET /calls/recent?limit=` | session | `limit` (default 20, max 100) | `{events: [{event_id, received_at, call_id, state, processed, payload}]}` newest first from `raw_events` | the reconnect re-fetch |

## Pop payloads published on `/events` (`app/live_pipeline.py:_pop_payload` and the outbound branch)

All frames carry `seq` (added by `PopBroadcast.publish`).

| kind | Fields | When |
|---|---|---|
| `matched` | `call_id`, `number`, `summary`, `contact_id` or `property_id`, `stale` (bool) | inbound ringing, one phone-index record |
| `ambiguous` | `call_id`, `number`, `summary`, `candidates: [{record_table, record_id, display_name, address}]` | inbound ringing, several records |
| `miss` | `call_id`, `number`, `summary` | inbound ringing, unknown number (the HTML pop shows the attribute link) |
| `outbound` | `call_id`, `summary`, `property_id`, `number` | outbound connected with a live intent |
| `outbound-matched`, `outbound-ambiguous`, `outbound-miss` | as the inbound kinds | outbound connected without an intent |

`call_id` is the canonical (parent leg) id; the note form must send it unchanged so the manual-note idempotency keys line up with the worker and sweeper claims.

## Write choke points, summarized

| Path | Local write | ID write | Idempotency |
|---|---|---|---|
| `POST /notes` | `processed_events` claims `{call_id}:manual_note:{client_uuid}` and `{call_id}:manual_note`; `outbox` row | asynchronous `create_task` (plus `update_task` to close a fired fallback) | `client_uuid`: a resubmit returns `enqueued: false` |
| `POST /attribute` | `phone_index.upsert` of the caller number to the new contact | synchronous `create_contact` then id recovery; a retry after a `LookupError` would create a duplicate contact | none beyond the warning text |
| `POST /dial` | `outbound_call_intents` row (15 minute TTL) | none | none (a second record is a newer intent) |
| `POST /agents`, `POST /agents/delete` | `agents` row | none | upsert |

## Dev and test surface relevant to the port

- `scripts/run_receiver_dev.py [port]`: receiver plus dashboard with `/dev/replay`, real credentials, the production database file, **no background loops**, so a replayed ringing event persists but never becomes a pop. The e2e runner needs `build_service()` (all loops) with fakes instead.
- `app/service.py:build_service(conn, *, webhook_secret, session_secret, password, id_client=None, dialpad_client=None, sms_sender_user_id=None, alert_sms_number=None, registry_path=None)` accepts injected ID and DialPad clients but has no `enable_dev_replay` parameter.
- Test fakes: `tests/test_dashboard.py:FakeIDClient` (list/get contacts and properties, seeded with one synthetic contact id 7 and property 5692), `tests/test_outbox.py:FakeIDClient` (`create_task` and `update_task` returning `{"status": "Success", "task": {"t_id": "9"}}`), `tests/test_live_pipeline.py:FakeID`, `tests/test_dashboard.py:FakeDialPadUsers` (`list_users`). The `session` fixture mints a valid cookie; `test_sse_delivery.py:live_server` runs real uvicorn on a free port because httpx's ASGI transport buffers streams.
- Baseline 2026-10-12: `pytest -q` 265 passed; `ruff check app scripts tests` clean; Python 3.13.12.
