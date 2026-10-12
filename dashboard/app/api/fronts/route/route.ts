import { NextResponse } from 'next/server';
import { requireAgentToken } from '@/lib/agent-auth';
import { routeSession } from '@/lib/front-router';
import { getFrontConfigs } from '@/lib/fronts';

export const dynamic = 'force-dynamic';

/**
 * Lane routing for the session-end pipeline (workers/fronts/route-session.sh).
 * Bearer-guarded. Body: { summary, cwd?, filesTouched? }. Returns
 * { fronts: [{slug, probability}], confidence, method, cwdMatch }.
 */
export async function POST(request: Request) {
  const denied = requireAgentToken(request);
  if (denied) return denied;
  let body: { summary?: unknown; cwd?: unknown; filesTouched?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (typeof body.summary !== 'string' || !body.summary.trim()) {
    return NextResponse.json({ error: 'summary is required' }, { status: 400 });
  }
  const cwd = typeof body.cwd === 'string' ? body.cwd : null;
  const filesTouched = Array.isArray(body.filesTouched)
    ? body.filesTouched.filter((f): f is string => typeof f === 'string')
    : [];
  try {
    const fronts = await getFrontConfigs();
    const result = await routeSession({ summary: body.summary, cwd, filesTouched }, fronts);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: `Routing failed: ${(err as Error).message}` }, { status: 500 });
  }
}
