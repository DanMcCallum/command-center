/**
 * Unit tests for the pure login-success predicate (live-view US-004) and the
 * hardened three-way detection (local-publish-2 US-003).
 * Run via: npm test (compiles to /tmp/posting-test-build, node --test).
 * Running from /tmp also proves this module loads without resolving
 * playwright or the capture server/stream modules.
 */
import * as assert from 'node:assert'
import { test } from 'node:test'
import { detectLogin, isLoggedIn } from './detect'

const DASHBOARD = { cookies: [], url: 'https://www.landmodo.com/dashboard' }

test('cookie signal: named cookie present means logged in', () => {
  assert.strictEqual(
    isLoggedIn(
      { cookie: 'session_id' },
      { cookies: [{ name: 'session_id' }, { name: 'other' }], url: 'https://x.com/login' }
    ),
    true
  )
})

test('cookie signal: named cookie absent means not logged in', () => {
  assert.strictEqual(
    isLoggedIn({ cookie: 'session_id' }, { cookies: [{ name: 'other' }], url: 'https://x.com/' }),
    false
  )
})

test('redirect signal: URL moved off the login path means logged in', () => {
  assert.strictEqual(isLoggedIn({ redirect_off: '/login' }, DASHBOARD), true)
})

test('redirect signal: still on the login path means not logged in', () => {
  assert.strictEqual(
    isLoggedIn(
      { redirect_off: '/login' },
      { cookies: [], url: 'https://www.landmodo.com/login?next=%2F' }
    ),
    false
  )
})

test('redirect signal: query-string mention of the path does not count as on it', () => {
  assert.strictEqual(
    isLoggedIn(
      { redirect_off: '/login' },
      { cookies: [], url: 'https://www.landmodo.com/dashboard?from=%2Flogin' }
    ),
    true
  )
})

test('redirect signal: unparseable URL (not on the site yet) is not logged in', () => {
  assert.strictEqual(isLoggedIn({ redirect_off: '/login' }, { cookies: [], url: '' }), false)
})

test('combined signals: both must hold', () => {
  const signal = { cookie: 'sid', redirect_off: '/login' }
  assert.strictEqual(
    isLoggedIn(signal, { cookies: [{ name: 'sid' }], url: 'https://x.com/account' }),
    true
  )
  assert.strictEqual(
    isLoggedIn(signal, { cookies: [{ name: 'sid' }], url: 'https://x.com/login' }),
    false
  )
  assert.strictEqual(
    isLoggedIn(signal, { cookies: [], url: 'https://x.com/account' }),
    false
  )
})

test('missing or empty signal fails closed', () => {
  assert.strictEqual(isLoggedIn(undefined, DASHBOARD), false)
  assert.strictEqual(isLoggedIn({}, DASHBOARD), false)
})

// --- detectLogin: hardened three-way detection (local-publish-2 US-003) -----

test('Akamai denial flow (/login → denial → /) is blocked, never logged in', () => {
  const signal = { redirect_off: '/login' }
  const tracker = { sawLoginPage: false }
  // The denial flow touches /login first — served as the Access Denied page.
  // It must not earn sawLoginPage: the operator never saw a real login page.
  assert.strictEqual(
    detectLogin(
      signal,
      { cookies: [], url: 'https://www.land.com/login', title: 'Access Denied' },
      tracker
    ),
    'blocked'
  )
  assert.strictEqual(tracker.sawLoginPage, false)
  // The flow then bounces to / — off the login path, which the old
  // redirect_off-only detection read as success. Still the denial page.
  assert.strictEqual(
    detectLogin(
      signal,
      { cookies: [], url: 'https://www.land.com/', title: 'Access Denied' },
      tracker
    ),
    'blocked'
  )
  // Even landing on / with a normal title afterwards: the login page was
  // never actually seen, so redirect_off is not honored.
  assert.strictEqual(
    detectLogin(
      signal,
      { cookies: [], url: 'https://www.land.com/', title: 'Land for Sale' },
      tracker
    ),
    'not_logged_in'
  )
})

test('Access Denied title is blocked even after the login page was seen', () => {
  const tracker = { sawLoginPage: true }
  assert.strictEqual(
    detectLogin(
      { cookie: 'sid', redirect_off: '/login' },
      { cookies: [{ name: 'sid' }], url: 'https://www.land.com/account', title: ' Access Denied ' },
      tracker
    ),
    'blocked'
  )
})

test('redirect_off is only honored after the login page was actually seen', () => {
  const signal = { redirect_off: '/login' }
  const tracker = { sawLoginPage: false }
  // Off the login path from the start (login_url 301ed elsewhere): fail closed.
  assert.strictEqual(
    detectLogin(signal, { cookies: [], url: 'https://x.com/dashboard', title: 'Dashboard' }, tracker),
    'not_logged_in'
  )
  // On the login page: not logged in yet, but sawLoginPage is earned.
  assert.strictEqual(
    detectLogin(signal, { cookies: [], url: 'https://x.com/login', title: 'Sign in' }, tracker),
    'not_logged_in'
  )
  assert.strictEqual(tracker.sawLoginPage, true)
  // Now leaving the login page counts.
  assert.strictEqual(
    detectLogin(signal, { cookies: [], url: 'https://x.com/dashboard', title: 'Dashboard' }, tracker),
    'logged_in'
  )
})

test('detectLogin: cookie AND redirect_off are both required', () => {
  const signal = { cookie: 'sid', redirect_off: '/login' }
  const seen = () => ({ sawLoginPage: true })
  assert.strictEqual(
    detectLogin(signal, { cookies: [{ name: 'sid' }], url: 'https://x.com/account', title: 'Account' }, seen()),
    'logged_in'
  )
  assert.strictEqual(
    detectLogin(signal, { cookies: [], url: 'https://x.com/account', title: 'Account' }, seen()),
    'not_logged_in'
  )
  assert.strictEqual(
    detectLogin(signal, { cookies: [{ name: 'sid' }], url: 'https://x.com/login', title: 'Sign in' }, seen()),
    'not_logged_in'
  )
})

test('detectLogin: cookie-only signal needs no login-page observation', () => {
  const tracker = { sawLoginPage: false }
  assert.strictEqual(
    detectLogin(
      { cookie: 'sid' },
      { cookies: [{ name: 'sid' }], url: 'https://x.com/account', title: 'Account' },
      tracker
    ),
    'logged_in'
  )
})

test('detectLogin: snapshot without a title still detects (no false block)', () => {
  const tracker = { sawLoginPage: true }
  assert.strictEqual(
    detectLogin({ redirect_off: '/login' }, { cookies: [], url: 'https://x.com/account' }, tracker),
    'logged_in'
  )
})

test('detectLogin: missing or empty signal fails closed', () => {
  const tracker = { sawLoginPage: true }
  assert.strictEqual(detectLogin(undefined, { ...DASHBOARD, title: 'Dashboard' }, tracker), 'not_logged_in')
  assert.strictEqual(detectLogin({}, { ...DASHBOARD, title: 'Dashboard' }, tracker), 'not_logged_in')
})
