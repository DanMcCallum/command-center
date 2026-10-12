import { NextResponse } from 'next/server';
import { createTask, getFrontSuggestion, resolveFrontSuggestion } from '@/lib/data';
import { suggestionToTask } from '@/lib/front-suggestions';
import { appendAnswer } from '@/lib/fronts';
import { spawnWorker } from '@/lib/run-worker';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/**
 * Operator actions on one suggestion (browser-called, no agent token):
 *   { status: 'dismissed' }
 *   { status: 'answered', answer }   -> also appended to the front's now.md
 *   { status: 'approved', operatorNotes? } -> creates a pending task, fires the worker
 */
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  let body: { status?: unknown; answer?: unknown; operatorNotes?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const suggestion = await getFrontSuggestion(id);
  if (!suggestion) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (suggestion.status !== 'open') {
    return NextResponse.json({ error: `Already ${suggestion.status}` }, { status: 409 });
  }

  if (body.status === 'dismissed') {
    const updated = await resolveFrontSuggestion(id, { status: 'dismissed' });
    return NextResponse.json(updated);
  }

  if (body.status === 'answered') {
    const answer = typeof body.answer === 'string' ? body.answer.trim() : '';
    if (!answer) return NextResponse.json({ error: 'answer is required' }, { status: 400 });
    const updated = await resolveFrontSuggestion(id, { status: 'answered', answer });
    if (updated && updated !== 'not_open') {
      await appendAnswer(suggestion.frontSlug, suggestion.title, answer);
    }
    return NextResponse.json(updated);
  }

  if (body.status === 'approved') {
    if (suggestion.kind !== 'task') {
      return NextResponse.json({ error: 'Only task suggestions can be approved; answer a question instead' }, { status: 400 });
    }
    const operatorNotes = typeof body.operatorNotes === 'string' ? body.operatorNotes.trim() : '';
    const task = await createTask(suggestionToTask(suggestion, operatorNotes));
    const updated = await resolveFrontSuggestion(id, {
      status: 'approved',
      taskId: task.id,
      ...(operatorNotes ? { operatorNotes } : {}),
    });
    let workerPid: number | undefined;
    try {
      workerPid = spawnWorker();
    } catch {
      workerPid = undefined;
    }
    return NextResponse.json({ suggestion: updated, task, workerPid });
  }

  return NextResponse.json(
    { error: 'status must be dismissed, answered, or approved' },
    { status: 400 },
  );
}
