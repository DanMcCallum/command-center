/**
 * Fronts: file-backed readers and writers (specs/fronts.md, US-001).
 *
 * A front is fronts/<slug>/north-star.md (operator-written, never touched by
 * agents) plus fronts/<slug>/now.md (agent-maintained). Session summaries live
 * in fronts/memory/. The registry is config/fronts.json. All paths resolve from
 * the project root (one level above the dashboard), like the other config
 * readers; client components reach this only through /api/fronts.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { FrontConfig, FrontDetail, FrontMemoryEntry, FrontSummary } from './types';

const PROJECT_ROOT = path.resolve(process.cwd(), '..');
const REGISTRY_FILE = path.join(PROJECT_ROOT, 'config', 'fronts.json');
export const FRONTS_DIR = path.join(PROJECT_ROOT, 'fronts');
export const MEMORY_DIR = path.join(FRONTS_DIR, 'memory');

export const NORTH_STAR_TODO_MARKER = 'TODO: hand-write';
export const ANSWERS_HEADING = '## Answers from Daniel';
const EXCERPT_CHARS = 300;
const RECENT_SESSIONS = 10;
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

export class UnknownFrontError extends Error {
  constructor(slug: string) {
    super(`Unknown front: ${slug}`);
    this.name = 'UnknownFrontError';
  }
}

async function readOrNull(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

async function mtimeOrNull(file: string): Promise<string | null> {
  try {
    return (await fs.stat(file)).mtime.toISOString();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** The registry, with defaults filled in. Slugs failing SLUG_RE are dropped. */
export async function getFrontConfigs(): Promise<FrontConfig[]> {
  const raw = await readOrNull(REGISTRY_FILE);
  if (!raw) return [];
  const parsed = JSON.parse(raw) as { fronts?: Partial<FrontConfig>[] };
  const out: FrontConfig[] = [];
  for (const f of parsed.fronts ?? []) {
    if (typeof f.slug !== 'string' || !SLUG_RE.test(f.slug)) continue;
    out.push({
      slug: f.slug,
      name: typeof f.name === 'string' && f.name ? f.name : f.slug,
      description: typeof f.description === 'string' ? f.description : '',
      cwdHints: Array.isArray(f.cwdHints) ? f.cwdHints.filter(h => typeof h === 'string') : [],
      enabled: f.enabled !== false,
    });
  }
  return out;
}

/** The registry entry for a slug, or throws UnknownFrontError. Never builds a
 * path from an unvalidated slug. */
export async function requireFrontConfig(slug: string): Promise<FrontConfig> {
  const configs = await getFrontConfigs();
  const cfg = configs.find(f => f.slug === slug);
  if (!cfg) throw new UnknownFrontError(slug);
  return cfg;
}

export function frontDir(slug: string): string {
  if (!SLUG_RE.test(slug)) throw new UnknownFrontError(slug);
  return path.join(FRONTS_DIR, slug);
}

function northStarPath(slug: string): string {
  return path.join(frontDir(slug), 'north-star.md');
}

function nowPath(slug: string): string {
  return path.join(frontDir(slug), 'now.md');
}

/** Minimal frontmatter parser: `key: value` lines between the first two `---`
 * lines. Lists are `[a, b]` or comma-separated. Quotes are stripped. */
export function parseFrontmatter(text: string): {
  fields: Record<string, string>;
  body: string;
} {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { fields: {}, body: text };
  const fields: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (!kv) continue;
    fields[kv[1]] = kv[2].trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  return { fields, body: m[2] };
}

function listField(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map(s => s.trim().replace(/^(["'])(.*)\1$/, '$2'))
    .filter(Boolean);
}

export function parseMemoryEntry(file: string, text: string): FrontMemoryEntry {
  const { fields, body } = parseFrontmatter(text);
  const fronts = listField(fields.front ?? fields.fronts);
  const turns = fields.user_turns ? Number.parseInt(fields.user_turns, 10) : NaN;
  return {
    file,
    sessionId: fields.session_id || null,
    cwd: fields.cwd || null,
    startedAt: fields.started_at || null,
    endedAt: fields.ended_at || null,
    fronts: fronts.length ? fronts : ['unrouted'],
    userTurns: Number.isFinite(turns) ? turns : null,
    summary: body.trim(),
  };
}

/** Every memory entry, newest file name first (names start with the date). */
export async function getMemoryEntries(): Promise<FrontMemoryEntry[]> {
  let names: string[];
  try {
    names = await fs.readdir(MEMORY_DIR);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const files = names.filter(n => n.endsWith('.md')).sort().reverse();
  const entries: FrontMemoryEntry[] = [];
  for (const file of files) {
    const text = await readOrNull(path.join(MEMORY_DIR, file));
    if (text !== null) entries.push(parseMemoryEntry(file, text));
  }
  return entries;
}

export function memoryForFront(entries: FrontMemoryEntry[], slug: string): FrontMemoryEntry[] {
  return entries.filter(e => e.fronts.includes(slug));
}

function excerpt(text: string | null): string {
  if (!text) return '';
  // Skip the title line and the "Last session" heading; show the first prose.
  const lines = text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));
  const joined = lines.join(' ');
  return joined.length > EXCERPT_CHARS ? joined.slice(0, EXCERPT_CHARS - 1).trimEnd() + '…' : joined;
}

interface SuggestionCounts {
  openSuggestions: number;
  openQuestions: number;
}

/**
 * Registry merged with file state. `counts` is supplied by the caller (the
 * suggestions store lives in dashboard/data, see data.ts) so this module stays
 * about files.
 */
export async function getFronts(
  counts: (slug: string) => SuggestionCounts = () => ({ openSuggestions: 0, openQuestions: 0 }),
): Promise<FrontSummary[]> {
  const configs = await getFrontConfigs();
  const memory = await getMemoryEntries();
  const out: FrontSummary[] = [];
  for (const cfg of configs) {
    const [northStar, now, nowUpdatedAt, northStarUpdatedAt] = await Promise.all([
      readOrNull(northStarPath(cfg.slug)),
      readOrNull(nowPath(cfg.slug)),
      mtimeOrNull(nowPath(cfg.slug)),
      mtimeOrNull(northStarPath(cfg.slug)),
    ]);
    const sessions = memoryForFront(memory, cfg.slug);
    const last = sessions[0];
    out.push({
      ...cfg,
      nowExcerpt: excerpt(now),
      nowUpdatedAt,
      northStarUpdatedAt,
      northStarIsTodo: !northStar || northStar.includes(NORTH_STAR_TODO_MARKER),
      lastSessionAt: last ? last.endedAt ?? last.startedAt : null,
      ...counts(cfg.slug),
    });
  }
  return out;
}

export async function getFront(
  slug: string,
  counts?: (slug: string) => SuggestionCounts,
): Promise<FrontDetail> {
  await requireFrontConfig(slug);
  const summaries = await getFronts(counts);
  const summary = summaries.find(f => f.slug === slug);
  if (!summary) throw new UnknownFrontError(slug);
  const [northStar, now, memory] = await Promise.all([
    readOrNull(northStarPath(slug)),
    readOrNull(nowPath(slug)),
    getMemoryEntries(),
  ]);
  return {
    ...summary,
    northStar: northStar ?? '',
    now: now ?? '',
    recentSessions: memoryForFront(memory, slug).slice(0, RECENT_SESSIONS),
  };
}

async function writeText(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, text.endsWith('\n') ? text : text + '\n', 'utf8');
  await fs.rename(tmp, file);
}

/** Operator edit of north-star.md. The pipeline never calls this. */
export async function writeNorthStar(slug: string, text: string): Promise<void> {
  await requireFrontConfig(slug);
  await writeText(northStarPath(slug), text);
}

/** Returns the `## Answers from Daniel` section (heading included) or null. */
export function extractAnswersSection(text: string): string | null {
  const start = text.indexOf(ANSWERS_HEADING);
  if (start === -1) return null;
  const rest = text.slice(start + ANSWERS_HEADING.length);
  const next = rest.search(/\n## /);
  return (ANSWERS_HEADING + (next === -1 ? rest : rest.slice(0, next))).trimEnd();
}

/**
 * Writes now.md. When `text` lacks an Answers section but the file on disk
 * has one, the existing section is carried over (appended at the end), so an
 * agent rewrite can never drop the operator's answers.
 */
export async function writeNow(slug: string, text: string): Promise<void> {
  await requireFrontConfig(slug);
  let next = text;
  if (!text.includes(ANSWERS_HEADING)) {
    const existing = await readOrNull(nowPath(slug));
    const answers = existing ? extractAnswersSection(existing) : null;
    if (answers) next = text.trimEnd() + '\n\n' + answers + '\n';
  }
  await writeText(nowPath(slug), next);
}
