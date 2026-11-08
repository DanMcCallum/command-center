'use client';

import { useEffect, useState } from 'react';
import {
  fmtCondition,
  fmtEnds,
  fmtMoney,
  fmtPct,
  type BuywanderFind,
  type BuywanderRun,
} from '@/lib/buywander-types';
import { formatRelative } from '@/lib/utils';

export default function DealsPage() {
  const [runs, setRuns] = useState<BuywanderRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/buywander/runs', { cache: 'no-store' })
      .then(r => r.json())
      .then((data: BuywanderRun[]) => {
        setRuns(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

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
          over $400, priced against eBay sold comps. Spread is the eBay median
          minus the current bid. Ship est is a UPS Ground planning number from the
          lot&apos;s listed size and weight (hover a value for the billable weight).
          Max bid is the eBay median net of eBay fees, less the target margin,
          divided by the pickup cost rate (hover the column for the rates);
          shipping is shown but not subtracted, since some lots sell locally.
          Times are Mountain.
        </p>
      </header>

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
            <RunSection key={run.id} run={run} />
          ))}
        </div>
      )}
    </div>
  );
}

function RunSection({ run }: { run: BuywanderRun }) {
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
              </tr>
            </thead>
            <tbody>
              {run.finds.map(f => (
                <FindRow key={f.auction_id} find={f} />
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

function FindRow({ find }: { find: BuywanderFind }) {
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
