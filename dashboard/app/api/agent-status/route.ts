import { NextResponse } from 'next/server';
import { requireAgentToken } from '@/lib/agent-auth';
import { getAgentStatus, saveAgentPlatformReport } from '@/lib/data';
import type { AgentPlatformSession } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Platform keys become UI labels and are cross-referenced against config —
// same pattern the other agent routes enforce.
const PLATFORM_PATTERN = /^[a-z0-9_]+$/;

/**
 * Browser-facing: the poster agent's liveness (lastSeenAt, stamped by its
 * GET /api/publish-jobs polls and its session reports) plus its last
 * per-platform session report (specs/local-publish-3-decommission.md, US-001).
 */
export async function GET() {
  return NextResponse.json(await getAgentStatus());
}

/**
 * Agent-facing: replace the stored per-platform session report. The agent
 * sends this on startup and after every login capture, from a scan of its
 * local auth/ dir — names, mtimes, expiry timestamps, never cookie values.
 */
export async function POST(request: Request) {
  const denied = requireAgentToken(request);
  if (denied) return denied;

  let body: { platforms?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!Array.isArray(body.platforms)) {
    return NextResponse.json(
      { error: 'Body must be {platforms: [{platform, hasSession, capturedAt, earliestCookieExpiry?}]}' },
      { status: 400 },
    );
  }

  const platforms: AgentPlatformSession[] = [];
  for (const entry of body.platforms as Array<Record<string, unknown>>) {
    const { platform, hasSession, capturedAt, earliestCookieExpiry } = entry ?? {};
    if (
      typeof platform !== 'string' ||
      !PLATFORM_PATTERN.test(platform) ||
      typeof hasSession !== 'boolean' ||
      (capturedAt !== null && typeof capturedAt !== 'string') ||
      (earliestCookieExpiry !== undefined && typeof earliestCookieExpiry !== 'string')
    ) {
      return NextResponse.json(
        { error: `Invalid platform entry${typeof platform === 'string' ? ` for "${platform}"` : ''}` },
        { status: 400 },
      );
    }
    // Rebuild each entry so only the known fields are ever stored.
    platforms.push({
      platform,
      hasSession,
      capturedAt: capturedAt ?? null,
      ...(earliestCookieExpiry !== undefined && { earliestCookieExpiry }),
    });
  }

  await saveAgentPlatformReport(platforms);
  return NextResponse.json({ ok: true });
}
