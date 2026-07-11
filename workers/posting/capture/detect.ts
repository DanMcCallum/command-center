/**
 * Login-success detection + storageState export for self-hosted live-view
 * login capture (specs/live-view-browser.md, US-004).
 *
 * isLoggedIn() is a pure predicate over a platform's login_success signal
 * (config/posting-platforms.json) and a snapshot of the live session's
 * cookies + URL — unit-testable with no browser. checkSession() applies it
 * to a live capture session (capture/session.ts); on success it persists
 * the session with the same context.storageState() + chmod 600 ritual as
 * capture-login.ts, then tears down the session and the streaming bridge
 * (capture/stream.ts).
 *
 * Cookie values and storageState contents are never logged and never appear
 * in error messages — only the auth file *path* may be referenced.
 *
 * session.ts and stream.ts are imported lazily inside checkSession() so this
 * module (and its unit test) loads without resolving playwright — the
 * compiled test build runs from /tmp, outside node_modules' reach.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { LoginSuccessSignal } from '../post-common'

/** What isLoggedIn needs to know about the live session — names only, no values. */
export interface SessionSnapshot {
  cookies: Array<{ name: string }>
  url: string
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

/**
 * Reads the live capture session's cookies + current URL and applies
 * isLoggedIn. On success: exports storageState to the session's authPath
 * (workers/posting/auth/<platform>.json), chmod 600, and tears down the
 * session and the stream. Returns whether login was detected.
 */
export async function checkSession(sessionId: string): Promise<boolean> {
  const { getSession, closeSession } = await import('./session')
  const session = getSession(sessionId)
  if (!session) {
    throw new Error(`Unknown capture session "${sessionId}" — start a new capture`)
  }

  const cookies = await session.context.cookies()
  const url = session.page.url()
  if (!isLoggedIn(session.platform.login_success, { cookies, url })) {
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
