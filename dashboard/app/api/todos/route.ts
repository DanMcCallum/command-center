import { NextResponse } from 'next/server';
import { getTodos } from '@/lib/data';

export const dynamic = 'force-dynamic';

export async function GET() {
  const todos = await getTodos();
  return NextResponse.json(todos);
}
