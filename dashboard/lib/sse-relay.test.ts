import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HEARTBEAT_FRAME, relaySse, UPSTREAM_CLOSED_FRAME } from './sse-relay';

const enc = new TextEncoder();
const dec = new TextDecoder();

/** An upstream the test pushes chunks into, recording whether it was cancelled. */
function fakeUpstream() {
  let ctl!: ReadableStreamDefaultController<Uint8Array>;
  const state = { cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      ctl = c;
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return {
    stream,
    state,
    push: (s: string) => ctl.enqueue(enc.encode(s)),
    close: () => ctl.close(),
    error: () => ctl.error(new Error('socket hang up')),
  };
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  let out = '';
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out;
    out += dec.decode(value);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const FRAME = 'id: 1\ndata: {"seq": 1, "kind": "ping", "sent_at": 1791787147.43}\n\n';

test('forwards upstream bytes unchanged, then an upstream-closed frame on close', async () => {
  const up = fakeUpstream();
  let ended = 0;
  const out = relaySse(up.stream, { heartbeatMs: 60_000, onEnd: () => ended++ });
  up.push(': keepalive\n\n');
  up.push(FRAME);
  up.close();
  const text = await readAll(out);
  assert.equal(text, HEARTBEAT_FRAME + ': keepalive\n\n' + FRAME + UPSTREAM_CLOSED_FRAME);
  assert.equal(UPSTREAM_CLOSED_FRAME, 'event: upstream-closed\ndata: {}\n\n');
  assert.equal(ended, 1);
});

test('an upstream error also ends with the upstream-closed frame', async () => {
  const up = fakeUpstream();
  const out = relaySse(up.stream, { heartbeatMs: 60_000 });
  up.push(FRAME);
  setTimeout(() => up.error(), 10);
  assert.equal(await readAll(out), HEARTBEAT_FRAME + FRAME + UPSTREAM_CLOSED_FRAME);
});

test('injects heartbeats on a quiet stream, never inside a split frame', async () => {
  const up = fakeUpstream();
  const out = relaySse(up.stream, { heartbeatMs: 20 });
  const reader = out.getReader();
  let text = '';
  const drain = (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      text += dec.decode(value);
    }
  })();
  await sleep(70);
  const quietBeats = text.split(HEARTBEAT_FRAME).length - 1;
  assert.ok(quietBeats >= 3, `expected the connect beat plus 2+ interval beats, got ${quietBeats}`);

  // Half a frame, a pause longer than the interval, then the rest.
  up.push('id: 2\ndata: {"seq": 2,');
  await sleep(70);
  up.push(' "kind": "ping"}\n\n');
  up.close();
  await drain;
  assert.ok(
    text.includes('id: 2\ndata: {"seq": 2, "kind": "ping"}\n\n'),
    'the split frame reaches the client contiguous',
  );
  assert.ok(text.endsWith(UPSTREAM_CLOSED_FRAME));
});

test('a frame cut off by the close is terminated before the close frame', async () => {
  const up = fakeUpstream();
  const out = relaySse(up.stream, { heartbeatMs: 60_000 });
  up.push('data: {"seq": 3');
  up.close();
  assert.equal(await readAll(out), HEARTBEAT_FRAME + 'data: {"seq": 3\n\n' + UPSTREAM_CLOSED_FRAME);
});

test('consumer cancel (browser gone) cancels upstream and runs onEnd once', async () => {
  const up = fakeUpstream();
  let ended = 0;
  const out = relaySse(up.stream, { heartbeatMs: 10, onEnd: () => ended++ });
  const reader = out.getReader();
  await reader.read();
  await reader.cancel();
  await sleep(30);
  assert.equal(up.state.cancelled, true);
  assert.equal(ended, 1);
});

test('signal abort closes the relay without the upstream-closed frame', async () => {
  const up = fakeUpstream();
  const abort = new AbortController();
  let ended = 0;
  const out = relaySse(up.stream, { heartbeatMs: 60_000, signal: abort.signal, onEnd: () => ended++ });
  up.push(FRAME);
  setTimeout(() => abort.abort(), 10);
  const text = await readAll(out);
  assert.equal(text, HEARTBEAT_FRAME + FRAME);
  assert.equal(up.state.cancelled, true);
  assert.equal(ended, 1);
});

test('an already-aborted signal ends at once', async () => {
  const up = fakeUpstream();
  const abort = new AbortController();
  abort.abort();
  let ended = 0;
  const out = relaySse(up.stream, { signal: abort.signal, onEnd: () => ended++ });
  assert.equal(await readAll(out), '');
  assert.equal(up.state.cancelled, true);
  assert.equal(ended, 1);
});

test('a consumer that stops reading without cancelling is dropped past maxBacklog', async () => {
  const up = fakeUpstream();
  let ended = 0;
  const out = relaySse(up.stream, { heartbeatMs: 60_000, maxBacklog: 3, onEnd: () => ended++ });
  // Nobody reads `out`: the connect heartbeat plus three frames fill the backlog.
  up.push(FRAME);
  up.push(FRAME);
  await sleep(10);
  assert.equal(ended, 0, 'three unread chunks are tolerated');
  up.push(FRAME);
  await sleep(10);
  assert.equal(ended, 1);
  assert.equal(up.state.cancelled, true);
  await assert.rejects(out.getReader().read(), /stopped reading/);
});
