/**
 * Response and request shapes of the followupdominator JSON API
 * (`~/claude/followupdominator/docs/api-v1.md`), the TypeScript twin of that
 * doc. Change both when a shape changes. See specs/calls-dashboard.md.
 *
 * Timestamps are epoch seconds as floats; phone numbers are E.164 (or
 * `raw:<digits>` when unparseable).
 */

/** Every error the API (and the command-center proxy) answers with. */
export interface CallsErrorBody {
  error: string;
  hint?: string;
}

export interface PingResponse {
  ok: true;
}

// ---- Live calls ----

/** The decoded Dialpad webhook event, verbatim; only these fields are relied on. */
export interface DialpadEventPayload {
  call_id?: number | string;
  state?: string;
  direction?: string;
  external_number?: string;
  internal_number?: string;
  event_timestamp?: number;
  [key: string]: unknown;
}

export interface RecentCall {
  event_id: number;
  received_at: number;
  call_id: string | null;
  state: string | null;
  processed: boolean;
  payload: DialpadEventPayload;
}

export interface RecentCallsResponse {
  events: RecentCall[];
}

export type RecordTable = 'contact' | 'property';

export interface PopCandidate {
  record_table: RecordTable;
  record_id: number;
  display_name: string;
  address: string;
}

interface PopBase {
  seq: number;
  call_id: string;
  number: string | null;
  /** Opaque display text (real summaries contain an em dash). */
  summary: string;
}

export interface MatchedPop extends PopBase {
  kind: 'matched' | 'outbound-matched';
  contact_id?: number;
  property_id?: number;
  stale: boolean;
}

export interface AmbiguousPop extends PopBase {
  kind: 'ambiguous' | 'outbound-ambiguous';
  candidates: PopCandidate[];
}

export interface MissPop extends PopBase {
  kind: 'miss' | 'outbound-miss';
}

export interface OutboundPop extends PopBase {
  kind: 'outbound';
  property_id: number;
}

/** Not a call: a "stream ok" tick from `POST /api/v1/dev/ping`. */
export interface PingPop {
  seq: number;
  kind: 'ping';
  sent_at: number;
}

/** One SSE `data:` payload from `/api/v1/events`, discriminated by `kind`. */
export type PopEvent = MatchedPop | AmbiguousPop | MissPop | OutboundPop | PingPop;

export type PopKind = PopEvent['kind'];

export interface DevPingResponse {
  ok: true;
  seq: number;
}

// ---- Records ----

/** ID record fields as ID returns them (string values, ID's own names). */
export type IdRecordFields = Record<string, string>;

export interface ContactsResponse {
  rows: IdRecordFields[];
  next_start: number | null;
}

export interface PropertiesResponse {
  rows: IdRecordFields[];
  next_start: number | null;
  status: string;
}

export interface TaskRef {
  task_id: number;
  title: string;
  status: string;
  task_type: string;
  start_ts: number | null;
  end_ts: number | null;
}

export interface RecordDetail {
  table: RecordTable;
  id: number;
  record: IdRecordFields;
  nickname: string | null;
  history: TaskRef[];
}

export interface SearchRecordRow {
  record_table: RecordTable;
  record_id: number;
  display_name: string;
  address: string;
  apn: string;
  status: string;
}

export interface NicknameMatch {
  nickname: string;
  slug: string;
  property_id: number | null;
  /** 0 to 1, 1 is exact. */
  score: number;
}

export interface SearchResult {
  records: SearchRecordRow[];
  nicknames: NicknameMatch[];
}

export interface NicknameSearchResponse {
  matches: NicknameMatch[];
}

export interface PropertyNickname {
  nickname: string;
  slug: string;
  property_id: number;
}

// ---- Tasks, ops, agents ----

export interface OpenTask extends TaskRef {
  overdue: boolean;
}

export interface TasksResponse {
  tasks: OpenTask[];
  now: number;
}

export type BadgeLevel = 'ok' | 'warn' | 'alarm';

export interface OpsBadge {
  /** Stable key: `dead letters`, `outbox queue`, `event backlog`, `last sync`, `health: <key>`, `sync error`, `sync warning`. */
  label: string;
  text: string;
  level: BadgeLevel;
}

export interface DeadLetterRow {
  id: number;
  event_key: string;
  kind: string;
  attempts: number;
  last_error: string | null;
  finished_at: number | null;
}

export interface OpsSummary {
  dead_letter: number;
  outbox_pending: number;
  raw_backlog: number;
  health_flags: Record<string, unknown>;
  sync_age_seconds: number | null;
  sync_error: string;
  sync_warning: string;
  badges: OpsBadge[];
  dead_letters: DeadLetterRow[];
}

export interface AgentRow {
  dialpad_user_id: string;
  name: string;
  id_user_id: string;
  sms_number: string;
  is_default: boolean;
}

export interface DialpadUser {
  id: number | string;
  name: string;
  number: string;
}

export interface AgentsResponse {
  agents: AgentRow[];
  default_key: string;
  dialpad_users: DialpadUser[] | null;
  dialpad_error: string | null;
}

// ---- Writes ----

export type NoteStatus = 'Not Started' | 'Working' | 'Completed';

export interface NoteRequest {
  note: string;
  client_uuid?: string;
  call_id?: string;
  status?: NoteStatus;
  /** ISO `YYYY-MM-DD`. */
  follow_up?: string;
  caller?: string;
  contact_id?: number | string | null;
  property_id?: number | string | null;
}

export type FallbackClose = 'queued' | 'not_delivered_yet' | 'unreadable';

export interface NoteOutcome {
  enqueued: boolean;
  event_key: string;
  /** On a repeated client_uuid this is the ORIGINAL row's id. */
  outbox_id: number;
  call_id: string;
  client_uuid: string;
  first_manual_note: boolean;
  fallback_already_fired: boolean;
  fallback_close: FallbackClose | null;
}

export type OutboxState = 'pending' | 'done' | 'dead_letter';

export interface OutboxStatus {
  id: number;
  event_key: string;
  kind: string;
  status: OutboxState;
  attempts: number;
  last_error: string | null;
  task_id: number | null;
}

export interface AttributeRequest {
  number: string;
  caller_fname: string;
  caller_lname?: string;
  slug?: string;
  call_id?: string;
}

export interface AttributeOutcome {
  contact_id: number;
  property_id: number | null;
  slug: string | null;
  indexed_number: string;
  unresolved_slug: boolean;
}

export interface DialRequest {
  phone: string;
  property_id: number | string;
}

export interface DialOutcome {
  intent_id: number;
  phone: string;
  property_id: number;
  nickname: string | null;
  window_minutes: number;
}

export interface AgentUpsertRequest {
  dialpad_user_id: string;
  name?: string;
  id_user_id?: string;
  sms_number?: string;
}

export interface AgentDeleteRequest {
  dialpad_user_id: string;
}

export interface AgentDeleteOutcome {
  removed: boolean;
}
