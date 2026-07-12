/**
 * Login-success detection + storageState export, shared by the live-view
 * capture server (specs/live-view-browser.md, US-004) and the local poster
 * agent (specs/local-publish-2-local-agent.md, US-003/US-004).
 *
 * detectLogin() is the full evaluation: a pure function over a platform's
 * login_success signal (config/posting-platforms.json), a snapshot of the
 * session's cookies + URL + page title, and a redirect tracker. It returns a
 * three-way result — 'blocked' (Akamai Access Denied page, a hard failure
 * that can never read as success), 'logged_in', or 'not_logged_in' — and
 * only honors redirect_off after the session has actually been observed on
 * the login page (the land-com spike's false-positive fix). isLoggedIn() is
 * the underlying per-snapshot signal predicate. Both are unit-testable with
 * no browser. checkSession() applies detectLogin to a live capture session
 * (capture/session.ts); on success it persists the session with the same
 * context.storageState() + chmod 600 ritual as capture-login.ts, then tears
 * down the session and the streaming bridge (capture/stream.ts).
 *
 * Cookie values and storageState contents are never logged and never appear
 * in error messages — only the auth file *path* may be referenced.
 *
 * session.ts and stream.ts are imported lazily inside checkSession() so this
 * module (and its unit test, and the agent) loads without resolving
 * playwright or the capture server/stream — the compiled test build runs
 * from /tmp, outside node_modules' reach.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { LoginSuccessSignal } from '../post-common'

/** What detection needs to know about the live session — names only, no values. */
export interface SessionSnapshot {
  cookies: Array<{ name: string }>
  url: string
  /** document.title — enables the Akamai Access Denied hard-failure check. */
  title?: string
}

export type LoginDetection = 'logged_in' | 'not_logged_in' | 'blocked'

/**
 * Caller-owned redirect_off state: set once the session has actually been
 * observed on the login page. The agent keeps one per probe; checkSession
 * keeps one per live capture session.
 */
export interface RedirectTracker {
  sawLoginPage: boolean
}

/** The Akamai edge denial page's exact title (land-com spike, 2026-07-11). */
const ACCESS_DENIED_TITLE = /^access denied$/i

function pathnameOf(url: string): string | null {
  try {
    return new URL(url).pathname
  } catch {
    return null // about:blank / unparseable — not on the site yet
  }
}

/**
 * Full login evaluation. An Access Denied page is 'blocked' before anything
 * else is considered — it never earns sawLoginPage and can never read as
 * logged-in, even when the denial flow bounces off the login path (the
 * failure that burned us in the land-com spike). redirect_off is only
 * honored after tracker.sawLoginPage — a session that was never seen on the
 * login page cannot succeed by merely being elsewhere. Signals defined
 * together (cookie AND redirect_off) must all hold.
 */
export function detectLogin(
  signal: LoginSuccessSignal | undefined,
  snapshot: SessionSnapshot,
  tracker: RedirectTracker
): LoginDetection {
  if (snapshot.title !== undefined && ACCESS_DENIED_TITLE.test(snapshot.title.trim())) {
    return 'blocked'
  }
  if (signal?.redirect_off !== undefined) {
    const pathname = pathnameOf(snapshot.url)
    if (pathname !== null && pathname.includes(signal.redirect_off)) {
      tracker.sawLoginPage = true
    }
    if (!tracker.sawLoginPage) return 'not_logged_in'
  }
  return isLoggedIn(signal, snapshot) ? 'logged_in' : 'not_logged_in'
}

/**
 * True when every signal defined in login_success holds: the named cookie is
 * present, and/or the page URL's path no longer contains redirect_off. A
 * missing or empty signal never reports logged-in (fail closed).
 */
export function isLoggedIn(
  signal: LoginSuccessSignal | undefined,
  { cookies, url }: SessionSnapshot
): boolean {
  if (!signal || (signal.cookie === undefined && signal.redirect_off === undefined)) {
    return false
  }
  if (signal.cookie !== undefined && !cookies.some((c) => c.name === signal.cookie)) {
    return false
  }
  if (signal.redirect_off !== undefined) {
    let pathname: string
    try {
      pathname = new URL(url).pathname
    } catch {
      return false // about:blank / unparseable — not on the site yet
    }
    if (pathname.includes(signal.redirect_off)) return false
  }
  return true
}

// Per-capture-session redirect_off state, keyed by the live session object so
// entries vanish with the session. Lives here (not on CaptureSession) so
// detection owns its own semantics.
const sessionTrackers = new WeakMap<object, RedirectTracker>()

/**
 * Reads the live capture session's cookies + current URL + page title and
 * applies detectLogin (blocked and not_logged_in both fail closed into the
 * capture timeout). On success: exports storageState to the session's
 * authPath (workers/posting/auth/<platform>.json), chmod 600, and tears down
 * the session and the stream. Returns whether login was detected.
 */
export async function checkSession(sessionId: string): Promise<boolean> {
  const { getSession, closeSession } = await import('./session')
  const session = getSession(sessionId)
  if (!session) {
    throw new Error(`Unknown capture session "${sessionId}" — start a new capture`)
  }

  const cookies = await session.context.cookies()
  const url = session.page.url()
  const title = await session.page.title()

  let tracker = sessionTrackers.get(session)
  if (!tracker) {
    tracker = { sawLoginPage: false }
    sessionTrackers.set(session, tracker)
  }

  if (detectLogin(session.platform.login_success, { cookies, url, title }, tracker) !== 'logged_in') {
    return false
  }

  fs.mkdirSync(path.dirname(session.authPath), { recursive: true })
  await session.context.storageState({ path: session.authPath })
  fs.chmodSync(session.authPath, 0o600)

  await closeSession(sessionId)
  const { stopStream } = await import('./stream')
  await stopStream()
  return true
}
