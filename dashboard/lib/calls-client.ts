/**
 * Server-only client for the followupdominator JSON API
 * (`~/claude/followupdominator/docs/api-v1.md`, specs/calls-dashboard.md
 * US-009). The /api/calls/* proxy routes call this; client components never
 * import it, because it reads CALLS_API_TOKEN.
 *
 * The token travels only as `Authorization: Bearer` (never `?token=`, which
 * uvicorn's access log would record) and never appears in a result: every
 * failure is mapped by `mapCallsError` to a fixed message.
 */
import { readProjectEnvVar } from './project-env';
import type {
  AgentDeleteOutcome,
  AgentDeleteRequest,
  AgentsResponse,
  AgentUpsertRequest,
  AgentRow,
  AttributeOutcome,
  AttributeRequest,
  CallsErrorBody,
  ContactsResponse,
  DevPingResponse,
  DialOutcome,
  DialRequest,
  NicknameSearchResponse,
  NoteOutcome,
  NoteRequest,
  OpsSummary,
  OutboxStatus,
  PingResponse,
  PropertiesResponse,
  PropertyNickname,
  RecentCallsResponse,
  RecordDetail,
  SearchResult,
  TasksResponse,
} from './calls-types';

export const DEFAULT_CALLS_API_URL = 'http://127.0.0.1:8100';
export const READ_TIMEOUT_MS = 8000;
export const WRITE_TIMEOUT_MS = 20000;

export const UNREACHABLE = 'call service unreachable';
export const NOT_CONFIGURED = 'call service is not configured for the API';
export const TOKEN_MISMATCH = 'call service token mismatch';
export const TOKEN_UNSET = 'CALLS_API_TOKEN is not set in the command center';

/** Base URL of the Python service, without a trailing slash. */
export function callsBaseUrl(): string {
  return (readProjectEnvVar('CALLS_API_URL') ?? DEFAULT_CALLS_API_URL).replace(/\/+$/, '');
}

/** The shared bearer token, or null when unset. Never log the value. */
export function callsToken(): string | null {
  return readProjectEnvVar('CALLS_API_TOKEN');
}

/** What an upstream HTTP answer looks like once its body is parsed (null when not JSON). */
export interface UpstreamReply {
  status: number;
  body: unknown;
}

export interface MappedError {
  status: number;
  body: CallsErrorBody;
}

export type CallsResult<T> =
  | { ok: true; status: number; data: T }
  | ({ ok: false } & MappedError);

/** Injection points for tests; production uses the globals and the env. */
export interface CallsDeps {
  fetch?: typeof fetch;
  baseUrl?: string;
  token?: string | null;
}

export type CallsQuery =
  | string
  | URLSearchParams
  | Record<string, string | number | null | undefined>;

const FORWARDED = new Set([400, 404, 409, 422, 502]);

function isUpstreamReply(x: unknown): x is UpstreamReply {
  return (
    typeof x === 'object' &&
    x !== null &&
    typeof (x as UpstreamReply).status === 'number' &&
    'body' in x
  );
}

function errorText(body: unknown): string | null {
  if (typeof body === 'object' && body !== null) {
    const e = (body as { error?: unknown }).error;
    if (typeof e === 'string' && e) return e;
  }
  return null;
}

/**
 * Maps a failed call to the status and body the proxy answers with.
 * Input is either something thrown by fetch (connection refused, timeout,
 * abort: all 502 unreachable) or an upstream non-2xx reply.
 *
 * - 503 `CALLS_API_TOKEN is not configured` -> 502 not configured
 * - 401 -> 500 token mismatch (never 401, which would read as an Access problem)
 * - 400, 404, 409, 422, 502 -> forwarded with their `{error, hint?}` body
 *   (422 is FastAPI's `{detail}`, normalized to an error string)
 * - any other 503 (a service not wired) -> forwarded as 503
 * - anything else -> 502 naming the upstream status
 */
export function mapCallsError(input: unknown): MappedError {
  if (!isUpstreamReply(input)) {
    return { status: 502, body: { error: UNREACHABLE } };
  }
  const { status, body } = input;
  const text = errorText(body);
  if (status === 401) return { status: 500, body: { error: TOKEN_MISMATCH } };
  if (status === 503) {
    if (!text || text.includes('CALLS_API_TOKEN')) {
      return { status: 502, body: { error: NOT_CONFIGURED } };
    }
    return { status: 503, body: { error: text } };
  }
  if (FORWARDED.has(status)) {
    const out: CallsErrorBody = {
      error: text ?? (status === 422 ? 'invalid request parameter' : `call service answered ${status}`),
    };
    const hint = (body as { hint?: unknown } | null)?.hint;
    if (typeof hint === 'string' && hint) out.hint = hint;
    return { status, body: out };
  }
  return { status: 502, body: { error: `call service error (HTTP ${status})` } };
}

function queryString(query?: CallsQuery): string {
  if (query === undefined) return '';
  if (typeof query === 'string') {
    const q = query.replace(/^\?/, '');
    return q ? `?${q}` : '';
  }
  const params =
    query instanceof URLSearchParams
      ? query
      : new URLSearchParams(
          Object.entries(query)
            .filter(([, v]) => v !== undefined && v !== null)
            .map(([k, v]) => [k, String(v)]),
        );
  const q = params.toString();
  return q ? `?${q}` : '';
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  query?: CallsQuery;
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * One call to the API. Never throws: every failure, including a missing
 * token on this side and a non-JSON success body, becomes `{ok: false}`.
 */
export async function callsRequest<T>(
  path: string,
  opts: RequestOptions = {},
  deps: CallsDeps = {},
): Promise<CallsResult<T>> {
  const token = deps.token !== undefined ? deps.token : callsToken();
  if (!token) return { ok: false, status: 500, body: { error: TOKEN_UNSET } };
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };
  let body: string | undefined;
  if (method === 'POST') {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body ?? {});
  }
  const url = `${deps.baseUrl ?? callsBaseUrl()}${path}${queryString(opts.query)}`;
  const doFetch = deps.fetch ?? fetch;
  let res: Response;
  let parsed: unknown = null;
  let jsonOk = false;
  try {
    res = await doFetch(url, {
      method,
      headers,
      body,
      cache: 'no-store',
      signal:
        opts.signal ?? AbortSignal.timeout(method === 'POST' ? WRITE_TIMEOUT_MS : READ_TIMEOUT_MS),
    });
    const text = await res.text();
    try {
      parsed = JSON.parse(text);
      jsonOk = true;
    } catch {
      parsed = null;
    }
  } catch (err) {
    return { ok: false, ...mapCallsError(err) };
  }
  if (res.ok) {
    if (!jsonOk) {
      return { ok: false, status: 502, body: { error: 'call service returned invalid JSON' } };
    }
    return { ok: true, status: res.status, data: parsed as T };
  }
  return { ok: false, ...mapCallsError({ status: res.status, body: parsed }) };
}

const seg = (v: string | number) => encodeURIComponent(String(v));

/** One function per `/api/v1/*` endpoint (docs/api-v1.md endpoint index). */
export const callsApi = {
  ping: (deps?: CallsDeps) => callsRequest<PingResponse>('/api/v1/ping', {}, deps),
  recent: (query?: CallsQuery, deps?: CallsDeps) =>
    callsRequest<RecentCallsResponse>('/api/v1/calls/recent', { query }, deps),
  devPing: (deps?: CallsDeps) =>
    callsRequest<DevPingResponse>('/api/v1/dev/ping', { method: 'POST' }, deps),
  contacts: (query?: CallsQuery, deps?: CallsDeps) =>
    callsRequest<ContactsResponse>('/api/v1/contacts', { query }, deps),
  properties: (query?: CallsQuery, deps?: CallsDeps) =>
    callsRequest<PropertiesResponse>('/api/v1/properties', { query }, deps),
  record: (table: string, id: string | number, deps?: CallsDeps) =>
    callsRequest<RecordDetail>(`/api/v1/record/${seg(table)}/${seg(id)}`, {}, deps),
  search: (query?: CallsQuery, deps?: CallsDeps) =>
    callsRequest<SearchResult>('/api/v1/search', { query }, deps),
  nicknameSearch: (query?: CallsQuery, deps?: CallsDeps) =>
    callsRequest<NicknameSearchResponse>('/api/v1/nicknames/search', { query }, deps),
  propertyNickname: (propertyId: string | number, deps?: CallsDeps) =>
    callsRequest<PropertyNickname>(`/api/v1/nicknames/property/${seg(propertyId)}`, {}, deps),
  tasks: (deps?: CallsDeps) => callsRequest<TasksResponse>('/api/v1/tasks', {}, deps),
  ops: (deps?: CallsDeps) => callsRequest<OpsSummary>('/api/v1/ops', {}, deps),
  agents: (deps?: CallsDeps) => callsRequest<AgentsResponse>('/api/v1/agents', {}, deps),
  note: (body: NoteRequest | unknown, deps?: CallsDeps) =>
    callsRequest<NoteOutcome>('/api/v1/notes', { method: 'POST', body }, deps),
  outbox: (id: string | number, deps?: CallsDeps) =>
    callsRequest<OutboxStatus>(`/api/v1/outbox/${seg(id)}`, {}, deps),
  attribute: (body: AttributeRequest | unknown, deps?: CallsDeps) =>
    callsRequest<AttributeOutcome>('/api/v1/attribute', { method: 'POST', body }, deps),
  dial: (body: DialRequest | unknown, deps?: CallsDeps) =>
    callsRequest<DialOutcome>('/api/v1/dial', { method: 'POST', body }, deps),
  upsertAgent: (body: AgentUpsertRequest | unknown, deps?: CallsDeps) =>
    callsRequest<AgentRow>('/api/v1/agents', { method: 'POST', body }, deps),
  deleteAgent: (body: AgentDeleteRequest | unknown, deps?: CallsDeps) =>
    callsRequest<AgentDeleteOutcome>('/api/v1/agents/delete', { method: 'POST', body }, deps),
  /**
   * Opens the SSE stream and hands back the raw upstream Response on success
   * (the US-011 relay forwards its bytes). No timeout: the caller's signal
   * ends the stream.
   */
  async events(
    signal: AbortSignal,
    deps: CallsDeps = {},
  ): Promise<{ ok: true; response: Response } | ({ ok: false } & MappedError)> {
    const token = deps.token !== undefined ? deps.token : callsToken();
    if (!token) return { ok: false, status: 500, body: { error: TOKEN_UNSET } };
    const doFetch = deps.fetch ?? fetch;
    let res: Response;
    try {
      res = await doFetch(`${deps.baseUrl ?? callsBaseUrl()}/api/v1/events`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
        cache: 'no-store',
        signal,
      });
    } catch (err) {
      return { ok: false, ...mapCallsError(err) };
    }
    if (res.ok && res.body) return { ok: true, response: res };
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    return { ok: false, ...mapCallsError({ status: res.status, body: parsed }) };
  },
};
