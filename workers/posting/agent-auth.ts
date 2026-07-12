/**
 * Auth-as-part-of-the-transaction for the local poster agent
 * (specs/local-publish-2-local-agent.md, US-004).
 *
 * authenticate() owns the browser side of a publish job: it launches a headed
 * Chromium on the operator's real display (headless: false, never Xvfb — the
 * popup window IS the login UI), loads the locally saved session
 * (auth/<platform>.json) when one exists, probes whether that session is
 * actually logged in using the hardened three-way detection from
 * capture/detect.ts, and — only when it isn't — parks the browser on the
 * platform's login page and waits for the operator to log in. On success the
 * fresh session is written back to auth/<platform>.json (chmod 600) and the
 * still-open, authenticated browser is handed to the caller so posting
 * (US-005) happens in the same context. On every non-ready outcome the
 * browser is closed before returning.
 *
 * Cookie VALUES are never logged — names and expiry timestamps only.
 * storageState contents never appear in logs or error messages either; only
 * the auth file path may be referenced.
 *
 * Do not import capture/session.ts or capture/stream.ts here — the VNC stack
 * dies in Part 3 and the agent must never depend on it.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { chromium } from 'playwright'
import type { Browser, BrowserContext, Page } from 'playwright'
import { detectLogin } from './capture/detect'
import type { RedirectTracker, SessionSnapshot } from './capture/detect'
import { AUTH_DIR } from './post-common'
import type { PlatformConfig } from './post-common'

// Humans are slow — the PRD floor for the login wait is 10 minutes.
const DEFAULT_LOGIN_TIMEOUT_MS = 15 * 60 * 1000
const DEFAULT_POLL_INTERVAL_MS = 2000
const NAVIGATION_TIMEOUT_MS = 45_000

export interface AuthenticateOptions {
  platformKey: string
  platform: PlatformConfig
  /** Called once, right before the headed login wait starts (report awaiting_auth). */
  onAwaitingAuth?: () => Promise<void>
  /** Polled during the login wait; return true to abort (agent shutdown). */
  shouldAbort?: () => boolean
  log?: (message: string) => void
  loginTimeoutMs?: number
  pollIntervalMs?: number
  /** Where auth/<platform>.json lives; tests point this at a temp dir. */
  authDir?: string
  /** Test-only hook: receives the page when the login wait begins. */
  _onLoginWait?: (page: Page) => void
}

export type AuthResult =
  | {
      outcome: 'ready'
      browser: Browser
      context: BrowserContext
      page: Page
      /** True when the job went through the headed login phase (posting must be flipped back from awaiting_auth). */
      usedHeadedLogin: boolean
    }
  | { outcome: 'blocked' | 'cancelled' | 'timeout' | 'error'; message: string }

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Snapshot the live page for detectLogin. Returns null when the page is
 * mid-navigation (title read raced the load) — the caller skips that
 * evaluation cycle rather than judging a titleless snapshot, because the
 * Akamai blocked check needs the title to fail closed.
 */
async function trySnapshot(context: BrowserContext, page: Page): Promise<SessionSnapshot | null> {
  try {
    return { cookies: await context.cookies(), url: page.url(), title: await page.title() }
  } catch (err) {
    if (page.isClosed()) throw err
    return null
  }
}

/** One line per cookie, names and expiry only — values must never appear. */
function describeCookies(cookies: Array<{ name: string; expires: number }>): string {
  if (cookies.length === 0) return '(none)'
  return cookies
    .map((c) =>
      c.expires > 0 ? `${c.name} (expires ${new Date(c.expires * 1000).toISOString()})` : `${c.name} (session)`
    )
    .join(', ')
}

function firstLine(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).split('\n')[0]
}

export async function authenticate(opts: AuthenticateOptions): Promise<AuthResult> {
  const log = opts.log ?? ((m: string) => console.log(m))
  const authDir = opts.authDir ?? AUTH_DIR
  const authPath = path.join(authDir, `${opts.platformKey}.json`)
  const loginTimeoutMs = opts.loginTimeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS

  // Headed, on whatever display the operator's shell already has.
  // handleSIGINT/handleSIGTERM off: Playwright's defaults force-exit the
  // process on Ctrl-C, which would kill the agent before it can report the
  // job failed and close the browser itself (the agent's signal handlers own
  // shutdown).
  const browser = await chromium.launch({
    headless: false,
    handleSIGINT: false,
    handleSIGTERM: false,
  })
  try {
    const result = await runAuthFlow(browser, authPath, loginTimeoutMs, pollIntervalMs, log, opts)
    if (result.outcome !== 'ready') await browser.close().catch(() => {})
    return result
  } catch (err) {
    const closedByOperator = !browser.isConnected() || /has been closed/i.test(String(err))
    await browser.close().catch(() => {})
    if (closedByOperator) return { outcome: 'cancelled', message: 'login cancelled' }
    return { outcome: 'error', message: firstLine(err) }
  }
}

async function runAuthFlow(
  browser: Browser,
  authPath: string,
  loginTimeoutMs: number,
  pollIntervalMs: number,
  log: (message: string) => void,
  opts: AuthenticateOptions
): Promise<AuthResult> {
  const { platformKey, platform } = opts
  const signal = platform.login_success

  let context: BrowserContext
  if (fs.existsSync(authPath)) {
    try {
      context = await browser.newContext({ storageState: authPath })
    } catch {
      log(`${platformKey}: saved session at ${authPath} is unreadable — starting fresh`)
      context = await browser.newContext()
    }
  } else {
    context = await browser.newContext()
  }
  const page = await context.newPage()
  const tracker: RedirectTracker = { sawLoginPage: false }

  const blocked: AuthResult = {
    outcome: 'blocked',
    message: `${platform.display_name} served its Akamai "Access Denied" page — this network is blocked by the site's edge; login and posting cannot proceed from here`,
  }

  // Probe: is the saved session already good? A redirect_off-only signal can
  // never confirm here (sawLoginPage is unearned by design — US-003), so this
  // fast-path fires mainly for platforms with a positive cookie signal; the
  // rest resolve in the login phase below without operator input.
  await page.goto(platform.new_listing_url, {
    waitUntil: 'domcontentloaded',
    timeout: NAVIGATION_TIMEOUT_MS,
  })
  const probeSnap = await trySnapshot(context, page)
  const probeVerdict = probeSnap === null ? 'not_logged_in' : detectLogin(signal, probeSnap, tracker)
  if (probeVerdict === 'blocked') return blocked
  if (probeVerdict === 'logged_in') {
    log(`${platformKey}: saved session is valid — skipping login`)
    return { outcome: 'ready', browser, context, page, usedHeadedLogin: false }
  }

  // Headed login: hand the window to the operator.
  log(`${platformKey}: not logged in — opening the login page in the popup window`)
  await opts.onAwaitingAuth?.()
  await page.goto(platform.login_url, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS })

  const landing = await trySnapshot(context, page)
  if (landing !== null) {
    const landingVerdict = detectLogin(signal, landing, tracker)
    if (landingVerdict === 'blocked') return blocked
    // One-shot check with a seeded tracker: we deliberately navigated to the
    // login page and were NOT denied — if the site bounced us straight off
    // the login path, the session was valid all along (the redirect_off-only
    // probe above can't see that). The Akamai denial flow can't reach this:
    // its page titles "Access Denied" and returned 'blocked' above before any
    // tracker state was earned. The seed is used once here and discarded —
    // the operator wait below keeps the strict US-003 semantics.
    if (landingVerdict === 'logged_in' || detectLogin(signal, landing, { sawLoginPage: true }) === 'logged_in') {
      return finishLogin(browser, context, page, authPath, platformKey, log)
    }
  }

  opts._onLoginWait?.(page)
  const deadline = Date.now() + loginTimeoutMs
  for (;;) {
    if (opts.shouldAbort?.()) return { outcome: 'cancelled', message: 'login cancelled' }
    if (Date.now() > deadline) {
      return {
        outcome: 'timeout',
        message: `operator login timed out after ${Math.round(loginTimeoutMs / 60000)} minutes — Publish again to retry`,
      }
    }
    await sleep(pollIntervalMs)
    if (page.isClosed()) return { outcome: 'cancelled', message: 'login cancelled' }
    const snap = await trySnapshot(context, page)
    if (snap === null) continue
    const verdict = detectLogin(signal, snap, tracker)
    if (verdict === 'blocked') return blocked
    if (verdict === 'logged_in') return finishLogin(browser, context, page, authPath, platformKey, log)
  }
}

/** Login detected: persist the session locally (chmod 600) and hand the browser over. */
async function finishLogin(
  browser: Browser,
  context: BrowserContext,
  page: Page,
  authPath: string,
  platformKey: string,
  log: (message: string) => void
): Promise<AuthResult> {
  fs.mkdirSync(path.dirname(authPath), { recursive: true })
  await context.storageState({ path: authPath })
  fs.chmodSync(authPath, 0o600)
  const cookies = await context.cookies()
  log(`${platformKey}: login captured — session saved to ${authPath}`)
  log(`${platformKey}: session cookies (names only): ${describeCookies(cookies)}`)
  return { outcome: 'ready', browser, context, page, usedHeadedLogin: true }
}
