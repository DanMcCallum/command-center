import { NextResponse } from 'next/server';
import { deleteTask, getTask, updateTask } from '@/lib/data';
import type { Task } from '@/lib/types';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const task = await getTask(id);
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(task);
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  let body: Partial<Task>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const task = await updateTask(id, body);
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (task.status === 'completed' && !task.completedAt) {
    const finalized = await updateTask(id, { completedAt: new Date().toISOString() });
    return NextResponse.json(finalized);
  }
  return NextResponse.json(task);
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  const ok = await deleteTask(id);
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ success: true });
}
