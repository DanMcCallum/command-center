import { callsApi } from '@/lib/calls-client';
import { callsResponse } from '@/lib/calls-proxy';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  return callsResponse(await callsApi.outbox(id));
}
