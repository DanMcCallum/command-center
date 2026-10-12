/**
 * Spawns workers/run-worker.sh detached, the way POST /api/run-worker does.
 * Shared so approving a front suggestion fires the worker the same way the
 * Ad Builder does.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const PROJECT_ROOT = path.resolve(process.cwd(), '..');
const WORKER_SCRIPT = path.join(PROJECT_ROOT, 'workers', 'run-worker.sh');

export function spawnWorker(): number | undefined {
  const child = spawn('bash', [WORKER_SCRIPT], {
    cwd: PROJECT_ROOT,
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      DASHBOARD_URL: process.env.DASHBOARD_URL ?? 'http://localhost:3000',
    },
  });
  child.unref();
  return child.pid;
}
