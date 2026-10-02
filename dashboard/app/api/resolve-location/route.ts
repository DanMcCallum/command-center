/**
 * POST /api/resolve-location  { "location": "Elko, NV" }
 *
 * The one place county/state resolution happens. Turbopack will not bundle
 * imports from outside dashboard/, so the posting worker cannot import
 * lib/location.ts directly (see AGENTS.md); it calls this route instead, the
 * same way it calls every other agent-facing endpoint. That keeps one
 * implementation and keeps TYPESAFE_API_KEY on the dashboard host only.
 *
 * Agent-authenticated: the body describes a task the operator owns, and the
 * route spends money on an inference call.
 */
import { NextResponse } from 'next/server';
import { requireAgentToken } from '@/lib/agent-auth';
import { loadCountyCandidates } from '@/lib/kb-counties';
import { resolveLocation } from '@/lib/location';
import path from 'node:path';

export const dynamic = 'force-dynamic';

const PROJECT_ROOT = path.resolve(process.cwd(), '..');

export async function POST(request: Request) {
  const denied = requireAgentToken(request);
  if (denied) return denied;

  let body: { location?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (typeof body.location !== 'string' || !body.location.trim()) {
    return NextResponse.json({ error: '"location" is required' }, { status: 400 });
  }

  try {
    const countyCandidates = await loadCountyCandidates(PROJECT_ROOT);
    const resolved = await resolveLocation(body.location, { countyCandidates });
    return NextResponse.json(resolved);
  } catch (err) {
    // An unsplittable location is the caller's problem to fix, not a 500.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 422 },
    );
  }
}
