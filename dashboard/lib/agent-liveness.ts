'use client';

import { useEffect, useState } from 'react';
import type { AgentStatus } from '@/lib/types';

// The agent's default poll is 15s; AGENT_POLL_SECONDS is operator-tunable but
// the server can't see the tuned value, so "online" is fixed at 3x the
// default poll interval (specs/local-publish-3-decommission.md, US-002).
const ONLINE_WINDOW_MS = 45_000;
const REFRESH_MS = 15_000;

export interface AgentLiveness {
  /** null until the first /api/agent-status fetch resolves. */
  online: boolean | null;
  lastSeenAt: string | null;
}

// One shared poller no matter how many components mount the hook.
let current: AgentLiveness = { online: null, lastSeenAt: null };
const subscribers = new Set<(liveness: AgentLiveness) => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function computeOnline(lastSeenAt: string | null): boolean {
  if (!lastSeenAt) return false;
  const seen = Date.parse(lastSeenAt);
  return Number.isFinite(seen) && Date.now() - seen <= ONLINE_WINDOW_MS;
}

async function refresh() {
  try {
    const res = await fetch('/api/agent-status', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as AgentStatus;
    current = {
      online: computeOnline(data.lastSeenAt),
      lastSeenAt: data.lastSeenAt,
    };
  } catch {
    // Fetch failed: recompute from the last known lastSeenAt so a stale
    // "online" ages out instead of sticking; stay null before the first load.
    if (current.online !== null) {
      current = { ...current, online: computeOnline(current.lastSeenAt) };
    }
  }
  subscribers.forEach(fn => fn(current));
}

export function useAgentLiveness(): AgentLiveness {
  const [liveness, setLiveness] = useState<AgentLiveness>(current);

  useEffect(() => {
    subscribers.add(setLiveness);
    setLiveness(current);
    if (timer === null) {
      refresh();
      timer = setInterval(refresh, REFRESH_MS);
    }
    return () => {
      subscribers.delete(setLiveness);
      if (subscribers.size === 0 && timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
  }, []);

  return liveness;
}
