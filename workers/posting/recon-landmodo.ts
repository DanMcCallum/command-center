/**
 * One-off login-flow recon for the auth-capture research spike (US-003).
 *
 * Usage: npx tsx recon-landmodo.ts
 *
 * Loads Landmodo's login page in a headless, default-fingerprint Chromium
 * (the same install the poster uses), screenshots it to the spike's artifacts
 * dir, and prints markers a human proposal needs: HTTP status, presence of
 * known bot-protection / CAPTCHA scripts, and the visible login form fields.
 * Recon only — it never types credentials or submits anything.
 */
import * as fs from 'fs';
import * as path from 'path';
import { chromium } from 'playwright';

const LOGIN_URL = 'https://www.landmodo.com/login';
const ARTIFACTS_DIR = path.resolve(
  __dirname,
  '../../research/auth-capture-spike/artifacts'
);
const SHOT_PATH = path.join(ARTIFACTS_DIR, 'landmodo-login.png');

// Substrings that, if present in the page HTML, flag a known bot-wall / CAPTCHA
// / MFA vendor. Matched case-insensitively against the raw response body.
const BOT_MARKERS: Record<string, string[]> = {
  reCAPTCHA: ['recaptcha', 'g-recaptcha', 'www.google.com/recaptcha'],
  hCaptcha: ['hcaptcha', 'h-captcha'],
  Turnstile: ['turnstile', 'challenges.cloudflare.com'],
  'Cloudflare challenge': ['cf-challenge', '__cf_chl', 'cdn-cgi/challenge-platform'],
  DataDome: ['datadome'],
  PerimeterX: ['perimeterx', '_px'],
  Arkose: ['arkoselabs', 'funcaptcha'],
};

async function main(): Promise<void> {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    const response = await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
    const status = response ? response.status() : null;
    console.log(`GET ${LOGIN_URL} -> HTTP ${status}`);
    console.log(`final URL after load: ${page.url()}`);
    console.log(`document title: ${JSON.stringify(await page.title())}`);

    await page.waitForLoadState('networkidle').catch(() => {});
    await page.screenshot({ path: SHOT_PATH, fullPage: true });
    console.log(`screenshot saved: ${SHOT_PATH}`);

    const html = (await page.content()).toLowerCase();

    console.log('\n-- bot-protection / CAPTCHA markers --');
    let anyMarker = false;
    for (const [vendor, needles] of Object.entries(BOT_MARKERS)) {
      const hits = needles.filter((n) => html.includes(n.toLowerCase()));
      if (hits.length > 0) {
        anyMarker = true;
        console.log(`  FOUND ${vendor}: ${hits.join(', ')}`);
      }
    }
    if (!anyMarker) console.log('  none of the known markers present');

    console.log('\n-- login form fields (inputs) --');
    const inputs = await page.$$eval('input', (els) =>
      els.map((el) => {
        const i = el as HTMLInputElement;
        return {
          type: i.type,
          name: i.name,
          id: i.id,
          placeholder: i.placeholder,
          required: i.required,
        };
      })
    );
    for (const i of inputs) console.log(`  ${JSON.stringify(i)}`);

    const forms = await page.$$eval('form', (els) =>
      els.map((el) => (el as HTMLFormElement).action)
    );
    console.log('\n-- form actions --');
    for (const a of forms) console.log(`  ${a}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
