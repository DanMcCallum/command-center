'use client';

import { useEffect, useState } from 'react';
import { useAgentLiveness } from '@/lib/agent-liveness';
import type { PostingStatus, Task } from '@/lib/types';

interface PlatformInfo {
  key: string;
  name: string;
}

const IN_FLIGHT: PostingStatus[] = ['queued', 'posting', 'awaiting_auth'];

const OFFLINE_WARNING =
  'Poster agent offline — start it on your machine. Publishing still queues the job for when it comes back.';

let platformsPromise: Promise<PlatformInfo[]> | null = null;

function loadEnabledPlatforms(): Promise<PlatformInfo[]> {
  if (!platformsPromise) {
    platformsPromise = fetch('/api/posting-platforms', { cache: 'no-store' })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(
        (data: {
          platforms: Record<string, { display_name?: string; enabled?: boolean }>;
        }) =>
          Object.entries(data.platforms)
            .filter(([, cfg]) => cfg.enabled === true)
            .map(([key, cfg]) => ({ key, name: cfg.display_name ?? key })),
      )
      .catch(() => {
        platformsPromise = null;
        return [];
      });
  }
  return platformsPromise;
}

interface Props {
  task: Task;
  onChange: () => void;
}

export default function PublishButtons({ task, onChange }: Props) {
  const [platforms, setPlatforms] = useState<PlatformInfo[]>([]);
  const [publishing, setPublishing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { online } = useAgentLiveness();
  const offline = online === false;

  useEffect(() => {
    let cancelled = false;
    loadEnabledPlatforms().then(p => {
      if (!cancelled) setPlatforms(p);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (platforms.length === 0) return null;

  async function publish(platform: string) {
    setPublishing(platform);
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${task.id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(
          (data as { error?: string } | null)?.error ?? `HTTP ${res.status}`,
        );
      }
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPublishing(null);
    }
  }

  return (
    <div>
      <div className="text-xs font-medium text-[#6B6B6B] uppercase tracking-wide mb-1">
        Publish
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {platforms.map(({ key, name }) => {
          const posting = task.postings?.find(p => p.platform === key);
          const inFlight =
            posting !== undefined && IN_FLIGHT.includes(posting.status);
          return (
            <span key={key} className="inline-flex items-center gap-2">
              <span className="text-xs text-[#9B9B9B]">{name}</span>
              <button
                type="button"
                disabled={inFlight || publishing === key}
                onClick={() => publish(key)}
                title={offline ? OFFLINE_WARNING : undefined}
                className={
                  'px-2.5 py-1 text-xs font-medium rounded bg-[#2F2F2F] hover:bg-[#373737] transition-colors disabled:opacity-50 disabled:hover:bg-[#2F2F2F] ' +
                  (offline
                    ? 'text-[#D4A04D] ring-1 ring-inset ring-[#D4A04D]/40'
                    : 'text-[#4DAB9A]')
                }
              >
                {posting?.status === 'posted' ? 'Publish again' : 'Publish'}
              </button>
            </span>
          );
        })}
      </div>
      {offline && (
        <div className="text-xs text-[#D4A04D] mt-2">{OFFLINE_WARNING}</div>
      )}
      {error && <div className="text-xs text-[#FF4D4D] mt-2">{error}</div>}
    </div>
  );
}
