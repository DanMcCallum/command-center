import { NextResponse } from 'next/server';
import {
  CaptureConfigError,
  CaptureRequestError,
  captureServerFetch,
  requireLiveViewPlatform,
} from '@/lib/capture-server';

export const dynamic = 'force-dynamic';

/**
 * POST { platform } — starts a live-view login capture on the worker
 * capture-server and returns { liveViewUrl, sessionId } for the panel's
 * iframe (specs/live-view-browser.md, US-006).
 */
export async function POST(request: Request) {
  let platform: unknown;
  try {
    ({ platform } = (await request.json()) as { platform?: unknown });
  } catch {
    return NextResponse.json(
      { error: 'Request body is not valid JSON' },
      { status: 400 },
    );
  }
  if (typeof platform !== 'string' || !platform) {
    return NextResponse.json(
      { error: 'Missing "platform" in request body' },
      { status: 400 },
    );
  }

  try {
    await requireLiveViewPlatform(platform);
    const upstream = await captureServerFetch('/capture/start', {
      method: 'POST',
      body: JSON.stringify({ platform }),
    });
    const data = (await upstream.json().catch(() => null)) as {
      sessionId?: string;
      liveViewUrl?: string;
      error?: string;
    } | null;
    if (!upstream.ok) {
      return NextResponse.json(
        { error: data?.error ?? `capture-server returned ${upstream.status}` },
        { status: upstream.status },
      );
    }
    return NextResponse.json({
      liveViewUrl: data?.liveViewUrl,
      sessionId: data?.sessionId,
    });
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
