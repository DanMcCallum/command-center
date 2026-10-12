import { NextResponse } from 'next/server';
import { countOpenFrontSuggestions } from '@/lib/data';
import { getFront, UnknownFrontError } from '@/lib/fronts';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { slug } = await params;
  try {
    const counts = await countOpenFrontSuggestions();
    const front = await getFront(slug, s => counts[s] ?? { openSuggestions: 0, openQuestions: 0 });
    return NextResponse.json(front);
  } catch (err) {
    if (err instanceof UnknownFrontError) {
      return NextResponse.json({ error: 'Unknown front' }, { status: 404 });
    }
    return NextResponse.json(
      { error: `Failed to read front: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}
