'use client';

import { useState } from 'react';
import CallsPageHeader, { CallsLoadStatus } from '@/components/CallsPageHeader';
import { useCallsGet } from '@/lib/use-calls-get';
import type { OpsSummary } from '@/lib/calls-types';

/** Same buckets as the Python `_fmt_age`: seconds under 90, minutes under 5400, else hours. */
function fmtAge(seconds: number | null): string {
  if (seconds === null) return 'never';
  if (seconds < 90) return `${seconds.toFixed(0)}s ago`;
  if (seconds < 5400) return `${(seconds / 60).toFixed(0)}m ago`;
  return `${(seconds / 3600).toFixed(1)}h ago`;
}

function fmtDate(ts: number | null): string {
  return ts == null ? '' : new Date(ts * 1000).toLocaleString();
}

function OpsDetail({ data }: { data: OpsSummary }) {
  const flags = Object.entries(data.health_flags);
  return (
    <>
      <section className="space-y-1 text-sm" data-testid="calls-ops-sync">
        <p>
          Last successful sync: <b data-testid="calls-ops-sync-age">{fmtAge(data.sync_age_seconds)}</b>
        </p>
        {data.sync_error && (
          <p className="text-[#FF4D4D]" data-testid="calls-ops-sync-error">
            Sync error: <b>{data.sync_error}</b>
          </p>
        )}
        {data.sync_warning && (
          <p className="text-[#D4A04D]" data-testid="calls-ops-sync-warning">
            Sync warning: {data.sync_warning}
          </p>
        )}
        <p className="text-xs text-[#6B6B6B]">
          Outbox queue {data.outbox_pending}, event backlog {data.raw_backlog}.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Health flags</h2>
        <ul className="text-sm list-disc pl-5" data-testid="calls-ops-flags">
          {flags.length === 0 ? (
            <li className="text-[#6B6B6B]">none</li>
          ) : (
            flags.map(([key, value]) => (
              <li key={key}>
                <b>{key}</b>: {typeof value === 'string' ? value : JSON.stringify(value)}
              </li>
            ))
          )}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Dead-lettered writes (need a human)</h2>
        <p className="text-xs text-[#9B9B9B]">
          These ID writes were dropped after exhausting retries or failing permanently. The data is still here: re-enter
          it manually, or fix the cause and re-submit.
        </p>
        {data.dead_letters.length === 0 ? (
          <div className="text-sm text-[#6B6B6B]" data-testid="calls-ops-no-dead-letters">
            None. Nothing has been dropped.
          </div>
        ) : (
          <table className="w-full text-sm" data-testid="calls-ops-dead-letters">
            <thead>
              <tr className="text-left text-xs text-[#6B6B6B] border-b border-[#2F2F2F]">
                <th className="py-2 pr-3 font-medium">Outbox</th>
                <th className="py-2 pr-3 font-medium">Key</th>
                <th className="py-2 pr-3 font-medium">Kind</th>
                <th className="py-2 pr-3 font-medium">Attempts</th>
                <th className="py-2 pr-3 font-medium">Last error</th>
                <th className="py-2 font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {data.dead_letters.map(d => (
                <tr key={d.id} className="border-b border-[#202020] bg-[#FF4D4D]/10">
                  <td className="py-2 pr-3 font-mono text-xs">{d.id}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{d.event_key}</td>
                  <td className="py-2 pr-3 text-[#9B9B9B]">{d.kind}</td>
                  <td className="py-2 pr-3 text-[#9B9B9B]">{d.attempts}</td>
                  <td className="py-2 pr-3 text-[#FF4D4D]">{d.last_error}</td>
                  <td className="py-2 whitespace-nowrap text-[#9B9B9B]">{fmtDate(d.finished_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

export default function CallsOpsPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const load = useCallsGet<OpsSummary>('/api/calls/ops', reloadKey);

  return (
    <div className="space-y-8">
      <CallsPageHeader title="Ops" />
      <div className="space-y-6">
        <button
          type="button"
          onClick={() => setReloadKey(k => k + 1)}
          className="text-xs text-[#9B9B9B] hover:text-white transition-colors"
          data-testid="calls-ops-refresh"
        >
          refresh
        </button>
        <CallsLoadStatus load={load} />
        {load.state === 'ok' && <OpsDetail data={load.data} />}
      </div>
    </div>
  );
}
