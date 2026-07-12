import { NextResponse } from 'next/server';
import { requireAgentToken } from '@/lib/agent-auth';
import { mutateTask } from '@/lib/data';
import type { PostingStatus } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Statuses the agent may report. `queued` is excluded — only the Publish
// endpoint queues, and re-queueing via report would bypass its attempts
// accounting.
const REPORTABLE = new Set<PostingStatus>([
  'posting',
  'awaiting_auth',
  'posted',
  'failed',
]);

// The agent may only report on a job it owns, i.e. one it has claimed
// (`posting`) or parked for operator login (`awaiting_auth`). Terminal states
// belong to the operator's Publish button; `queued` means claim first.
const AGENT_OWNED = new Set<PostingStatus>(['posting', 'awaiting_auth']);

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value) {
    throw new Error(`"${name}" must be a non-empty string when present`);
  }
  return value;
}

/**
 * Agent-facing: report the outcome of a claimed publish job
 * (specs/local-publish-2-local-agent.md). Flips one posting between the
 * agent-owned states and the terminal posted/failed states, carrying whatever
 * result fields the agent has (lastError, listingUrl, screenshotPath).
 */
export async function POST(request: Request) {
  const denied = requireAgentToken(request);
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { taskId, platform, status } = body;
  if (
    typeof taskId !== 'string' ||
    !taskId ||
    typeof platform !== 'string' ||
    !platform
  ) {
    return NextResponse.json(
      { error: 'Body must include {taskId, platform, status}' },
      { status: 400 },
    );
  }
  if (
    typeof status !== 'string' ||
    !REPORTABLE.has(status as PostingStatus)
  ) {
    return NextResponse.json(
      { error: `"status" must be one of: ${[...REPORTABLE].join(', ')}` },
      { status: 400 },
    );
  }

  let lastError: string | undefined;
  let listingUrl: string | undefined;
  let screenshotPath: string | undefined;
  try {
    lastError = optionalString(body.lastError, 'lastError');
    listingUrl = optionalString(body.listingUrl, 'listingUrl');
    screenshotPath = optionalString(body.screenshotPath, 'screenshotPath');
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Invalid body' },
      { status: 400 },
    );
  }

  let conflict: string | null = null;
  const result = await mutateTask(taskId, task => {
    const postings = task.postings ?? [];
    const existing = postings.find(p => p.platform === platform);
    if (!existing || !AGENT_OWNED.has(existing.status)) {
      conflict = existing
        ? `posting for "${platform}" is ${existing.status} — the agent only owns posting/awaiting_auth jobs`
        : `no posting for "${platform}" on this task`;
      return null;
    }
    const next = postings.map(p => {
      if (p.platform !== platform) return p;
      const updated = {
        ...p,
        status: status as PostingStatus,
        ...(lastError !== undefined && { lastError }),
        ...(listingUrl !== undefined && { listingUrl }),
        ...(screenshotPath !== undefined && { screenshotPath }),
        ...(status === 'posted' && { postedAt: new Date().toISOString() }),
      };
      return updated;
    });
    return { ...task, postings: next };
  });

  if (result.outcome === 'not_found') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (result.outcome === 'rejected') {
    return NextResponse.json({ error: conflict }, { status: 409 });
  }
  return NextResponse.json(result.task);
}
