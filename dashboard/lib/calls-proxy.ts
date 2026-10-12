/**
 * Shared plumbing for the /api/calls/* proxy routes (specs/calls-dashboard.md
 * US-010). Each route is one `callsApi` call: query strings and JSON bodies
 * go upstream as-is, and the answer comes back as the upstream JSON or the
 * `mapCallsError` body. The token stays in calls-client.ts.
 */
import { NextResponse } from 'next/server';
import type { CallsResult } from './calls-client';

export const INVALID_JSON = 'body must be valid JSON';

/** The proxy's HTTP answer for a client result. Never cached. */
export function callsResponse<T>(result: CallsResult<T>): NextResponse {
  return NextResponse.json(result.ok ? result.data : result.body, {
    status: result.status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

/**
 * Reads the request body for forwarding. An empty body becomes `{}`; anything
 * that is not JSON is refused here with a 400 (the Python side would refuse a
 * non-object too, so this only saves a round trip).
 */
export async function readJsonBody(
  request: Request,
): Promise<{ ok: true; body: unknown } | { ok: false; response: NextResponse }> {
  const text = await request.text();
  if (!text.trim()) return { ok: true, body: {} };
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: INVALID_JSON }, { status: 400 }),
    };
  }
}
