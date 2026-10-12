import { callsApi } from '@/lib/calls-client';
import { callsResponse } from '@/lib/calls-proxy';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ table: string; id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { table, id } = await params;
  return callsResponse(await callsApi.record(table, id));
}
