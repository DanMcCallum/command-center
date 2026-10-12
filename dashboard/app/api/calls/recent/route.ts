import type { NextRequest } from 'next/server';
import { callsApi } from '@/lib/calls-client';
import { callsResponse } from '@/lib/calls-proxy';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return callsResponse(await callsApi.recent(request.nextUrl.search));
}
