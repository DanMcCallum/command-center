import { NextResponse } from 'next/server';
import { getCronConfig, saveCronConfig } from '@/lib/data';
import { installCron, removeCron } from '@/lib/cron';
import { SUPPORTED_INTERVALS, type CronConfig } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  const cfg = await getCronConfig();
  return NextResponse.json(cfg);
}

export async function PUT(request: Request) {
  let body: Partial<CronConfig>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const current = await getCronConfig();
  const next: CronConfig = {
    enabled: body.enabled ?? current.enabled,
    intervalMinutes: body.intervalMinutes ?? current.intervalMinutes,
  };

  if (
    !SUPPORTED_INTERVALS.includes(next.intervalMinutes as never)
  ) {
    return NextResponse.json(
      { error: `intervalMinutes must be one of ${SUPPORTED_INTERVALS.join(', ')}` },
      { status: 400 },
    );
  }

  const enabledChanged = body.enabled !== undefined && body.enabled !== current.enabled;
  const intervalChanged =
    body.intervalMinutes !== undefined && body.intervalMinutes !== current.intervalMinutes;

  if (enabledChanged || intervalChanged) {
    try {
      if (next.enabled) {
        await installCron(next.intervalMinutes);
      } else {
        await removeCron();
      }
    } catch (err) {
      return NextResponse.json(
        { error: `Failed to update crontab: ${(err as Error).message}` },
        { status: 500 },
      );
    }
  }

  await saveCronConfig(next);
  return NextResponse.json(next);
}
