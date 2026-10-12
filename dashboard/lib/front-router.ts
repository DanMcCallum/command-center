/**
 * Lane routing for the fronts pipeline (specs/fronts.md US-005): which front
 * did a finished session belong to?
 *
 * Order of evidence, all combined in code:
 *   1. cwd hints from config/fronts.json (deterministic bias, longest match).
 *   2. Jev (TypeSafe Choice) over the session summary, when configured.
 *   3. `claude -p --model haiku --json-schema` with the same options, when
 *      Jev is unavailable.
 * Thresholds live in workers/fronts/route-session.sh, not here: this module
 * returns probabilities, the script decides.
 */
import { spawn } from 'node:child_process';
import os from 'node:os';
import type { FrontConfig } from './types';
import { asChoice, isConfigured, systemOne, type SystemOneFn } from './typesafe';

export const NONE = 'none';
const CWD_BIAS = 0.25;
const CWD_ONLY_PROBABILITY = 0.7;
const CLAUDE_TIMEOUT_MS = 90_000;

export interface RouteInput {
  summary: string;
  cwd: string | null;
  filesTouched: string[];
}

export interface RouteResult {
  /** Sorted by probability, highest first; `none` excluded. */
  fronts: { slug: string; probability: number }[];
  /** How peaked the distribution was (0 when nothing answered). */
  confidence: number;
  method: 'jev' | 'claude' | 'cwd' | 'none';
  /** Slug the cwd hint pointed at, if any. */
  cwdMatch: string | null;
}

export interface RouterDeps {
  ask?: SystemOneFn;
  configured?: () => boolean;
  /** Returns probabilities per slug (plus `none`), or throws. */
  claudeFallback?: (state: string, criteria: Record<string, string>) => Promise<Record<string, number>>;
  home?: string;
}

function expandTilde(p: string, home: string): string {
  return p.startsWith('~') ? home + p.slice(1) : p;
}

/** The enabled front whose cwd hint is the longest prefix of cwd, or null. */
export function matchCwd(cwd: string | null, fronts: FrontConfig[], home = os.homedir()): string | null {
  if (!cwd) return null;
  let best: { slug: string; len: number } | null = null;
  for (const f of fronts) {
    if (!f.enabled) continue;
    for (const hint of f.cwdHints) {
      const h = expandTilde(hint, home).replace(/\/+$/, '');
      if (!h) continue;
      if (cwd === h || cwd.startsWith(h + '/')) {
        if (!best || h.length > best.len) best = { slug: f.slug, len: h.length };
      }
    }
  }
  return best?.slug ?? null;
}

export function buildCriteria(fronts: FrontConfig[]): Record<string, string> {
  const criteria: Record<string, string> = {};
  for (const f of fronts) if (f.enabled) criteria[f.slug] = `${f.name}: ${f.description}`;
  criteria[NONE] = 'None of these fronts. The session was about something else, or it is not clear enough to say.';
  return criteria;
}

export function buildState(input: RouteInput): string {
  return [
    `Working directory: ${input.cwd ?? 'unknown'}`,
    `Files touched: ${input.filesTouched.length ? input.filesTouched.join(', ') : 'none recorded'}`,
    '',
    'Session summary:',
    input.summary,
  ].join('\n');
}

/** Applies the cwd bias, drops `none`, renormalizes, sorts. */
export function combine(
  probabilities: Record<string, number>,
  cwdMatch: string | null,
  fronts: FrontConfig[],
): { slug: string; probability: number }[] {
  const slugs = fronts.filter(f => f.enabled).map(f => f.slug);
  const raw: Record<string, number> = {};
  for (const s of slugs) raw[s] = Math.max(0, probabilities[s] ?? 0);
  raw[NONE] = Math.max(0, probabilities[NONE] ?? 0);
  if (cwdMatch && cwdMatch in raw) raw[cwdMatch] += CWD_BIAS;
  const total = Object.values(raw).reduce((a, b) => a + b, 0);
  if (total <= 0) return [];
  return slugs
    .map(slug => ({ slug, probability: Math.round((raw[slug] / total) * 1000) / 1000 }))
    .filter(x => x.probability > 0)
    .sort((a, b) => b.probability - a.probability);
}

/** Runs `claude` with the prompt on stdin; resolves with stdout. */
function runClaude(args: string[], input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, {
      env: { ...process.env, FRONTS_SKIP: '1', PATH: `${process.env.PATH ?? ''}:${os.homedir()}/.local/bin` },
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('claude timed out'));
    }, CLAUDE_TIMEOUT_MS);
    child.stdout.on('data', (c: Buffer) => chunks.push(c));
    child.on('error', err => { clearTimeout(timer); reject(err); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(chunks).toString('utf8'));
      else reject(new Error(`claude exited with ${code}`));
    });
    child.stdin.end(input);
  });
}

async function defaultClaudeFallback(
  state: string,
  criteria: Record<string, string>,
): Promise<Record<string, number>> {
  const keys = Object.keys(criteria);
  const schema = JSON.stringify({
    type: 'object',
    properties: {
      probabilities: {
        type: 'object',
        properties: Object.fromEntries(keys.map(k => [k, { type: 'number' }])),
        required: keys,
        additionalProperties: false,
      },
    },
    required: ['probabilities'],
    additionalProperties: false,
  });
  const prompt = [
    'Which front (lane of work) did this session belong to? Give a probability for every option; they should sum to 1. Use "none" when the session fits nothing listed or is too thin to tell.',
    '',
    'Options:',
    ...keys.map(k => `- ${k}: ${criteria[k]}`),
    '',
    state,
  ].join('\n');
  const stdout = await runClaude(
    ['-p', '--model', 'haiku', '--output-format', 'json', '--json-schema', schema, '--tools', ''],
    prompt,
  );
  const parsed = JSON.parse(stdout) as { structured_output?: { probabilities?: Record<string, number> } };
  const probs = parsed.structured_output?.probabilities;
  if (!probs) throw new Error('claude returned no structured_output');
  return probs;
}

export async function routeSession(
  input: RouteInput,
  fronts: FrontConfig[],
  deps: RouterDeps = {},
): Promise<RouteResult> {
  const home = deps.home ?? os.homedir();
  const cwdMatch = matchCwd(input.cwd, fronts, home);
  const criteria = buildCriteria(fronts);
  const state = buildState(input);
  const configured = deps.configured ?? isConfigured;
  const ask = deps.ask ?? systemOne;
  const fallback = deps.claudeFallback ?? defaultClaudeFallback;

  if (configured()) {
    try {
      const res = await ask(state, {
        front: {
          type: 'choice',
          instructions:
            'Which front (lane of the operator\'s work) was this session about? Judge from the summary, the working directory, and the files touched. Pick none when it fits nothing listed or is too thin to tell.',
          criteria,
        },
      });
      const answer = asChoice(res.answers.front);
      if (answer) {
        return {
          fronts: combine(answer.probabilities, cwdMatch, fronts),
          confidence: answer.confidence,
          method: 'jev',
          cwdMatch,
        };
      }
    } catch {
      // fall through to claude
    }
  }

  try {
    const probs = await fallback(state, criteria);
    const combined = combine(probs, cwdMatch, fronts);
    const top = combined[0]?.probability ?? 0;
    const second = combined[1]?.probability ?? 0;
    return { fronts: combined, confidence: Math.max(0, top - second), method: 'claude', cwdMatch };
  } catch {
    // fall through to cwd only
  }

  if (cwdMatch) {
    return {
      fronts: [{ slug: cwdMatch, probability: CWD_ONLY_PROBABILITY }],
      confidence: CWD_ONLY_PROBABILITY,
      method: 'cwd',
      cwdMatch,
    };
  }
  return { fronts: [], confidence: 0, method: 'none', cwdMatch: null };
}
