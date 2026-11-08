/**
 * BuyWander nightly deal scan: storage, scoring and the phone push.
 *
 * The scan itself is a `claude -p --chrome` run (workers/buywander/run.sh)
 * that reads BuyWander and eBay in the operator's Chrome and writes a
 * BuywanderAgentOutput. The dashboard stores it as a BuywanderRun, remembers
 * every auction id it has seen so the next run only scores new lots, and
 * pushes the finds to the operator through ntfy. Nothing here talks to BuyWander or eBay.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { nowIso } from './utils';
import { readProjectEnvVar } from './project-env';
import {
  fmtCondition,
  fmtEnds,
  fmtMoney,
  fmtPct,
  DEFAULT_BID_RULE,
  type BuywanderAgentOutput,
  type BuywanderBidRule,
  type BuywanderFind,
  type BuywanderNotify,
  type BuywanderRun,
  type BuywanderSeen,
} from './buywander-types';
import { publishNtfy, type NtfyMessage } from './ntfy';
import { estimateShipping } from './shipping';

export * from './buywander-types';

const DATA_DIR = path.join(process.cwd(), 'data');
const RUNS_FILE = path.join(DATA_DIR, 'buywander-runs.json');
const SEEN_FILE = path.join(DATA_DIR, 'buywander-seen.json');

/** Keep the most recent runs on disk; older ones roll off. */
export const MAX_RUNS = 60;
/** Forget auction ids after this long; BuyWander lots close within days. */
export const SEEN_TTL_DAYS = 30;
export const NTFY_TOPIC_VAR = 'BUYWANDER_NTFY_TOPIC';
export const DEFAULT_DASHBOARD_PUBLIC_URL = 'https://dashboard.ownaloha.land';


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

export async function getRuns(): Promise<BuywanderRun[]> {
  return readJson<BuywanderRun[]>(RUNS_FILE, []);
}

export async function getSeen(): Promise<BuywanderSeen> {
  return readJson<BuywanderSeen>(SEEN_FILE, {});
}

/** Drop ids first seen more than SEEN_TTL_DAYS ago. Pure. */
export function pruneSeen(seen: BuywanderSeen, now: Date = new Date()): BuywanderSeen {
  const cutoff = now.getTime() - SEEN_TTL_DAYS * 86_400_000;
  const out: BuywanderSeen = {};
  for (const [id, iso] of Object.entries(seen)) {
    const t = Date.parse(iso);
    if (Number.isNaN(t) || t >= cutoff) out[id] = iso;
  }
  return out;
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Validates the agent's JSON. Returns the error message or null. Lenient on
 * optional fields, strict on the ones the table and the seen list depend on.
 */
export function validateAgentOutput(body: unknown): string | null {
  if (!isRecord(body)) return 'body must be an object';
  if (typeof body.scanned_at !== 'string') return 'scanned_at must be a string';
  if (typeof body.location !== 'string') return 'location must be a string';
  if (!Array.isArray(body.scanned_ids) || body.scanned_ids.some(x => typeof x !== 'string')) {
    return 'scanned_ids must be an array of strings';
  }
  if (!Array.isArray(body.finds)) return 'finds must be an array';
  for (const [i, f] of body.finds.entries()) {
    if (!isRecord(f)) return `finds[${i}] must be an object`;
    for (const key of ['auction_id', 'url', 'title', 'ends_at', 'condition', 'category']) {
      if (typeof f[key] !== 'string') return `finds[${i}].${key} must be a string`;
    }
    if (typeof f.retail_value !== 'number') return `finds[${i}].retail_value must be a number`;
    if (typeof f.current_bid !== 'number') return `finds[${i}].current_bid must be a number`;
    if (f.size_description !== undefined && f.size_description !== null && typeof f.size_description !== 'string') {
      return `finds[${i}].size_description must be a string or null`;
    }
    if (!isRecord(f.ebay)) return `finds[${i}].ebay must be an object`;
    if (f.ebay.median_sold !== null && typeof f.ebay.median_sold !== 'number') {
      return `finds[${i}].ebay.median_sold must be a number or null`;
    }
    if (typeof f.ebay.comp_count !== 'number') return `finds[${i}].ebay.comp_count must be a number`;
    if (typeof f.ebay.search_url !== 'string') return `finds[${i}].ebay.search_url must be a string`;
  }
  if (body.skipped !== undefined) {
    if (!Array.isArray(body.skipped)) return 'skipped must be an array';
    for (const [i, s] of body.skipped.entries()) {
      if (!isRecord(s) || typeof s.auction_id !== 'string' || typeof s.title !== 'string') {
        return `skipped[${i}] needs auction_id and title`;
      }
    }
  }
  return null;
}

/** Median of a list; null for an empty list. Pure. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Suggested maximum bid under a rule. Pure. Shipping is deliberately left
 * out: a heavy lot may be sold locally, so the estimate is shown beside the
 * bid instead of capping it.
 *   net resale = median * (1 - ebay_fee_rate)
 *   max_bid * (1 + buyer_cost_rate) = net resale * (1 - target_margin)
 * Floored to whole dollars; never below 0.
 */
export function suggestedMaxBid(median: number, rule: BuywanderBidRule = DEFAULT_BID_RULE): number {
  const net = median * (1 - rule.ebay_fee_rate);
  const bid = (net * (1 - rule.target_margin)) / (1 + rule.buyer_cost_rate);
  return Math.max(0, Math.floor(bid));
}

/** Fills shipping, spread, margin and max_bid from the lot and its eBay median. Pure. */
export function scoreFind(find: BuywanderFind, rule: BuywanderBidRule = DEFAULT_BID_RULE): BuywanderFind {
  const est = estimateShipping(find.size_description, rule.shipping_multiplier);
  let shipping = est.cost;
  let shippingNote = est.note;
  if (shipping === null && est.billable_lbs === null) {
    shipping = rule.default_shipping;
    shippingNote = `${est.note}; assuming ${fmtMoney(rule.default_shipping)}`;
  }
  const base = { ...find, shipping_est: shipping, shipping_note: shippingNote };
  const med = find.ebay.median_sold;
  if (med === null || med <= 0) return { ...base, spread: null, margin: null, max_bid: null };
  const spread = round2(med - find.current_bid);
  return { ...base, spread, margin: round2(spread / med), max_bid: suggestedMaxBid(med, rule) };
}

/** Reads rule overrides from the root .env.local; falls back per field. */
export function bidRuleFromEnv(): BuywanderBidRule {
  const num = (name: string, fallback: number) => {
    const raw = readProjectEnvVar(name);
    const v = raw === null ? NaN : Number(raw);
    return Number.isFinite(v) && v >= 0 && v < 1 ? v : fallback;
  };
  const pos = (name: string, fallback: number) => {
    const raw = readProjectEnvVar(name);
    const v = raw === null ? NaN : Number(raw);
    return Number.isFinite(v) && v >= 0 ? v : fallback;
  };
  return {
    ebay_fee_rate: num('BUYWANDER_EBAY_FEE_RATE', DEFAULT_BID_RULE.ebay_fee_rate),
    target_margin: num('BUYWANDER_TARGET_MARGIN', DEFAULT_BID_RULE.target_margin),
    buyer_cost_rate: num('BUYWANDER_BUYER_COST_RATE', DEFAULT_BID_RULE.buyer_cost_rate),
    shipping_multiplier: pos('BUYWANDER_SHIPPING_MULTIPLIER', DEFAULT_BID_RULE.shipping_multiplier),
    default_shipping: pos('BUYWANDER_DEFAULT_SHIPPING', DEFAULT_BID_RULE.default_shipping),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Best spread first; finds without comps sink to the bottom. Pure. */
export function sortFinds(finds: BuywanderFind[]): BuywanderFind[] {
  return [...finds].sort((a, b) => {
    const sa = a.spread ?? -Infinity;
    const sb = b.spread ?? -Infinity;
    if (sa !== sb) return sb - sa;
    return b.retail_value - a.retail_value;
  });
}

/** Skip reason the agent uses when a lot was left unpriced only by the per-run cap. */
export const OVER_MAX_REASON = 'over max';

/**
 * Which auction ids a run settles: the lots it priced and the lots it skipped
 * for cause. Lots skipped as "over max" stay unseen so a later run prices
 * them. Pure.
 */
export function idsToRemember(output: BuywanderAgentOutput): string[] {
  const ids = new Set<string>();
  for (const f of output.finds) ids.add(f.auction_id);
  for (const s of output.skipped ?? []) {
    if (s.reason.trim().toLowerCase() !== OVER_MAX_REASON) ids.add(s.auction_id);
  }
  return [...ids];
}

/**
 * Stores a run: scores the finds, counts which scanned ids were new, merges
 * the settled ids into the seen list. Returns the stored run (without the
 * push result filled in; the route sets that after notifying).
 */
export async function recordRun(output: BuywanderAgentOutput, rule: BuywanderBidRule = DEFAULT_BID_RULE): Promise<BuywanderRun> {
  return serialize(async () => {
    const seen = pruneSeen(await getSeen());
    const now = nowIso();
    const newCount = output.scanned_ids.filter(id => !(id in seen)).length;
    for (const id of idsToRemember(output)) {
      if (!(id in seen)) seen[id] = now;
    }
    const run: BuywanderRun = {
      ...output,
      finds: sortFinds(output.finds.map(f => scoreFind(f, rule))),
      bid_rule: rule,
      skipped: output.skipped ?? [],
      id: `bw-${now.replace(/[-:.TZ]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`,
      received_at: now,
      new_count: newCount,
      notify: { sent: false, channel: 'ntfy', error: null },
    };
    const runs = [run, ...(await getRuns())].slice(0, MAX_RUNS);
    await writeJson(SEEN_FILE, seen);
    await writeJson(RUNS_FILE, runs);
    return run;
  });
}

export async function updateRunNotify(id: string, notify: BuywanderNotify): Promise<void> {
  await serialize(async () => {
    const runs = await getRuns();
    const idx = runs.findIndex(r => r.id === id);
    if (idx === -1) return;
    runs[idx] = { ...runs[idx], notify };
    await writeJson(RUNS_FILE, runs);
  });
}

// --- Push notification -------------------------------------------------------

/** Lines for the ntfy push: a headline count plus the top finds by spread. Pure. */
export function ntfyMessage(run: BuywanderAgentOutput, dashboardUrl = DEFAULT_DASHBOARD_PUBLIC_URL, rule: BuywanderBidRule = DEFAULT_BID_RULE): NtfyMessage {
  const finds = sortFinds(run.finds.map(f => scoreFind(f, rule)));
  const n = finds.length;
  const priced = finds.filter(f => f.spread !== null && f.spread !== undefined);
  const lines = priced.slice(0, 5).map(f => {
    const title = f.title.length > 48 ? f.title.slice(0, 47).trimEnd() + '…' : f.title;
    return `${title}: eBay ${fmtMoney(f.ebay.median_sold)} vs bid ${fmtMoney(f.current_bid)}, spread ${fmtMoney(f.spread)} (${fmtPct(f.margin)}), ship ${f.shipping_est === null ? 'freight' : fmtMoney(f.shipping_est)}, max bid ${f.max_bid === null ? 'n/a' : fmtMoney(f.max_bid)}`;
  });
  const unpriced = n - priced.length;
  if (unpriced > 0) lines.push(`${unpriced} more with no eBay comps`);
  if (priced.length > 5) lines.push(`${priced.length - 5} more priced, see Deals`);
  const best = priced[0];
  return {
    title: `BuyWander ${run.location}: ${n} new ${n === 1 ? 'lot' : 'lots'} over $400`,
    body: lines.join('\n') || `${n} lots, none with eBay comps`,
    click: `${dashboardUrl.replace(/\/+$/, '')}/deals`,
    priority: best && (best.margin ?? 0) >= 0.5 ? 4 : 3,
    tags: ['moneybag'],
  };
}

/** Pushes the run summary; the route records success or the error on the run. */
export async function notifyRun(run: BuywanderAgentOutput, rule: BuywanderBidRule = DEFAULT_BID_RULE): Promise<void> {
  const base = readProjectEnvVar('DASHBOARD_PUBLIC_URL') ?? DEFAULT_DASHBOARD_PUBLIC_URL;
  await publishNtfy(NTFY_TOPIC_VAR, ntfyMessage(run, base, rule));
}
