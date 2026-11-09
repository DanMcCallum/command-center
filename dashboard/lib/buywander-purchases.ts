/**
 * BuyWander purchases: lots the operator won, marked from /deals.
 *
 * Each record copies the lot's fields out of the run it was found in, so it
 * keeps its title, comps and shipping estimate after the run rolls off.
 * The ad builder (/item-ad-builder?auction_id=...) reads these records and
 * writes back task_id once it has created a task.
 *
 * Paths come from BUYWANDER_PURCHASES_FILE and BUYWANDER_RUNS_FILE when set
 * (tests point them at a temp dir); otherwise data/ under the cwd, the same
 * files lib/buywander.ts uses.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { nowIso } from './utils';
import type { BuywanderFind, BuywanderPurchase, BuywanderRun } from './buywander-types';

export type { BuywanderPurchase } from './buywander-types';

function purchasesFile(): string {
  return process.env.BUYWANDER_PURCHASES_FILE || path.join(process.cwd(), 'data', 'buywander-purchases.json');
}

function runsFile(): string {
  return process.env.BUYWANDER_RUNS_FILE || path.join(process.cwd(), 'data', 'buywander-runs.json');
}

let writeChain: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeChain.then(fn, fn);
  writeChain = next.catch(() => undefined);
  return next;
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw err;
  }
}

async function writeJson(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  await fs.rename(tmp, file);
}

/** Every purchase, newest first. */
export async function getPurchases(): Promise<BuywanderPurchase[]> {
  const list = await readJson<BuywanderPurchase[]>(purchasesFile(), []);
  return Array.isArray(list) ? list : [];
}

export async function getPurchase(auctionId: string): Promise<BuywanderPurchase | null> {
  return (await getPurchases()).find(p => p.auction_id === auctionId) ?? null;
}

/** Finds a lot across all stored runs, newest run first. */
export async function findLot(auctionId: string): Promise<{ find: BuywanderFind; run_id: string } | null> {
  const runs = await readJson<BuywanderRun[]>(runsFile(), []);
  if (!Array.isArray(runs)) return null;
  for (const run of runs) {
    const find = (run.finds ?? []).find(f => f.auction_id === auctionId);
    if (find) return { find, run_id: run.id };
  }
  return null;
}

export class LotNotFoundError extends Error {
  constructor(auctionId: string) {
    super(`Lot ${auctionId} is not in any stored run`);
    this.name = 'LotNotFoundError';
  }
}

export interface RecordPurchaseInput {
  auction_id: string;
  run_id?: string | null;
  paid_usd?: number | null;
  notes?: string;
}

/** Builds the stored record from a lot. Pure. */
export function purchaseFromFind(find: BuywanderFind, input: RecordPurchaseInput, runId: string | null, purchasedAt: string): BuywanderPurchase {
  return {
    auction_id: find.auction_id,
    run_id: input.run_id ?? runId,
    purchased_at: purchasedAt,
    paid_usd: typeof input.paid_usd === 'number' && Number.isFinite(input.paid_usd) ? input.paid_usd : null,
    title: find.title,
    url: find.url,
    bwsku: find.bwsku ?? null,
    category: find.category ?? null,
    condition: find.condition ?? null,
    retail_value: typeof find.retail_value === 'number' ? find.retail_value : null,
    size_description: find.size_description ?? null,
    ebay: find.ebay ?? null,
    shipping_est: find.shipping_est ?? null,
    notes: input.notes ?? '',
    task_id: null,
  };
}

/**
 * Records a won lot. Idempotent: an existing record is returned unchanged.
 * Throws LotNotFoundError when no run holds the auction id.
 */
export async function recordPurchase(input: RecordPurchaseInput): Promise<BuywanderPurchase> {
  return serialize(async () => {
    const purchases = await getPurchases();
    const existing = purchases.find(p => p.auction_id === input.auction_id);
    if (existing) return existing;
    const lot = await findLot(input.auction_id);
    if (!lot) throw new LotNotFoundError(input.auction_id);
    const purchase = purchaseFromFind(lot.find, input, lot.run_id, nowIso());
    await writeJson(purchasesFile(), [purchase, ...purchases]);
    return purchase;
  });
}

export type PurchasePatch = Partial<Pick<BuywanderPurchase, 'paid_usd' | 'notes' | 'task_id'>>;

/** Applies paid_usd, notes and task_id; other keys are ignored. Null when missing. */
export async function updatePurchase(auctionId: string, patch: PurchasePatch): Promise<BuywanderPurchase | null> {
  return serialize(async () => {
    const purchases = await getPurchases();
    const idx = purchases.findIndex(p => p.auction_id === auctionId);
    if (idx === -1) return null;
    const next = { ...purchases[idx] };
    if ('paid_usd' in patch) next.paid_usd = typeof patch.paid_usd === 'number' && Number.isFinite(patch.paid_usd) ? patch.paid_usd : null;
    if ('notes' in patch) next.notes = typeof patch.notes === 'string' ? patch.notes : '';
    if ('task_id' in patch) next.task_id = typeof patch.task_id === 'string' && patch.task_id ? patch.task_id : null;
    purchases[idx] = next;
    await writeJson(purchasesFile(), purchases);
    return next;
  });
}

/** True when a record was removed. */
export async function deletePurchase(auctionId: string): Promise<boolean> {
  return serialize(async () => {
    const purchases = await getPurchases();
    const remaining = purchases.filter(p => p.auction_id !== auctionId);
    if (remaining.length === purchases.length) return false;
    await writeJson(purchasesFile(), remaining);
    return true;
  });
}
