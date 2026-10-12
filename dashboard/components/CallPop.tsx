'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { PingPop, PopEvent } from '@/lib/calls-types';
import CallNoteForm from './CallNoteForm';

export function attributeHref(callId: string | null | undefined, number: string | null | undefined): string {
  const q = new URLSearchParams({ call_id: callId ?? '', number: number ?? '' });
  return `/calls/attribute?${q}`;
}

const linkClass = 'text-[#4DAB9A] hover:text-[#5BC0AE] transition-colors';

/** One live pop, by `kind`, as the HTML dashboard's `popHtml` shows it. */
export default function CallPop({ pop, onNoteLogged }: { pop: Exclude<PopEvent, PingPop>; onNoteLogged?: () => void }) {
  const [noteOpen, setNoteOpen] = useState(false);
  const contactId = 'contact_id' in pop ? pop.contact_id : undefined;
  const propertyId = 'property_id' in pop ? pop.property_id : undefined;

  return (
    <div
      className="border border-[#2F2F2F] rounded-lg bg-[#1A1A1A] px-4 py-3 space-y-2"
      data-testid="call-pop"
      data-kind={pop.kind}
      data-call-id={pop.call_id}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-[#4DA3D420] text-[#4DA3D4]">{pop.kind}</span>
        <span className="text-xs font-mono text-[#6B6B6B]">call {pop.call_id}</span>
        {pop.number && <span className="text-xs font-mono text-[#9B9B9B]">{pop.number}</span>}
      </div>
      <div className="text-sm text-[#D4D4D4]">{pop.summary}</div>

      {(pop.kind === 'matched' || pop.kind === 'outbound-matched') && (
        <div className="text-sm flex items-center gap-3">
          {pop.contact_id != null && (
            <Link href={`/calls/record/contact/${pop.contact_id}`} className={linkClass}>
              contact {pop.contact_id}
            </Link>
          )}
          {pop.property_id != null && (
            <Link href={`/calls/record/property/${pop.property_id}`} className={linkClass}>
              property {pop.property_id}
            </Link>
          )}
          {pop.stale && (
            <span className="text-xs font-semibold text-[#D4A04D]" data-testid="pop-stale">
              stale: the phone index may be out of date
            </span>
          )}
        </div>
      )}

      {(pop.kind === 'ambiguous' || pop.kind === 'outbound-ambiguous') && (
        <ul className="text-sm space-y-1">
          {pop.candidates.map(c => (
            <li key={`${c.record_table}-${c.record_id}`}>
              <Link href={`/calls/record/${c.record_table}/${c.record_id}`} className={linkClass}>
                {c.display_name || `${c.record_table} ${c.record_id}`}
              </Link>
              {c.address && <span className="text-[#6B6B6B]"> · {c.address}</span>}
            </li>
          ))}
        </ul>
      )}

      {(pop.kind === 'miss' || pop.kind === 'outbound-miss') && (
        <div className="text-sm">
          <Link href={attributeHref(pop.call_id, pop.number)} className={linkClass + ' font-semibold'}>
            Attribute caller
          </Link>
        </div>
      )}

      {pop.kind === 'outbound' && (
        <div className="text-sm">
          <Link href={`/calls/record/property/${pop.property_id}`} className={linkClass}>
            property {pop.property_id}
          </Link>
        </div>
      )}

      {noteOpen ? (
        <CallNoteForm
          callId={pop.call_id}
          contactId={contactId}
          propertyId={propertyId}
          caller={pop.number ?? undefined}
          onClose={() => setNoteOpen(false)}
          onLogged={onNoteLogged}
        />
      ) : (
        <button
          type="button"
          onClick={() => setNoteOpen(true)}
          className="px-3 py-1.5 text-xs font-medium rounded bg-[#2F2F2F] text-[#9B9B9B] hover:bg-[#373737] hover:text-white transition-colors"
        >
          Log note
        </button>
      )}
    </div>
  );
}
