'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  fmtCondition,
  fmtEnds,
  fmtMoney,
  fmtPct,
  type BuywanderFind,
  type BuywanderPurchase,
  type BuywanderRun,
} from '@/lib/buywander-types';
import { formatRelative } from '@/lib/utils';

const BTN_SMALL = 'text-xs px-2 py-1 rounded bg-[#2F2F2F] text-[#D4D4D4] hover:bg-[#3A3A3A] disabled:opacity-60 disabled:cursor-default';

/** Asks for a dollar amount; null for blank or cancel. */
function promptPrice(label: string, current: number | null | undefined): number | null | undefined {
  const raw = window.prompt(label, current === null || current === undefined ? '' : String(current));
  if (raw === null) return undefined;
  const cleaned = raw.replace(/[$,\s]/g, '');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export default function DealsPage() {
  const [runs, setRuns] = useState<BuywanderRun[]>([]);
  const [purchases, setPurchases] = useState<BuywanderPurchase[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/buywander/runs', { cache: 'no-store' }).then(r => r.json()).catch(() => []),
      fetch('/api/buywander/purchases', { cache: 'no-store' }).then(r => r.json()).catch(() => ({ purchases: [] })),
    ])
      .then(([data, bought]: [BuywanderRun[], { purchases?: BuywanderPurchase[] }]) => {
        setRuns(Array.isArray(data) ? data : []);
        setPurchases(Array.isArray(bought?.purchases) ? bought.purchases : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const upsertPurchase = useCallback((p: BuywanderPurchase) => {
    setPurchases(prev => {
      const rest = prev.filter(x => x.auction_id !== p.auction_id);
      return [p, ...rest].sort((a, b) => Date.parse(b.purchased_at) - Date.parse(a.purchased_at));
    });
  }, []);

  const markBought = useCallback(async (find: BuywanderFind, runId: string) => {
    // BuyWander's settled finalAmount beats the bid the scan saw; fall back quietly.
    let paidDefault: number | null | undefined = find.current_bid;
    try {
      const lotRes = await fetch(`/api/buywander/lot/${encodeURIComponent(find.auction_id)}`);
      if (lotRes.ok) {
        const { lot } = (await lotRes.json()) as { lot?: { final_amount?: number | null } };
        if (typeof lot?.final_amount === 'number') paidDefault = lot.final_amount;
      }
    } catch {
      // ignore
    }
    const paid = promptPrice('Price paid (blank if unknown)', paidDefault);
    if (paid === undefined) return;
    const res = await fetch('/api/buywander/purchases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auction_id: find.auction_id, run_id: runId, paid_usd: paid }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      window.alert(`Could not record the purchase: ${err.error ?? res.status}`);
      return;
    }
    const { purchase } = (await res.json()) as { purchase: BuywanderPurchase };
    upsertPurchase(purchase);
  }, [upsertPurchase]);

  const editPrice = useCallback(async (p: BuywanderPurchase) => {
    const paid = promptPrice('Price paid (blank to clear)', p.paid_usd);
    if (paid === undefined) return;
    const res = await fetch(`/api/buywander/purchases/${encodeURIComponent(p.auction_id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paid_usd: paid }),
    });
    if (!res.ok) {
      window.alert(`Could not update the price (${res.status})`);
      return;
    }
    const { purchase } = (await res.json()) as { purchase: BuywanderPurchase };
    upsertPurchase(purchase);
  }, [upsertPurchase]);

  const removePurchase = useCallback(async (p: BuywanderPurchase) => {
    if (!window.confirm(`Remove "${p.title}" from purchased lots?`)) return;
    const res = await fetch(`/api/buywander/purchases/${encodeURIComponent(p.auction_id)}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) {
      window.alert(`Could not remove the purchase (${res.status})`);
      return;
    }
    setPurchases(prev => prev.filter(x => x.auction_id !== p.auction_id));
  }, []);

  const boughtIds = new Set(purchases.map(p => p.auction_id));

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <div className="flex items-baseline gap-3">
          <h1 className="text-3xl font-bold">Deals</h1>
          {!loading && (
            <span className="text-sm font-mono text-[#6B6B6B]">
              {runs.length} {runs.length === 1 ? 'scan' : 'scans'}
            </span>
          )}
        </div>
        <p className="text-sm text-[#6B6B6B] max-w-2xl">
          Nightly BuyWander scan at 5pm Mountain: new lots with a retail value
          over $400, priced against eBay sold comps (a &quot;loose&quot; tag means
          the same brand and product type, not the exact model). Spread is the eBay median
          minus the current bid. Ship est is a UPS Ground planning number from the
          lot&apos;s listed size and weight (hover a value for the billable weight).
          Max bid is the eBay median net of eBay fees, less the target margin,
          divided by the pickup cost rate (hover the column for the rates);
          shipping is shown but not subtracted, since some lots sell locally.
          Times are Mountain.
        </p>
      </header>

      {!loading && (
        <PurchasedSection purchases={purchases} onEditPrice={editPrice} onRemove={removePurchase} />
      )}

      {loading ? (
        <div className="text-sm text-[#6B6B6B]">Loading…</div>
      ) : runs.length === 0 ? (
        <div className="border border-dashed border-[#2F2F2F] rounded-lg py-16 text-center">
          <div className="text-sm text-[#6B6B6B]">
            No scans yet. The first one lands after the 5pm run, or start one with{' '}
            <code className="font-mono text-[#D4D4D4]">workers/buywander/run.sh --now</code>.
          </div>
        </div>
      ) : (
        <div className="space-y-10">
          {runs.map(run => (
            <RunSection key={run.id} run={run} boughtIds={boughtIds} onBought={markBought} />
          ))}
        </div>
      )}
    </div>
  );
}

function PurchasedSection({
  purchases,
  onEditPrice,
  onRemove,
}: {
  purchases: BuywanderPurchase[];
  onEditPrice: (p: BuywanderPurchase) => void;
  onRemove: (p: BuywanderPurchase) => void;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline gap-3">
        <h2 className="text-lg font-semibold">Purchased</h2>
        {purchases.length > 0 && (
          <span className="text-xs font-mono text-[#6B6B6B]">
            {purchases.length} {purchases.length === 1 ? 'lot' : 'lots'}
          </span>
        )}
      </div>
      {purchases.length === 0 ? (
        <p className="text-sm text-[#6B6B6B]">No purchased lots yet. Mark a lot Bought below after you win it.</p>
      ) : (
        <div className="overflow-x-auto border border-[#2F2F2F] rounded-lg">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-[#6B6B6B] bg-[#1F1F1F]">
              <tr>
                <th className="px-3 py-2 font-medium">Item</th>
                <th className="px-3 py-2 font-medium">SKU</th>
                <th className="px-3 py-2 font-medium text-right">Paid</th>
                <th className="px-3 py-2 font-medium text-right">eBay sold</th>
                <th className="px-3 py-2 font-medium">Purchased</th>
                <th className="px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {purchases.map(p => (
                <PurchaseRow key={p.auction_id} purchase={p} onEditPrice={onEditPrice} onRemove={onRemove} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function PurchaseRow({
  purchase: p,
  onEditPrice,
  onRemove,
}: {
  purchase: BuywanderPurchase;
  onEditPrice: (p: BuywanderPurchase) => void;
  onRemove: (p: BuywanderPurchase) => void;
}) {
  const builderHref = `/item-ad-builder?auction_id=${encodeURIComponent(p.auction_id)}`;
  const median = p.ebay?.median_sold ?? null;
  return (
    <tr className="border-t border-[#2F2F2F] align-top">
      <td className="px-3 py-2 max-w-xs">
        <a href={p.url} target="_blank" rel="noreferrer" className="text-white hover:underline">
          {p.title}
        </a>
        {p.notes && <div className="text-xs text-[#6B6B6B] mt-0.5 whitespace-pre-wrap">{p.notes}</div>}
      </td>
      <td className="px-3 py-2 font-mono whitespace-nowrap">{p.bwsku ?? <span className="text-[#6B6B6B]">none</span>}</td>
      <td className="px-3 py-2 text-right font-mono whitespace-nowrap">
        {p.paid_usd === null ? <span className="text-[#6B6B6B]">unknown</span> : fmtMoney(p.paid_usd)}
      </td>
      <td className="px-3 py-2 text-right font-mono whitespace-nowrap">
        {median === null ? (
          <span className="text-[#6B6B6B]">none</span>
        ) : p.ebay?.search_url ? (
          <a href={p.ebay.search_url} target="_blank" rel="noreferrer" className="hover:underline">{fmtMoney(median)}</a>
        ) : (
          fmtMoney(median)
        )}
      </td>
      <td className="px-3 py-2 whitespace-nowrap">{fmtEnds(p.purchased_at)}</td>
      <td className="px-3 py-2 whitespace-nowrap">
        <div className="flex items-center gap-2">
          {p.task_id ? (
            <>
              <Link href={`/tasks?focus=${encodeURIComponent(p.task_id)}`} className="text-xs px-2 py-1 rounded bg-[#4DAB9A] text-black font-medium hover:opacity-90">
                Open task
              </Link>
              <Link href={builderHref} className="text-xs text-[#6B6B6B] hover:text-white underline decoration-dotted">
                Rebuild
              </Link>
            </>
          ) : (
            <Link href={builderHref} className="text-xs px-2 py-1 rounded bg-[#4DAB9A] text-black font-medium hover:opacity-90">
              Build ads
            </Link>
          )}
          <button type="button" onClick={() => onEditPrice(p)} className={BTN_SMALL}>
            Edit price
          </button>
          <button type="button" onClick={() => onRemove(p)} className={`${BTN_SMALL} hover:text-red-300`}>
            Remove
          </button>
        </div>
      </td>
    </tr>
  );
}

function RunSection({
  run,
  boughtIds,
  onBought,
}: {
  run: BuywanderRun;
  boughtIds: Set<string>;
  onBought: (find: BuywanderFind, runId: string) => void;
}) {
  const [showSkipped, setShowSkipped] = useState(false);
  const skipped = run.skipped ?? [];
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="text-lg font-semibold">
          {run.location} · {new Date(run.scanned_at).toLocaleDateString('en-US', { timeZone: 'America/Denver', weekday: 'short', month: 'short', day: 'numeric' })}
        </h2>
        <span className="text-xs font-mono text-[#6B6B6B]">
          {formatRelative(run.received_at)} · {run.new_count} new of {run.scanned_ids.length} over $400 · {run.finds.length} scored
        </span>
        <NotifyBadge run={run} />
      </div>

      {run.finds.length === 0 ? (
        <div className="text-sm text-[#6B6B6B]">No new lots over $400.</div>
      ) : (
        <div className="overflow-x-auto border border-[#2F2F2F] rounded-lg">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-[#6B6B6B] bg-[#1F1F1F]">
              <tr>
                <th className="px-3 py-2 font-medium">Item</th>
                <th className="px-3 py-2 font-medium text-right">Retail</th>
                <th className="px-3 py-2 font-medium text-right">Bid</th>
                <th className="px-3 py-2 font-medium text-right">eBay sold</th>
                <th className="px-3 py-2 font-medium text-right">Spread</th>
                <th className="px-3 py-2 font-medium text-right">Margin</th>
                <th className="px-3 py-2 font-medium text-right">Ship est</th>
                <th className="px-3 py-2 font-medium text-right" title={ruleTitle(run)}>Max bid</th>
                <th className="px-3 py-2 font-medium">Ends</th>
                <th className="px-3 py-2 font-medium">Condition</th>
                <th className="px-3 py-2 font-medium">Category</th>
                <th className="px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {run.finds.map(f => (
                <FindRow key={f.auction_id} find={f} bought={boughtIds.has(f.auction_id)} onBought={() => onBought(f, run.id)} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {skipped.length > 0 && (
        <div className="text-xs text-[#6B6B6B]">
          <button
            type="button"
            onClick={() => setShowSkipped(v => !v)}
            className="underline decoration-dotted hover:text-white"
          >
            {showSkipped ? 'Hide' : 'Show'} {skipped.length} skipped
          </button>
          {showSkipped && (
            <ul className="mt-2 space-y-1">
              {skipped.map(s => (
                <li key={s.auction_id}>
                  <a href={s.url} target="_blank" rel="noreferrer" className="text-[#D4D4D4] hover:underline">
                    {s.title}
                  </a>{' '}
                  · {fmtMoney(s.retail_value)} · {s.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {run.notes && <p className="text-xs text-[#6B6B6B] whitespace-pre-wrap">{run.notes}</p>}
    </section>
  );
}

function FindRow({ find, bought, onBought }: { find: BuywanderFind; bought: boolean; onBought: () => void }) {
  const hasComps = find.ebay.median_sold !== null;
  const margin = find.margin ?? null;
  const marginClass =
    margin === null ? 'text-[#6B6B6B]' : margin >= 0.5 ? 'text-emerald-400' : margin >= 0.25 ? 'text-amber-300' : 'text-[#D4D4D4]';
  return (
    <tr className="border-t border-[#2F2F2F] align-top">
      <td className="px-3 py-2 max-w-xs">
        <a href={find.url} target="_blank" rel="noreferrer" className="text-white hover:underline">
          {find.title}
        </a>
        {find.ebay.note && <div className="text-xs text-[#6B6B6B] mt-0.5">{find.ebay.note}</div>}
      </td>
      <td className="px-3 py-2 text-right font-mono">{fmtMoney(find.retail_value)}</td>
      <td className="px-3 py-2 text-right font-mono">{fmtMoney(find.current_bid)}</td>
      <td className="px-3 py-2 text-right font-mono whitespace-nowrap">
        <a href={find.ebay.search_url} target="_blank" rel="noreferrer" className="hover:underline">
          {hasComps ? fmtMoney(find.ebay.median_sold) : 'none'}
        </a>
        {hasComps && <span className="text-[#6B6B6B]"> ({find.ebay.comp_count})</span>}
        {hasComps && find.ebay.match === 'loose' && (
          <span className="ml-1 text-[10px] uppercase tracking-wide text-amber-300" title="Same brand and product type, not the exact model">loose</span>
        )}
      </td>
      <td className="px-3 py-2 text-right font-mono">{fmtMoney(find.spread)}</td>
      <td className={`px-3 py-2 text-right font-mono ${marginClass}`}>{fmtPct(margin)}</td>
      <td className="px-3 py-2 text-right font-mono whitespace-nowrap" title={find.shipping_note}>
        {find.shipping_est === null ? <span className="text-amber-300">freight</span> : fmtMoney(find.shipping_est)}
      </td>
      <td className="px-3 py-2 text-right font-mono text-white">{fmtMoney(find.max_bid)}</td>
      <td className="px-3 py-2 whitespace-nowrap">{fmtEnds(find.ends_at)}</td>
      <td className="px-3 py-2 whitespace-nowrap">{fmtCondition(find.condition)}</td>
      <td className="px-3 py-2">{find.category}</td>
      <td className="px-3 py-2 whitespace-nowrap">
        <button
          type="button"
          onClick={onBought}
          disabled={bought}
          className={bought ? `${BTN_SMALL} text-[#4DAB9A]` : BTN_SMALL}
          title={bought ? 'Recorded under Purchased' : 'Mark this lot as won'}
        >
          {bought ? 'Bought ✓' : 'Bought'}
        </button>
      </td>
    </tr>
  );
}

function ruleTitle(run: BuywanderRun): string {
  const r = run.bid_rule;
  if (!r) return 'Rule not recorded for this run';
  return `eBay fee ${fmtPct(r.ebay_fee_rate)}, target margin ${fmtPct(r.target_margin)}, pickup cost ${fmtPct(r.buyer_cost_rate)}, shipping x${r.shipping_multiplier} (default ${fmtMoney(r.default_shipping)} without dimensions)`;
}

function NotifyBadge({ run }: { run: BuywanderRun }) {
  if (run.finds.length === 0) return null;
  const n = run.notify ?? (run.email ? { sent: run.email.sent, channel: 'ntfy' as const, error: run.email.error } : null);
  if (!n) return null;
  if (n.sent) {
    return <span className="text-xs text-emerald-400">pushed to phone</span>;
  }
  return (
    <span className="text-xs text-amber-300" title={n.error ?? undefined}>
      push not sent{n.error ? `: ${n.error}` : ''}
    </span>
  );
}
