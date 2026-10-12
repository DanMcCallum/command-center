import { NextResponse } from 'next/server';
import { requireAgentToken } from '@/lib/agent-auth';
import { createFrontSuggestions, getFrontSuggestions, type FrontSuggestionInput } from '@/lib/data';
import { getFrontConfigs } from '@/lib/fronts';
import type { ClaudeModel, FrontSuggestionStatus } from '@/lib/types';

export const dynamic = 'force-dynamic';

const STATUSES: FrontSuggestionStatus[] = ['open', 'approved', 'dismissed', 'answered'];
const MODELS: ClaudeModel[] = ['sonnet', 'opus', 'haiku'];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const frontSlug = searchParams.get('front') ?? undefined;
  const statusParam = searchParams.get('status');
  const status = STATUSES.includes(statusParam as FrontSuggestionStatus)
    ? (statusParam as FrontSuggestionStatus)
    : undefined;
  return NextResponse.json(await getFrontSuggestions({ frontSlug, status }));
}

/**
 * Pipeline entry point (workers/fronts/whats-next.sh). Bearer-guarded with
 * AGENT_TOKEN so a stray process cannot fill the review bin. Body is one
 * suggestion or an array; unknown fields are dropped, unknown fronts rejected.
 */
export async function POST(request: Request) {
  const denied = requireAgentToken(request);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const items = Array.isArray(body) ? body : [body];
  const known = new Set((await getFrontConfigs()).map(f => f.slug));
  const inputs: FrontSuggestionInput[] = [];
  for (const [i, raw] of items.entries()) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const frontSlug = r.frontSlug;
    const kind = r.kind;
    const title = r.title;
    const text = r.body;
    if (typeof frontSlug !== 'string' || !known.has(frontSlug)) {
      return NextResponse.json({ error: `item ${i}: unknown frontSlug` }, { status: 400 });
    }
    if (kind !== 'task' && kind !== 'question') {
      return NextResponse.json({ error: `item ${i}: kind must be task or question` }, { status: 400 });
    }
    if (typeof title !== 'string' || !title.trim() || typeof text !== 'string') {
      return NextResponse.json({ error: `item ${i}: title and body are required` }, { status: 400 });
    }
    inputs.push({
      frontSlug,
      kind,
      title: title.trim(),
      body: text,
      type: typeof r.type === 'string' ? r.type : undefined,
      model: MODELS.includes(r.model as ClaudeModel) ? (r.model as ClaudeModel) : undefined,
      slashCommand: typeof r.slashCommand === 'string' ? r.slashCommand : null,
      sourceSessionId: typeof r.sourceSessionId === 'string' ? r.sourceSessionId : null,
      sourceMemoryFile: typeof r.sourceMemoryFile === 'string' ? r.sourceMemoryFile : null,
    });
  }
  const added = await createFrontSuggestions(inputs);
  return NextResponse.json({ added, skipped: inputs.length - added.length }, { status: 201 });
}
