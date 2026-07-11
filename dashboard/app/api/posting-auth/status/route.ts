import { NextResponse } from 'next/server';
import {
  CaptureConfigError,
  CaptureRequestError,
  captureServerFetch,
  requireLiveViewPlatform,
} from '@/lib/capture-server';

export const dynamic = 'force-dynamic';

/**
 * GET ?sessionId=…[&platform=…] — proxies the capture-server login-success
 * check and returns { loggedIn } (specs/live-view-browser.md, US-006). When
 * the optional platform is supplied it is validated as live-view, same as
 * the connect route (sessions can only exist for live-view platforms — the
 * capture-server enforces that at start).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('sessionId');
  if (!sessionId) {
    return NextResponse.json(
      { error: 'Missing "sessionId" query parameter' },
      { status: 400 },
    );
  }

  try {
    const platform = url.searchParams.get('platform');
    if (platform) await requireLiveViewPlatform(platform);
    const upstream = await captureServerFetch(
      `/capture/status?sessionId=${encodeURIComponent(sessionId)}`,
    );
    const data = (await upstream.json().catch(() => null)) as {
      loggedIn?: boolean;
      error?: string;
    } | null;
    if (!upstream.ok) {
      return NextResponse.json(
        { error: data?.error ?? `capture-server returned ${upstream.status}` },
        { status: upstream.status },
      );
    }
    return NextResponse.json({ loggedIn: data?.loggedIn === true });
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
