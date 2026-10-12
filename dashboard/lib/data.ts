import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  AgentPlatformSession,
  AgentStatus,
  CronConfig,
  FrontSuggestion,
  FrontSuggestionStatus,
  Task,
  Todo,
  WorkerState,
} from './types';
import { generateSuggestionId, generateTaskId, nowIso } from './utils';

const DATA_DIR = path.join(process.cwd(), 'data');
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');
const CRON_FILE = path.join(DATA_DIR, 'cron-config.json');
const WORKER_STATE_FILE = path.join(DATA_DIR, 'worker-state.json');
const TODOS_FILE = path.join(DATA_DIR, 'todos.json');
const AGENT_STATUS_FILE = path.join(DATA_DIR, 'agent-status.json');
const FRONT_SUGGESTIONS_FILE = path.join(DATA_DIR, 'front-suggestions.json');

let writeChain: Promise<unknown> = Promise.resolve();

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeChain.then(fn, fn);
  writeChain = next.catch(() => undefined);
  return next;
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return fallback;
    }
    throw err;
  }
}

async function writeJson(file: string, data: unknown): Promise<void> {
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  await fs.rename(tmp, file);
}

function withDefaults(input: Partial<Task>): Task {
  const now = nowIso();
  return {
    id: input.id ?? generateTaskId(),
    title: input.title ?? 'Untitled task',
    description: input.description ?? '',
    type: input.type ?? 'Admin',
    tags: input.tags ?? [],
    status: input.status ?? 'pending',
    priority: input.priority ?? 3,
    model: input.model ?? 'sonnet',
    acceptanceCriteria: input.acceptanceCriteria ?? [],
    slashCommand: input.slashCommand ?? null,
    claudeNotes: input.claudeNotes ?? '',
    completionFile: input.completionFile ?? null,
    workspacePath: input.workspacePath ?? null,
    parentTaskId: input.parentTaskId ?? null,
    claudeSessionId: input.claudeSessionId ?? null,
    captainNotes: input.captainNotes ?? null,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
    startedAt: input.startedAt ?? null,
    completedAt: input.completedAt ?? null,
    estimatedMinutes: input.estimatedMinutes ?? null,
    metadata: input.metadata ?? null,
  };
}

function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

export async function getTasks(): Promise<Task[]> {
  const tasks = await readJson<Task[]>(TASKS_FILE, []);
  return sortTasks(tasks);
}

export async function getTask(id: string): Promise<Task | null> {
  const tasks = await readJson<Task[]>(TASKS_FILE, []);
  return tasks.find(t => t.id === id) ?? null;
}

export async function createTask(input: Partial<Task>): Promise<Task> {
  return serialize(async () => {
    const tasks = await readJson<Task[]>(TASKS_FILE, []);
    const task = withDefaults(input);
    tasks.push(task);
    await writeJson(TASKS_FILE, tasks);
    return task;
  });
}

export async function updateTask(
  id: string,
  updates: Partial<Task>,
): Promise<Task | null> {
  return serialize(async () => {
    const tasks = await readJson<Task[]>(TASKS_FILE, []);
    const idx = tasks.findIndex(t => t.id === id);
    if (idx === -1) return null;
    const existing = tasks[idx];
    const { id: _ignoreId, createdAt: _ignoreCreatedAt, ...safe } = updates;
    void _ignoreId;
    void _ignoreCreatedAt;
    const merged: Task = {
      ...existing,
      ...safe,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: nowIso(),
    };
    tasks[idx] = merged;
    await writeJson(TASKS_FILE, tasks);
    return merged;
  });
}

export type TaskMutationResult =
  | { outcome: 'updated'; task: Task }
  | { outcome: 'rejected' }
  | { outcome: 'not_found' };

/**
 * Atomic read-modify-write of one task under the write mutex, for endpoints
 * whose precondition check and write must be a single step (e.g. publish /
 * claim flipping one postings[] entry). `mutate` returns the updated task,
 * or null to reject without writing.
 */
export async function mutateTask(
  id: string,
  mutate: (task: Task) => Task | null,
): Promise<TaskMutationResult> {
  return serialize(async () => {
    const tasks = await readJson<Task[]>(TASKS_FILE, []);
    const idx = tasks.findIndex(t => t.id === id);
    if (idx === -1) return { outcome: 'not_found' as const };
    const existing = tasks[idx];
    const mutated = mutate(existing);
    if (!mutated) return { outcome: 'rejected' as const };
    const merged: Task = {
      ...mutated,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: nowIso(),
    };
    tasks[idx] = merged;
    await writeJson(TASKS_FILE, tasks);
    return { outcome: 'updated' as const, task: merged };
  });
}

export async function deleteTask(id: string): Promise<boolean> {
  return serialize(async () => {
    const tasks = await readJson<Task[]>(TASKS_FILE, []);
    const next = tasks.filter(t => t.id !== id);
    if (next.length === tasks.length) return false;
    await writeJson(TASKS_FILE, next);
    return true;
  });
}

export async function getCronConfig(): Promise<CronConfig> {
  const cfg = await readJson<CronConfig>(CRON_FILE, {
    enabled: false,
    intervalMinutes: 10,
  });
  return { enabled: cfg.enabled, intervalMinutes: cfg.intervalMinutes };
}

export async function saveCronConfig(config: CronConfig): Promise<void> {
  return serialize(async () => {
    await writeJson(CRON_FILE, config);
  });
}

export async function getWorkerState(): Promise<WorkerState> {
  return readJson<WorkerState>(WORKER_STATE_FILE, {
    lastRun: null,
    lastTaskId: null,
  });
}

export async function saveWorkerState(state: WorkerState): Promise<void> {
  return serialize(async () => {
    await writeJson(WORKER_STATE_FILE, state);
  });
}

export async function getAgentStatus(): Promise<AgentStatus> {
  // Files written before session reporting existed lack `platforms`.
  const raw = await readJson<Partial<AgentStatus>>(AGENT_STATUS_FILE, {});
  return { lastSeenAt: raw.lastSeenAt ?? null, platforms: raw.platforms ?? [] };
}

/** Stamps the poster agent's last poll time (backs the online/offline UI). */
export async function recordAgentSeen(): Promise<void> {
  return serialize(async () => {
    const raw = await readJson<Partial<AgentStatus>>(AGENT_STATUS_FILE, {});
    await writeJson(AGENT_STATUS_FILE, {
      lastSeenAt: nowIso(),
      platforms: raw.platforms ?? [],
    });
  });
}

/**
 * Stores the agent's per-platform session report (POST /api/agent-status).
 * The report itself is proof of life, so lastSeenAt is stamped too.
 */
export async function saveAgentPlatformReport(
  platforms: AgentPlatformSession[],
): Promise<void> {
  return serialize(async () => {
    await writeJson(AGENT_STATUS_FILE, { lastSeenAt: nowIso(), platforms });
  });
}

export async function getTodos(): Promise<Todo[]> {
  const todos = await readJson<Todo[]>(TODOS_FILE, []);
  return [...todos].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt),
  );
}

// --- Front suggestions (specs/fronts.md US-002) ------------------------------

export interface FrontSuggestionInput {
  frontSlug: string;
  kind: FrontSuggestion['kind'];
  title: string;
  body: string;
  type?: string;
  model?: FrontSuggestion['model'];
  slashCommand?: string | null;
  sourceSessionId?: string | null;
  sourceMemoryFile?: string | null;
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Newest first. */
export async function getFrontSuggestions(filter?: {
  frontSlug?: string;
  status?: FrontSuggestionStatus;
}): Promise<FrontSuggestion[]> {
  const all = await readJson<FrontSuggestion[]>(FRONT_SUGGESTIONS_FILE, []);
  return all
    .filter(s => !filter?.frontSlug || s.frontSlug === filter.frontSlug)
    .filter(s => !filter?.status || s.status === filter.status)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getFrontSuggestion(id: string): Promise<FrontSuggestion | null> {
  const all = await readJson<FrontSuggestion[]>(FRONT_SUGGESTIONS_FILE, []);
  return all.find(s => s.id === id) ?? null;
}

/**
 * Appends a batch. Only the fields of FrontSuggestionInput are kept (the
 * pipeline POSTs whatever the model returned). An input whose normalized
 * title matches an open suggestion for the same front is skipped, so a
 * re-run never doubles the review bin. Returns the records actually added.
 */
export async function createFrontSuggestions(
  inputs: FrontSuggestionInput[],
): Promise<FrontSuggestion[]> {
  return serialize(async () => {
    const all = await readJson<FrontSuggestion[]>(FRONT_SUGGESTIONS_FILE, []);
    const openKeys = new Set(
      all.filter(s => s.status === 'open').map(s => `${s.frontSlug}|${normalizeTitle(s.title)}`),
    );
    const added: FrontSuggestion[] = [];
    for (const input of inputs) {
      const key = `${input.frontSlug}|${normalizeTitle(input.title)}`;
      if (openKeys.has(key)) continue;
      openKeys.add(key);
      const record: FrontSuggestion = {
        id: generateSuggestionId(),
        frontSlug: input.frontSlug,
        kind: input.kind,
        title: input.title,
        body: input.body,
        type: input.type,
        model: input.model,
        slashCommand: input.slashCommand ?? null,
        sourceSessionId: input.sourceSessionId ?? null,
        sourceMemoryFile: input.sourceMemoryFile ?? null,
        status: 'open',
        createdAt: nowIso(),
      };
      all.push(record);
      added.push(record);
    }
    if (added.length) await writeJson(FRONT_SUGGESTIONS_FILE, all);
    return added;
  });
}

export type FrontSuggestionResolution =
  | { status: 'dismissed' }
  | { status: 'answered'; answer: string }
  | { status: 'approved'; operatorNotes?: string; taskId: string };

/** Resolves an open suggestion. Returns null when unknown; 'not_open' when
 * it was already resolved (the caller turns that into a 409). */
export async function resolveFrontSuggestion(
  id: string,
  resolution: FrontSuggestionResolution,
): Promise<FrontSuggestion | null | 'not_open'> {
  return serialize(async () => {
    const all = await readJson<FrontSuggestion[]>(FRONT_SUGGESTIONS_FILE, []);
    const idx = all.findIndex(s => s.id === id);
    if (idx === -1) return null;
    if (all[idx].status !== 'open') return 'not_open';
    const merged: FrontSuggestion = { ...all[idx], ...resolution, resolvedAt: nowIso() };
    all[idx] = merged;
    await writeJson(FRONT_SUGGESTIONS_FILE, all);
    return merged;
  });
}

export async function countOpenFrontSuggestions(): Promise<
  Record<string, { openSuggestions: number; openQuestions: number }>
> {
  const open = await getFrontSuggestions({ status: 'open' });
  const counts: Record<string, { openSuggestions: number; openQuestions: number }> = {};
  for (const s of open) {
    const c = (counts[s.frontSlug] ??= { openSuggestions: 0, openQuestions: 0 });
    if (s.kind === 'question') c.openQuestions += 1;
    else c.openSuggestions += 1;
  }
  return counts;
}
