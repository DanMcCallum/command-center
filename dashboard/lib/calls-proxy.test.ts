import assert from 'node:assert/strict';
import { test } from 'node:test';
import { callsResponse, INVALID_JSON, readJsonBody } from './calls-proxy';

test('callsResponse passes upstream data and status through, uncached', async () => {
  const res = callsResponse({ ok: true, status: 200, data: { events: [] } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await res.json(), { events: [] });
});

test('callsResponse answers with the mapped error body and status', async () => {
  const res = callsResponse({ ok: false, status: 409, body: { error: 'dup', hint: 'check contacts' } });
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { error: 'dup', hint: 'check contacts' });
});

test('readJsonBody forwards JSON as-is, empty as {}, refuses non-JSON', async () => {
  const post = (body?: string) => new Request('http://localhost/x', { method: 'POST', body });
  assert.deepEqual(await readJsonBody(post('{"note":"hi","status":"Working"}')), {
    ok: true,
    body: { note: 'hi', status: 'Working' },
  });
  assert.deepEqual(await readJsonBody(post('[1,2]')), { ok: true, body: [1, 2] });
  assert.deepEqual(await readJsonBody(post()), { ok: true, body: {} });
  const bad = await readJsonBody(post('note=hi'));
  assert.equal(bad.ok, false);
  if (!bad.ok) {
    assert.equal(bad.response.status, 400);
    assert.deepEqual(await bad.response.json(), { error: INVALID_JSON });
  }
});
