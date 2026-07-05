import { promises as fs } from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const PROJECT_ROOT = path.resolve(process.cwd(), '..');
const KB_DIR = path.join(PROJECT_ROOT, 'knowledge-base', 'ads');

interface KbPayload {
  slug: string;
  location: string;
  acreage: number;
  price_usd: number;
  sold_on: string;
  days_to_sale?: number | null;
  platform_sold_on: string;
  features?: string[];
  buyer_type?: string | null;
  access?: string | null;
  utilities?: string[];
  zoning?: string | null;
  notes?: string | null;
  headline: string;
  description: string;
}

function escapeForYamlDouble(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function yamlString(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '""';
  return `"${escapeForYamlDouble(value)}"`;
}

function yamlList(items: string[] | undefined): string {
  if (!items || items.length === 0) return '[]';
  return `[${items.map(s => yamlString(s)).join(', ')}]`;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export async function POST(request: Request) {
  let body: KbPayload;
  try {
    body = (await request.json()) as KbPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  for (const required of ['location', 'sold_on', 'platform_sold_on', 'headline', 'description'] as const) {
    if (!body[required] || (typeof body[required] === 'string' && (body[required] as string).trim() === '')) {
      return NextResponse.json({ error: `${required} is required` }, { status: 400 });
    }
  }
  if (typeof body.acreage !== 'number' || typeof body.price_usd !== 'number') {
    return NextResponse.json({ error: 'acreage and price_usd must be numbers' }, { status: 400 });
  }

  const slug = body.slug?.trim() ? slugify(body.slug) : slugify(
    `${body.location} ${body.acreage}ac ${body.sold_on}`,
  );
  if (!slug) {
    return NextResponse.json({ error: 'Could not derive slug' }, { status: 400 });
  }

  const filePath = path.join(KB_DIR, `${slug}.md`);

  // Don't silently overwrite. If a file exists, append a numeric suffix.
  let finalPath = filePath;
  let counter = 2;
  while (await fileExists(finalPath)) {
    finalPath = path.join(KB_DIR, `${slug}-${counter}.md`);
    counter += 1;
  }

  const frontmatter = [
    '---',
    `location: ${yamlString(body.location)}`,
    `acreage: ${body.acreage}`,
    `price_usd: ${body.price_usd}`,
    `sold_on: ${yamlString(body.sold_on)}`,
    body.days_to_sale != null ? `days_to_sale: ${body.days_to_sale}` : null,
    `platform_sold_on: ${yamlString(body.platform_sold_on)}`,
    `features: ${yamlList(body.features)}`,
    body.buyer_type ? `buyer_type: ${yamlString(body.buyer_type)}` : null,
    body.access ? `access: ${yamlString(body.access)}` : null,
    body.utilities && body.utilities.length > 0 ? `utilities: ${yamlList(body.utilities)}` : null,
    body.zoning ? `zoning: ${yamlString(body.zoning)}` : null,
    body.notes ? `notes: ${yamlString(body.notes)}` : null,
    '---',
  ].filter(Boolean).join('\n');

  const content = `${frontmatter}\n\n# HEADLINE\n${body.headline.trim()}\n\n# DESCRIPTION\n${body.description.trim()}\n`;

  await fs.mkdir(KB_DIR, { recursive: true });
  await fs.writeFile(finalPath, content, 'utf8');

  const relPath = path.relative(PROJECT_ROOT, finalPath);
  return NextResponse.json({ saved: true, path: relPath, slug: path.basename(finalPath, '.md') }, { status: 201 });
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
