import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const CONFIG_PATH = path.resolve(
  process.cwd(),
  '..',
  'config',
  'posting-platforms.json',
);

export interface LoginSuccessSignal {
  cookie?: string;
  redirect_off?: string;
}

export interface PostingPlatformConfig {
  display_name: string;
  enabled: boolean;
  login_url: string;
  new_listing_url: string;
  login_success?: LoginSuccessSignal;
}

export async function GET() {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf8');
    const config = JSON.parse(raw) as {
      platforms: Record<string, PostingPlatformConfig>;
    };
    return NextResponse.json({ platforms: config.platforms });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to read posting platforms: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}
