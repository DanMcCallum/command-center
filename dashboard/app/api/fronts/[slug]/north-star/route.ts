import { NextResponse } from 'next/server';
import { UnknownFrontError, writeNorthStar } from '@/lib/fronts';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };

/** Operator edit of north-star.md. Agents never call this route. */
export async function PUT(request: Request, { params }: Params) {
  const { slug } = await params;
  let body: { text?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (typeof body.text !== 'string') {
    return NextResponse.json({ error: 'Body must include {text}' }, { status: 400 });
  }
  try {
    await writeNorthStar(slug, body.text);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof UnknownFrontError) {
      return NextResponse.json({ error: 'Unknown front' }, { status: 404 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
