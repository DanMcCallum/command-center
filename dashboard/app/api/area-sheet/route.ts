/**
 * GET /api/area-sheet?location=Elko%2C+NV&must_include=...
 *
 * Which knowledge-base area sheet covers this property, if any. The eBay
 * listing route calls lib/area-sheets.ts directly; this route exists so the
 * generate-ad worker (Step 3L) resolves the sheet the same way instead of
 * reimplementing the substring rule in prose, which is how the two drifted.
 */
import { NextResponse } from 'next/server';
import path from 'node:path';
import { requireAgentToken } from '@/lib/agent-auth';
import { loadAreaSheets, matchAreaSheet } from '@/lib/area-sheets';

export const dynamic = 'force-dynamic';

const PROJECT_ROOT = path.resolve(process.cwd(), '..');
const AREAS_DIR = path.join(PROJECT_ROOT, 'knowledge-base', 'ebay', 'areas');

export async function GET(request: Request) {
  const denied = requireAgentToken(request);
  if (denied) return denied;

  const url = new URL(request.url);
  const location = url.searchParams.get('location') ?? '';
  const mustInclude = url.searchParams.get('must_include') ?? '';
  if (!location.trim() && !mustInclude.trim()) {
    return NextResponse.json({ error: '"location" is required' }, { status: 400 });
  }

  const sheets = await loadAreaSheets(AREAS_DIR);
  const match = await matchAreaSheet({ location, must_include: mustInclude }, sheets);

  return NextResponse.json({
    slug: match.sheet?.slug ?? null,
    area: match.sheet?.area ?? null,
    path: match.sheet ? path.relative(PROJECT_ROOT, match.sheet.path) : null,
    source: match.source,
    confidence: match.confidence,
    warnings: match.warnings,
  });
}
