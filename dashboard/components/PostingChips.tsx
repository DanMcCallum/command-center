'use client';

import { useEffect, useRef, useState } from 'react';
import type { AdPosting, PostingStatus, Task } from '@/lib/types';

export const POSTING_COLORS: Record<PostingStatus, { color: string; label: string }> = {
  queued: { color: '#6B6B6B', label: 'Queued' },
  posting: { color: '#4DA3D4', label: 'Posting…' },
  awaiting_auth: { color: '#D4A04D', label: 'Waiting for login…' },
  posted: { color: '#4DAB9A', label: 'Posted' },
  failed: { color: '#FF4D4D', label: 'Failed' },
};

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
  const [retryError, setRetryError] = useState<{ platform: string; message: string } | null>(null);

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

  async function retry(platform: string): Promise<boolean> {
    setRetrying(platform);
    setRetryError(null);
    try {
      const res = await fetch(`/api/tasks/${task.id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setRetryError({ platform, message: body?.error ?? `HTTP ${res.status}` });
        return false;
      }
      onChange();
      return true;
    } catch {
      setRetryError({ platform, message: 'Request failed — is the dashboard reachable?' });
      return false;
    } finally {
      setRetrying(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {postings.map(p => {
        const { color, label } = POSTING_COLORS[p.status];
        const name = names[p.platform] ?? p.platform;
        if (p.status === 'failed') {
          return (
            <FailedChip
              key={p.platform}
              posting={p}
              name={name}
              retrying={retrying === p.platform}
              retryError={retryError?.platform === p.platform ? retryError.message : null}
              onRetry={() => retry(p.platform)}
            />
          );
        }
        const chip = (
          <span
            className="inline-flex items-center px-2 py-0.5 text-xs rounded-full whitespace-nowrap"
            style={{ backgroundColor: `${color}20`, color }}
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
        return <span key={p.platform}>{chip}</span>;
      })}
    </div>
  );
}

function FailedChip({
  posting,
  name,
  retrying,
  retryError,
  onRetry,
}: {
  posting: AdPosting;
  name: string;
  retrying: boolean;
  retryError: string | null;
  onRetry: () => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);
  const { color, label } = POSTING_COLORS.failed;

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <span ref={containerRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="inline-flex items-center px-2 py-0.5 text-xs rounded-full whitespace-nowrap hover:brightness-125 transition"
        style={{ backgroundColor: `${color}20`, color }}
      >
        {name}: {label}
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-20 w-80 rounded border border-[#2F2F2F] bg-[#202020] p-3 text-left space-y-2">
          <div className="text-xs font-medium uppercase tracking-wide text-[#FF4D4D]">
            {name} posting failed
          </div>
          <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap font-sans text-xs text-[#D4D4D4]">
            {posting.lastError || 'No error message recorded.'}
          </pre>
          <div className="text-xs text-[#6B6B6B]">
            Attempts: {posting.attempts}
          </div>
          {posting.screenshotPath && (
            <a
              href={`/api/files/${encodeURI(posting.screenshotPath)}`}
              target="_blank"
              rel="noreferrer"
              className="block text-xs text-[#4DAB9A] hover:underline"
            >
              View screenshot
            </a>
          )}
          <button
            type="button"
            disabled={retrying}
            onClick={async () => {
              if (await onRetry()) setOpen(false);
            }}
            className="px-2 py-0.5 text-xs font-medium rounded bg-[#2F2F2F] text-[#9B9B9B] hover:bg-[#373737] hover:text-white transition-colors disabled:opacity-50"
          >
            Retry
          </button>
          {retryError && <div className="text-xs text-[#FF4D4D]">{retryError}</div>}
        </div>
      )}
    </span>
  );
}
