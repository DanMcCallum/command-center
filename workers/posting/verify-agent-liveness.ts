/**
 * Throwaway US-002 browser verification (specs/local-publish-3-decommission.md):
 * fakes /api/tasks and /api/agent-status via page.route and checks
 * - offline: header indicator says offline, Publish buttons warn (text + tooltip),
 *   clicking still queues (POST /publish fires)
 * - online: indicator says online, no warning
 * Run: cd workers/posting && npx tsx verify-agent-liveness.ts
 */
import { chromium, type Page } from 'playwright';

const BASE = 'http://localhost:3001';

const TASK = {
  id: 'verify-liveness-1',
  title: 'Liveness verify fixture',
  description: '',
  type: 'Content',
  tags: ['ad-builder'],
  status: 'needs_review',
  priority: 3,
  model: 'sonnet',
  acceptanceCriteria: [],
  slashCommand: 'generate-ad',
  claudeNotes: '',
  completionFile: null,
  workspacePath: null,
  parentTaskId: null,
  claudeSessionId: null,
  captainNotes: null,
  createdAt: '2026-07-12T00:00:00.000Z',
  updatedAt: '2026-07-12T00:00:00.000Z',
  startedAt: null,
  completedAt: null,
  estimatedMinutes: null,
  metadata: null,
  postings: [],
};

const failures: string[] = [];
function check(name: string, ok: boolean) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failures.push(name);
}

async function setupRoutes(page: Page, lastSeenAt: string | null) {
  await page.route('**/api/tasks', route =>
    route.fulfill({ json: [TASK] }),
  );
  await page.route('**/api/agent-status', route =>
    route.fulfill({ json: { lastSeenAt, platforms: [] } }),
  );
}

async function openCard(page: Page) {
  await page.goto(`${BASE}/tasks`);
  await page.getByText('Liveness verify fixture').click();
  await page.getByText('Publish', { exact: true }).first().waitFor();
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // --- Offline: lastSeenAt 10 minutes ago (way past the 45s window) ---
  await setupRoutes(page, new Date(Date.now() - 600_000).toISOString());
  let publishCalled = false;
  await page.route(`**/api/tasks/${TASK.id}/publish`, route => {
    publishCalled = true;
    return route.fulfill({ json: { ok: true } });
  });
  await openCard(page);

  check(
    'offline: header shows "Poster agent offline"',
    await page.getByText('Poster agent offline', { exact: true }).isVisible(),
  );
  check(
    'offline: warning text under Publish buttons',
    await page
      .getByText('Poster agent offline — start it on your machine', {
        exact: false,
      })
      .isVisible(),
  );
  const btn = page.getByRole('button', { name: 'Publish', exact: true }).first();
  const title = await btn.getAttribute('title');
  check(
    'offline: button tooltip carries the warning',
    (title ?? '').includes('Poster agent offline'),
  );
  await btn.click();
  await page.waitForTimeout(500);
  check('offline: clicking Publish still queues (POST fired)', publishCalled);

  // --- Online: lastSeenAt now ---
  await page.unroute('**/api/agent-status');
  await page.route('**/api/agent-status', route =>
    route.fulfill({
      json: { lastSeenAt: new Date().toISOString(), platforms: [] },
    }),
  );
  await openCard(page);
  check(
    'online: header shows "Poster agent online"',
    await page.getByText('Poster agent online', { exact: true }).isVisible(),
  );
  check(
    'online: no offline warning rendered',
    (await page
      .getByText('Poster agent offline — start it on your machine', {
        exact: false,
      })
      .count()) === 0,
  );

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
