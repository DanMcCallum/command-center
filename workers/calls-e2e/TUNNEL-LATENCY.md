# Tunnel latency for call pops (operator step)

Measures how long a call pop takes to reach a browser through Cloudflare Access, the tunnel, and the `/api/calls/events` relay (specs/calls-dashboard.md US-011). Target: under 3 s. Locally (no tunnel) the median was under 10 ms; see `progress-calls-dashboard.txt`.

## Before you start

- The production Python service on 8100 must be running the build that has `/api/v1/*` (the restart under "Questions for Daniel" in the progress log).
- Production port 3000 must be serving a build that includes `/api/calls/events` and `/api/calls/dev/ping` (rebuild and restart of 3000 is an operator step).
- The ping is harmless: `POST /api/calls/dev/ping` publishes a `{kind: "ping"}` frame on the pop stream and writes nothing to the database or to Investment Dominator. An open `/calls` page ignores ping frames.

## Steps

1. Open `https://dashboard.ownaloha.land/calls` (or any dashboard page; the snippet only needs the Access session) and sign in through Access.
2. Open the browser console (F12, Console tab) and paste the snippet below.
3. It runs 5 pings, one every 2 s, and prints one line per ping plus the median. Paste the median line under "Tunnel latency" in `progress-calls-dashboard.txt`.

```js
(async () => {
  const runs = 5;
  const results = [];
  const arrived = new Map(); // seq -> {at: performance.now(), sentAt} for every ping frame seen
  let wake = () => {};
  const es = new EventSource('/api/calls/events');
  es.onmessage = (e) => {
    let p;
    try { p = JSON.parse(e.data); } catch { return; }
    if (p.kind !== 'ping') return;
    // Recorded on arrival: the frame can beat the ping POST's own response.
    arrived.set(p.seq, { at: performance.now(), sentAt: p.sent_at });
    wake();
  };
  es.addEventListener('upstream-closed', () => console.warn('relay says the call service closed the stream'));
  es.onerror = () => console.warn('stream error (EventSource will retry)');
  await new Promise((r) => (es.onopen = r));
  await new Promise((r) => setTimeout(r, 1000)); // let the relay subscribe upstream
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    const res = await fetch('/api/calls/dev/ping', { method: 'POST' });
    const body = await res.json();
    if (!res.ok) { console.error('ping failed', res.status, body); break; }
    const deadline = Date.now() + 10000;
    while (!arrived.has(body.seq) && Date.now() < deadline) {
      await new Promise((r) => { wake = r; setTimeout(r, 250); });
    }
    const m = arrived.get(body.seq);
    if (!m) { console.error(`run ${i + 1}: no ping frame within 10 s`); continue; }
    const roundTrip = m.at - t0;
    const sinceSent = Date.now() - (performance.now() - m.at) - m.sentAt * 1000;
    results.push(roundTrip);
    console.log(`run ${i + 1}: ${roundTrip.toFixed(0)} ms round trip (sent_at clock: ${sinceSent.toFixed(0)} ms)`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  es.close();
  const s = [...results].sort((a, b) => a - b);
  if (s.length) console.log(`median round trip: ${s[Math.floor(s.length / 2)].toFixed(0)} ms over ${s.length} runs`);
  else console.error('no runs completed');
})();
```

## Reading the numbers

- **Round trip** is measured on the browser's own clock: from sending the ping POST until the frame comes back on the stream. It includes the POST's own trip through the tunnel, so the real pop latency is lower. This is the number to report.
- **sent_at clock** compares the Python service's timestamp with the browser's clock. It is the true one-way latency only when the two clocks agree; a laptop a second off makes it meaningless (it can even go negative). Ignore it unless the round trip looks wrong.
- A run with "no ping frame within 10 s" while the POST succeeded means the stream is buffered somewhere between the browser and the relay (check that the response has `Content-Type: text/event-stream` in the Network tab and that nothing in front of the tunnel buffers it).

## From a shell instead

`workers/calls-e2e/measure-latency.mjs` does the same from Node (one-way, `sent_at` based, so only meaningful on the box that runs the Python service). Through Access it needs the `CF_Authorization` cookie in `LATENCY_COOKIE`:

```
LATENCY_COOKIE='CF_Authorization=...' node workers/calls-e2e/measure-latency.mjs \
  https://dashboard.ownaloha.land/api/calls/events https://dashboard.ownaloha.land/api/calls/dev/ping --runs 5
```
