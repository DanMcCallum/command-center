import { spawn } from 'node:child_process';
import path from 'node:path';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const PROJECT_ROOT = path.resolve(process.cwd(), '..');
const POSTER_SCRIPT = path.join(PROJECT_ROOT, 'workers', 'run-poster.sh');

export async function POST() {
  try {
    const child = spawn('bash', [POSTER_SCRIPT], {
      cwd: PROJECT_ROOT,
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        DASHBOARD_URL: process.env.DASHBOARD_URL ?? 'http://localhost:3000',
      },
    });
    child.unref();
    return NextResponse.json({ triggered: true, pid: child.pid });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to spawn poster: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}
