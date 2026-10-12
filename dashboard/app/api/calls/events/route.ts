import { NextResponse } from 'next/server';
import { callsApi } from '@/lib/calls-client';
import { relaySse } from '@/lib/sse-relay';

export const dynamic = 'force-dynamic';

// Upstream must answer with headers within this long, else 502 (a hung
// connect must not become a hanging stream). The stream itself has no limit.
const CONNECT_TIMEOUT_MS = 8000;

/**
 * GET /api/calls/events: the Python pop stream (`/api/v1/events`) re-emitted
 * with relay heartbeats, so the browser only ever talks to the command center.
 * The bearer token stays in calls-client.ts.
 */
export async function GET(request: Request) {
  const upstreamAbort = new AbortController();
  const stop = () => upstreamAbort.abort();
  request.signal.addEventListener('abort', stop);
  const connectTimer = setTimeout(stop, CONNECT_TIMEOUT_MS);

  const result = await callsApi.events(upstreamAbort.signal);
  clearTimeout(connectTimer);
  if (!result.ok) {
    request.signal.removeEventListener('abort', stop);
    return NextResponse.json(result.body, {
      status: result.status,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const stream = relaySse(result.response.body!, {
    signal: request.signal,
    onEnd: () => {
      request.signal.removeEventListener('abort', stop);
      stop();
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
