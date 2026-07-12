import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { mutateTask } from '@/lib/data';
import type { AdPosting } from '@/lib/types';
import { nowIso } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const CONFIG_PATH = path.resolve(
  process.cwd(),
  '..',
  'config',
  'posting-platforms.json',
);

const IN_FLIGHT: AdPosting['status'][] = ['queued', 'posting', 'awaiting_auth'];

type Params = { params: Promise<{ id: string }> };

/**
 * Queues a publish job for exactly one platform on one task (the per-site
 * Publish button; specs/job-model-agent-facing-api.md US-003). Browser-called,
 * so no agent token. Re-publishing a `failed` or `posted` entry is the
 * retry/repost path; an in-flight entry is a 409.
 */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;

  let body: { platform?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const platform = body.platform;
  if (typeof platform !== 'string' || !platform) {
    return NextResponse.json(
      { error: 'Body must include {platform}' },
      { status: 400 },
    );
  }

  let platforms: Record<string, { enabled?: boolean }>;
  try {
    const raw = await readFile(CONFIG_PATH, 'utf8');
    platforms = (JSON.parse(raw) as {
      platforms: Record<string, { enabled?: boolean }>;
    }).platforms;
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to read posting platforms: ${(err as Error).message}` },
      { status: 500 },
    );
  }
  if (!platforms[platform]?.enabled) {
    return NextResponse.json(
      { error: `Platform "${platform}" is not enabled for posting` },
      { status: 400 },
    );
  }

  let conflictStatus: AdPosting['status'] | null = null;
  const result = await mutateTask(id, task => {
    const postings = task.postings ?? [];
    const existing = postings.find(p => p.platform === platform);
    if (existing && IN_FLIGHT.includes(existing.status)) {
      conflictStatus = existing.status;
      return null;
    }
    const entry: AdPosting = {
      platform,
      status: 'queued',
      attempts: (existing?.attempts ?? 0) + 1,
      queuedAt: nowIso(),
    };
    const next = existing
      ? postings.map(p => (p.platform === platform ? entry : p))
      : [...postings, entry];
    return { ...task, postings: next };
  });

  if (result.outcome === 'not_found') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (result.outcome === 'rejected') {
    return NextResponse.json(
      {
        error: `A publish job for "${platform}" is already in flight (${conflictStatus})`,
      },
      { status: 409 },
    );
  }
  return NextResponse.json(result.task);
}
