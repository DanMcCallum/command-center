import { NextResponse } from 'next/server';
import { requireAgentToken } from '@/lib/agent-auth';
import { getSeen, pruneSeen } from '@/lib/buywander';

export const dynamic = 'force-dynamic';

/**
 * Agent-facing (bearer AGENT_TOKEN): the auction ids earlier scans already
 * scored, so tonight's run only scores lots that are new.
 */
export async function GET(request: Request) {
  const denied = requireAgentToken(request);
  if (denied) return denied;
  const seen = pruneSeen(await getSeen());
  return NextResponse.json({ ids: Object.keys(seen) });
}
