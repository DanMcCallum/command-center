/**
 * Live call pops for the `/calls` page: an EventSource on the Next.js relay
 * (`/api/calls/events`) plus the recent calls list, re-fetched on every
 * (re)connect so nothing published while the stream was down is lost.
 *
 * `startCallStream` is the plumbing as plain callbacks (unit-tested with a fake
 * EventSource); `useCallStream` is the React state around it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PingPop, PopEvent, RecentCall, RecentCallsResponse } from './calls-types';

/** The part of the browser EventSource this module uses. */
export interface EventSourceLike {
  readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  close(): void;
}

export type EventSourceCtor = new (url: string) => EventSourceLike;

export type StreamStatus = 'connecting' | 'open' | 'reconnecting';

/** EventSource.CLOSED: the browser gave up (e.g. the relay answered 502 JSON). */
const CLOSED = 2;

export interface CallStreamHandlers {
  /** Fires on the first connect and on every reconnect. */
  onOpen(): void;
  onPop(pop: Exclude<PopEvent, PingPop>): void;
  onPing(ping: PingPop): void;
  onStatus(status: StreamStatus): void;
}

export interface CallStreamOptions {
  url?: string;
  EventSourceImpl?: EventSourceCtor;
  /** Delay before a fresh EventSource when the browser stopped retrying. */
  retryMs?: number;
  setTimeoutImpl?: (fn: () => void, ms: number) => unknown;
  clearTimeoutImpl?: (handle: unknown) => void;
}

/** One `data:` payload as a pop, or null for anything that is not one. */
export function parsePopFrame(data: string): PopEvent | null {
  try {
    const parsed = JSON.parse(data) as unknown;
    if (parsed && typeof parsed === 'object' && typeof (parsed as { kind?: unknown }).kind === 'string') {
      return parsed as PopEvent;
    }
  } catch {
    // not JSON: ignore the frame
  }
  return null;
}

/**
 * Opens the stream and keeps it open. EventSource retries a dropped stream by
 * itself; when it gives up for good (readyState CLOSED, which happens when the
 * relay answers 502 JSON because the call service is down), a new one is
 * opened after `retryMs`. Returns a stop function.
 */
export function startCallStream(handlers: CallStreamHandlers, opts: CallStreamOptions = {}): () => void {
  const url = opts.url ?? '/api/calls/events';
  const Impl = opts.EventSourceImpl ?? (globalThis as unknown as { EventSource: EventSourceCtor }).EventSource;
  const retryMs = opts.retryMs ?? 5000;
  const setT = opts.setTimeoutImpl ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearT = opts.clearTimeoutImpl ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));

  let stopped = false;
  let source: EventSourceLike | null = null;
  let retry: unknown = null;

  const connect = () => {
    retry = null;
    if (stopped) return;
    const es = new Impl(url);
    source = es;
    es.onopen = () => {
      if (stopped || source !== es) return;
      handlers.onStatus('open');
      handlers.onOpen();
    };
    es.onmessage = ev => {
      if (stopped || source !== es) return;
      const pop = parsePopFrame(ev.data);
      if (!pop) return;
      if (pop.kind === 'ping') handlers.onPing(pop);
      else handlers.onPop(pop);
    };
    es.onerror = () => {
      if (stopped || source !== es) return;
      handlers.onStatus('reconnecting');
      if (es.readyState === CLOSED && retry === null) {
        es.close();
        retry = setT(connect, retryMs);
      }
    };
  };

  handlers.onStatus('connecting');
  connect();

  return () => {
    stopped = true;
    if (retry !== null) clearT(retry);
    source?.close();
    source = null;
  };
}

const MAX_POPS = 50;

/** Newest pop first, capped at MAX_POPS. */
export function prependPop<T>(prev: T[], pop: T, max = MAX_POPS): T[] {
  return [pop, ...prev].slice(0, max);
}

export interface CallStreamState {
  pops: Exclude<PopEvent, PingPop>[];
  recent: RecentCall[];
  /** Error text from the last recent-calls fetch, or null. */
  recentError: string | null;
  recentLoaded: boolean;
  status: StreamStatus;
  /** Epoch ms when the last ping frame arrived. */
  lastPingAt: number | null;
  refreshRecent(): void;
}

export function useCallStream(opts: CallStreamOptions & { fetchImpl?: typeof fetch } = {}): CallStreamState {
  const [pops, setPops] = useState<Exclude<PopEvent, PingPop>[]>([]);
  const [recent, setRecent] = useState<RecentCall[]>([]);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [recentLoaded, setRecentLoaded] = useState(false);
  const [status, setStatus] = useState<StreamStatus>('connecting');
  const [lastPingAt, setLastPingAt] = useState<number | null>(null);
  const optsRef = useRef(opts);

  const refreshRecent = useCallback(() => {
    const f = optsRef.current.fetchImpl ?? fetch;
    f('/api/calls/recent', { cache: 'no-store' })
      .then(async r => {
        const body = (await r.json().catch(() => null)) as
          | RecentCallsResponse
          | { error?: string }
          | null;
        if (r.ok && body && Array.isArray((body as RecentCallsResponse).events)) {
          setRecent((body as RecentCallsResponse).events);
          setRecentError(null);
        } else {
          setRecentError((body as { error?: string } | null)?.error ?? `HTTP ${r.status}`);
        }
      })
      .catch(() => setRecentError('call service unreachable'))
      .finally(() => setRecentLoaded(true));
  }, []);

  useEffect(() => {
    return startCallStream(
      {
        onOpen: refreshRecent,
        onPop: pop => {
          setPops(prev => prependPop(prev, pop));
          refreshRecent();
        },
        onPing: () => setLastPingAt(Date.now()),
        onStatus: setStatus,
      },
      optsRef.current,
    );
  }, [refreshRecent]);

  useEffect(() => {
    refreshRecent();
  }, [refreshRecent]);

  return { pops, recent, recentError, recentLoaded, status, lastPingAt, refreshRecent };
}
