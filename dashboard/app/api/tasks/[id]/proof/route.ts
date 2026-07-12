import { promises as fs } from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { requireAgentToken } from '@/lib/agent-auth';
import { getTask } from '@/lib/data';

export const dynamic = 'force-dynamic';

const PROJECT_ROOT = path.resolve(process.cwd(), '..');
const OUTPUTS_DIR = path.join(PROJECT_ROOT, 'workers', 'workspace', 'outputs');

// Platform keys are config keys like "land_com" — anything else would be a
// path segment, so reject it before touching the filesystem.
const PLATFORM_PATTERN = /^[a-z0-9_]+$/;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type Params = { params: Promise<{ id: string }> };

/**
 * The local poster agent uploads its proof-of-posting screenshot here. The
 * file lands at the same path the old server-side poster wrote
 * (outputs/<taskId>/postings/<platform>.png), so the existing screenshot
 * display keeps working (specs/job-model-agent-facing-api.md US-007).
 */
export async function POST(request: Request, { params }: Params) {
  const denied = requireAgentToken(request);
  if (denied) return denied;

  const { id } = await params;
  const platform = new URL(request.url).searchParams.get('platform');
  if (!platform || !PLATFORM_PATTERN.test(platform)) {
    return NextResponse.json(
      { error: 'Query param "platform" is required (e.g. ?platform=landmodo)' },
      { status: 400 },
    );
  }

  const task = await getTask(id);
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = Buffer.from(await request.arrayBuffer());
  if (body.length < PNG_MAGIC.length || !body.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
    return NextResponse.json(
      { error: 'Body must be raw PNG bytes (missing PNG signature)' },
      { status: 400 },
    );
  }

  const postingsDir = path.join(OUTPUTS_DIR, id, 'postings');
  const target = path.resolve(postingsDir, `${platform}.png`);
  if (!target.startsWith(postingsDir + path.sep)) {
    return NextResponse.json({ error: 'Path traversal blocked' }, { status: 400 });
  }

  await fs.mkdir(postingsDir, { recursive: true });
  await fs.writeFile(target, body);

  return NextResponse.json({
    path: `workers/workspace/outputs/${id}/postings/${platform}.png`,
    size: body.length,
  });
}
