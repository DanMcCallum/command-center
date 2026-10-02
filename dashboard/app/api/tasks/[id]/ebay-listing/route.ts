import { promises as fs } from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { getTask } from '@/lib/data';
import { loadAreaSheets, matchAreaSheet } from '@/lib/area-sheets';
import { parseEbayMarkdown, renderEbayListing, type EbayImage } from '@/lib/ebay-html';

export const dynamic = 'force-dynamic';

/**
 * GET /api/tasks/<id>/ebay-listing
 *
 * Turns the task's ebay.md into the copy-paste HTML the operator drops into
 * eBay's description editor (HTML view). On every call it:
 *   1. reads outputs/<id>/ebay.md (headline, description, item specifics)
 *   2. builds web-size JPEG derivatives of outputs/<id>/photos/* and of the
 *      matching area sheet's photo folder into outputs/<id>/ebay-images/
 *      (skipped when the derivative is newer than its source)
 *   3. renders the listing twice: `html` with public URLs under the
 *      configured image_base_url (what gets pasted into eBay) and
 *      `previewHtml` with dashboard-local URLs (what the modal shows)
 *   4. probes the first public image URL so the modal can warn when the
 *      image host is not reachable yet
 *
 * ?format=html returns the preview as a page instead of JSON.
 */

const PROJECT_ROOT = path.resolve(process.cwd(), '..');
const CONFIG_FILE = path.join(PROJECT_ROOT, 'config', 'ad-platforms.json');
const PHOTO_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const DERIVATIVES_DIR = 'ebay-images';

interface EbayPlatformConfig {
  areas_dir?: string;
  image_base_url?: string;
  image_max_width?: number;
  image_render_width?: number;
}

type Params = { params: Promise<{ id: string }> };

async function readEbayConfig(): Promise<EbayPlatformConfig> {
  try {
    const raw = JSON.parse(await fs.readFile(CONFIG_FILE, 'utf-8'));
    return (raw?.platforms?.ebay ?? {}) as EbayPlatformConfig;
  } catch {
    return {};
  }
}

async function listImages(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter(e => e.isFile() && PHOTO_EXTS.has(path.extname(e.name).toLowerCase()))
      .map(e => e.name)
      .sort();
  } catch {
    return [];
  }
}

async function isFresh(target: string, source: string): Promise<boolean> {
  try {
    const [t, s] = await Promise.all([fs.stat(target), fs.stat(source)]);
    return t.mtimeMs >= s.mtimeMs;
  } catch {
    return false;
  }
}

/**
 * Writes a JPEG derivative (rotated per EXIF, capped at maxWidth, quality
 * 82) unless an up-to-date one exists. Returns the derivative basename.
 */
async function derive(
  source: string,
  outDir: string,
  baseName: string,
  maxWidth: number,
): Promise<string> {
  const name = `${baseName}.jpg`;
  const target = path.join(outDir, name);
  if (!(await isFresh(target, source))) {
    await sharp(source)
      .rotate()
      .resize({ width: maxWidth, withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toFile(target);
  }
  return name;
}

/**
 * Finds the area sheet covering the task's location and returns its sibling
 * photo folder when one exists. Matching lives in lib/area-sheets.ts so the
 * generate-ad worker (via /api/area-sheet) and this route cannot drift: the
 * substring rule they each used to carry matched none of the real tasks.
 */
async function findAreaPhotoDir(
  areasDir: string,
  metadata: Record<string, unknown> | null,
): Promise<{ slug: string | null; dir: string | null; warnings: string[] }> {
  const sheets = await loadAreaSheets(areasDir);
  const match = await matchAreaSheet(metadata, sheets);
  if (!match.sheet) return { slug: null, dir: null, warnings: match.warnings };
  const dir = path.join(areasDir, match.sheet.slug);
  const warnings = [...match.warnings];
  try {
    if (!(await fs.stat(dir)).isDirectory()) throw new Error('not a directory');
  } catch {
    warnings.push(`area sheet "${match.sheet.slug}" matched but has no photo folder`);
    return { slug: match.sheet.slug, dir: null, warnings };
  }
  return { slug: match.sheet.slug, dir, warnings };
}

async function probe(url: string): Promise<{ ok: boolean; status: number | null; error?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'manual', signal: ctrl.signal });
    const ok = res.status === 200 && (res.headers.get('content-type') ?? '').startsWith('image/');
    return { ok, status: res.status };
  } catch (e) {
    return { ok: false, status: null, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(req: Request, { params }: Params) {
  const { id } = await params;
  const task = await getTask(id);
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!task.workspacePath) {
    return NextResponse.json({ error: 'Task has no workspace yet' }, { status: 409 });
  }

  const outputDir = path.join(PROJECT_ROOT, task.workspacePath);
  let markdown: string;
  try {
    markdown = await fs.readFile(path.join(outputDir, 'ebay.md'), 'utf-8');
  } catch {
    return NextResponse.json(
      { error: 'No ebay.md in this task. Tick eBay on the Ad Builder form and regenerate.' },
      { status: 404 },
    );
  }

  const parsed = parseEbayMarkdown(markdown);
  if (!parsed.description) {
    return NextResponse.json({ error: 'ebay.md has no ## DESCRIPTION section' }, { status: 422 });
  }

  const cfg = await readEbayConfig();
  const maxWidth = cfg.image_max_width ?? 1000;
  const renderWidth = cfg.image_render_width ?? 800;
  const baseUrl = (cfg.image_base_url ?? '').replace(/\/+$/, '');
  const derivDir = path.join(outputDir, DERIVATIVES_DIR);
  await fs.mkdir(derivDir, { recursive: true });

  const label = parsed.headline || task.title;
  const publicUrl = (file: string) => `${baseUrl}/${id}/${DERIVATIVES_DIR}/${file}`;
  const localUrl = (file: string) =>
    `/api/files/${encodeURI(`${task.workspacePath}/${DERIVATIVES_DIR}/${file}`)}`;

  // Property photos: keep the operator's NN_ order prefix as the derivative name.
  const photoFiles = await listImages(path.join(outputDir, 'photos'));
  const photoDerivs: string[] = [];
  for (let i = 0; i < photoFiles.length; i++) {
    const src = path.join(outputDir, 'photos', photoFiles[i]);
    const prefix = photoFiles[i].match(/^(\d{2})_/)?.[1] ?? String(i).padStart(2, '0');
    photoDerivs.push(await derive(src, derivDir, `photo-${prefix}`, maxWidth));
  }

  // Area photos from knowledge-base/ebay/areas/<slug>/ when the sheet matches.
  let areaSlug: string | null = null;
  let areaWarnings: string[] = [];
  const areaDerivs: string[] = [];
  if (cfg.areas_dir) {
    const area = await findAreaPhotoDir(path.join(PROJECT_ROOT, cfg.areas_dir), task.metadata);
    areaSlug = area.slug;
    areaWarnings = area.warnings;
    if (area.dir) {
      const files = await listImages(area.dir);
      for (let i = 0; i < files.length; i++) {
        areaDerivs.push(
          await derive(path.join(area.dir, files[i]), derivDir, `area-${String(i).padStart(2, '0')}`, maxWidth),
        );
      }
    }
  }

  const build = (toUrl: (f: string) => string) =>
    renderEbayListing({
      headline: parsed.headline,
      description: parsed.description,
      imageWidth: renderWidth,
      photos: photoDerivs.map<EbayImage>((f, i) => ({ url: toUrl(f), alt: `${label} - photo ${i + 1}` })),
      areaPhotos: areaDerivs.map<EbayImage>((f, i) => ({
        url: toUrl(f),
        alt: `${areaSlug ?? 'area'} - area photo ${i + 1}`,
      })),
    });

  const html = build(publicUrl);
  const previewHtml = build(localUrl);

  const url = new URL(req.url);
  if (url.searchParams.get('format') === 'html') {
    const page = `<!doctype html><html><head><meta charset="utf-8"><title>${parsed.headline}</title></head><body style="margin:0;background:#fff;">${previewHtml}</body></html>`;
    return new NextResponse(page, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }

  const firstImage = photoDerivs[0] ?? areaDerivs[0] ?? null;
  const hosting = !baseUrl
    ? { configured: false, ok: false, status: null as number | null, url: null as string | null }
    : firstImage
      ? { configured: true, url: publicUrl(firstImage), ...(await probe(publicUrl(firstImage))) }
      : { configured: true, ok: false, status: null as number | null, url: null as string | null };

  return NextResponse.json({
    taskId: id,
    headline: parsed.headline,
    headlineMax: 80,
    itemSpecifics: parsed.itemSpecifics,
    html,
    previewHtml,
    images: photoDerivs.map(f => ({ file: f, url: publicUrl(f) })),
    areaImages: areaDerivs.map(f => ({ file: f, url: publicUrl(f) })),
    areaSlug,
    areaWarnings,
    imageBaseUrl: baseUrl || null,
    hosting,
  });
}
