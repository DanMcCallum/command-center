import { NextResponse } from 'next/server';
import { countOpenFrontSuggestions } from '@/lib/data';
import { getFronts } from '@/lib/fronts';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const counts = await countOpenFrontSuggestions();
    const fronts = await getFronts(slug => counts[slug] ?? { openSuggestions: 0, openQuestions: 0 });
    return NextResponse.json(fronts);
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to read fronts: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}
