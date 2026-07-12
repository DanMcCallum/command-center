import { NextResponse } from 'next/server';
import { requireAgentToken } from '@/lib/agent-auth';
import { mutateTask } from '@/lib/data';

export const dynamic = 'force-dynamic';

/**
 * Agent-facing: atomically claim one queued publish job
 * (specs/job-model-agent-facing-api.md, US-005). The queued -> posting flip
 * happens inside the data.ts write mutex, so two identical claims can never
 * both succeed — the loser sees the entry already `posting` and gets a 409.
 */
export async function POST(request: Request) {
  const denied = requireAgentToken(request);
  if (denied) return denied;

  let body: { taskId?: unknown; platform?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { taskId, platform } = body;
  if (
    typeof taskId !== 'string' ||
    !taskId ||
    typeof platform !== 'string' ||
    !platform
  ) {
    return NextResponse.json(
      { error: 'Body must include {taskId, platform}' },
      { status: 400 },
    );
  }

  let conflict: string | null = null;
  const result = await mutateTask(taskId, task => {
    const postings = task.postings ?? [];
    const existing = postings.find(p => p.platform === platform);
    if (!existing || existing.status !== 'queued') {
      conflict = existing
        ? `posting for "${platform}" is ${existing.status}, not queued`
        : `no publish job for "${platform}" on this task`;
      return null;
    }
    const next = postings.map(p =>
      p.platform === platform ? { ...p, status: 'posting' as const } : p,
    );
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
