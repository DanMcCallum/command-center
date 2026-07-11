/**
 * Interactive login capture for marketplace posting.
 *
 * Usage: npm run capture-login -- <platform>
 *
 * Opens the platform's login_url (from config/posting-platforms.json) in a
 * headed Chromium window. The operator logs in by hand, then presses Enter in
 * the terminal; the browser's storage state (cookies + localStorage) is saved
 * to workers/posting/auth/<platform>.json for the posting scripts to reuse.
 * No passwords are ever stored.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { chromium } from 'playwright';

const CONFIG_PATH = path.resolve(__dirname, '../../config/posting-platforms.json');
const AUTH_DIR = path.resolve(__dirname, 'auth');

interface LoginSuccessSignal {
  cookie?: string;
  redirect_off?: string;
}

interface PlatformConfig {
  display_name: string;
  enabled: boolean;
  login_url: string;
  new_listing_url: string;
  capture?: 'live-view' | 'cli'; // defaults to "cli" when absent
  login_success?: LoginSuccessSignal;
}

interface PostingPlatformsFile {
  _doc?: string;
  platforms: Record<string, PlatformConfig>;
}

function loadPlatforms(): Record<string, PlatformConfig> {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
  return (JSON.parse(raw) as PostingPlatformsFile).platforms;
}

function waitForEnter(prompt: string): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, () => {
      rl.close();
      resolve();
    });
  });
}

async function main(): Promise<void> {
  const platformKey = process.argv[2];
  const platforms = loadPlatforms();
  const enabledKeys = Object.keys(platforms).filter((k) => platforms[k].enabled);

  if (!platformKey) {
    console.error('Usage: npm run capture-login -- <platform>');
    console.error(`Enabled platforms: ${enabledKeys.join(', ')}`);
    process.exit(1);
  }

  const platform = platforms[platformKey];
  if (!platform) {
    console.error(
      `Unknown platform "${platformKey}". Valid keys: ${Object.keys(platforms).join(', ')}`
    );
    process.exit(1);
  }
  if (!platform.enabled) {
    console.error(
      `Platform "${platformKey}" (${platform.display_name}) is not enabled in config/posting-platforms.json.`
    );
    console.error(`Enabled platforms: ${enabledKeys.join(', ')}`);
    process.exit(1);
  }

  const authPath = path.join(AUTH_DIR, `${platformKey}.json`);
  console.log(`Opening ${platform.display_name} login page: ${platform.login_url}`);

  const browser = await chromium.launch({ headless: false });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(platform.login_url);

    await waitForEnter(
      `\nLog in to ${platform.display_name} in the browser window, then press Enter here to save the session... `
    );

    fs.mkdirSync(AUTH_DIR, { recursive: true });
    await context.storageState({ path: authPath });
    fs.chmodSync(authPath, 0o600);
    console.log(`Session saved to ${authPath}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
