import { promises as fs } from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { getTask } from '@/lib/data';

export const dynamic = 'force-dynamic';

const PROJECT_ROOT = path.resolve(process.cwd(), '..');
const OUTPUTS_DIR = path.join(PROJECT_ROOT, 'workers', 'workspace', 'outputs');

const ALLOWED_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const MAX_BYTES = 15 * 1024 * 1024;

// Order-prefixed basename: 00_ is the primary photo, 01_/02_/... follow in
// gallery order — listPhotos() in workers/posting sorts by filename.
const FILENAME_PATTERN = /^[0-9]{2}_[\w.-]+$/;

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const task = await getTask(id);
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing "file" field' }, { status: 400 });
  }

  const rawName = form.get('filename');
  if (typeof rawName !== 'string' || rawName.length === 0) {
    return NextResponse.json({ error: 'Missing "filename" field' }, { status: 400 });
  }

  const filename = rawName.trim();
  if (
    filename.includes('/') ||
    filename.includes('\\') ||
    filename.includes('..') ||
    !FILENAME_PATTERN.test(filename)
  ) {
    return NextResponse.json(
      { error: 'Filename must be a safe basename matching NN_name.ext (e.g. 00_front.jpg)' },
      { status: 400 },
    );
  }

  const ext = path.extname(filename).toLowerCase();
  if (!ALLOWED_EXTS.has(ext)) {
    return NextResponse.json(
      { error: `File type ${ext || '(none)'} not allowed; use jpg, jpeg, png, webp, or gif` },
      { status: 400 },
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File exceeds the 15 MB limit' }, { status: 400 });
  }

  const photosDir = path.join(OUTPUTS_DIR, id, 'photos');
  const target = path.resolve(photosDir, filename);
  if (!target.startsWith(photosDir + path.sep)) {
    return NextResponse.json({ error: 'Path traversal blocked' }, { status: 400 });
  }

  await fs.mkdir(photosDir, { recursive: true });
  const data = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(target, data);

  return NextResponse.json({ filename, size: data.byteLength });
}
