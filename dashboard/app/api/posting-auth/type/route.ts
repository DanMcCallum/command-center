import { NextResponse } from 'next/server';
import {
  CaptureConfigError,
  CaptureRequestError,
  captureServerFetch,
} from '@/lib/capture-server';

export const dynamic = 'force-dynamic';

/**
 * POST { sessionId, text } — relays pasted text to the worker capture-server,
 * which types it into the focused field of the captive browser
 * (specs/live-view-browser.md, US-008). OS-clipboard paste cannot cross into
 * the sandboxed noVNC iframe, so the panel's paste box goes through here.
 * The text is never logged and never stored.
 */
export async function POST(request: Request) {
  let sessionId: unknown;
  let text: unknown;
  try {
    ({ sessionId, text } = (await request.json()) as {
      sessionId?: unknown;
      text?: unknown;
    });
  } catch {
    return NextResponse.json(
      { error: 'Request body is not valid JSON' },
      { status: 400 },
    );
  }
  if (typeof sessionId !== 'string' || !sessionId) {
    return NextResponse.json(
      { error: 'Missing "sessionId" in request body' },
      { status: 400 },
    );
  }
  if (typeof text !== 'string' || !text) {
    return NextResponse.json(
      { error: 'Missing "text" in request body' },
      { status: 400 },
    );
  }

  try {
    const upstream = await captureServerFetch('/capture/type', {
      method: 'POST',
      body: JSON.stringify({ sessionId, text }),
    });
    const data = (await upstream.json().catch(() => null)) as {
      typed?: boolean;
      error?: string;
    } | null;
    if (!upstream.ok) {
      return NextResponse.json(
        { error: data?.error ?? `capture-server returned ${upstream.status}` },
        { status: upstream.status },
      );
    }
    return NextResponse.json({ typed: data?.typed === true });
  } catch (err) {
    if (err instanceof CaptureRequestError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const status = err instanceof CaptureConfigError ? 503 : 502;
    return NextResponse.json(
      { error: (err as Error).message },
      { status },
    );
  }
}
