import { exec } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { SUPPORTED_INTERVALS } from './types';

const execP = promisify(exec);

const MARKER = '# COMMAND-CENTER-WORKER';
// Retired server-side poster (Local Publish Part 1) — kept only so stripMarker
// scrubs any leftover line from crontabs written before the retirement.
const LEGACY_POSTER_MARKER = '# COMMAND-CENTER-POSTER';
const PROJECT_ROOT = path.resolve(process.cwd(), '..');
const WORKER_SCRIPT = path.join(PROJECT_ROOT, 'workers', 'run-worker.sh');
const CRON_LOG = path.join(PROJECT_ROOT, 'workers', 'logs', 'cron.log');

function cronExpression(intervalMinutes: number): string {
  if (intervalMinutes < 60) return `*/${intervalMinutes} * * * *`;
  if (intervalMinutes === 60) return '0 * * * *';
  const hours = Math.round(intervalMinutes / 60);
  return `0 */${hours} * * *`;
}

async function readCrontab(): Promise<string> {
  try {
    const { stdout } = await execP('crontab -l', { encoding: 'utf8' });
    return stdout;
  } catch {
    // No crontab installed yet — treat as empty.
    return '';
  }
}

async function writeCrontab(content: string): Promise<void> {
  const trimmed = content.replace(/\n+$/, '') + '\n';
  await new Promise<void>((resolve, reject) => {
    const child = exec('crontab -', { shell: '/bin/bash' }, err => {
      if (err) reject(err);
      else resolve();
    });
    child.stdin?.end(trimmed, 'utf8');
  });
}

function stripMarker(crontab: string): string {
  return crontab
    .split('\n')
    .filter(line => !line.includes(MARKER) && !line.includes(LEGACY_POSTER_MARKER))
    .join('\n');
}

export async function installCron(intervalMinutes: number): Promise<void> {
  if (!SUPPORTED_INTERVALS.includes(intervalMinutes as never)) {
    throw new Error(
      `Unsupported interval: ${intervalMinutes}. Use one of ${SUPPORTED_INTERVALS.join(', ')}.`,
    );
  }
  const expr = cronExpression(intervalMinutes);
  const workerLine = `${expr} cd ${PROJECT_ROOT} && bash ${WORKER_SCRIPT} >> ${CRON_LOG} 2>&1 ${MARKER}`;
  const current = await readCrontab();
  const next = stripMarker(current).replace(/\n+$/, '');
  const merged = next ? `${next}\n${workerLine}\n` : `${workerLine}\n`;
  await writeCrontab(merged);
}

export async function removeCron(): Promise<void> {
  const current = await readCrontab();
  await writeCrontab(stripMarker(current));
}

export async function isCronInstalled(): Promise<boolean> {
  const current = await readCrontab();
  return current.includes(MARKER);
}
