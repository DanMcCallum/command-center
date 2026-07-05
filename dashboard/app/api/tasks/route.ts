import { NextResponse } from 'next/server';
import { createTask, getTasks } from '@/lib/data';
import type { Task } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const tasks = await getTasks();
  const { searchParams } = new URL(request.url);
  if (searchParams.get('postable') === 'true') {
    const postable = tasks.filter(task =>
      (task.postings ?? []).some(
        p => p.status === 'queued' || (p.status === 'failed' && p.attempts < 3),
      ),
    );
    return NextResponse.json(postable);
  }
  return NextResponse.json(tasks);
}

export async function POST(request: Request) {
  let body: Partial<Task>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body.title || typeof body.title !== 'string') {
    return NextResponse.json(
      { error: 'title is required' },
      { status: 400 },
    );
  }
  const task = await createTask(body);
  return NextResponse.json(task, { status: 201 });
}
