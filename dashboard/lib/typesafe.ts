/**
 * Minimal TypeSafe System One client (https://docs.typesafe.ai/api).
 *
 * System One models return typed judgments rather than prose: a Choice picks
 * one option from a fixed set and reports how peaked the distribution is, a
 * Noul reports the probability a statement is true. We use them where code
 * needs semantic understanding that string matching cannot supply, and keep
 * every exact lookup, rule and calculation in code.
 *
 * Deliberately plain fetch rather than @typesafe-ai/sdk: one POST, no new
 * dependency, and the same source works in the dashboard and in a worker.
 *
 * TYPESAFE_API_KEY lives in the project-root .env.local alongside AGENT_TOKEN.
 * It is server-side only. It is never logged, never returned in a response,
 * and never reaches a client component. Callers must treat this module as
 * optional: isConfigured() is false on a machine with no key, and every
 * caller in this repo has a deterministic fallback.
 */
import { readProjectEnvVar } from './project-env';

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const MODEL = 'jev-latest';
const DEFAULT_TIMEOUT_MS = 8000;

export interface ChoiceQuestion {
  type: 'choice';
  instructions: string;
  /** option id -> what picking that option means. Include a no-match option. */
  criteria: Record<string, string>;
}

export interface NoulQuestion {
  type: 'noul';
  instructions: string;
  criteria?: { true: string; false: string };
}

export type Question = ChoiceQuestion | NoulQuestion;

export interface ChoiceAnswer {
  type: 'choice';
  choice: string;
  probabilities: Record<string, number>;
  /** How peaked the distribution is. Not a promise that the pick is right. */
  confidence: number;
}

export interface NoulAnswer {
  type: 'noul';
  /** Probability of yes. Near 0.5 means yes and no are similarly likely. */
  noul: number;
}

export type Answer = ChoiceAnswer | NoulAnswer;

export interface SystemOneResult {
  answers: Record<string, Answer>;
}

/** State is whatever the questions need: prose, or named JSON fields. */
export type State = string | Record<string, unknown> | unknown[];

export function isConfigured(): boolean {
  return readProjectEnvVar('TYPESAFE_API_KEY') !== null;
}

export class TypeSafeUnavailableError extends Error {}

/**
 * Asks one batch of independent questions over one state. Questions in a
 * batch run in parallel and cannot see each other's answers, so anything
 * that depends on an earlier answer needs a second call.
 *
 * Throws TypeSafeUnavailableError when there is no key, the request times
 * out, or the service answers with an error. Callers fall back; they do not
 * propagate the failure to the operator.
 */
export async function systemOne(
  state: State,
  questions: Record<string, Question>,
  opts: { timeoutMs?: number } = {},
): Promise<SystemOneResult> {
  const key = readProjectEnvVar('TYPESAFE_API_KEY');
  if (!key) {
    throw new TypeSafeUnavailableError(
      'TYPESAFE_API_KEY is not set in the project-root .env.local',
    );
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ state, model: MODEL, questions }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      // The body can echo request content. Keep the status only, so nothing
      // from a listing or a task ends up in a log line.
      throw new TypeSafeUnavailableError(`TypeSafe returned HTTP ${res.status}`);
    }
    const body = (await res.json()) as SystemOneResult;
    if (!body?.answers) {
      throw new TypeSafeUnavailableError('TypeSafe response had no answers');
    }
    return body;
  } catch (err) {
    if (err instanceof TypeSafeUnavailableError) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    throw new TypeSafeUnavailableError(`TypeSafe request failed: ${reason}`);
  } finally {
    clearTimeout(timer);
  }
}

/** The shape tests and callers inject to avoid hitting the network. */
export type SystemOneFn = typeof systemOne;

export function asChoice(answer: Answer | undefined): ChoiceAnswer | null {
  return answer && answer.type === 'choice' ? answer : null;
}

export function asNoul(answer: Answer | undefined): NoulAnswer | null {
  return answer && answer.type === 'noul' ? answer : null;
}
