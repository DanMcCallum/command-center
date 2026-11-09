import { NextResponse } from 'next/server';
import { BUYWANDER_ORIGIN, isAuctionId, lotUrl, normalizeLot } from '@/lib/buywander-lot';

export const dynamic = 'force-dynamic';

const UPSTREAM_TIMEOUT_MS = 15_000;

type Params = { params: Promise<{ auctionId: string }> };

/**
 * GET /api/buywander/lot/<auctionId>: one lot from BuyWander's public
 * by-auction endpoint, normalized. 400 malformed id, 404 unknown lot,
 * 502 for any other upstream failure or a timeout.
 */
export async function GET(_req: Request, { params }: Params) {
  const { auctionId } = await params;
  if (!isAuctionId(auctionId)) {
    return NextResponse.json({ error: 'auctionId must be a GUID' }, { status: 400 });
  }

  let res: Response;
  try {
    res = await fetch(lotUrl(auctionId), {
      cache: 'no-store',
      headers: { Origin: BUYWANDER_ORIGIN, Accept: 'application/json' },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    const msg = err instanceof Error && err.name === 'TimeoutError' ? 'BuyWander timed out' : `BuyWander unreachable: ${(err as Error).message}`;
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  if (res.status === 404) {
    return NextResponse.json({ error: 'Lot not found' }, { status: 404 });
  }
  if (!res.ok) {
    return NextResponse.json({ error: `BuyWander answered ${res.status}` }, { status: 502 });
  }

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    return NextResponse.json({ error: 'BuyWander sent non-JSON' }, { status: 502 });
  }

  const lot = normalizeLot(raw);
  if (!lot.auction_id) lot.auction_id = auctionId;
  return NextResponse.json({ lot });
}
