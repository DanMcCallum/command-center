export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'needs_review';
export type TaskPriority = 1 | 2 | 3 | 4 | 5;
export type ClaudeModel = 'sonnet' | 'opus' | 'haiku';

export type TaskType =
  | 'Research'
  | 'Content'
  | 'Coaching'
  | 'Building'
  | 'Outreach'
  | 'Admin';

export const TASK_TYPES: TaskType[] = [
  'Research',
  'Content',
  'Coaching',
  'Building',
  'Outreach',
  'Admin',
];

export type PostingStatus = 'queued' | 'posting' | 'awaiting_auth' | 'posted' | 'failed';

export interface AdPosting {
  platform: string;
  status: PostingStatus;
  attempts: number;
  queuedAt: string;
  postedAt?: string;
  lastError?: string;
  listingUrl?: string;
  screenshotPath?: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  type: string;
  tags: string[];
  status: TaskStatus;
  priority: TaskPriority;
  model: ClaudeModel;
  acceptanceCriteria: string[];
  slashCommand: string | null;
  claudeNotes: string;
  completionFile: string | null;
  workspacePath: string | null;
  parentTaskId: string | null;
  claudeSessionId: string | null;
  captainNotes: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  estimatedMinutes: number | null;
  metadata: Record<string, unknown> | null;
  postings?: AdPosting[];
}

export interface CronConfig {
  enabled: boolean;
  intervalMinutes: number;
}

export interface WorkerState {
  lastRun: string | null;
  lastTaskId: string | null;
}

/** One platform's session state as reported by the local poster agent
 * (names, mtimes, expiry timestamps only — never cookie values). */
export interface AgentPlatformSession {
  platform: string;
  hasSession: boolean;
  /** mtime of the agent's local auth/<platform>.json; null when no session. */
  capturedAt: string | null;
  /** Earliest positive cookie expiry in the saved session, when known. */
  earliestCookieExpiry?: string;
}

export interface AgentStatus {
  lastSeenAt: string | null;
  /** Per-platform session reports from the agent's last POST /api/agent-status. */
  platforms: AgentPlatformSession[];
}

export const SUPPORTED_INTERVALS = [5, 10, 15, 30, 60, 120, 240] as const;

export interface Todo {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  convertedToTaskId?: string;
}

// --- Fronts (specs/fronts.md) -----------------------------------------------

/** One entry of config/fronts.json. */
export interface FrontConfig {
  slug: string;
  name: string;
  /** Written for the router: "this session belongs here when ...". */
  description: string;
  /** Repo paths (may start with ~) that bias routing toward this front. */
  cwdHints: string[];
  enabled: boolean;
}

/** One session summary under fronts/memory/, parsed from its frontmatter. */
export interface FrontMemoryEntry {
  /** File name only, e.g. 2026-10-12-0930-016d446a.md */
  file: string;
  sessionId: string | null;
  cwd: string | null;
  startedAt: string | null;
  endedAt: string | null;
  /** Front slugs the session was routed to; ['unrouted'] when none. */
  fronts: string[];
  userTurns: number | null;
  /** Markdown body after the frontmatter. */
  summary: string;
}

export type FrontSuggestionKind = 'task' | 'question';
export type FrontSuggestionStatus = 'open' | 'approved' | 'dismissed' | 'answered';

/** A what's-next proposal or question waiting for the operator. */
export interface FrontSuggestion {
  id: string;
  frontSlug: string;
  kind: FrontSuggestionKind;
  title: string;
  /** For a task: the ready-to-run prompt. For a question: why it matters. */
  body: string;
  /** Hints for the task created on approval. */
  type?: string;
  model?: ClaudeModel;
  slashCommand?: string | null;
  sourceSessionId: string | null;
  sourceMemoryFile: string | null;
  status: FrontSuggestionStatus;
  operatorNotes?: string;
  answer?: string;
  taskId?: string;
  createdAt: string;
  resolvedAt?: string;
}

/** GET /api/fronts list item. */
export interface FrontSummary extends FrontConfig {
  nowExcerpt: string;
  nowUpdatedAt: string | null;
  northStarUpdatedAt: string | null;
  /** True while north-star.md still carries the seed's TODO marker. */
  northStarIsTodo: boolean;
  lastSessionAt: string | null;
  openSuggestions: number;
  openQuestions: number;
}

/** GET /api/fronts/<slug>. */
export interface FrontDetail extends FrontSummary {
  northStar: string;
  now: string;
  recentSessions: FrontMemoryEntry[];
}
