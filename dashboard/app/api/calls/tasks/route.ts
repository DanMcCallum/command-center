import { callsApi } from '@/lib/calls-client';
import { callsResponse } from '@/lib/calls-proxy';

export const dynamic = 'force-dynamic';

export async function GET() {
  return callsResponse(await callsApi.tasks());
}
