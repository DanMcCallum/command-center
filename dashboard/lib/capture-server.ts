/**
 * Shared helpers for the dashboard → worker capture-server proxy routes
 * (specs/live-view-browser.md, US-006).
 *
 * The browser never talks to the capture-server directly: these routes call
 * it server-side with a Bearer token derived from CAPTURE_STREAM_SECRET
 * (the same HMAC-SHA256("capture-api") derivation the capture-server uses —
 * the dashboard cannot import workers/posting modules). The raw secret and
 * the derived token are never logged and never appear in a response.
 */
import { createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { PostingPlatformConfig } from '../app/api/posting-platforms/route';

const PROJECT_ROOT = path.resolve(process.cwd(), '..');
const CONFIG_PATH = path.join(PROJECT_ROOT, 'config', 'posting-platforms.json');

/** Configuration is absent (OT-3 not done / env not set) — fail closed. */
export class CaptureConfigError extends Error {}

/** Caller input is bad (unknown platform, not live-view) — reject with 400. */
export class CaptureRequestError extends Error {}

/**
 * Reads a var from process.env, falling back to the project-root .env.local
 * (the same fallback the capture-server's stream.ts uses, so both ends read
 * one file). Returns null when absent — callers decide the failure message.
 */
function readProjectEnvVar(name: string): string | null {
  const fromEnv = process.env[name];
  if (fromEnv) return fromEnv;
  const envPath = path.join(PROJECT_ROOT, '.env.local');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
      const m = line.match(new RegExp(`^(?:export\\s+)?${name}=(.*)$`));
      if (m) {
        const value = m[1].trim().replace(/^(["'])(.*)\1$/, '$2');
        if (value) return value;
      }
    }
  }
  return null;
}

/**
 * Resolves where the capture-server lives and the token that authorizes
 * requests to it. Throws CaptureConfigError (non-secret message) when either
 * CAPTURE_SERVER_URL or CAPTURE_STREAM_SECRET is absent.
 */
export function getCaptureServerTarget(): { baseUrl: string; token: string } {
  const baseUrl = readProjectEnvVar('CAPTURE_SERVER_URL');
  if (!baseUrl) {
    throw new CaptureConfigError(
      'CAPTURE_SERVER_URL is not set — point it at the worker capture-server ' +
        '(e.g. http://127.0.0.1:4750) in .env.local',
    );
  }
  const secret = readProjectEnvVar('CAPTURE_STREAM_SECRET');
  if (!secret) {
    throw new CaptureConfigError(
      'CAPTURE_STREAM_SECRET is not set — generate a random secret in ' +
        '.env.local (specs/live-view-browser.md, OT-3)',
    );
  }
  const token = createHmac('sha256', secret).update('capture-api').digest('hex');
  return { baseUrl: baseUrl.replace(/\/+$/, ''), token };
}

/**
 * Throws CaptureRequestError unless the platform exists, is enabled, and is
 * configured `capture: "live-view"`.
 */
export async function requireLiveViewPlatform(platformKey: string): Promise<void> {
  const raw = await readFile(CONFIG_PATH, 'utf8');
  const config = JSON.parse(raw) as {
    platforms: Record<string, PostingPlatformConfig>;
  };
  const platform = config.platforms[platformKey];
  if (!platform) {
    throw new CaptureRequestError(`Unknown platform "${platformKey}"`);
  }
  if (!platform.enabled) {
    throw new CaptureRequestError(`Platform "${platformKey}" is not enabled`);
  }
  if (platform.capture !== 'live-view') {
    throw new CaptureRequestError(
      `Platform "${platformKey}" is not configured for live-view capture ` +
        '(use `npm run capture-login` instead)',
    );
  }
}

/**
 * Calls the capture-server, attaching the Bearer token. Throws
 * CaptureConfigError when env is absent and Error("capture-server
 * unreachable…") when the fetch itself fails; HTTP error statuses are
 * returned as-is for the route to pass through.
 */
export async function captureServerFetch(
  pathname: string,
  init: Omit<RequestInit, 'headers'> = {},
): Promise<Response> {
  const { baseUrl, token } = getCaptureServerTarget();
  try {
    return await fetch(`${baseUrl}${pathname}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });
  } catch {
    throw new Error(
      `capture-server unreachable at ${baseUrl} — start it with ` +
        '`npm run capture-server` in workers/posting',
    );
  }
}
