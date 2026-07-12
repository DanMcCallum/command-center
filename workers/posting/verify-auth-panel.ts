/**
 * US-003 browser verification (specs/local-publish-3-decommission.md):
 * fakes /api/posting-platforms and /api/agent-status via page.route and checks
 * the Settings auth panel is a read-only view of agent-reported sessions
 * - session held renders captured + expiry dates; no session renders amber
 * - platforms the agent hasn't reported show "No report from agent yet"
 * - disabled platforms don't render
 * - Connect button, live-view iframe, and paste UI are gone
 * - the real GET /api/posting-auth route is deleted (404)
 * Run: cd workers/posting && npx tsx verify-auth-panel.ts
 */
import { chromium, type Page } from 'playwright';

const BASE = 'http://localhost:3001';

const PLATFORMS = {
  landmodo: {
    display_name: 'Landmodo',
    enabled: true,
    login_url: 'https://x/login',
    new_listing_url: 'https://x/new',
  },
  land_com: {
    display_name: 'Land.com',
    enabled: true,
    login_url: 'https://y/login',
    new_listing_url: 'https://y/new',
  },
  landflip: {
    display_name: 'LANDFLIP',
    enabled: false,
    login_url: 'https://z/login',
    new_listing_url: 'https://z/new',
  },
};

const REPORT = [
  {
    platform: 'landmodo',
    hasSession: true,
    capturedAt: '2026-07-10T08:00:00.000Z',
    earliestCookieExpiry: '2026-08-09T08:00:00.000Z',
  },
  { platform: 'land_com', hasSession: false, capturedAt: null },
];

const failures: string[] = [];
function check(name: string, ok: boolean) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failures.push(name);
}

async function setupRoutes(page: Page, platforms: unknown[]) {
  await page.route('**/api/posting-platforms', route =>
    route.fulfill({ json: { platforms: PLATFORMS } }),
  );
  await page.route('**/api/agent-status', route =>
    route.fulfill({
      json: { lastSeenAt: new Date().toISOString(), platforms },
    }),
  );
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // --- Agent has reported: one session held, one absent ---
  await setupRoutes(page, REPORT);
  await page.goto(`${BASE}/settings`);
  await page.getByText('Marketplace logins').waitFor();
  await page.getByText('Landmodo', { exact: true }).waitFor();

  check(
    'session held: captured + expiry dates rendered',
    await page
      .getByText('Session held (captured 7/10/2026, expires 8/9/2026)')
      .isVisible(),
  );
  check(
    'no session: amber "No session" for land_com',
    await page.getByText('No session', { exact: true }).isVisible(),
  );
  check(
    'disabled platform not rendered',
    (await page.getByText('LANDFLIP').count()) === 0,
  );
  check(
    'static local-publish text present',
    await page
      .getByText('Sessions are established on your machine when you click Publish', {
        exact: false,
      })
      .isVisible(),
  );
  check(
    'agent online indicator in panel',
    await page.getByText('Poster agent online', { exact: true }).isVisible(),
  );
  check(
    'no Connect button',
    (await page.getByRole('button', { name: /connect/i }).count()) === 0,
  );
  check('no live-view iframe', (await page.locator('iframe').count()) === 0);
  check(
    'no paste UI',
    (await page.getByPlaceholder(/paste/i).count()) === 0 &&
      (await page.getByText(/clipboard/i).count()) === 0,
  );

  // --- Agent has never reported: platforms rows fall back ---
  await page.unroute('**/api/agent-status');
  await page.route('**/api/agent-status', route =>
    route.fulfill({ json: { lastSeenAt: null, platforms: [] } }),
  );
  await page.goto(`${BASE}/settings`);
  await page.getByText('Landmodo', { exact: true }).waitFor();
  check(
    'unreported platforms show "No report from agent yet"',
    (await page.getByText('No report from agent yet').count()) === 2,
  );

  // --- The old server-side route is gone (hits the real server) ---
  const res = await page.request.get(`${BASE}/api/posting-auth`);
  check('GET /api/posting-auth is deleted (404)', res.status() === 404);

  await browser.close();
  if (failures.length) {
    console.error(`\n${failures.length} check(s) failed`);
    process.exit(1);
  }
  console.log('\nAll checks passed');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
