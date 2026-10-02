/**
 * Auth guard for agent-facing API routes (specs/job-model-agent-facing-api.md,
 * US-002).
 *
 * The local poster agent authenticates with `Authorization: Bearer <AGENT_TOKEN>`.
 * The token is a secret on the same footing as auth/*.json: it lives in the
 * project-root .env.local and is never logged and never appears in a response.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { readProjectEnvVar } from './project-env';

/**
 * Guards an agent-facing route. Returns null when the request carries the
 * correct bearer token; otherwise returns the error response to send:
 * 503 when AGENT_TOKEN is not configured (fail closed), 401 on a missing or
 * wrong token.
 */
export function requireAgentToken(request: Request): NextResponse | null {
  const expected = readProjectEnvVar('AGENT_TOKEN');
  if (!expected) {
    return NextResponse.json(
      {
        error:
          'AGENT_TOKEN is not set — generate a random secret in the ' +
          'project-root .env.local before using the agent API',
      },
      { status: 503 },
    );
  }
  const header = request.headers.get('authorization');
  const match = header?.match(/^Bearer\s+(.+)$/i);
  if (match) {
    // Hash both sides to fixed-length digests so timingSafeEqual never
    // throws on length mismatch (and length isn't observable either).
    const provided = createHash('sha256').update(match[1]).digest();
    const wanted = createHash('sha256').update(expected).digest();
    if (timingSafeEqual(provided, wanted)) return null;
  }
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
