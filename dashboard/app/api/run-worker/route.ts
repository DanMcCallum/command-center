import { NextResponse } from 'next/server';
import { spawnWorker } from '@/lib/run-worker';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const pid = spawnWorker();
    return NextResponse.json({ triggered: true, pid });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to spawn worker: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}
