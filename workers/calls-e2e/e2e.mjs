#!/usr/bin/env node
// Browser steps for the /calls e2e (specs/calls-dashboard.md US-018). Run by
// workers/calls-e2e/run.sh, which starts the stack and passes:
//   E2E_BASE        command center dev server, http://localhost:3001
//   E2E_PY_BASE     e2e runner, http://127.0.0.1:8101
//   E2E_SESSION     session token the runner printed (for POST /dev/replay)
//   E2E_RECORD_LOG  the runner's fake ID write log (JSON lines)
//   E2E_PY_PID      the runner's pid (the last step kills it)
//   E2E_SHOTS       directory for a screenshot when a step fails
// Prints PASS/FAIL per step; after the first failure the rest print SKIP.
// Exit code 1 on any failure.

import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require(path.resolve(here, '../posting/node_modules/playwright'));

const env = name => {
  const v = process.env[name];
  if (!v) {
    console.error(`missing ${name}`);
    process.exit(2);
  }
  return v;
};
const BASE = env('E2E_BASE');
const PY_BASE = env('E2E_PY_BASE');
const SESSION = env('E2E_SESSION');
const RECORD_LOG = env('E2E_RECORD_LOG');
const PY_PID = Number(env('E2E_PY_PID'));
const SHOTS = process.env.E2E_SHOTS || '/tmp';

const MATCHED_NUMBER = '+15305550123';
const MISS_NUMBER = '+15305550199';
const run = Date.now().toString(36);

const sleep = ms => new Promise(r => setTimeout(r, ms));

function writes(kind) {
  if (!existsSync(RECORD_LOG)) return [];
  return readFileSync(RECORD_LOG, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line))
    .filter(w => w.kind === kind);
}

async function waitFor(check, timeoutMs, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await check();
    if (v) return v;
    if (Date.now() > deadline) return null;
    await sleep(intervalMs);
  }
}

async function replay(event) {
  const r = await fetch(`${PY_BASE}/dev/replay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `fud_session=${SESSION}` },
    body: JSON.stringify(event),
  });
  if (!r.ok) throw new Error(`/dev/replay answered ${r.status}`);
}

function ringing(callId, number) {
  return { call_id: callId, state: 'ringing', direction: 'inbound', external_number: number, internal_number: '+18085550100' };
}

/** Loads /calls and waits until the strip is green and the stream is open. */
async function openCalls(page) {
  await page.goto(`${BASE}/calls`);
  const strip = page.getByTestId('calls-ops-strip');
  await page.locator('[data-testid=calls-ops-strip][data-state=ok]').waitFor({ timeout: 30000 });
  const open = await waitFor(async () => !/connecting/.test(await strip.innerText()), 15000);
  if (!open) throw new Error('stream never opened (strip still says connecting)');
}

const steps = [];
const step = (name, fn) => steps.push({ name, fn });

const matchedCall = `e2e-${run}-matched`;
const missCall = `e2e-${run}-miss`;
const noteText = `E2E synthetic note ${run}`;

step('load /calls: strip green, stream open', async page => {
  await openCalls(page);
  return 'ok';
});

step(`ringing from ${MATCHED_NUMBER} pops matched within 5 s`, async page => {
  const t0 = Date.now();
  await replay(ringing(matchedCall, MATCHED_NUMBER));
  await page.locator(`[data-testid=call-pop][data-call-id="${matchedCall}"][data-kind=matched]`).waitFor({ timeout: 5000 });
  return `${Date.now() - t0} ms`;
});

step('note on the pop: exactly one create_task with the note, page shows the fake task id within 15 s', async page => {
  const pop = page.locator(`[data-testid=call-pop][data-call-id="${matchedCall}"]`);
  await pop.getByRole('button', { name: 'Log note' }).click();
  await pop.locator('textarea[name=note]').fill(noteText);
  const t0 = Date.now();
  await pop.getByRole('button', { name: 'Save note' }).click();
  const task = pop.getByTestId('call-note-task');
  await task.waitFor({ timeout: 15000 });
  const text = (await task.innerText()).trim();
  const id = text.match(/ID task (\d+)/)?.[1];
  if (!id) throw new Error(`task line without an id: ${text}`);
  const found = await waitFor(() => writes('create_task').filter(w => String(w.payload?.description ?? '').includes(noteText)), 15000 - (Date.now() - t0));
  const all = writes('create_task');
  if (!found || found.length !== 1 || all.length !== 1) {
    throw new Error(`create_task lines with the note: ${found?.length ?? 0}, total: ${all.length}`);
  }
  if (found[0].payload.contact_id !== 7) throw new Error(`task contact_id ${found[0].payload.contact_id}, want 7`);
  return `"${text}" after ${Date.now() - t0} ms, 1 create_task`;
});

step('search "Jane" and open the contact record', async page => {
  await page.goto(`${BASE}/calls/search`);
  await page.locator('input[name=q]').fill('Jane');
  await page.locator('input[name=q]').press('Enter');
  const table = page.getByTestId('calls-search-records');
  await table.waitFor({ timeout: 15000 });
  const row = await table.innerText();
  if (!/Jane Buyer/.test(row)) throw new Error(`search table lacks Jane Buyer: ${row}`);
  await table.locator('a[href="/calls/record/contact/7"]').first().click();
  await page.waitForURL(`${BASE}/calls/record/contact/7`, { timeout: 15000 });
  const fields = page.getByTestId('calls-record-fields');
  await fields.waitFor({ timeout: 15000 });
  if (!/Jane/.test(await fields.innerText())) throw new Error('record fields lack Jane');
  return 'contact 7 record page';
});

step(`attribute a miss from ${MISS_NUMBER} to "Test Meadow": one create_contact`, async page => {
  await openCalls(page);
  await replay(ringing(missCall, MISS_NUMBER));
  const pop = page.locator(`[data-testid=call-pop][data-call-id="${missCall}"][data-kind=miss]`);
  await pop.waitFor({ timeout: 5000 });
  await pop.getByRole('link', { name: 'Attribute caller' }).click();
  await page.getByTestId('calls-attribute-prompt').waitFor({ timeout: 15000 });
  await page.locator('input[name=q]').fill('Test Meadow');
  await page.getByRole('button', { name: 'Search nicknames' }).click();
  const form = page.locator('[data-testid=calls-attribute-form][data-slug=test-meadow]');
  await form.waitFor({ timeout: 15000 });
  await form.locator('input[name=caller_fname]').fill('Synthetic');
  await form.locator('input[name=caller_lname]').fill('Caller');
  await form.getByRole('button').click();
  await page.getByTestId('calls-attribute-done').waitFor({ timeout: 15000 });
  const property = await page.getByTestId('calls-attribute-property').getAttribute('href');
  if (property !== '/calls/record/property/5692') throw new Error(`property link ${property}`);
  const contacts = await waitFor(() => (writes('create_contact').length ? writes('create_contact') : null), 5000);
  if (!contacts || contacts.length !== 1) throw new Error(`create_contact lines: ${contacts?.length ?? 0}`);
  if (contacts[0].payload.phone !== MISS_NUMBER) throw new Error(`create_contact phone ${contacts[0].payload.phone}`);
  return `contact ${await page.getByTestId('calls-attribute-contact').innerText()}, property 5692`;
});

step('dial for property 5692 records an intent', async page => {
  await page.goto(`${BASE}/calls/dial?property_id=5692&phone=${encodeURIComponent(MISS_NUMBER)}`);
  await page.getByTestId('calls-dial-nickname').waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'Record intent' }).click();
  const done = page.getByTestId('calls-dial-done');
  await done.waitFor({ timeout: 15000 });
  const intent = await done.getAttribute('data-intent-id');
  if (!intent) throw new Error('no intent id');
  return `intent ${intent}`;
});

step('/calls/ops: strip green', async page => {
  await page.goto(`${BASE}/calls/ops`);
  const strip = page.locator('[data-testid=calls-ops-strip][data-state=ok]');
  await strip.waitFor({ timeout: 15000 });
  const levels = await strip.locator('[data-level]').evaluateAll(els => els.map(e => `${e.getAttribute('title')}=${e.getAttribute('data-level')}`));
  if (!levels.length || levels.some(l => !l.endsWith('=ok'))) throw new Error(`badges ${levels.join(', ')}`);
  return levels.join(', ');
});

step('stop the Python runner: strip shows unreachable within 35 s', async page => {
  // SIGKILL: SIGTERM leaves the runner serving open SSE streams.
  process.kill(PY_PID, 'SIGKILL');
  const t0 = Date.now();
  await page.getByTestId('calls-unreachable').waitFor({ timeout: 35000 });
  return `${Date.now() - t0} ms: ${(await page.getByTestId('calls-unreachable').innerText()).trim()}`;
});

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));

let failed = false;
for (const s of steps) {
  if (failed) {
    console.log(`SKIP ${s.name}`);
    continue;
  }
  try {
    const detail = await s.fn(page);
    console.log(`PASS ${s.name}${detail ? ` (${detail})` : ''}`);
  } catch (err) {
    failed = true;
    const shot = path.join(SHOTS, `calls-e2e-fail-${run}.png`);
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    console.log(`FAIL ${s.name}: ${String(err?.message ?? err).split('\n')[0]} (screenshot ${shot})`);
  }
}
if (pageErrors.length) {
  failed = true;
  console.log(`FAIL no page errors: ${pageErrors.slice(0, 3).join(' | ')}`);
} else {
  console.log('PASS no page errors');
}

await browser.close();
process.exit(failed ? 1 : 0);
