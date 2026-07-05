import { NextResponse } from 'next/server';
import { getCronConfig } from '@/lib/data';
import { isCronInstalled } from '@/lib/cron';

export const dynamic = 'force-dynamic';

export async function GET() {
  const cfg = await getCronConfig();
  let installed = false;
  try {
    installed = await isCronInstalled();
  } catch {
    installed = false;
  }
  return NextResponse.json({
    enabled: cfg.enabled,
    intervalMinutes: cfg.intervalMinutes,
    lastRun: cfg.lastRun,
    lastTaskId: cfg.lastTaskId,
    crontabInstalled: installed,
  });
}
