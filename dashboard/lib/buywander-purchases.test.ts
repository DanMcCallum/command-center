import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, test } from 'node:test';

let dir: string;
let mod: typeof import('./buywander-purchases');

const find = (auction_id: string, over: Record<string, unknown> = {}) => ({
  auction_id,
  url: `https://buywander.com/auctions?auctionId=${auction_id}`,
  title: `Lot ${auction_id}`,
  retail_value: 500,
  current_bid: 40,
  ends_at: '2026-11-10T02:02:00+00:00',
  condition: 'AppearsNew',
  category: 'Furniture',
  bwsku: `SLC-${auction_id}`,
  size_description: null,
  ebay: { median_sold: 300, comp_count: 3, match: 'exact', search_url: 'https://www.ebay.com/sch/i.html?_nkw=x' },
  shipping_est: 25,
  spread: 260,
  margin: 0.87,
  max_bid: 150,
  ...over,
});

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bw-purchases-'));
  process.env.BUYWANDER_PURCHASES_FILE = path.join(dir, 'purchases.json');
  process.env.BUYWANDER_RUNS_FILE = path.join(dir, 'runs.json');
  await fs.writeFile(
    process.env.BUYWANDER_RUNS_FILE,
    JSON.stringify([
      { id: 'run-new', finds: [find('a1'), find('shared', { title: 'Newer copy' })] },
      { id: 'run-old', finds: [find('b1', { bwsku: undefined }), find('shared', { title: 'Older copy' })] },
    ]),
  );
  mod = await import('./buywander-purchases');
});

beforeEach(async () => {
  await fs.rm(process.env.BUYWANDER_PURCHASES_FILE!, { force: true });
});

after(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

test('findLot searches newest run first and returns null for unknown ids', async () => {
  const shared = await mod.findLot('shared');
  assert.equal(shared?.run_id, 'run-new');
  assert.equal(shared?.find.title, 'Newer copy');
  assert.equal((await mod.findLot('b1'))?.run_id, 'run-old');
  assert.equal(await mod.findLot('nope'), null);
});

test('recordPurchase copies lot fields and stores newest first', async () => {
  const p = await mod.recordPurchase({ auction_id: 'a1', paid_usd: 42, notes: 'won on the phone' });
  assert.equal(p.auction_id, 'a1');
  assert.equal(p.run_id, 'run-new');
  assert.equal(p.paid_usd, 42);
  assert.equal(p.title, 'Lot a1');
  assert.equal(p.bwsku, 'SLC-a1');
  assert.equal(p.category, 'Furniture');
  assert.equal(p.condition, 'AppearsNew');
  assert.equal(p.retail_value, 500);
  assert.equal(p.size_description, null);
  assert.equal(p.ebay?.median_sold, 300);
  assert.equal(p.shipping_est, 25);
  assert.equal(p.notes, 'won on the phone');
  assert.equal(p.task_id, null);
  assert.ok(!Number.isNaN(Date.parse(p.purchased_at)));

  const second = await mod.recordPurchase({ auction_id: 'b1' });
  assert.equal(second.bwsku, null);
  assert.equal(second.paid_usd, null);
  assert.equal(second.notes, '');
  const all = await mod.getPurchases();
  assert.deepEqual(all.map(x => x.auction_id), ['b1', 'a1']);
  assert.equal((await mod.getPurchase('a1'))?.paid_usd, 42);
  assert.equal(await mod.getPurchase('zzz'), null);
});

test('recordPurchase is idempotent', async () => {
  const first = await mod.recordPurchase({ auction_id: 'a1', paid_usd: 10 });
  const again = await mod.recordPurchase({ auction_id: 'a1', paid_usd: 999, notes: 'changed' });
  assert.deepEqual(again, first);
  assert.equal((await mod.getPurchases()).length, 1);
});

test('recordPurchase throws LotNotFoundError for an id in no run', async () => {
  await assert.rejects(mod.recordPurchase({ auction_id: 'missing' }), mod.LotNotFoundError);
  assert.equal((await mod.getPurchases()).length, 0);
});

test('updatePurchase patches only paid_usd, notes and task_id', async () => {
  await mod.recordPurchase({ auction_id: 'a1' });
  const updated = await mod.updatePurchase('a1', { paid_usd: 55, task_id: 'task-1', notes: 'n' });
  assert.equal(updated?.paid_usd, 55);
  assert.equal(updated?.task_id, 'task-1');
  assert.equal(updated?.notes, 'n');
  assert.equal(updated?.title, 'Lot a1');
  const cleared = await mod.updatePurchase('a1', { paid_usd: null, task_id: null });
  assert.equal(cleared?.paid_usd, null);
  assert.equal(cleared?.task_id, null);
  assert.equal(cleared?.notes, 'n');
  assert.equal(await mod.updatePurchase('missing', { paid_usd: 1 }), null);
});

test('deletePurchase removes the record and reports a missing one', async () => {
  await mod.recordPurchase({ auction_id: 'a1' });
  await mod.recordPurchase({ auction_id: 'b1' });
  assert.equal(await mod.deletePurchase('a1'), true);
  assert.deepEqual((await mod.getPurchases()).map(x => x.auction_id), ['b1']);
  assert.equal(await mod.deletePurchase('a1'), false);
});

test('concurrent records serialize without losing writes', async () => {
  await Promise.all([
    mod.recordPurchase({ auction_id: 'a1' }),
    mod.recordPurchase({ auction_id: 'b1' }),
    mod.recordPurchase({ auction_id: 'shared' }),
  ]);
  assert.equal((await mod.getPurchases()).length, 3);
});
