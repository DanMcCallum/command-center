/**
 * CLI runner for the per-platform posting scripts, and home of the POSTERS
 * registry the local poster agent invokes (specs/local-publish-2-local-agent.md
 * US-005).
 *
 * Usage: npm run post -- <platform> <taskId> [--dry-run] [--headed] [--login] [--keep-open]
 *
 * --keep-open leaves the browser window open after the run (success or
 * failure) until the operator closes it, so a failing step can be retried by
 * hand in the very same session.
 *
 * --login runs the agent's own auth flow first (agent-auth.ts): a headed
 * window, the saved session probed, the operator logging in only if it is
 * stale, the fresh session saved to auth/<platform>.json, and the post made
 * in that same browser context. Use it to reproduce exactly what the agent
 * does, or when a saved session reads as logged in but the site disagrees.
 *
 * The CLI is the local-dev path: it reads the server-side outputs/ layout,
 * builds a headless browser from the saved auth/<platform>.json session, and hands
 * the authenticated page to the platform's posting script. The agent builds
 * the same PostContext from its headed browser and cache dir instead.
 * Logs go to stderr; the final line on stdout is a JSON PostResult so the
 * caller can parse listingUrl/screenshotPath.
 */
import * as path from 'node:path'
import { chromium } from 'playwright'
import type { Browser, Page } from 'playwright'
import { authenticate } from './agent-auth'
import { parseAdOutput } from './parse-ad-output'
import {
  AdCopy,
  OUTPUTS_DIR,
  PostContext,
  PostOptions,
  PosterTask,
  PostResult,
  loadPlatformConfig,
  requireAuthState,
  requirePhotos,
} from './post-common'
import { postToLandCentury } from './post-land_century'
import { postToLandCom } from './post-land_com'
import { postToLandmodo } from './post-landmodo'
import { postToParcelView } from './post-parcelview'

const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:3000'

export type Poster = (
  task: PosterTask,
  adCopy: AdCopy,
  opts: PostOptions & PostContext
) => Promise<PostResult>

export const POSTERS: Record<string, Poster> = {
  landmodo: postToLandmodo,
  land_com: postToLandCom,
  parcelview: postToParcelView,
  land_century: postToLandCentury,
}

async function fetchTask(taskId: string): Promise<PosterTask> {
  const url = `${DASHBOARD_URL}/api/tasks/${taskId}`
  let res: Response
  try {
    res = await fetch(url)
  } catch (err) {
    throw new Error(
      `Dashboard not reachable at ${url} — is it running? (${err instanceof Error ? err.message : err})`
    )
  }
  if (!res.ok) {
    throw new Error(`Task "${taskId}" not found (${res.status} from ${url})`)
  }
  return (await res.json()) as PosterTask
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const headed = args.includes('--headed')
  const login = args.includes('--login')
  const keepOpen = args.includes('--keep-open')
  const [platformKey, taskId] = args.filter((a) => !a.startsWith('--'))

  if (!platformKey || !taskId) {
    console.error('Usage: npm run post -- <platform> <taskId> [--dry-run] [--headed] [--login] [--keep-open]')
    console.error(`Implemented platforms: ${Object.keys(POSTERS).join(', ')}`)
    process.exit(1)
  }

  const platform = loadPlatformConfig(platformKey) // throws on unknown key
  if (!platform.enabled) {
    throw new Error(
      `Platform "${platformKey}" (${platform.display_name}) is not enabled in config/posting-platforms.json`
    )
  }
  const poster = POSTERS[platformKey]
  if (!poster) {
    throw new Error(
      `No posting script implemented for "${platformKey}" yet. ` +
        `Implemented: ${Object.keys(POSTERS).join(', ')}`
    )
  }

  const log = (m: string) => console.error(m)
  const task = await fetchTask(taskId)
  const outputDir = path.join(OUTPUTS_DIR, taskId)
  requirePhotos(outputDir, taskId) // fail fast before any browser launch
  const adCopy = parseAdOutput(outputDir, platformKey)

  console.error(
    `Posting task ${taskId} to ${platform.display_name}${dryRun ? ' (dry run)' : ''}...`
  )
  let browser: Browser
  let page: Page
  if (login) {
    // The agent's transaction: headed window, probe, operator login if stale,
    // session saved, then post in the same context.
    const auth = await authenticate({
      platformKey,
      platform,
      log,
      // Diagnostics for the login itself: status and top-level KEY NAMES of
      // the site's auth responses (never values), so a session that comes
      // back without a token can be traced to the response that minted it.
      _onLoginWait: (p) => {
        p.on('response', (res) => {
          const url = res.url()
          if (!/\/api\/(auth\/login|auth\/register[a-z-]*|users\/me)(\?|$)/.test(url)) return
          res
            .text()
            .then((body) => {
              let keys = ''
              try {
                const j = JSON.parse(body) as Record<string, unknown>
                keys = Object.entries(j)
                  .map(([k, v]) => `${k}=${v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v}`)
                  .join(', ')
              } catch {
                keys = `(non-JSON, ${body.length} bytes)`
              }
              log(`${platformKey}: login flow ${res.request().method()} ${url.replace(/^https?:\/\//, '')} -> ${res.status()} {${keys}}`)
            })
            .catch(() => {})
        })
      },
    })
    if (auth.outcome !== 'ready') throw new Error(`login ${auth.outcome}: ${auth.message}`)
    browser = auth.browser
    page = auth.page
  } else {
    const authPath = requireAuthState(platformKey)
    // --headed shows the window, the same way the agent runs.
    browser = await chromium.launch({ headless: !headed })
    const context = await browser.newContext({ storageState: authPath })
    page = await context.newPage()
  }
  try {
    const result = await poster(task, adCopy, {
      dryRun,
      outputDir,
      page,
      platform,
      log,
    })
    console.error(
      dryRun
        ? `Dry run complete — form filled, screenshot at ${result.screenshotPath}`
        : `Posted: ${result.listingUrl} (screenshot: ${result.screenshotPath})`
    )
    console.log(JSON.stringify(result))
  } catch (err) {
    if (keepOpen) console.error(`Failed: ${err instanceof Error ? err.message : err}`)
    throw err
  } finally {
    if (keepOpen && browser.isConnected()) {
      console.error('--keep-open: the browser stays open; close the window to finish')
      while (browser.isConnected() && !page.isClosed()) await new Promise((r) => setTimeout(r, 1000))
    }
    await browser.close().catch(() => {})
  }
}

// Guarded so agent.ts can import POSTERS without running the CLI.
if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
