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
