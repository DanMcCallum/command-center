import { promises as fs } from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { getTask } from '@/lib/data';
import { IMPORT_MAX_URLS, planImportFilenames } from '@/lib/buywander-lot';

export const dynamic = 'force-dynamic';

const PROJECT_ROOT = path.resolve(process.cwd(), '..');
const OUTPUTS_DIR = path.join(PROJECT_ROOT, 'workers', 'workspace', 'outputs');

const FETCH_TIMEOUT_MS = 20_000;
const MAX_BYTES = 15 * 1024 * 1024;
const MAX_SIDE = 1600;
const JPEG_QUALITY = 85;
// Retailer CDNs (walmart, amazon) refuse the default undici agent.
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

// Same shape the sibling photos route accepts: NN_name.ext.
const FILENAME_PATTERN = /^[0-9]{2}_[\w.-]+$/;

type Params = { params: Promise<{ id: string }> };

interface ImportBody {
  urls?: unknown;
  primaryIndex?: unknown;
  startIndex?: unknown;
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function nonNegativeInt(value: unknown, fallback: number): number | null {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null;
  return value;
}

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    cache: 'no-store',
    redirect: 'follow',
    headers: { 'User-Agent': USER_AGENT, Accept: 'image/*,*/*;q=0.8' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BYTES) throw new Error('larger than 15 MB');
  const data = Buffer.from(await res.arrayBuffer());
  if (data.byteLength > MAX_BYTES) throw new Error('larger than 15 MB');
  if (data.byteLength === 0) throw new Error('empty response');
  return data;
}

/**
 * POST /api/tasks/<id>/photos/import { urls, primaryIndex?, startIndex? }:
 * fetches each https URL, re-encodes it as a JPEG (EXIF rotation applied,
 * longest side 1600) and writes NN_bw-<k>.jpg under the task's photos dir.
 * The primary takes startIndex; the rest follow in submitted order. A failed
 * download is reported, not fatal. Task metadata is left to the caller.
 */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const task = await getTask(id);
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let body: ImportBody;
  try {
    body = (await request.json()) as ImportBody;
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400 });
  }

  const urls = body.urls;
  if (!Array.isArray(urls) || urls.length === 0) {
    return NextResponse.json({ error: 'urls must be a non-empty array' }, { status: 400 });
  }
  if (urls.length > IMPORT_MAX_URLS) {
    return NextResponse.json({ error: `At most ${IMPORT_MAX_URLS} urls per import` }, { status: 400 });
  }
  if (!urls.every(isHttpsUrl)) {
    return NextResponse.json({ error: 'Every url must be https' }, { status: 400 });
  }
  const primaryIndex = nonNegativeInt(body.primaryIndex, 0);
  const startIndex = nonNegativeInt(body.startIndex, 0);
  if (primaryIndex === null || startIndex === null) {
    return NextResponse.json({ error: 'primaryIndex and startIndex must be non-negative integers' }, { status: 400 });
  }
  if (startIndex + urls.length > 100) {
    return NextResponse.json({ error: 'startIndex too high for a two-digit prefix' }, { status: 400 });
  }

  const photosDir = path.join(OUTPUTS_DIR, id, 'photos');
  const plan = planImportFilenames(urls, primaryIndex, startIndex);
  const saved: { url: string; filename: string; bytes: number }[] = [];
  const failed: { url: string; error: string }[] = [];
  let primaryPhoto: string | null = null;
  let dirReady = false;

  for (const entry of plan) {
    if (!FILENAME_PATTERN.test(entry.filename)) {
      failed.push({ url: entry.url, error: 'bad filename' });
      continue;
    }
    const target = path.resolve(photosDir, entry.filename);
    if (!target.startsWith(photosDir + path.sep)) {
      failed.push({ url: entry.url, error: 'path traversal blocked' });
      continue;
    }
    try {
      const source = await download(entry.url);
      const jpeg = await sharp(source)
        .rotate()
        .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
        .toBuffer();
      if (!dirReady) {
        await fs.mkdir(photosDir, { recursive: true });
        dirReady = true;
      }
      await fs.writeFile(target, jpeg);
      saved.push({ url: entry.url, filename: entry.filename, bytes: jpeg.byteLength });
      if (entry.index === startIndex) primaryPhoto = entry.filename;
    } catch (err) {
      const msg = err instanceof Error ? (err.name === 'TimeoutError' ? 'timed out' : err.message) : String(err);
      failed.push({ url: entry.url, error: msg });
    }
  }

  if (primaryPhoto === null && saved.length > 0) primaryPhoto = saved[0].filename;

  return NextResponse.json({
    saved,
    failed,
    primaryPhoto,
    nextIndex: startIndex + plan.length,
  });
}
