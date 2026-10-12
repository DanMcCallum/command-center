import { callsApi } from '@/lib/calls-client';
import { callsResponse, readJsonBody } from '@/lib/calls-proxy';

export const dynamic = 'force-dynamic';

export async function GET() {
  return callsResponse(await callsApi.agents());
}

export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  return callsResponse(await callsApi.upsertAgent(parsed.body));
}
