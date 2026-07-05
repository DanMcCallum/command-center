import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import type { PostingPlatformConfig } from '../posting-platforms/route';

export const dynamic = 'force-dynamic';

const CONFIG_PATH = path.resolve(
  process.cwd(),
  '..',
  'config',
  'posting-platforms.json',
);

const AUTH_DIR = path.resolve(process.cwd(), '..', 'workers', 'posting', 'auth');

export interface PostingAuthStatus {
  platform: string;
  displayName: string;
  hasSession: boolean;
  savedAt: string | null;
}

export async function GET() {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf8');
    const config = JSON.parse(raw) as {
      platforms: Record<string, PostingPlatformConfig>;
    };

    const statuses: PostingAuthStatus[] = await Promise.all(
      Object.entries(config.platforms)
        .filter(([, cfg]) => cfg.enabled)
        .map(async ([key, cfg]) => {
          try {
            const info = await stat(path.join(AUTH_DIR, `${key}.json`));
            return {
              platform: key,
              displayName: cfg.display_name,
              hasSession: true,
              savedAt: info.mtime.toISOString(),
            };
          } catch {
            return {
              platform: key,
              displayName: cfg.display_name,
              hasSession: false,
              savedAt: null,
            };
          }
        }),
    );

    return NextResponse.json({ platforms: statuses });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to read posting auth status: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}
