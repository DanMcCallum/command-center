import { NextResponse } from 'next/server';
import {
  getPurchase,
  getPurchases,
  LotNotFoundError,
  recordPurchase,
} from '@/lib/buywander-purchases';
import { isRecord } from '@/lib/buywander';

export const dynamic = 'force-dynamic';

/** Dashboard-facing: every purchase newest first, or one by ?auction_id=. */
export async function GET(request: Request) {
  const auctionId = new URL(request.url).searchParams.get('auction_id');
  if (auctionId) {
    const one = await getPurchase(auctionId);
    return NextResponse.json({ purchases: one ? [one] : [] });
  }
  return NextResponse.json({ purchases: await getPurchases() });
}

/**
 * Mark a lot as bought. Body { auction_id, run_id?, paid_usd?, notes? }.
 * 201 with the new record, 200 with the existing one when already recorded,
 * 404 when no stored run holds the auction id.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!isRecord(body) || typeof body.auction_id !== 'string' || !body.auction_id.trim()) {
    return NextResponse.json({ error: 'auction_id is required' }, { status: 400 });
  }
  if (body.paid_usd !== undefined && body.paid_usd !== null && typeof body.paid_usd !== 'number') {
    return NextResponse.json({ error: 'paid_usd must be a number or null' }, { status: 400 });
  }
  const auctionId = body.auction_id.trim();
  const existing = await getPurchase(auctionId);
  if (existing) return NextResponse.json({ purchase: existing }, { status: 200 });
  try {
    const purchase = await recordPurchase({
      auction_id: auctionId,
      run_id: typeof body.run_id === 'string' ? body.run_id : undefined,
      paid_usd: typeof body.paid_usd === 'number' ? body.paid_usd : null,
      notes: typeof body.notes === 'string' ? body.notes : undefined,
    });
    return NextResponse.json({ purchase }, { status: 201 });
  } catch (err) {
    if (err instanceof LotNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    throw err;
  }
}
