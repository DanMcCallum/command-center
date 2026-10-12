import { spawn } from 'node:child_process';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { requireFrontConfig, UnknownFrontError } from '@/lib/fronts';

export const dynamic = 'force-dynamic';

const PROJECT_ROOT = path.resolve(process.cwd(), '..');
const SCRIPT = path.join(PROJECT_ROOT, 'workers', 'fronts', 'whats-next.sh');

type Params = { params: Promise<{ slug: string }> };

/** The front page's Refresh button: runs whats-next.sh detached, like
 * /api/run-worker runs the worker. The page polls GET /api/fronts/<slug>
 * until nowUpdatedAt changes. */
export async function POST(_request: Request, { params }: Params) {
  const { slug } = await params;
  try {
    await requireFrontConfig(slug);
  } catch (err) {
    if (err instanceof UnknownFrontError) {
      return NextResponse.json({ error: 'Unknown front' }, { status: 404 });
    }
    throw err;
  }
  try {
    const child = spawn('bash', [SCRIPT, slug], {
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
      { error: `Failed to spawn what's-next: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}
