/**
 * Reader for the project-root .env.local.
 *
 * Next.js only auto-loads dashboard/.env.local, but the project's shared
 * secrets (AGENT_TOKEN, TYPESAFE_API_KEY, Dialpad keys) live one level up so
 * the workers can read the same file. Anything that needs a root var reads
 * process.env first and falls back to parsing that file. See AGENTS.md.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const PROJECT_ROOT = path.resolve(process.cwd(), '..');

/**
 * Returns a var from process.env, falling back to the project-root
 * .env.local, or null when it is set nowhere. Values are never logged.
 */
export function readProjectEnvVar(name: string): string | null {
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
