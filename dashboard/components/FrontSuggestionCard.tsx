'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { FrontSuggestion } from '@/lib/types';
import { formatRelative } from '@/lib/utils';

const TEAL = '#4DAB9A';
const AMBER = '#D4A04D';

interface Props {
  suggestion: FrontSuggestion;
  /** Front name for the chip; when given, the chip links to the front page. */
  frontName?: string;
  onChanged: () => void;
}

/**
 * One open suggestion (approve with notes / dismiss) or question (answer).
 * Used on the front page and as a pseudo-card in the Tasks page's Needs
 * review filter; visually distinct from TaskCard (chip, kind label, no
 * status badge).
 */
export default function FrontSuggestionCard({ suggestion, frontName, onChanged }: Props) {
  const [notes, setNotes] = useState('');
  const [answer, setAnswer] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState<'approve' | 'dismiss' | 'answer' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const isQuestion = suggestion.kind === 'question';
  const color = isQuestion ? AMBER : TEAL;

  async function patch(body: Record<string, unknown>, kind: 'approve' | 'dismiss' | 'answer') {
    setBusy(kind);
    setError(null);
    try {
      const res = await fetch(`/api/fronts/suggestions/${suggestion.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; task?: { id: string } };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (kind === 'approve' && data.task) setResult(data.task.id);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <article
      className="border-b border-[#2F2F2F] px-4 py-4 space-y-3"
      style={{ borderLeft: `3px solid ${color}` }}
      data-suggestion-id={suggestion.id}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2 text-xs">
            <span
              className="px-1.5 py-0.5 rounded font-medium uppercase tracking-wide"
              style={{ color, backgroundColor: `${color}20` }}
            >
              {isQuestion ? 'Question' : 'Suggested task'}
            </span>
            {frontName ? (
              <Link
                href={`/fronts/${suggestion.frontSlug}`}
                className="px-1.5 py-0.5 rounded bg-[#202020] text-[#D4D4D4] hover:text-white transition-colors"
              >
                {frontName}
              </Link>
            ) : (
              <span className="px-1.5 py-0.5 rounded bg-[#202020] text-[#D4D4D4]">{suggestion.frontSlug}</span>
            )}
            <span className="text-[#6B6B6B] font-mono">{formatRelative(suggestion.createdAt)}</span>
          </div>
          <h3 className="text-sm font-medium text-white">{suggestion.title}</h3>
        </div>
        {!isQuestion && (
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            className="text-xs text-[#6B6B6B] hover:text-white transition-colors flex-shrink-0"
          >
            {expanded ? 'Hide prompt' : 'Show prompt'}
          </button>
        )}
      </div>

      {(isQuestion || expanded) && (
        <pre className="whitespace-pre-wrap text-xs text-[#D4D4D4] bg-[#202020] rounded p-3 font-sans leading-relaxed">
          {suggestion.body}
        </pre>
      )}

      {result ? (
        <div className="text-xs" style={{ color: TEAL }}>
          Task created: <Link href="/tasks" className="underline">{result}</Link>
        </div>
      ) : isQuestion ? (
        <div className="space-y-2">
          <textarea
            value={answer}
            onChange={e => setAnswer(e.target.value)}
            placeholder="Your answer (goes into now.md under Answers from Daniel)"
            rows={2}
            className="w-full text-sm bg-[#191919] border border-[#2F2F2F] rounded p-2 text-[#D4D4D4] outline-none focus:border-[#4DAB9A]"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!answer.trim() || busy !== null}
              onClick={() => patch({ status: 'answered', answer }, 'answer')}
              className="px-3 py-1.5 text-xs font-medium rounded bg-[#4DAB9A] text-[#191919] hover:bg-[#5BC0AE] disabled:opacity-40 transition-colors"
            >
              {busy === 'answer' ? 'Saving…' : 'Answer'}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => patch({ status: 'dismissed' }, 'dismiss')}
              className="px-3 py-1.5 text-xs text-[#6B6B6B] hover:text-white transition-colors"
            >
              Dismiss
            </button>
            {error && <span className="text-xs text-[#D4A04D]">{error}</span>}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Notes for the worker (optional)"
            rows={2}
            className="w-full text-sm bg-[#191919] border border-[#2F2F2F] rounded p-2 text-[#D4D4D4] outline-none focus:border-[#4DAB9A]"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => patch({ status: 'approved', operatorNotes: notes }, 'approve')}
              className="px-3 py-1.5 text-xs font-medium rounded bg-[#4DAB9A] text-[#191919] hover:bg-[#5BC0AE] disabled:opacity-40 transition-colors"
            >
              {busy === 'approve' ? 'Creating task…' : 'Approve'}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => patch({ status: 'dismissed' }, 'dismiss')}
              className="px-3 py-1.5 text-xs text-[#6B6B6B] hover:text-white transition-colors"
            >
              Dismiss
            </button>
            {error && <span className="text-xs text-[#D4A04D]">{error}</span>}
          </div>
        </div>
      )}
    </article>
  );
}
