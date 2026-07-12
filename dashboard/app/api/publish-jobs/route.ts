import { NextResponse } from 'next/server';
import { requireAgentToken } from '@/lib/agent-auth';
import { getTasks, recordAgentSeen } from '@/lib/data';

export const dynamic = 'force-dynamic';

/**
 * Agent-facing: list every queued publish job across all tasks
 * (specs/job-model-agent-facing-api.md, US-004).
 */
export async function GET(request: Request) {
  const denied = requireAgentToken(request);
  if (denied) return denied;
  const tasks = await getTasks();
  const jobs = tasks.flatMap(task =>
    (task.postings ?? [])
      .filter(p => p.status === 'queued')
      .map(p => ({
        taskId: task.id,
        taskTitle: task.title,
        platform: p.platform,
        queuedAt: p.queuedAt,
        attempts: p.attempts,
      })),
  );
  await recordAgentSeen();
  return NextResponse.json({ jobs });
}
