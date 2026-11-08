import { NextResponse } from 'next/server';
import { requireAgentToken } from '@/lib/agent-auth';
import {
  bidRuleFromEnv,
  getRuns,
  notifyRun,
  recordRun,
  updateRunNotify,
  validateAgentOutput,
  type BuywanderAgentOutput,
  type BuywanderNotify,
} from '@/lib/buywander';

export const dynamic = 'force-dynamic';

/** Dashboard-facing: every stored run, newest first. */
export async function GET() {
  return NextResponse.json(await getRuns());
}

/**
 * Agent-facing (bearer AGENT_TOKEN): store the nightly scan the
 * `claude -p --chrome` run produced, merge its settled auction ids into the
 * seen list, and push the finds to the operator's phone through ntfy. The
 * push result is recorded on the run, so a bad topic shows up on /deals
 * instead of only in a log.
 */
export async function POST(request: Request) {
  const denied = requireAgentToken(request);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const problem = validateAgentOutput(body);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const rule = bidRuleFromEnv();
  const run = await recordRun(body as BuywanderAgentOutput, rule);

  let notify: BuywanderNotify = { sent: false, channel: 'ntfy', error: null };
  if (run.finds.length > 0) {
    try {
      await notifyRun(run, rule);
      notify = { sent: true, channel: 'ntfy', error: null };
    } catch (err) {
      notify = { sent: false, channel: 'ntfy', error: err instanceof Error ? err.message : String(err) };
    }
  }
  await updateRunNotify(run.id, notify);
  return NextResponse.json({ ...run, notify }, { status: 201 });
}
