import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  callsApi,
  callsRequest,
  mapCallsError,
  NOT_CONFIGURED,
  READ_TIMEOUT_MS,
  TOKEN_MISMATCH,
  TOKEN_UNSET,
  UNREACHABLE,
  type CallsDeps,
} from './calls-client';
import type { NoteOutcome, OpsSummary, OutboxStatus, PopEvent, RecordDetail } from './calls-types';

// Fixture payloads copied verbatim from followupdominator docs/api-v1.md.
const RECORD_PROPERTY = {
  table: 'property',
  id: 5692,
  record: {
    property_id: '5692',
    property_status: 'Available',
    property_apn: '010-123-45',
    property_address: '12 Montello Rd',
    property_city: 'Montello',
    property_state: 'NV',
    property_zip: '89830',
    owner_first_name: 'Olive',
    owner_last_name: 'Owner',
  },
  nickname: 'Test Meadow',
  history: [
    {
      task_id: 9001,
      title: 'Call 10/12/2026',
      status: 'Completed',
      task_type: 'Note',
      start_ts: 1791763200.0,
      end_ts: 1791763200.0,
    },
  ],
};

const OPS = {
  dead_letter: 1,
  outbox_pending: 0,
  raw_backlog: 0,
  health_flags: {},
  sync_age_seconds: 754.2,
  sync_error: '',
  sync_warning: '',
  badges: [
    { label: 'dead letters', text: 'dead letters: 1', level: 'alarm' },
    { label: 'outbox queue', text: 'outbox queue: 0', level: 'ok' },
    { label: 'event backlog', text: 'event backlog: 0', level: 'ok' },
    { label: 'last sync', text: 'last sync: 13m ago', level: 'ok' },
  ],
  dead_letters: [
    {
      id: 4,
      event_key: '5550007:manual_note',
      kind: 'create_task',
      attempts: 8,
      last_error: 'HTTP 500 from Investment Dominator',
      finished_at: 1791786000.0,
    },
  ],
};

const NOTE_REQUEST = {
  note: 'Asked about road access',
  client_uuid: '0b9c6f1e-1111-4a2b-9c3d-000000000001',
  call_id: '5550001',
  status: 'Working',
  follow_up: '2026-10-20',
  caller: '+15305550123',
  contact_id: 7,
  property_id: 5692,
};

const NOTE_OUTCOME = {
  enqueued: true,
  event_key: '5550001:manual_note:0b9c6f1e-1111-4a2b-9c3d-000000000001',
  outbox_id: 1,
  call_id: '5550001',
  client_uuid: '0b9c6f1e-1111-4a2b-9c3d-000000000001',
  first_manual_note: true,
  fallback_already_fired: false,
  fallback_close: null,
};

const OUTBOX_DONE = {
  id: 1,
  event_key: '5550001:manual_note:0b9c6f1e-1111-4a2b-9c3d-000000000001',
  kind: 'create_task',
  status: 'done',
  attempts: 0,
  last_error: null,
  task_id: 9001,
};

const POPS = [
  '{"seq": 1, "kind": "matched", "call_id": "5550001", "number": "+15305550123", "summary": "Call: Jane Buyer", "contact_id": 7, "stale": false}',
  '{"seq": 3, "kind": "ambiguous", "call_id": "5550004", "number": "+15305550150", "summary": "Call: 2 possible matches for +15305550150", "candidates": [{"record_table": "contact", "record_id": 7, "display_name": "Jane Buyer", "address": ""}, {"record_table": "property", "record_id": 5692, "display_name": "Olive Owner", "address": "12 Montello Rd, Montello NV"}]}',
  '{"seq": 4, "kind": "miss", "call_id": "5550002", "number": "+15305550199", "summary": "Call: unknown caller +15305550199"}',
  '{"seq": 5, "kind": "outbound", "call_id": "5550005", "number": "+15305550123", "summary": "Call: Olive Owner", "property_id": 5692}',
  '{"seq": 7, "kind": "ping", "sent_at": 1791787147.43}',
];

const TOKEN = 'test-token-0123456789abcdef';

interface Seen {
  url: string;
  init: RequestInit;
}

function fakeFetch(status: number, body: unknown, seen: Seen[] = []): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), init: init ?? {} });
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return new Response(text, { status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
}

function throwingFetch(err: unknown): typeof fetch {
  return (async () => {
    throw err;
  }) as typeof fetch;
}

const deps = (f: typeof fetch): CallsDeps => ({ fetch: f, baseUrl: 'http://127.0.0.1:8101', token: TOKEN });

test('mapCallsError: thrown errors (refused, timeout, abort) are 502 unreachable', () => {
  const refused = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
  for (const err of [refused, new DOMException('timed out', 'TimeoutError'), new Error('x'), 'boom', null]) {
    assert.deepEqual(mapCallsError(err), { status: 502, body: { error: UNREACHABLE } });
  }
});

test('mapCallsError: upstream 503 token unset is 502 not configured', () => {
  assert.deepEqual(
    mapCallsError({ status: 503, body: { error: 'CALLS_API_TOKEN is not configured' } }),
    { status: 502, body: { error: NOT_CONFIGURED } },
  );
  assert.deepEqual(mapCallsError({ status: 503, body: null }), {
    status: 502,
    body: { error: NOT_CONFIGURED },
  });
});

test('mapCallsError: a 503 for an unwired service is forwarded', () => {
  assert.deepEqual(
    mapCallsError({ status: 503, body: { error: 'lookup service not wired in this deployment' } }),
    { status: 503, body: { error: 'lookup service not wired in this deployment' } },
  );
});

test('mapCallsError: upstream 401 is 500 token mismatch, never 401', () => {
  const out = mapCallsError({ status: 401, body: { error: 'Unauthorized' } });
  assert.deepEqual(out, { status: 500, body: { error: TOKEN_MISMATCH } });
});

test('mapCallsError: 400, 404, 409, 502 are forwarded with their body', () => {
  const cases = [
    { status: 400, body: { error: 'note is required' } },
    { status: 404, body: { error: 'no outbox row 99' } },
    {
      status: 409,
      body: {
        error: 'contact not recoverable',
        hint: 'the contact may exist in ID without being indexed; check contacts before retrying',
      },
    },
    { status: 502, body: { error: 'Investment Dominator did not respond' } },
  ];
  for (const c of cases) assert.deepEqual(mapCallsError(c), c);
});

test('mapCallsError: FastAPI 422 and bodiless errors get an error string', () => {
  const detail = {
    detail: [{ type: 'int_parsing', loc: ['query', 'start'], msg: 'Input should be a valid integer', input: 'abc' }],
  };
  assert.deepEqual(mapCallsError({ status: 422, body: detail }), {
    status: 422,
    body: { error: 'invalid request parameter' },
  });
  assert.deepEqual(mapCallsError({ status: 404, body: { detail: 'Not Found' } }), {
    status: 404,
    body: { error: 'call service answered 404' },
  });
  assert.deepEqual(mapCallsError({ status: 500, body: null }), {
    status: 502,
    body: { error: 'call service error (HTTP 500)' },
  });
});

test('GET sends the bearer header, no-store, a timeout signal, and no token in the URL', async () => {
  const seen: Seen[] = [];
  const res = await callsApi.record('property', 5692, deps(fakeFetch(200, RECORD_PROPERTY, seen)));
  assert.equal(res.ok, true);
  if (res.ok) {
    const rec: RecordDetail = res.data;
    assert.equal(rec.nickname, 'Test Meadow');
    assert.equal(rec.history[0].task_id, 9001);
  }
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'http://127.0.0.1:8101/api/v1/record/property/5692');
  assert.ok(!seen[0].url.includes(TOKEN));
  const headers = seen[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(seen[0].init.method, 'GET');
  assert.equal(seen[0].init.cache, 'no-store');
  assert.ok(seen[0].init.signal instanceof AbortSignal);
  assert.equal(seen[0].init.body, undefined);
});

test('query strings are forwarded as-is or built from an object', async () => {
  const seen: Seen[] = [];
  const f = fakeFetch(200, { rows: [], next_start: null, status: '0' }, seen);
  await callsApi.properties('?status=0&start=50', deps(f));
  await callsApi.properties({ status: 'Available', start: 0, skip: undefined }, deps(f));
  await callsApi.search(new URLSearchParams({ q: 'test medow' }), deps(f));
  await callsApi.contacts(undefined, deps(f));
  assert.deepEqual(
    seen.map((s) => s.url.replace('http://127.0.0.1:8101', '')),
    [
      '/api/v1/properties?status=0&start=50',
      '/api/v1/properties?status=Available&start=0',
      '/api/v1/search?q=test+medow',
      '/api/v1/contacts',
    ],
  );
});

test('POST sends the JSON body and returns the note receipt', async () => {
  const seen: Seen[] = [];
  const res = await callsApi.note(NOTE_REQUEST, deps(fakeFetch(200, NOTE_OUTCOME, seen)));
  assert.equal(res.ok, true);
  if (res.ok) {
    const out: NoteOutcome = res.data;
    assert.equal(out.outbox_id, 1);
    assert.equal(out.fallback_close, null);
  }
  assert.equal(seen[0].url, 'http://127.0.0.1:8101/api/v1/notes');
  assert.equal(seen[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(String(seen[0].init.body)), NOTE_REQUEST);
  const headers = seen[0].init.headers as Record<string, string>;
  assert.equal(headers['Content-Type'], 'application/json');
  assert.equal(headers.Authorization, `Bearer ${TOKEN}`);
});

test('every endpoint hits its documented path and method', async () => {
  const seen: Seen[] = [];
  const d = deps(fakeFetch(200, {}, seen));
  await callsApi.ping(d);
  await callsApi.recent({ limit: 5 }, d);
  await callsApi.devPing(d);
  await callsApi.nicknameSearch({ q: 'meadow' }, d);
  await callsApi.propertyNickname(5692, d);
  await callsApi.tasks(d);
  await callsApi.ops(d);
  await callsApi.agents(d);
  await callsApi.outbox(1, d);
  await callsApi.attribute({ number: '+15305550199', caller_fname: 'Sam' }, d);
  await callsApi.dial({ phone: '530-555-0123', property_id: 5692 }, d);
  await callsApi.upsertAgent({ dialpad_user_id: '501' }, d);
  await callsApi.deleteAgent({ dialpad_user_id: '501' }, d);
  assert.deepEqual(
    seen.map((s) => `${s.init.method} ${s.url.replace('http://127.0.0.1:8101', '')}`),
    [
      'GET /api/v1/ping',
      'GET /api/v1/calls/recent?limit=5',
      'POST /api/v1/dev/ping',
      'GET /api/v1/nicknames/search?q=meadow',
      'GET /api/v1/nicknames/property/5692',
      'GET /api/v1/tasks',
      'GET /api/v1/ops',
      'GET /api/v1/agents',
      'GET /api/v1/outbox/1',
      'POST /api/v1/attribute',
      'POST /api/v1/dial',
      'POST /api/v1/agents',
      'POST /api/v1/agents/delete',
    ],
  );
});

test('typed payloads: ops badges and outbox done', async () => {
  const ops = await callsApi.ops(deps(fakeFetch(200, OPS)));
  assert.ok(ops.ok);
  if (ops.ok) {
    const s: OpsSummary = ops.data;
    assert.equal(s.badges[0].level, 'alarm');
    assert.equal(s.dead_letters[0].attempts, 8);
  }
  const ob = await callsApi.outbox(1, deps(fakeFetch(200, OUTBOX_DONE)));
  assert.ok(ob.ok);
  if (ob.ok) {
    const o: OutboxStatus = ob.data;
    assert.equal(o.status, 'done');
    assert.equal(o.task_id, 9001);
  }
});

test('pop fixtures narrow by kind', () => {
  const pops = POPS.map((p) => JSON.parse(p) as PopEvent);
  const kinds = pops.map((p) => {
    switch (p.kind) {
      case 'matched':
      case 'outbound-matched':
        return `${p.kind}:${p.contact_id ?? p.property_id}`;
      case 'ambiguous':
      case 'outbound-ambiguous':
        return `${p.kind}:${p.candidates.length}`;
      case 'miss':
      case 'outbound-miss':
        return `${p.kind}:${p.number}`;
      case 'outbound':
        return `${p.kind}:${p.property_id}`;
      case 'ping':
        return `${p.kind}:${p.sent_at}`;
    }
  });
  assert.deepEqual(kinds, ['matched:7', 'ambiguous:2', 'miss:+15305550199', 'outbound:5692', 'ping:1791787147.43']);
});

test('upstream errors come back mapped, not thrown', async () => {
  const r404 = await callsApi.outbox(99, deps(fakeFetch(404, { error: 'no outbox row 99' })));
  assert.deepEqual(r404, { ok: false, status: 404, body: { error: 'no outbox row 99' } });
  const r401 = await callsApi.ops(deps(fakeFetch(401, { error: 'Unauthorized' })));
  assert.deepEqual(r401, { ok: false, status: 500, body: { error: TOKEN_MISMATCH } });
  const r503 = await callsApi.ops(deps(fakeFetch(503, { error: 'CALLS_API_TOKEN is not configured' })));
  assert.deepEqual(r503, { ok: false, status: 502, body: { error: NOT_CONFIGURED } });
  const html = await callsApi.ops(deps(fakeFetch(200, '<html>not json</html>')));
  assert.deepEqual(html, { ok: false, status: 502, body: { error: 'call service returned invalid JSON' } });
});

test('connection refused and timeout map to 502 and never leak the token', async () => {
  const leaky = new TypeError(`fetch failed for http://x/?token=${TOKEN} Bearer ${TOKEN}`);
  const timeout = new DOMException(`timed out after ${READ_TIMEOUT_MS} ms (${TOKEN})`, 'TimeoutError');
  for (const err of [leaky, timeout]) {
    let result: unknown;
    await assert.doesNotReject(async () => {
      result = await callsApi.recent(undefined, deps(throwingFetch(err)));
    });
    assert.deepEqual(result, { ok: false, status: 502, body: { error: UNREACHABLE } });
    assert.ok(!JSON.stringify(result).includes(TOKEN));
  }
  const ev = await callsApi.events(new AbortController().signal, deps(throwingFetch(leaky)));
  assert.deepEqual(ev, { ok: false, status: 502, body: { error: UNREACHABLE } });
  assert.ok(!JSON.stringify(ev).includes(TOKEN));
});

test('a missing local token is a 500 and makes no request', async () => {
  const seen: Seen[] = [];
  const res = await callsRequest('/api/v1/ping', {}, { fetch: fakeFetch(200, {}, seen), baseUrl: 'http://x', token: null });
  assert.deepEqual(res, { ok: false, status: 500, body: { error: TOKEN_UNSET } });
  assert.equal(seen.length, 0);
});

test('events returns the raw stream on success and a mapped error otherwise', async () => {
  const seen: Seen[] = [];
  const streamFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), init: init ?? {} });
    return new Response(': keepalive\n\n', { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  }) as typeof fetch;
  const ctrl = new AbortController();
  const ok = await callsApi.events(ctrl.signal, deps(streamFetch));
  assert.ok(ok.ok);
  if (ok.ok) assert.equal(await ok.response.text(), ': keepalive\n\n');
  assert.equal(seen[0].url, 'http://127.0.0.1:8101/api/v1/events');
  assert.equal(seen[0].init.signal, ctrl.signal);
  assert.equal((seen[0].init.headers as Record<string, string>).Authorization, `Bearer ${TOKEN}`);
  const bad = await callsApi.events(ctrl.signal, deps(fakeFetch(401, { error: 'Unauthorized' })));
  assert.deepEqual(bad, { ok: false, status: 500, body: { error: TOKEN_MISMATCH } });
});
