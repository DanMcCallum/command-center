/**
 * Capture-session manager for self-hosted live-view login capture
 * (specs/live-view-browser.md, US-002).
 *
 * startSession() launches a headed Chromium — inheriting process.env.DISPLAY,
 * so under the streaming bridge (US-003) it renders into the Xvfb display —
 * navigates to the platform's login_url, and tracks the live browser objects
 * in an in-memory map by session id so the capture-server can drive login
 * detection and teardown remotely. Login-success detection and the
 * storageState export happen in US-004; this module writes no files.
 */
import * as crypto from 'node:crypto'
import * as path from 'node:path'
import type { Browser, BrowserContext, Page } from 'playwright'
import { chromium } from 'playwright'
import { AUTH_DIR, loadPlatformConfig, PlatformConfig } from '../post-common'

export interface CaptureSession {
  sessionId: string
  platformKey: string
  platform: PlatformConfig
  browser: Browser
  context: BrowserContext
  page: Page
  /** Where the storageState lands on login success (US-004). */
  authPath: string
}

export interface StartSessionResult {
  sessionId: string
  platformKey: string
}

const sessions = new Map<string, CaptureSession>()

export async function startSession(platformKey: string): Promise<StartSessionResult> {
  const platform = loadPlatformConfig(platformKey)
  if (!platform.enabled) {
    throw new Error(
      `Platform "${platformKey}" is not enabled in config/posting-platforms.json`
    )
  }
  if (platform.capture !== 'live-view') {
    throw new Error(
      `Platform "${platformKey}" is not configured for live-view capture ` +
        `(capture: "${platform.capture ?? 'cli'}")`
    )
  }

  const browser = await chromium.launch({ headless: false })
  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(platform.login_url)

    const sessionId = crypto.randomBytes(16).toString('hex')
    sessions.set(sessionId, {
      sessionId,
      platformKey,
      platform,
      browser,
      context,
      page,
      authPath: path.join(AUTH_DIR, `${platformKey}.json`),
    })
    return { sessionId, platformKey }
  } catch (err) {
    await browser.close()
    throw err
  }
}

export function getSession(sessionId: string): CaptureSession | undefined {
  return sessions.get(sessionId)
}

/** Closes the session's browser and forgets it. No-op for unknown ids. */
export async function closeSession(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId)
  if (!session) return
  sessions.delete(sessionId)
  await session.browser.close()
}
