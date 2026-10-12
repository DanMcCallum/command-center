'use client';

import { useEffect, useRef, useState } from 'react';
import type { CallsErrorBody } from './calls-types';

export type CallsLoad<T> =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ok'; data: T }
  | { state: 'error'; status: number; error: string };

/**
 * GET one `/api/calls/*` route and track its state. A 502 from the proxy
 * carries `{error: "call service unreachable"}`; a network failure gets the
 * same text. `url` null means "nothing to fetch yet" (idle). Bump `reloadKey`
 * to fetch the same url again (after a write); a reload keeps showing the old data until
 * the new answer arrives.
 */
export function useCallsGet<T>(url: string | null, reloadKey = 0): CallsLoad<T> {
  const [load, setLoad] = useState<CallsLoad<T>>(url ? { state: 'loading' } : { state: 'idle' });
  const lastUrl = useRef<string | null>(null);

  useEffect(() => {
    const sameUrl = lastUrl.current === url;
    lastUrl.current = url;
    if (!url) {
      setLoad({ state: 'idle' });
      return;
    }
    let cancelled = false;
    setLoad(prev => (sameUrl && prev.state === 'ok' ? prev : { state: 'loading' }));
    fetch(url, { cache: 'no-store' })
      .then(async r => {
        const body = (await r.json().catch(() => null)) as T | CallsErrorBody | null;
        if (cancelled) return;
        if (r.ok && body) return setLoad({ state: 'ok', data: body as T });
        setLoad({
          state: 'error',
          status: r.status,
          error: (body as CallsErrorBody | null)?.error ?? `HTTP ${r.status}`,
        });
      })
      .catch(() => {
        if (!cancelled) setLoad({ state: 'error', status: 502, error: 'call service unreachable' });
      });
    return () => {
      cancelled = true;
    };
  }, [url, reloadKey]);

  return load;
}
