import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parsePopFrame,
  prependPop,
  startCallStream,
  type CallStreamHandlers,
  type EventSourceLike,
  type StreamStatus,
} from './use-call-stream';

class FakeEventSource implements EventSourceLike {
  static instances: FakeEventSource[] = [];
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  frame(payload: unknown) {
    this.onmessage?.({ data: typeof payload === 'string' ? payload : JSON.stringify(payload) });
  }
  drop(closed = false) {
    this.readyState = closed ? 2 : 0;
    this.onerror?.({});
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
}

function setup() {
  FakeEventSource.instances = [];
  const log = { opens: 0, pops: [] as unknown[], pings: 0, statuses: [] as StreamStatus[] };
  const handlers: CallStreamHandlers = {
    onOpen: () => log.opens++,
    onPop: p => log.pops.push(p),
    onPing: () => log.pings++,
    onStatus: s => log.statuses.push(s),
  };
  const timers: { fn: () => void; ms: number; cleared: boolean }[] = [];
  const stop = startCallStream(handlers, {
    EventSourceImpl: FakeEventSource,
    retryMs: 5000,
    setTimeoutImpl: (fn, ms) => {
      const t = { fn, ms, cleared: false };
      timers.push(t);
      return t;
    },
    clearTimeoutImpl: h => {
      (h as { cleared: boolean }).cleared = true;
    },
  });
  return { log, stop, timers };
}

const matched = { seq: 1, kind: 'matched', call_id: '6001', number: '+15305550123', summary: 'Jane Buyer', contact_id: 7, stale: false };
const miss = { seq: 2, kind: 'miss', call_id: '6002', number: '+15305550199', summary: 'unknown caller' };

test('opens the relay URL and fetches recent calls on open', () => {
  const { log } = setup();
  assert.equal(FakeEventSource.instances.length, 1);
  assert.equal(FakeEventSource.instances[0].url, '/api/calls/events');
  assert.deepEqual(log.statuses, ['connecting']);
  assert.equal(log.opens, 0);
  FakeEventSource.instances[0].open();
  assert.equal(log.opens, 1);
  assert.deepEqual(log.statuses, ['connecting', 'open']);
});

test('pops go to onPop in arrival order and prependPop puts the newest first', () => {
  const { log } = setup();
  const es = FakeEventSource.instances[0];
  es.open();
  es.frame(matched);
  es.frame(miss);
  assert.deepEqual(log.pops, [matched, miss]);
  let list: unknown[] = [];
  for (const p of log.pops) list = prependPop(list, p);
  assert.deepEqual(list, [miss, matched]);
});

test('prependPop caps the list', () => {
  let list: number[] = [];
  for (let i = 0; i < 60; i++) list = prependPop(list, i);
  assert.equal(list.length, 50);
  assert.equal(list[0], 59);
  assert.deepEqual(prependPop([1, 2, 3], 0, 2), [0, 1]);
});

test('ping frames go to onPing, never to onPop; junk frames are ignored', () => {
  const { log } = setup();
  const es = FakeEventSource.instances[0];
  es.open();
  es.frame({ seq: 3, kind: 'ping', sent_at: 1760000000.5 });
  es.frame('not json');
  es.frame({ seq: 4 });
  assert.equal(log.pings, 1);
  assert.deepEqual(log.pops, []);
});

test('a dropped stream shows reconnecting and the reconnect re-fetches recent calls', () => {
  const { log, timers } = setup();
  const es = FakeEventSource.instances[0];
  es.open();
  es.drop();
  assert.equal(log.statuses.at(-1), 'reconnecting');
  assert.equal(timers.length, 0, 'the browser retries by itself while CONNECTING');
  es.open();
  assert.equal(log.opens, 2);
  assert.equal(log.statuses.at(-1), 'open');
  assert.equal(FakeEventSource.instances.length, 1);
});

test('when the browser gives up (CLOSED), a new EventSource opens after retryMs', () => {
  const { log, timers } = setup();
  const first = FakeEventSource.instances[0];
  first.drop(true);
  first.drop(true);
  assert.equal(timers.length, 1, 'one retry scheduled');
  assert.equal(timers[0].ms, 5000);
  assert.equal(first.closed, true);
  timers[0].fn();
  assert.equal(FakeEventSource.instances.length, 2);
  // late events from the old source are ignored
  first.frame(matched);
  assert.deepEqual(log.pops, []);
  FakeEventSource.instances[1].open();
  assert.equal(log.opens, 1);
  assert.equal(log.statuses.at(-1), 'open');
});

test('stop closes the source, clears a pending retry, and silences callbacks', () => {
  const { log, stop, timers } = setup();
  const es = FakeEventSource.instances[0];
  es.drop(true);
  stop();
  assert.equal(es.closed, true);
  assert.equal(timers[0].cleared, true);
  es.onopen?.({});
  es.frame(matched);
  assert.equal(log.opens, 0);
  assert.deepEqual(log.pops, []);
});

test('parsePopFrame', () => {
  assert.deepEqual(parsePopFrame(JSON.stringify(miss)), miss);
  assert.equal(parsePopFrame('{"kind": 3}'), null);
  assert.equal(parsePopFrame('null'), null);
  assert.equal(parsePopFrame(''), null);
});
