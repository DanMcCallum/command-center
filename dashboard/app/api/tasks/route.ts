import { NextResponse } from 'next/server';
import { createTask, getTasks } from '@/lib/data';
import type { Task } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  const tasks = await getTasks();
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
