'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import CallsPageHeader, { CallsLoadStatus } from '@/components/CallsPageHeader';
import { useCallsGet } from '@/lib/use-calls-get';
import type { PropertiesResponse } from '@/lib/calls-types';

function pageStart(raw: string | null): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

function propertiesHref(status: string, start: number): string {
  return `/calls/properties?${new URLSearchParams({ status, start: String(start) })}`;
}

function PropertiesList() {
  const router = useRouter();
  const params = useSearchParams();
  const status = params.get('status')?.trim() || '0';
  const start = pageStart(params.get('start'));
  const [statusInput, setStatusInput] = useState(status);
  const load = useCallsGet<PropertiesResponse>(
    `/api/calls/properties?${new URLSearchParams({ status, start: String(start) })}`,
  );

  useEffect(() => setStatusInput(status), [status]);

  return (
    <section className="space-y-3">
      <form
        className="flex items-end gap-3 text-sm"
        onSubmit={e => {
          e.preventDefault();
          router.push(propertiesHref(statusInput.trim() || '0', 0));
        }}
      >
        <label className="space-y-1">
          <span className="block text-xs text-[#9B9B9B]">Status</span>
          <input
            name="status"
            value={statusInput}
            onChange={e => setStatusInput(e.target.value)}
            className="w-28 bg-[#191919] border border-[#2F2F2F] rounded px-2 py-1.5 text-sm"
          />
        </label>
        <button
          type="submit"
          className="px-3 py-1.5 rounded bg-[#2F2F2F] hover:bg-[#3F3F3F] text-sm transition-colors"
        >
          Filter
        </button>
        <span className="text-xs text-[#6B6B6B] pb-2">ID status id or group; 0 = all</span>
      </form>

      <CallsLoadStatus load={load} />
      {load.state === 'ok' &&
        (load.data.rows.length === 0 ? (
          <div className="text-sm text-[#6B6B6B]" data-testid="calls-list-empty">
            No properties on this page.
          </div>
        ) : (
          <table className="w-full text-sm" data-testid="calls-properties">
            <thead>
              <tr className="text-left text-xs text-[#6B6B6B] border-b border-[#2F2F2F]">
                <th className="py-2 pr-3 font-medium">ID</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium">APN</th>
                <th className="py-2 pr-3 font-medium">Address</th>
                <th className="py-2 font-medium">Owner</th>
              </tr>
            </thead>
            <tbody>
              {load.data.rows.map((p, i) => {
                const cityLine = [p.property_city, p.property_state, p.property_zip].filter(Boolean).join(' ');
                return (
                  <tr key={p.property_id ?? i} className="border-b border-[#202020]">
                    <td className="py-2 pr-3 font-mono text-xs">
                      <Link
                        href={`/calls/record/property/${encodeURIComponent(p.property_id ?? '')}`}
                        className="text-[#4DAB9A] hover:text-[#5BC0AE] transition-colors"
                      >
                        {p.property_id}
                      </Link>
                    </td>
                    <td className="py-2 pr-3 text-[#9B9B9B]">{p.property_status ?? ''}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{p.property_apn ?? ''}</td>
                    <td className="py-2 pr-3">{[p.property_address, cityLine].filter(Boolean).join(', ')}</td>
                    <td className="py-2">{[p.owner_first_name, p.owner_last_name].filter(Boolean).join(' ')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ))}
      <div className="flex gap-4 text-sm">
        {start > 0 && (
          <Link
            href={propertiesHref(status, Math.max(0, start - 50))}
            className="text-[#9B9B9B] hover:text-white transition-colors"
          >
            Previous page
          </Link>
        )}
        {load.state === 'ok' && load.data.next_start != null && (
          <Link
            href={propertiesHref(status, load.data.next_start)}
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

export default function CallsPropertiesPage() {
  return (
    <div className="space-y-8">
      <CallsPageHeader title="Properties" />
      <Suspense fallback={<div className="text-sm text-[#6B6B6B]">Loading…</div>}>
        <PropertiesList />
      </Suspense>
    </div>
  );
}
