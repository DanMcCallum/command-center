/**
 * Verification harness for agent-auth.ts (US-004). NOT part of `npm test` —
 * the compiled test build runs from /tmp where playwright doesn't resolve.
 * Run from workers/posting/ with a display available (test scaffolding may be
 * an Xvfb; the agent itself never manages one):
 *
 *   Xvfb :98 &
 *   DISPLAY=:98 npx tsx verify-agent-auth.ts
 *
 * Spins up a mock marketplace on 127.0.0.1:4799 whose /login page "logs the
 * operator in" via a JS timer (or never, with ?noauto=1), then drives
 * authenticate() through: fresh headed login, valid-session probe skip
 * (cookie signal), valid-session bounce (redirect_off-only signal), Akamai
 * blocked at probe and at login, operator window close, shutdown abort, and
 * login timeout.
 */
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'
import { authenticate } from './agent-auth'
import type { PlatformConfig } from './post-common'

const PORT = 4799
const BASE = `http://127.0.0.1:${PORT}`
// Distinctive so a leak into logs is grep-able; must never appear in output.
const COOKIE_VALUE = 'sekrit-cookie-value-a41f'

function html(title: string, body = ''): string {
  return `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', BASE)
  const loggedIn = /(?:^|;\s*)mock_session=/.test(req.headers.cookie ?? '')
  const send = (status: number, body?: string, headers: Record<string, string> = {}) => {
    res.writeHead(status, { 'Content-Type': 'text/html', ...headers })
    res.end(body ?? '')
  }
  if (url.pathname === '/login') {
    if (loggedIn) return send(302, undefined, { Location: '/dashboard' })
    const auto = url.searchParams.has('noauto')
      ? ''
      : `<script>setTimeout(() => { document.cookie = 'mock_session=${COOKIE_VALUE}; path=/'; location.href = '/dashboard' }, 1500)</script>`
    return send(200, html('Mock Login', `<h1>Log in</h1>${auto}`))
  }
  if (url.pathname === '/listings/new') {
    // Preserve the query so ?noauto=1 survives the bounce to /login.
    if (!loggedIn) return send(302, undefined, { Location: `/login${url.search}` })
    return send(200, html('New Listing', '<form></form>'))
  }
  if (url.pathname === '/dashboard') return send(200, html('Dashboard'))
  if (url.pathname === '/denied') return send(200, html('Access Denied', 'Reference #18.4d5a'))
  return send(404, html('Not Found'))
})

function mockPlatform(overrides: Partial<PlatformConfig> = {}): PlatformConfig {
  return {
    display_name: 'Mockland',
    enabled: true,
    login_url: `${BASE}/login`,
    new_listing_url: `${BASE}/listings/new`,
    login_success: { redirect_off: '/login' },
    ...overrides,
  }
}

function tempAuthDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agent-auth-verify-'))
}

let failures = 0
function check(name: string, cond: boolean, detail = ''): void {
  if (!cond) failures++
  console.log(`  ${cond ? 'PASS' : 'FAIL'}: ${name}${cond || !detail ? '' : ` — ${detail}`}`)
}

async function main(): Promise<void> {
  await new Promise<void>((resolve) => server.listen(PORT, '127.0.0.1', resolve))

  // 1. Fresh login: no saved session, redirect_off-only signal (real config
  //    shape) — expect awaiting_auth, headed login, session saved chmod 600,
  //    cookie names logged but never values.
  console.log('Scenario 1: fresh headed login')
  const authDir = tempAuthDir()
  const logs: string[] = []
  let awaiting = 0
  {
    const r = await authenticate({
      platformKey: 'mockland',
      platform: mockPlatform(),
      authDir,
      pollIntervalMs: 300,
      log: (m) => logs.push(m),
      onAwaitingAuth: async () => {
        awaiting++
      },
    })
    check('outcome ready', r.outcome === 'ready', JSON.stringify(r))
    check('went through headed login', r.outcome === 'ready' && r.usedHeadedLogin)
    check('onAwaitingAuth fired once', awaiting === 1, `fired ${awaiting}x`)
    const authPath = path.join(authDir, 'mockland.json')
    check('auth file written', fs.existsSync(authPath))
    check(
      'auth file chmod 600',
      fs.existsSync(authPath) && (fs.statSync(authPath).mode & 0o777) === 0o600,
      fs.existsSync(authPath) ? (fs.statSync(authPath).mode & 0o777).toString(8) : 'missing'
    )
    check(
      'cookie NAME logged',
      logs.some((l) => l.includes('mock_session'))
    )
    check(
      'cookie VALUE never logged',
      logs.every((l) => !l.includes(COOKIE_VALUE))
    )
    if (r.outcome === 'ready') await r.browser.close()
  }

  // 2. Valid saved session + positive cookie signal: the probe alone confirms
  //    — login is skipped entirely, no awaiting_auth.
  console.log('Scenario 2: valid session, cookie signal — probe skips login')
  {
    awaiting = 0
    const r = await authenticate({
      platformKey: 'mockland',
      platform: mockPlatform({ login_success: { cookie: 'mock_session' } }),
      authDir,
      pollIntervalMs: 300,
      onAwaitingAuth: async () => {
        awaiting++
      },
      log: () => {},
    })
    check('outcome ready', r.outcome === 'ready', JSON.stringify(r))
    check('login skipped (saved session)', r.outcome === 'ready' && !r.usedHeadedLogin)
    check('awaiting_auth never reported', awaiting === 0)
    if (r.outcome === 'ready') await r.browser.close()
  }

  // 3. Valid saved session + redirect_off-only signal: the probe can't
  //    confirm (strict US-003 semantics), but the login-page bounce resolves
  //    it without operator input.
  console.log('Scenario 3: valid session, redirect_off-only — resolves via login bounce')
  {
    awaiting = 0
    const started = Date.now()
    const r = await authenticate({
      platformKey: 'mockland',
      platform: mockPlatform(),
      authDir,
      pollIntervalMs: 300,
      onAwaitingAuth: async () => {
        awaiting++
      },
      log: () => {},
    })
    check('outcome ready', r.outcome === 'ready', JSON.stringify(r))
    check('went through login phase', r.outcome === 'ready' && r.usedHeadedLogin)
    check('resolved without operator (<10s)', Date.now() - started < 10_000)
    if (r.outcome === 'ready') await r.browser.close()
  }

  // 4. Akamai denial at the probe: hard 'blocked', message names Akamai,
  //    nothing saved.
  console.log('Scenario 4: Access Denied page at probe → blocked')
  {
    const dir = tempAuthDir()
    const r = await authenticate({
      platformKey: 'mockland',
      platform: mockPlatform({ new_listing_url: `${BASE}/denied` }),
      authDir: dir,
      pollIntervalMs: 300,
      log: () => {},
    })
    check('outcome blocked', r.outcome === 'blocked', JSON.stringify(r))
    check('message names Akamai', r.outcome === 'blocked' && r.message.includes('Akamai'))
    check('no session saved', !fs.existsSync(path.join(dir, 'mockland.json')))
  }

  // 5. Akamai denial on the login page itself (the spike's flow: /login is
  //    the first thing the denial touches).
  console.log('Scenario 5: Access Denied at login phase → blocked')
  {
    const r = await authenticate({
      platformKey: 'mockland',
      platform: mockPlatform({
        new_listing_url: `${BASE}/listings/new?noauto=1`,
        login_url: `${BASE}/denied`,
      }),
      authDir: tempAuthDir(),
      pollIntervalMs: 300,
      log: () => {},
    })
    check('outcome blocked', r.outcome === 'blocked', JSON.stringify(r))
  }

  // 6. Operator closes the window mid-login → cancelled, exact message.
  console.log('Scenario 6: window closed by operator → cancelled')
  {
    const r = await authenticate({
      platformKey: 'mockland',
      platform: mockPlatform({
        new_listing_url: `${BASE}/listings/new?noauto=1`,
        login_url: `${BASE}/login?noauto=1`,
      }),
      authDir: tempAuthDir(),
      pollIntervalMs: 300,
      log: () => {},
      _onLoginWait: (page) => {
        setTimeout(() => page.close().catch(() => {}), 800)
      },
    })
    check('outcome cancelled', r.outcome === 'cancelled', JSON.stringify(r))
    check("message is 'login cancelled'", r.outcome === 'cancelled' && r.message === 'login cancelled')
  }

  // 7. Agent shutdown during the login wait → cancelled.
  console.log('Scenario 7: shouldAbort during login wait → cancelled')
  {
    let abort = false
    setTimeout(() => {
      abort = true
    }, 800)
    const r = await authenticate({
      platformKey: 'mockland',
      platform: mockPlatform({
        new_listing_url: `${BASE}/listings/new?noauto=1`,
        login_url: `${BASE}/login?noauto=1`,
      }),
      authDir: tempAuthDir(),
      pollIntervalMs: 300,
      shouldAbort: () => abort,
      log: () => {},
    })
    check('outcome cancelled', r.outcome === 'cancelled', JSON.stringify(r))
  }

  // 8. Login wait deadline → timeout (short deadline is a test override; the
  //    production default is 15 min, PRD floor 10).
  console.log('Scenario 8: login never happens → timeout')
  {
    const r = await authenticate({
      platformKey: 'mockland',
      platform: mockPlatform({
        new_listing_url: `${BASE}/listings/new?noauto=1`,
        login_url: `${BASE}/login?noauto=1`,
      }),
      authDir: tempAuthDir(),
      pollIntervalMs: 300,
      loginTimeoutMs: 3000,
      log: () => {},
    })
    check('outcome timeout', r.outcome === 'timeout', JSON.stringify(r))
    check('message mentions timeout', r.outcome === 'timeout' && r.message.includes('timed out'))
  }

  server.close()
  console.log(failures === 0 ? '\nALL SCENARIOS PASSED' : `\n${failures} CHECK(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
