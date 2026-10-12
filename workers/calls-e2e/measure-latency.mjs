#!/usr/bin/env node
// Measures call-pop latency through the command-center SSE relay
// (specs/calls-dashboard.md US-011). Opens <events-url> as an SSE client with a
// plain fetch reader, POSTs <ping-url>, and prints the milliseconds between the
// frame's `sent_at` (stamped by the Python service) and its receipt here. Only
// meaningful when this script and the Python service share a clock (same box).
//
// Usage:
//   node workers/calls-e2e/measure-latency.mjs <events-url> <ping-url> [--runs N]
//   node workers/calls-e2e/measure-latency.mjs \
//     http://localhost:3001/api/calls/events http://localhost:3001/api/calls/dev/ping --runs 5
//
// Optional env LATENCY_COOKIE is sent as the Cookie header on both requests
// (for example a Cloudflare Access `CF_Authorization=...` cookie); it is never
// printed. Without it, the tunnel measurement is the browser-console snippet in
// TUNNEL-LATENCY.md.

const args = process.argv.slice(2);
const runsAt = args.indexOf('--runs');
const runs = runsAt >= 0 ? Number(args.splice(runsAt, 2)[1]) : 1;
const [eventsUrl, pingUrl] = args;
if (!eventsUrl || !pingUrl || !Number.isInteger(runs) || runs < 1) {
  console.error('usage: measure-latency.mjs <events-url> <ping-url> [--runs N]');
  process.exit(2);
}

const headers = process.env.LATENCY_COOKIE ? { Cookie: process.env.LATENCY_COOKIE } : {};
const PING_RETRY_MS = 2000;
const GIVE_UP_MS = 15000;

/** Yields {event, data, comment} for each SSE frame on a fetch body. */
async function* frames(body) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buf += dec.decode(value, { stream: true }).replace(/\r\n?/g, '\n');
    let cut;
    while ((cut = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, cut);
      buf = buf.slice(cut + 2);
      const frame = { event: 'message', data: '', comment: '' };
      for (const line of block.split('\n')) {
        if (line.startsWith(':')) frame.comment += line.slice(1).trim();
        else if (line.startsWith('event:')) frame.event = line.slice(6).trim();
        else if (line.startsWith('data:')) frame.data += line.slice(5).replace(/^ /, '');
      }
      yield frame;
    }
  }
}

async function postPing() {
  const res = await fetch(pingUrl, { method: 'POST', headers });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`ping answered ${res.status}: ${JSON.stringify(body)}`);
  return body.seq;
}

async function measureOnce() {
  const abort = new AbortController();
  const giveUp = setTimeout(() => abort.abort(), GIVE_UP_MS);
  try {
    const res = await fetch(eventsUrl, {
      headers: { ...headers, Accept: 'text/event-stream' },
      signal: abort.signal,
    });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !type.startsWith('text/event-stream')) {
      throw new Error(`events answered ${res.status} ${type}: ${(await res.text()).slice(0, 200)}`);
    }
    const seqs = new Set();
    let retry;
    let done = false;
    // The relay's connect heartbeat proves the relay is up; the upstream
    // subscription may land a moment later, so the ping is re-sent until one
    // of ours comes back.
    const ping = async () => {
      if (done) return;
      seqs.add(await postPing());
      if (!done) retry = setTimeout(() => ping().catch(() => {}), PING_RETRY_MS);
    };
    let started = false;
    for await (const frame of frames(res.body)) {
      if (!started) {
        started = true;
        await ping();
      }
      if (frame.event === 'upstream-closed') throw new Error('upstream closed before the ping frame');
      if (!frame.data) continue;
      let payload;
      try {
        payload = JSON.parse(frame.data);
      } catch {
        continue;
      }
      if (payload.kind === 'ping' && seqs.has(payload.seq)) {
        done = true;
        clearTimeout(retry);
        return Date.now() - payload.sent_at * 1000;
      }
    }
    throw new Error('stream ended before the ping frame');
  } finally {
    clearTimeout(giveUp);
    abort.abort();
  }
}

const results = [];
for (let i = 0; i < runs; i++) {
  const ms = await measureOnce();
  results.push(ms);
  console.log(`run ${i + 1}: ${ms.toFixed(1)} ms`);
}
if (runs > 1) {
  const sorted = [...results].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  console.log(`median: ${median.toFixed(1)} ms over ${runs} runs`);
}
