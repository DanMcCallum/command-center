import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { CronConfig, Task, Todo, WorkerState } from './types';
import { generateTaskId, nowIso } from './utils';

const DATA_DIR = path.join(process.cwd(), 'data');
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');
const CRON_FILE = path.join(DATA_DIR, 'cron-config.json');
const WORKER_STATE_FILE = path.join(DATA_DIR, 'worker-state.json');
const TODOS_FILE = path.join(DATA_DIR, 'todos.json');

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

export async function getTodos(): Promise<Todo[]> {
  const todos = await readJson<Todo[]>(TODOS_FILE, []);
  return [...todos].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt),
  );
}
