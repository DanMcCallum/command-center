'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { BadgeLevel, OpsBadge, OpsSummary } from '@/lib/calls-types';
import type { StreamStatus } from '@/lib/use-call-stream';

const LEVEL_CLASS: Record<BadgeLevel, string> = {
  ok: 'bg-[#4DAB9A20] text-[#4DAB9A]',
  warn: 'bg-[#D4A04D20] text-[#D4A04D]',
  alarm: 'bg-[#FF4D4D20] text-[#FF4D4D]',
};

const REFRESH_MS = 30_000;

interface Props {
  /** Omit on pages without a live stream. */
  stream?: StreamStatus;
  /** Epoch ms of the last ping frame. */
  lastPingAt?: number | null;
}

/**
 * The ops badges from `/api/calls/ops` (levels decided by the Python
 * `ops_badges`, never re-derived here), re-fetched every 30 s.
 */
export default function CallsOpsStrip({ stream, lastPingAt }: Props) {
  const [badges, setBadges] = useState<OpsBadge[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch('/api/calls/ops', { cache: 'no-store' })
      .then(async r => {
        const body = (await r.json().catch(() => null)) as (OpsSummary & { error?: string }) | null;
        if (r.ok && body && Array.isArray(body.badges)) {
          setBadges(body.badges);
          setError(null);
        } else {
          setError(r.status === 502 ? 'call service unreachable' : body?.error ?? `HTTP ${r.status}`);
        }
      })
      .catch(() => setError('call service unreachable'));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  // A stream drop or reconnect is news about the service: re-check at once
  // instead of waiting out the 30 s interval.
  useEffect(() => {
    if (stream === 'open' || stream === 'reconnecting') load();
  }, [stream, load]);

  return (
    <div
      className="flex flex-wrap items-center gap-2 border border-[#2F2F2F] rounded-lg bg-[#1A1A1A] px-4 py-2 text-xs font-mono"
      data-testid="calls-ops-strip"
      data-state={error ? 'unreachable' : badges ? 'ok' : 'loading'}
    >
      {error ? (
        <span className={'px-1.5 py-0.5 rounded ' + LEVEL_CLASS.alarm} data-testid="calls-unreachable">
          {error}
        </span>
      ) : badges === null ? (
        <span className="text-[#6B6B6B]">loading ops…</span>
      ) : (
        badges.map(b => (
          <span
            key={b.label}
            className={'px-1.5 py-0.5 rounded ' + LEVEL_CLASS[b.level]}
            data-level={b.level}
            title={b.label}
          >
            {b.text}
          </span>
        ))
      )}
      <span className="ml-auto flex items-center gap-3">
        {stream === 'reconnecting' && (
          <span className="text-[#D4A04D]" data-testid="calls-stream-reconnecting">
            reconnecting
          </span>
        )}
        {stream === 'connecting' && <span className="text-[#6B6B6B]">connecting</span>}
        {lastPingAt != null && (
          <span className="text-[#6B6B6B]">stream ok {new Date(lastPingAt).toLocaleTimeString()}</span>
        )}
        <Link href="/calls/ops" className="text-[#6B6B6B] hover:text-white transition-colors">
          detail
        </Link>
      </span>
    </div>
  );
}
