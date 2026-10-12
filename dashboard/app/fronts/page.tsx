'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { FrontSummary } from '@/lib/types';
import { formatRelative } from '@/lib/utils';

export default function FrontsPage() {
  const [fronts, setFronts] = useState<FrontSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInactive, setShowInactive] = useState(false);

  useEffect(() => {
    fetch('/api/fronts', { cache: 'no-store' })
      .then(r => r.json())
      .then((data: FrontSummary[]) => {
        setFronts(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const active = fronts.filter(f => f.enabled);
  const inactive = fronts.filter(f => !f.enabled);

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <div className="flex items-baseline gap-3">
          <h1 className="text-3xl font-bold">Fronts</h1>
          {!loading && (
            <span className="text-sm font-mono text-[#6B6B6B]">
              {active.length} active
            </span>
          )}
        </div>
        <p className="text-sm text-[#6B6B6B] max-w-2xl">
          The lanes of your day-to-day. Each front has a hand-written north star and an
          agent-kept now file; sessions route here when they end, and what&apos;s next
          shows up as suggestions and questions.
        </p>
      </header>

      {loading ? (
        <div className="text-sm text-[#6B6B6B]">Loading…</div>
      ) : fronts.length === 0 ? (
        <div className="border border-dashed border-[#2F2F2F] rounded-lg py-16 text-center">
          <div className="text-sm text-[#6B6B6B]">
            No fronts yet. Add one to{' '}
            <code className="font-mono text-[#D4D4D4]">config/fronts.json</code> and see{' '}
            <code className="font-mono text-[#D4D4D4]">fronts/README.md</code>.
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            {active.map(f => (
              <FrontCard key={f.slug} front={f} />
            ))}
          </div>
          {inactive.length > 0 && (
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => setShowInactive(v => !v)}
                className="text-xs font-medium text-[#6B6B6B] hover:text-white transition-colors"
              >
                {showInactive ? 'Hide' : 'Show'} inactive ({inactive.length})
              </button>
              {showInactive && (
                <div className="grid gap-4 sm:grid-cols-2 opacity-60">
                  {inactive.map(f => (
                    <FrontCard key={f.slug} front={f} />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FrontCard({ front }: { front: FrontSummary }) {
  const waiting = front.openSuggestions + front.openQuestions;
  return (
    <Link
      href={`/fronts/${front.slug}`}
      className="block border border-[#2F2F2F] rounded-lg bg-[#1A1A1A] px-5 py-4 space-y-3 hover:border-[#4DAB9A] transition-colors"
      data-testid={`front-card-${front.slug}`}
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-semibold text-white">{front.name}</h2>
        {waiting > 0 && (
          <span className="flex items-center gap-2 text-xs font-mono flex-shrink-0">
            {front.openSuggestions > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-[#4DAB9A20] text-[#4DAB9A]">
                {front.openSuggestions} sugg.
              </span>
            )}
            {front.openQuestions > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-[#D4A04D20] text-[#D4A04D]">
                {front.openQuestions} q.
              </span>
            )}
          </span>
        )}
      </div>
      <p className="text-sm text-[#D4D4D4] leading-relaxed line-clamp-4">
        {front.northStarIsTodo ? (
          <span className="text-[#D4A04D]">North star not written yet.</span>
        ) : (
          front.nowExcerpt || 'No now.md yet.'
        )}
      </p>
      <div className="text-xs text-[#6B6B6B] font-mono">
        last session {front.lastSessionAt ? formatRelative(front.lastSessionAt) : 'never'}
        {front.nowUpdatedAt && ` · now updated ${formatRelative(front.nowUpdatedAt)}`}
      </div>
    </Link>
  );
}
