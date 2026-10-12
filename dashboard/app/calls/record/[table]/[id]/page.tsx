'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import CallsOpsStrip from '@/components/CallsOpsStrip';
import CallNoteForm from '@/components/CallNoteForm';
import type { CallsErrorBody, RecordDetail } from '@/lib/calls-types';

type Load =
  | { state: 'loading' }
  | { state: 'ok'; detail: RecordDetail }
  | { state: 'not_found' }
  | { state: 'error'; error: string };

function fmtDate(ts: number | null): string {
  return ts == null ? '' : new Date(ts * 1000).toLocaleDateString();
}

export default function CallsRecordPage() {
  const { table, id } = useParams<{ table: string; id: string }>();
  const [load, setLoad] = useState<Load>({ state: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setLoad({ state: 'loading' });
    fetch(`/api/calls/record/${encodeURIComponent(table)}/${encodeURIComponent(id)}`, { cache: 'no-store' })
      .then(async r => {
        const body = (await r.json().catch(() => null)) as RecordDetail | CallsErrorBody | null;
        if (cancelled) return;
        if (r.ok && body && 'record' in body) return setLoad({ state: 'ok', detail: body });
        if (r.status === 404) return setLoad({ state: 'not_found' });
        setLoad({ state: 'error', error: (body as CallsErrorBody | null)?.error ?? `HTTP ${r.status}` });
      })
      .catch(() => {
        if (!cancelled) setLoad({ state: 'error', error: 'call service unreachable' });
      });
    return () => {
      cancelled = true;
    };
  }, [table, id]);

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <div className="text-xs text-[#6B6B6B]">
          <Link href="/calls" className="hover:text-white transition-colors">
            Calls
          </Link>{' '}
          / record
        </div>
        <h1 className="text-3xl font-bold">
          {table} {id}
        </h1>
        <CallsOpsStrip />
      </header>

      {load.state === 'loading' && <div className="text-sm text-[#6B6B6B]">Loading…</div>}
      {load.state === 'not_found' && (
        <div className="text-sm text-[#D4A04D]" data-testid="calls-record-missing">
          No {table} {id} in Investment Dominator.
        </div>
      )}
      {load.state === 'error' && (
        <div className="text-sm text-[#FF4D4D]" data-testid="calls-record-error">
          {load.error}
        </div>
      )}

      {load.state === 'ok' && (
        <>
          {load.detail.nickname && (
            <div className="text-sm text-[#D4D4D4]" data-testid="calls-record-nickname">
              Ad nickname: <span className="font-semibold">{load.detail.nickname}</span>
            </div>
          )}

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[#9B9B9B]">Record</h2>
            <table className="text-sm" data-testid="calls-record-fields">
              <tbody>
                {Object.entries(load.detail.record)
                  .filter(([, v]) => v !== '' && v != null)
                  .map(([k, v]) => (
                    <tr key={k} className="border-b border-[#202020]">
                      <td className="py-1.5 pr-6 text-xs font-mono text-[#6B6B6B] align-top">{k}</td>
                      <td className="py-1.5 text-[#D4D4D4] break-all">{String(v)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[#9B9B9B]">Task history</h2>
            {load.detail.history.length === 0 ? (
              <div className="text-sm text-[#6B6B6B]">
                No linked tasks yet. New tasks appear after the next sync walk.
              </div>
            ) : (
              <table className="w-full text-sm" data-testid="calls-record-history">
                <thead>
                  <tr className="text-left text-xs text-[#6B6B6B] border-b border-[#2F2F2F]">
                    <th className="py-2 pr-3 font-medium">Task</th>
                    <th className="py-2 pr-3 font-medium">Title</th>
                    <th className="py-2 pr-3 font-medium">Type</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 font-medium">Due</th>
                  </tr>
                </thead>
                <tbody>
                  {load.detail.history.map(t => (
                    <tr key={t.task_id} className="border-b border-[#202020]">
                      <td className="py-2 pr-3 font-mono text-xs">{t.task_id}</td>
                      <td className="py-2 pr-3">{t.title}</td>
                      <td className="py-2 pr-3 text-[#9B9B9B]">{t.task_type}</td>
                      <td className="py-2 pr-3 text-[#9B9B9B]">{t.status}</td>
                      <td className="py-2 text-[#9B9B9B] whitespace-nowrap">{fmtDate(t.start_ts)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="space-y-3 max-w-xl">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[#9B9B9B]">Log a note</h2>
            <CallNoteForm
              contactId={load.detail.table === 'contact' ? load.detail.id : undefined}
              propertyId={load.detail.table === 'property' ? load.detail.id : undefined}
            />
          </section>
        </>
      )}
    </div>
  );
}
