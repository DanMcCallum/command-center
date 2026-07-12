/**
 * Login-success detection for the local poster agent
 * (specs/local-publish-2-local-agent.md, US-003/US-004) — the sole survivor
 * of the server-side capture stack deleted in Local publish 3/3.
 *
 * detectLogin() is the full evaluation: a pure function over a platform's
 * login_success signal (config/posting-platforms.json), a snapshot of the
 * session's cookies + URL + page title, and a redirect tracker. It returns a
 * three-way result — 'blocked' (Akamai Access Denied page, a hard failure
 * that can never read as success), 'logged_in', or 'not_logged_in' — and
 * only honors redirect_off after the session has actually been observed on
 * the login page (the land-com spike's false-positive fix). isLoggedIn() is
 * the underlying per-snapshot signal predicate. Both are unit-testable with
 * no browser and import nothing that resolves playwright — the compiled test
 * build runs from /tmp, outside node_modules' reach.
 *
 * Cookie values and storageState contents are never logged and never appear
 * in error messages — only the auth file *path* may be referenced.
 */
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
 * observed on the login page. The agent keeps one per probe.
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
