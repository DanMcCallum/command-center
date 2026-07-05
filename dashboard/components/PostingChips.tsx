'use client';

import { useEffect, useState } from 'react';
import type { PostingStatus, Task } from '@/lib/types';

export const POSTING_COLORS: Record<PostingStatus, { color: string; label: string }> = {
  queued: { color: '#6B6B6B', label: 'Queued' },
  posting: { color: '#4DA3D4', label: 'Posting…' },
  posted: { color: '#4DAB9A', label: 'Posted' },
  failed: { color: '#FF4D4D', label: 'Failed' },
};

const MAX_ATTEMPTS = 3;

let namesPromise: Promise<Record<string, string>> | null = null;

function loadDisplayNames(): Promise<Record<string, string>> {
  if (!namesPromise) {
    namesPromise = fetch('/api/posting-platforms', { cache: 'no-store' })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: { platforms: Record<string, { display_name?: string }> }) => {
        const names: Record<string, string> = {};
        for (const [key, cfg] of Object.entries(data.platforms)) {
          names[key] = cfg.display_name ?? key;
        }
        return names;
      })
      .catch(() => {
        namesPromise = null;
        return {};
      });
  }
  return namesPromise;
}

interface Props {
  task: Task;
  onChange: () => void;
}

export default function PostingChips({ task, onChange }: Props) {
  const postings = task.postings ?? [];
  const [names, setNames] = useState<Record<string, string>>({});
  const [retrying, setRetrying] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadDisplayNames().then(n => {
      if (!cancelled) setNames(n);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (postings.length === 0) return null;

  async function retry(platform: string) {
    setRetrying(platform);
    try {
      // Re-fetch before rewriting so a concurrent poster update to another
      // posting isn't clobbered by the full-array-replace PATCH.
      const res = await fetch(`/api/tasks/${task.id}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const fresh = (await res.json()) as Task;
      const updated = (fresh.postings ?? []).map(p =>
        p.platform === platform
          ? {
              ...p,
              status: 'queued' as const,
              attempts: 0,
              queuedAt: new Date().toISOString(),
              lastError: undefined,
            }
          : p,
      );
      const patch = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postings: updated }),
      });
      if (!patch.ok) throw new Error(`HTTP ${patch.status}`);
      fetch('/api/run-poster', { method: 'POST' }).catch(() => {});
      onChange();
    } finally {
      setRetrying(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {postings.map(p => {
        const { color, label } = POSTING_COLORS[p.status];
        const name = names[p.platform] ?? p.platform;
        const chip = (
          <span
            className="inline-flex items-center px-2 py-0.5 text-xs rounded-full whitespace-nowrap"
            style={{ backgroundColor: `${color}20`, color }}
            title={p.status === 'failed' && p.lastError ? p.lastError : undefined}
          >
            {name}: {label}
          </span>
        );
        if (p.status === 'posted' && p.listingUrl) {
          return (
            <a
              key={p.platform}
              href={p.listingUrl}
              target="_blank"
              rel="noreferrer"
              className="hover:underline"
            >
              {chip}
            </a>
          );
        }
        if (p.status === 'failed' && p.attempts >= MAX_ATTEMPTS) {
          return (
            <span key={p.platform} className="inline-flex items-center gap-1">
              {chip}
              <button
                type="button"
                disabled={retrying === p.platform}
                onClick={() => retry(p.platform)}
                className="px-2 py-0.5 text-xs font-medium rounded bg-[#2F2F2F] text-[#9B9B9B] hover:bg-[#373737] hover:text-white transition-colors disabled:opacity-50"
              >
                Retry
              </button>
            </span>
          );
        }
        return <span key={p.platform}>{chip}</span>;
      })}
    </div>
  );
}
