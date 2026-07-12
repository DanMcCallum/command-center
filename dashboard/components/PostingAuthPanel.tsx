'use client';

import { useEffect, useState } from 'react';
import { useAgentLiveness } from '@/lib/agent-liveness';
import type { AgentPlatformSession } from '@/lib/types';

interface PlatformRow {
  platform: string;
  displayName: string;
}

export default function PostingAuthPanel() {
  const { online, platforms: reported } = useAgentLiveness();
  const [rows, setRows] = useState<PlatformRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/posting-platforms', { cache: 'no-store' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        if (cancelled) return;
        const next: PlatformRow[] = Object.entries(
          data.platforms as Record<string, { display_name: string; enabled: boolean }>,
        )
          .filter(([, cfg]) => cfg.enabled)
          .map(([key, cfg]) => ({ platform: key, displayName: cfg.display_name }));
        setRows(next);
        setError(null);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const bySession = new Map<string, AgentPlatformSession>(
    reported.map(s => [s.platform, s]),
  );

  return (
    <div className="bg-[#202020] border border-[#373737] rounded-lg p-5 space-y-4">
      <div>
        <h2 className="text-base font-semibold">Marketplace logins</h2>
        <p className="text-xs text-[#6B6B6B] mt-1">
          Sessions are established on your machine when you click Publish — if a
          login is needed, the poster agent opens a browser window there. This
          panel shows what the agent last reported; nothing is stored on the
          server.
        </p>
      </div>

      {online !== null && (
        <div className="flex items-center gap-2 text-xs text-[#9B9B9B]">
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{ backgroundColor: online ? '#4DAB9A' : '#D4A04D' }}
          />
          {online ? 'Poster agent online' : 'Poster agent offline'}
        </div>
      )}

      {error && <div className="text-xs text-[#FF4D4D]">{error}</div>}

      {!rows && !error && (
        <div className="text-sm text-[#6B6B6B]">Loading platforms…</div>
      )}

      {rows?.map(r => {
        const s = bySession.get(r.platform);
        return (
          <div
            key={r.platform}
            className="flex items-center justify-between gap-3 text-sm"
          >
            <span className="text-white">{r.displayName}</span>
            {!s ? (
              <span className="text-[#6B6B6B] whitespace-nowrap">
                No report from agent yet
              </span>
            ) : s.hasSession ? (
              <span className="text-[#4DAB9A] whitespace-nowrap">
                Session held
                {s.capturedAt &&
                  ` (captured ${new Date(s.capturedAt).toLocaleDateString()}`}
                {s.capturedAt &&
                  s.earliestCookieExpiry &&
                  `, expires ${new Date(s.earliestCookieExpiry).toLocaleDateString()}`}
                {s.capturedAt && ')'}
              </span>
            ) : (
              <span className="text-[#E5A54B] whitespace-nowrap">No session</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
