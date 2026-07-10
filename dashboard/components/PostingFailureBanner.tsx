'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Task } from '@/lib/types';

const MAX_ATTEMPTS = 3;
const STORAGE_KEY = 'dismissed-posting-failures';
const AMBER = '#D4A04D';

interface Props {
  tasks: Task[];
}

export default function PostingFailureBanner({ tasks }: Props) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) setDismissed(new Set(JSON.parse(raw) as string[]));
    } catch {
      // corrupt/unavailable storage — start undismissed
    }
    setLoaded(true);
  }, []);

  const failed = useMemo(() => {
    const keys: string[] = [];
    const affected: { id: string; title: string }[] = [];
    for (const t of tasks) {
      const permanent = (t.postings ?? []).filter(
        p => p.status === 'failed' && p.attempts >= MAX_ATTEMPTS,
      );
      if (permanent.length === 0) continue;
      affected.push({ id: t.id, title: t.title });
      for (const p of permanent) keys.push(`${t.id}:${p.platform}`);
    }
    return { keys, affected };
  }, [tasks]);

  if (!loaded || failed.keys.length === 0) return null;
  // Reappear only when a posting not covered by the last dismissal fails.
  if (!failed.keys.some(k => !dismissed.has(k))) return null;

  function dismiss() {
    const next = new Set(dismissed);
    for (const k of failed.keys) next.add(k);
    setDismissed(next);
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
    } catch {
      // storage unavailable — dismissal still holds for this render tree
    }
  }

  const n = failed.keys.length;
  return (
    <div
      className="rounded border px-4 py-3"
      style={{ borderColor: `${AMBER}40`, backgroundColor: `${AMBER}10` }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="text-sm font-medium" style={{ color: AMBER }}>
            {n} posting{n === 1 ? '' : 's'} need{n === 1 ? 's' : ''} attention
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {failed.affected.map(t => (
              <Link
                key={t.id}
                href={`/tasks?focus=${t.id}`}
                className="underline hover:text-white transition-colors"
                style={{ color: AMBER }}
              >
                {t.title}
              </Link>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="text-sm leading-none text-[#6B6B6B] hover:text-white transition-colors"
        >
          ×
        </button>
      </div>
    </div>
  );
}
