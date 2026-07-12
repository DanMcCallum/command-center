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

type Params = { params: Promise<{ id: string }> };

/**
 * Everything the local poster agent needs to post one platform's ad without
 * sharing a filesystem with the server: the ad copy inline, photos as
 * repo-relative paths servable via GET /api/files/<path>
 * (specs/job-model-agent-facing-api.md US-006).
 */
export async function GET(request: Request, { params }: Params) {
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

  let adCopy: string;
  try {
    adCopy = await fs.readFile(
      path.join(OUTPUTS_DIR, id, `${platform}.md`),
      'utf-8',
    );
  } catch {
    return NextResponse.json(
      {
        error: `No ad copy found at outputs/${id}/${platform}.md — has the ad been generated for this platform?`,
      },
      { status: 404 },
    );
  }

  let photos: string[] = [];
  try {
    const entries = await fs.readdir(path.join(OUTPUTS_DIR, id, 'photos'), {
      withFileTypes: true,
    });
    photos = entries
      .filter(e => e.isFile())
      .map(e => `workers/workspace/outputs/${id}/photos/${e.name}`)
      .sort();
  } catch {
    // No photos dir — the bundle is still valid, just photo-less.
  }

  return NextResponse.json({ adCopy, photos });
}
