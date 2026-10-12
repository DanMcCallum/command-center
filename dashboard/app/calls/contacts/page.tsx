'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import CallsPageHeader, { CallsLoadStatus } from '@/components/CallsPageHeader';
import { useCallsGet } from '@/lib/use-calls-get';
import type { ContactsResponse } from '@/lib/calls-types';

function pageStart(raw: string | null): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

function ContactsList() {
  const start = pageStart(useSearchParams().get('start'));
  const load = useCallsGet<ContactsResponse>(`/api/calls/contacts?start=${start}`);

  return (
    <section className="space-y-3">
      <CallsLoadStatus load={load} />
      {load.state === 'ok' &&
        (load.data.rows.length === 0 ? (
          <div className="text-sm text-[#6B6B6B]" data-testid="calls-list-empty">
            No contacts on this page.
          </div>
        ) : (
          <table className="w-full text-sm" data-testid="calls-contacts">
            <thead>
              <tr className="text-left text-xs text-[#6B6B6B] border-b border-[#2F2F2F]">
                <th className="py-2 pr-3 font-medium">ID</th>
                <th className="py-2 pr-3 font-medium">Name</th>
                <th className="py-2 pr-3 font-medium">Type</th>
                <th className="py-2 pr-3 font-medium">Phone</th>
                <th className="py-2 pr-3 font-medium">Cell</th>
                <th className="py-2 font-medium">Email</th>
              </tr>
            </thead>
            <tbody>
              {load.data.rows.map((c, i) => (
                <tr key={c.id ?? i} className="border-b border-[#202020]">
                  <td className="py-2 pr-3 font-mono text-xs">
                    <Link
                      href={`/calls/record/contact/${encodeURIComponent(c.id ?? '')}`}
                      className="text-[#4DAB9A] hover:text-[#5BC0AE] transition-colors"
                    >
                      {c.id}
                    </Link>
                  </td>
                  <td className="py-2 pr-3">{[c.first_name, c.last_name].filter(Boolean).join(' ')}</td>
                  <td className="py-2 pr-3 text-[#9B9B9B]">{c.type ?? ''}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{c.phone ?? ''}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{c.cell ?? ''}</td>
                  <td className="py-2 text-[#9B9B9B] break-all">{c.email ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      <div className="flex gap-4 text-sm">
        {start > 0 && (
          <Link
            href={`/calls/contacts?start=${Math.max(0, start - 50)}`}
            className="text-[#9B9B9B] hover:text-white transition-colors"
          >
            Previous page
          </Link>
        )}
        {load.state === 'ok' && load.data.next_start != null && (
          <Link
            href={`/calls/contacts?start=${load.data.next_start}`}
            className="text-[#4DAB9A] hover:text-[#5BC0AE] transition-colors"
            data-testid="calls-next-page"
          >
            Next page
          </Link>
        )}
      </div>
    </section>
  );
}

export default function CallsContactsPage() {
  return (
    <div className="space-y-8">
      <CallsPageHeader title="Contacts" />
      <Suspense fallback={<div className="text-sm text-[#6B6B6B]">Loading…</div>}>
        <ContactsList />
      </Suspense>
    </div>
  );
}
