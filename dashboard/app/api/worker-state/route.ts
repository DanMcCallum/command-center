import { NextResponse } from 'next/server';
import { getWorkerState, saveWorkerState } from '@/lib/data';
import type { WorkerState } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  const state = await getWorkerState();
  return NextResponse.json(state);
}

export async function PUT(request: Request) {
  let body: Partial<WorkerState>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const current = await getWorkerState();
  const next: WorkerState = {
    lastRun: body.lastRun !== undefined ? body.lastRun : current.lastRun,
    lastTaskId: body.lastTaskId !== undefined ? body.lastTaskId : current.lastTaskId,
  };
  await saveWorkerState(next);
  return NextResponse.json(next);
}
