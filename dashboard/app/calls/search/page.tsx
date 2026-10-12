'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import CallsPageHeader, { CallsLoadStatus } from '@/components/CallsPageHeader';
import { useCallsGet } from '@/lib/use-calls-get';
import type { SearchResult } from '@/lib/calls-types';

function SearchView() {
  const router = useRouter();
  const q = useSearchParams().get('q')?.trim() ?? '';
  const [input, setInput] = useState(q);
  const load = useCallsGet<SearchResult>(q ? `/api/calls/search?${new URLSearchParams({ q })}` : null);

  useEffect(() => setInput(q), [q]);

  return (
    <section className="space-y-6">
      <form
        className="flex gap-3"
        onSubmit={e => {
          e.preventDefault();
          const next = input.trim();
          router.push(next ? `/calls/search?${new URLSearchParams({ q: next })}` : '/calls/search');
        }}
      >
        <input
          name="q"
          autoFocus
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Name, address, APN, or ad nickname"
          className="flex-1 max-w-xl bg-[#191919] border border-[#2F2F2F] rounded px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          className="px-3 py-1.5 rounded bg-[#2F2F2F] hover:bg-[#3F3F3F] text-sm transition-colors"
        >
          Search
        </button>
      </form>

      {!q && (
        <p className="text-xs text-[#6B6B6B]">
          Records come from the local phone index (names, addresses, APNs); nicknames are the ad names callers use.
        </p>
      )}

      <CallsLoadStatus load={load} />

      {load.state === 'ok' && (
        <>
          <div className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[#9B9B9B]">Records</h2>
            {load.data.records.length === 0 ? (
              <div className="text-sm text-[#6B6B6B]" data-testid="calls-search-no-records">
                No records match.
              </div>
            ) : (
              <table className="w-full text-sm" data-testid="calls-search-records">
                <thead>
                  <tr className="text-left text-xs text-[#6B6B6B] border-b border-[#2F2F2F]">
                    <th className="py-2 pr-3 font-medium">Record</th>
                    <th className="py-2 pr-3 font-medium">Name</th>
                    <th className="py-2 pr-3 font-medium">Address</th>
                    <th className="py-2 pr-3 font-medium">APN</th>
                    <th className="py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {load.data.records.map(r => (
                    <tr key={`${r.record_table}-${r.record_id}`} className="border-b border-[#202020]">
                      <td className="py-2 pr-3 font-mono text-xs whitespace-nowrap">
                        <Link
                          href={`/calls/record/${r.record_table}/${r.record_id}`}
                          className="text-[#4DAB9A] hover:text-[#5BC0AE] transition-colors"
                        >
                          {r.record_table} {r.record_id}
                        </Link>
                      </td>
                      <td className="py-2 pr-3">{r.display_name}</td>
                      <td className="py-2 pr-3 text-[#9B9B9B]">{r.address}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{r.apn}</td>
                      <td className="py-2 text-[#9B9B9B]">{r.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[#9B9B9B]">Ad nicknames</h2>
            {load.data.nicknames.length === 0 ? (
              <div className="text-sm text-[#6B6B6B]" data-testid="calls-search-no-nicknames">
                No nickname matches.
              </div>
            ) : (
              <ul className="space-y-1.5 text-sm" data-testid="calls-search-nicknames">
                {load.data.nicknames.map(n => (
                  <li key={n.slug}>
                    <span className="font-semibold">{n.nickname}</span>{' '}
                    <span className="text-xs text-[#6B6B6B]">score {n.score.toFixed(2)}</span>{' '}
                    {n.property_id != null ? (
                      <Link
                        href={`/calls/record/property/${n.property_id}`}
                        className="text-[#4DAB9A] hover:text-[#5BC0AE] transition-colors"
                      >
                        property {n.property_id}
                      </Link>
                    ) : (
                      <span className="text-[#D4A04D]">unresolved ({n.slug})</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <Link
              href={`/calls/attribute?${new URLSearchParams({ q })}`}
              className="inline-block text-sm text-[#4DAB9A] hover:text-[#5BC0AE] transition-colors"
              data-testid="calls-search-attribute"
            >
              Caller named one of these? Attribute them
            </Link>
          </div>
        </>
      )}
    </section>
  );
}

export default function CallsSearchPage() {
  return (
    <div className="space-y-8">
      <CallsPageHeader title="Search" />
      <Suspense fallback={<div className="text-sm text-[#6B6B6B]">Loading…</div>}>
        <SearchView />
      </Suspense>
    </div>
  );
}
