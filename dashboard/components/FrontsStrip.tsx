'use client';

import Link from 'next/link';
import type { FrontSummary } from '@/lib/types';

const TEAL = '#4DAB9A';

/** "Fronts: N suggestions, M questions waiting" with per-front links.
 * Renders nothing when both are zero. */
export default function FrontsStrip({ fronts }: { fronts: FrontSummary[] }) {
  const waiting = fronts.filter(f => f.openSuggestions + f.openQuestions > 0);
  const suggestions = waiting.reduce((n, f) => n + f.openSuggestions, 0);
  const questions = waiting.reduce((n, f) => n + f.openQuestions, 0);
  if (suggestions + questions === 0) return null;
  return (
    <div
      className="rounded border px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1"
      style={{ borderColor: `${TEAL}40`, backgroundColor: `${TEAL}10` }}
      data-testid="fronts-strip"
    >
      <span className="text-sm font-medium" style={{ color: TEAL }}>
        Fronts: {suggestions} suggestion{suggestions === 1 ? '' : 's'}, {questions} question{questions === 1 ? '' : 's'} waiting
      </span>
      <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {waiting.map(f => (
          <Link
            key={f.slug}
            href={`/fronts/${f.slug}`}
            className="underline hover:text-white transition-colors"
            style={{ color: TEAL }}
          >
            {f.name} ({f.openSuggestions + f.openQuestions})
          </Link>
        ))}
      </span>
    </div>
  );
}
