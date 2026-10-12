'use client';

import { Fragment, useState } from 'react';
import Link from 'next/link';
import CallsOpsStrip from '@/components/CallsOpsStrip';
import { CallsSubnav } from '@/components/CallsPageHeader';
import CallPop, { attributeHref } from '@/components/CallPop';
import CallNoteForm from '@/components/CallNoteForm';
import { useCallStream } from '@/lib/use-call-stream';

export default function CallsPage() {
  const { pops, recent, recentError, recentLoaded, status, lastPingAt, refreshRecent } = useCallStream();
  const [noteFor, setNoteFor] = useState<number | null>(null);

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <h1 className="text-3xl font-bold">Calls</h1>
        <CallsSubnav />
        <CallsOpsStrip stream={status} lastPingAt={lastPingAt} />
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[#9B9B9B]">Live pops</h2>
        {pops.length === 0 ? (
          <div className="border border-dashed border-[#2F2F2F] rounded-lg py-8 text-center text-sm text-[#6B6B6B]">
            No calls since this page opened. Pops appear here as the phone rings.
          </div>
        ) : (
          <div className="space-y-3" data-testid="call-pops">
            {pops.map(p => (
              <CallPop key={`${p.seq}-${p.call_id}`} pop={p} onNoteLogged={refreshRecent} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[#9B9B9B]">Recent call events</h2>
        {recentError && (
          <div className="text-sm text-[#FF4D4D]" data-testid="calls-recent-error">
            {recentError}
          </div>
        )}
        {!recentLoaded ? (
          <div className="text-sm text-[#6B6B6B]">Loading…</div>
        ) : recent.length === 0 ? (
          !recentError && <div className="text-sm text-[#6B6B6B]">No call events yet.</div>
        ) : (
          <table className="w-full text-sm" data-testid="calls-recent">
            <thead>
              <tr className="text-left text-xs text-[#6B6B6B] border-b border-[#2F2F2F]">
                <th className="py-2 pr-3 font-medium">When</th>
                <th className="py-2 pr-3 font-medium">Call</th>
                <th className="py-2 pr-3 font-medium">State</th>
                <th className="py-2 pr-3 font-medium">Number</th>
                <th className="py-2 pr-3 font-medium">Note</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {recent.map(ev => {
                const number = typeof ev.payload?.external_number === 'string' ? ev.payload.external_number : '';
                return (
                  <Fragment key={ev.event_id}>
                    <tr className="border-b border-[#202020]" data-call-id={ev.call_id ?? ''}>
                      <td className="py-2 pr-3 text-[#9B9B9B] whitespace-nowrap">
                        {new Date(ev.received_at * 1000).toLocaleString()}
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs">{ev.call_id ?? ''}</td>
                      <td className="py-2 pr-3">{ev.state ?? ''}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{number}</td>
                      <td className="py-2 pr-3 text-xs">
                        {ev.has_manual_note && (
                          <span className="text-[#4DAB9A]" data-testid="calls-recent-note-logged">
                            note logged
                          </span>
                        )}
                      </td>
                      <td className="py-2 text-right whitespace-nowrap space-x-3">
                        <Link
                          href={attributeHref(ev.call_id, number)}
                          className="text-xs text-[#4DAB9A] hover:text-[#5BC0AE] transition-colors"
                        >
                          Attribute caller
                        </Link>
                        <button
                          type="button"
                          onClick={() => setNoteFor(noteFor === ev.event_id ? null : ev.event_id)}
                          className="text-xs text-[#9B9B9B] hover:text-white transition-colors"
                        >
                          Log note
                        </button>
                      </td>
                    </tr>
                    {noteFor === ev.event_id && (
                      <tr>
                        <td colSpan={6} className="pb-3">
                          <CallNoteForm
                            callId={ev.call_id ?? undefined}
                            caller={number || undefined}
                            onClose={() => setNoteFor(null)}
                            onLogged={refreshRecent}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
