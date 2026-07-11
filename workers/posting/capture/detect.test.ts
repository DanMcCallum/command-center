/**
 * Unit tests for the pure login-success predicate (US-004).
 * Run via: npm test (compiles to /tmp/posting-test-build, node --test).
 */
import * as assert from 'node:assert'
import { test } from 'node:test'
import { isLoggedIn } from './detect'

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
