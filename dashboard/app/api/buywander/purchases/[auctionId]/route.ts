import { NextResponse } from 'next/server';
import { deletePurchase, getPurchase, updatePurchase, type PurchasePatch } from '@/lib/buywander-purchases';
import { isRecord } from '@/lib/buywander';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ auctionId: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { auctionId } = await params;
  const purchase = await getPurchase(auctionId);
  if (!purchase) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ purchase });
}

/** Body { paid_usd?, notes?, task_id? }; other keys are ignored. */
export async function PATCH(request: Request, { params }: Params) {
  const { auctionId } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!isRecord(body)) return NextResponse.json({ error: 'body must be an object' }, { status: 400 });
  if (body.paid_usd !== undefined && body.paid_usd !== null && typeof body.paid_usd !== 'number') {
    return NextResponse.json({ error: 'paid_usd must be a number or null' }, { status: 400 });
  }
  if (body.notes !== undefined && typeof body.notes !== 'string') {
    return NextResponse.json({ error: 'notes must be a string' }, { status: 400 });
  }
  if (body.task_id !== undefined && body.task_id !== null && typeof body.task_id !== 'string') {
    return NextResponse.json({ error: 'task_id must be a string or null' }, { status: 400 });
  }
  const patch: PurchasePatch = {};
  if ('paid_usd' in body) patch.paid_usd = body.paid_usd as number | null;
  if ('notes' in body) patch.notes = body.notes as string;
  if ('task_id' in body) patch.task_id = body.task_id as string | null;
  const purchase = await updatePurchase(auctionId, patch);
  if (!purchase) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ purchase });
}

export async function DELETE(_req: Request, { params }: Params) {
  const { auctionId } = await params;
  const ok = await deletePurchase(auctionId);
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
