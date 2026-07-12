import { promises as fs } from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { requireAgentToken } from '@/lib/agent-auth';

export const dynamic = 'force-dynamic';

const PROJECT_ROOT = path.resolve(process.cwd(), '..');
const WORKERS_DIR = path.join(PROJECT_ROOT, 'workers');

const MIME_TYPES: Record<string, string> = {
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
};

const EDITABLE_EXTS = new Set(['.md', '.txt', '.json', '.html', '.css', '.js']);

type Params = { params: Promise<{ path: string[] }> };

function resolveTarget(parts: string[] | undefined): string | NextResponse {
  if (!parts || parts.length === 0) {
    return NextResponse.json({ error: 'Path required' }, { status: 400 });
  }

  const segments = parts.map(decodeURIComponent);
  if (segments.some(seg => seg === '..' || seg.includes('\0'))) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  // Allow paths that start with "workers/" (matching the relative paths
  // stored on tasks) or relative paths within the workers directory.
  let relative = segments.join('/');
  if (relative.startsWith('workers/')) {
    relative = relative.slice('workers/'.length);
  }

  const target = path.resolve(WORKERS_DIR, relative);
  if (!target.startsWith(WORKERS_DIR + path.sep) && target !== WORKERS_DIR) {
    return NextResponse.json({ error: 'Path traversal blocked' }, { status: 400 });
  }
  return target;
}

export async function GET(req: Request, { params }: Params) {
  // The local poster agent downloads publish-bundle photos through this route
  // with its bearer token. Browser usage (<img> tags, FileEditorModal) sends
  // no Authorization header and stays unauthenticated as before; when the
  // header IS present it must be the valid agent token, so an agent
  // misconfiguration fails loudly instead of being silently served
  // (specs/job-model-agent-facing-api.md US-006).
  if (req.headers.get('authorization') !== null) {
    const denied = requireAgentToken(req);
    if (denied) return denied;
  }

  const { path: parts } = await params;
  const resolved = resolveTarget(parts);
  if (resolved instanceof NextResponse) return resolved;
  const target = resolved;
  const relative = path.relative(WORKERS_DIR, target);

  let stat;
  try {
    stat = await fs.stat(target);
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (stat.isDirectory()) {
    const entries = await fs.readdir(target, { withFileTypes: true });
    return NextResponse.json({
      type: 'directory',
      path: relative,
      entries: entries.map(e => ({
        name: e.name,
        type: e.isDirectory() ? 'directory' : 'file',
      })),
    });
  }

  const ext = path.extname(target).toLowerCase();
  const mime = MIME_TYPES[ext] ?? 'application/octet-stream';
  const data = await fs.readFile(target);
  return new NextResponse(data, {
    status: 200,
    headers: {
      'content-type': mime,
      'cache-control': 'no-store',
    },
  });
}

export async function PUT(req: Request, { params }: Params) {
  const { path: parts } = await params;
  const resolved = resolveTarget(parts);
  if (resolved instanceof NextResponse) return resolved;
  const target = resolved;

  const ext = path.extname(target).toLowerCase();
  if (!EDITABLE_EXTS.has(ext)) {
    return NextResponse.json(
      { error: `Editing not allowed for ${ext || 'this'} files` },
      { status: 415 },
    );
  }

  let stat;
  try {
    stat = await fs.stat(target);
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (stat.isDirectory()) {
    return NextResponse.json({ error: 'Target is a directory' }, { status: 400 });
  }

  const body = await req.text();
  await fs.writeFile(target, body, 'utf-8');
  return NextResponse.json({ ok: true, bytes: Buffer.byteLength(body, 'utf-8') });
}
