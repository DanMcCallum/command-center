/**
 * Local poster agent (specs/local-publish-2-local-agent.md).
 *
 * Runs on the operator's machine (residential IP), polling the dashboard's
 * agent API for queued publish jobs. Outbound-only: the laptop never opens a
 * port. Jobs are processed strictly one at a time — never two browsers.
 *
 * Usage: npm run agent   (env: DASHBOARD_URL, AGENT_TOKEN, AGENT_POLL_SECONDS)
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { Page } from 'playwright'
import { authenticate } from './agent-auth'
import { parseAdOutput } from './parse-ad-output'
import { POSTERS } from './post'
import { loadPlatformConfig, PROJECT_ROOT } from './post-common'
import type { AdCopy, PlatformConfig, PosterTask, PostResult } from './post-common'

interface AgentConfig {
  dashboardUrl: string
  agentToken: string
  pollSeconds: number
}

interface PublishJob {
  taskId: string
  taskTitle: string
  platform: string
  queuedAt: string
  attempts: number
}

/**
 * Reads a var from the environment, falling back to the project-root
 * .env.local. On the operator's machine that file holds DASHBOARD_URL and
 * AGENT_TOKEN; on the server it is the same file the other secrets live in.
 * Values are never logged.
 */
function readProjectEnvVar(name: string): string | undefined {
  const fromEnv = process.env[name]
  if (fromEnv) return fromEnv
  const envPath = path.join(PROJECT_ROOT, '.env.local')
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
      const m = line.match(new RegExp(`^(?:export\\s+)?${name}=(.*)$`))
      if (m) {
        const value = m[1].trim().replace(/^(["'])(.*)\1$/, '$2')
        if (value) return value
      }
    }
  }
  return undefined
}

function loadConfig(): AgentConfig {
  const dashboardUrl = readProjectEnvVar('DASHBOARD_URL')
  const agentToken = readProjectEnvVar('AGENT_TOKEN')
  const missing = [
    !dashboardUrl && 'DASHBOARD_URL (e.g. http://localhost:3000 or the tunnel hostname)',
    !agentToken && 'AGENT_TOKEN (must match the dashboard server\'s token)',
  ].filter((v): v is string => Boolean(v))
  if (missing.length > 0) {
    console.error(
      `agent: missing required config — set in the environment or the project-root .env.local:\n` +
        missing.map((m) => `  - ${m}`).join('\n')
    )
    process.exit(1)
  }
  const rawPoll = readProjectEnvVar('AGENT_POLL_SECONDS') ?? '15'
  const pollSeconds = Number(rawPoll)
  if (!Number.isFinite(pollSeconds) || pollSeconds <= 0) {
    console.error(`agent: AGENT_POLL_SECONDS must be a positive number (got "${rawPoll}")`)
    process.exit(1)
  }
  return {
    dashboardUrl: dashboardUrl!.replace(/\/+$/, ''),
    agentToken: agentToken!,
    pollSeconds,
  }
}

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`)
}

// --- clean shutdown ---------------------------------------------------------
// First Ctrl-C: finish the current pass, cut the poll sleep short, exit the
// loop. Second Ctrl-C: hard exit.

let shuttingDown = false
let wakeFromSleep: (() => void) | null = null

function requestShutdown(signal: string): void {
  if (shuttingDown) process.exit(1)
  shuttingDown = true
  log(`${signal} received — shutting down`)
  wakeFromSleep?.()
}

process.on('SIGINT', () => requestShutdown('SIGINT'))
process.on('SIGTERM', () => requestShutdown('SIGTERM'))

/** Sleep that a shutdown signal can cut short. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      wakeFromSleep = null
      resolve()
    }, ms)
    wakeFromSleep = () => {
      clearTimeout(timer)
      wakeFromSleep = null
      resolve()
    }
  })
}

// --- agent API calls ----------------------------------------------------------

async function fetchQueuedJobs(config: AgentConfig): Promise<PublishJob[]> {
  const res = await fetch(`${config.dashboardUrl}/api/publish-jobs`, {
    headers: { Authorization: `Bearer ${config.agentToken}` },
  })
  if (!res.ok) {
    throw new Error(`GET /api/publish-jobs returned HTTP ${res.status}`)
  }
  const body = (await res.json()) as { jobs: PublishJob[] }
  return body.jobs
}

/** Best-effort error message out of an API response body. */
async function apiError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string }
    if (body.error) return body.error
  } catch {
    // Non-JSON body — fall through to the status line.
  }
  return `HTTP ${res.status}`
}

/**
 * Atomically claim a queued job; the claim response is the full task, whose
 * metadata (price/acreage/location) the posting scripts need.
 * 'conflict' = someone else got it (409).
 */
async function claimJob(config: AgentConfig, job: PublishJob): Promise<PosterTask | 'conflict'> {
  const res = await fetch(`${config.dashboardUrl}/api/publish-jobs/claim`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.agentToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ taskId: job.taskId, platform: job.platform }),
  })
  if (res.status === 409) return 'conflict'
  if (!res.ok) {
    throw new Error(`claim failed: ${await apiError(res)}`)
  }
  return (await res.json()) as PosterTask
}

/**
 * Report a claimed job's state back to the dashboard. Never throws — a failed
 * report is logged and the loop moves on (the posting stays agent-owned and
 * the operator can see it on the dashboard).
 */
async function reportPosting(
  config: AgentConfig,
  job: PublishJob,
  patch: {
    status: 'posting' | 'awaiting_auth' | 'posted' | 'failed'
    lastError?: string
    listingUrl?: string
    screenshotPath?: string
  }
): Promise<void> {
  try {
    const res = await fetch(`${config.dashboardUrl}/api/publish-jobs/report`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.agentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ taskId: job.taskId, platform: job.platform, ...patch }),
    })
    if (!res.ok) {
      log(`report ${patch.status} for ${job.platform}/${job.taskId} failed: ${await apiError(res)}`)
    }
  } catch (err) {
    log(
      `report ${patch.status} for ${job.platform}/${job.taskId} failed: ` +
        (err instanceof Error ? err.message : String(err))
    )
  }
}

// --- publish bundle download ---------------------------------------------------

// Local mirror of the server's outputs/<taskId>/ layout: ad copy at
// <taskId>/<platform>.md, photos under <taskId>/photos/. Gitignored.
const AGENT_CACHE_DIR = path.resolve(__dirname, '.agent-cache')

// Both become path segments in the cache dir — refuse anything that could
// escape it. The server enforces the same platform pattern on its side.
const TASK_ID_PATTERN = /^[A-Za-z0-9_-]+$/
const PLATFORM_PATTERN = /^[a-z0-9_]+$/

/**
 * Download the ad copy + photos for a claimed job into the local cache.
 * Photos are size-checked against the server's Content-Length after writing.
 * Throws with a one-line message naming what failed.
 */
async function downloadBundle(
  config: AgentConfig,
  job: PublishJob
): Promise<{ taskDir: string; photoCount: number }> {
  if (!TASK_ID_PATTERN.test(job.taskId) || !PLATFORM_PATTERN.test(job.platform)) {
    throw new Error(`refusing unsafe job identifiers (taskId "${job.taskId}", platform "${job.platform}")`)
  }

  const bundleUrl =
    `${config.dashboardUrl}/api/tasks/${encodeURIComponent(job.taskId)}` +
    `/publish-bundle?platform=${encodeURIComponent(job.platform)}`
  const res = await fetch(bundleUrl, {
    headers: { Authorization: `Bearer ${config.agentToken}` },
  })
  if (!res.ok) {
    throw new Error(`publish-bundle download failed: ${await apiError(res)}`)
  }
  const bundle = (await res.json()) as { adCopy: string; photos: string[] }

  const taskDir = path.join(AGENT_CACHE_DIR, job.taskId)
  const photosDir = path.join(taskDir, 'photos')
  fs.mkdirSync(photosDir, { recursive: true })
  fs.writeFileSync(path.join(taskDir, `${job.platform}.md`), bundle.adCopy)

  for (const photoPath of bundle.photos) {
    const name = path.posix.basename(photoPath)
    const fileUrl =
      `${config.dashboardUrl}/api/files/` +
      photoPath.split('/').map(encodeURIComponent).join('/')
    const photoRes = await fetch(fileUrl, {
      headers: { Authorization: `Bearer ${config.agentToken}` },
    })
    if (!photoRes.ok) {
      throw new Error(`photo download failed: ${name} (${await apiError(photoRes)})`)
    }
    const bytes = Buffer.from(await photoRes.arrayBuffer())
    const contentLength = photoRes.headers.get('content-length')
    if (contentLength !== null && Number(contentLength) !== bytes.length) {
      throw new Error(
        `photo download truncated: ${name} (got ${bytes.length} bytes, server said ${contentLength})`
      )
    }
    const dest = path.join(photosDir, name)
    fs.writeFileSync(dest, bytes)
    if (fs.statSync(dest).size !== bytes.length) {
      throw new Error(`photo write incomplete: ${name}`)
    }
  }
  log(`bundle cached: ${job.platform}.md + ${bundle.photos.length} photo(s) in .agent-cache/${job.taskId}/`)
  return { taskDir, photoCount: bundle.photos.length }
}

// --- posting -----------------------------------------------------------------

// lastError renders in a dashboard chip popover — one line, hard cap.
const LAST_ERROR_MAX = 300

/** First line of an error, truncated to LAST_ERROR_MAX chars. */
function oneLineError(err: unknown): string {
  const line = (err instanceof Error ? err.message : String(err)).split('\n')[0].trim()
  return line.length > LAST_ERROR_MAX ? `${line.slice(0, LAST_ERROR_MAX - 1)}…` : line
}

/**
 * Upload a local PNG as the job's proof screenshot. Returns the server-side
 * path (for the posting's screenshotPath) or undefined on failure — a lost
 * screenshot never fails the job, it is only logged.
 */
async function uploadProof(
  config: AgentConfig,
  job: PublishJob,
  localPngPath: string
): Promise<string | undefined> {
  try {
    const bytes = fs.readFileSync(localPngPath)
    const res = await fetch(
      `${config.dashboardUrl}/api/tasks/${encodeURIComponent(job.taskId)}` +
        `/proof?platform=${encodeURIComponent(job.platform)}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.agentToken}`,
          'Content-Type': 'image/png',
        },
        body: new Uint8Array(bytes),
      }
    )
    if (!res.ok) {
      log(`proof upload for ${job.platform}/${job.taskId} failed: ${await apiError(res)}`)
      return undefined
    }
    const body = (await res.json()) as { path?: string }
    return body.path
  } catch (err) {
    log(`proof upload for ${job.platform}/${job.taskId} failed: ${oneLineError(err)}`)
    return undefined
  }
}

/**
 * After a posting failure, capture what the browser was looking at and upload
 * it as the proof screenshot so the operator can see the failure state.
 * Best-effort: returns the server-side path or undefined.
 */
async function captureFailureProof(
  config: AgentConfig,
  job: PublishJob,
  page: Page,
  taskDir: string
): Promise<string | undefined> {
  if (page.isClosed()) return undefined
  try {
    const postingsDir = path.join(taskDir, 'postings')
    fs.mkdirSync(postingsDir, { recursive: true })
    const localPath = path.join(postingsDir, `${job.platform}.png`)
    await page.screenshot({ path: localPath, fullPage: true })
    return await uploadProof(config, job, localPath)
  } catch (err) {
    log(`failure screenshot for ${job.platform}/${job.taskId} not captured: ${oneLineError(err)}`)
    return undefined
  }
}

/** Claim one job, download its bundle, then auth + post in one browser. */
async function processJob(config: AgentConfig, job: PublishJob): Promise<void> {
  const task = await claimJob(config, job)
  if (task === 'conflict') {
    log(`claim conflict for ${job.platform}/${job.taskId} — someone else got it, skipping`)
    return
  }
  log(`claimed ${job.platform}/${job.taskId}`)

  // Preflight everything that can fail without a browser: bundle download,
  // ad-copy parse, platform config, poster lookup. A doomed job must never
  // pop a login window at the operator.
  let taskDir: string
  let adCopy: AdCopy
  let platform: PlatformConfig
  try {
    const bundle = await downloadBundle(config, job)
    taskDir = bundle.taskDir
    if (bundle.photoCount === 0) {
      throw new Error('no photos on the server for this task — upload photos and Publish again')
    }
    adCopy = parseAdOutput(taskDir, job.platform)
    platform = loadPlatformConfig(job.platform)
    if (!POSTERS[job.platform]) {
      throw new Error(
        `no posting script implemented for "${job.platform}" (implemented: ${Object.keys(POSTERS).join(', ')})`
      )
    }
  } catch (err) {
    const message = oneLineError(err)
    log(`job ${job.platform}/${job.taskId} failed: ${message}`)
    await reportPosting(config, job, { status: 'failed', lastError: `agent: ${message}` })
    return
  }

  // Auth and posting are one transaction in one browser: probe the saved
  // session, pop a headed window for the operator only when it's stale, then
  // (US-005) post in that same context.
  log(`checking ${job.platform} session in a headed browser on this machine`)
  const auth = await authenticate({
    platformKey: job.platform,
    platform,
    log,
    shouldAbort: () => shuttingDown,
    onAwaitingAuth: () => reportPosting(config, job, { status: 'awaiting_auth' }),
  })

  if (auth.outcome !== 'ready') {
    log(`job ${job.platform}/${job.taskId} failed (${auth.outcome}): ${auth.message}`)
    await reportPosting(config, job, {
      status: 'failed',
      // The cancelled message is the operator-facing contract ("login
      // cancelled") — don't prefix it.
      lastError: auth.outcome === 'cancelled' ? auth.message : `agent: ${auth.message}`,
    })
    return
  }

  // Post in the same, already-authenticated browser context, then push every
  // result the dashboard needs back through the API. The browser closes when
  // the job finishes, success or failure (the finally owns it).
  try {
    if (auth.usedHeadedLogin) {
      await reportPosting(config, job, { status: 'posting' })
    }

    let result: PostResult
    try {
      log(`posting ${job.platform}/${job.taskId}`)
      result = await POSTERS[job.platform](task, adCopy, {
        outputDir: taskDir,
        page: auth.page,
        platform,
      })
    } catch (err) {
      const message = oneLineError(err)
      log(`job ${job.platform}/${job.taskId} failed: ${message}`)
      const screenshotPath = await captureFailureProof(config, job, auth.page, taskDir)
      await reportPosting(config, job, {
        status: 'failed',
        lastError: `agent: ${message}`,
        ...(screenshotPath && { screenshotPath }),
      })
      return
    }

    // saveProofScreenshot returns a PROJECT_ROOT-relative path; the local file
    // is in the cache dir. Upload it so the dashboard's screenshot link works,
    // then report posted (the server stamps postedAt).
    const localShot = path.resolve(PROJECT_ROOT, result.screenshotPath)
    const screenshotPath = await uploadProof(config, job, localShot)
    await reportPosting(config, job, {
      status: 'posted',
      ...(result.listingUrl && { listingUrl: result.listingUrl }),
      ...(screenshotPath && { screenshotPath }),
    })
    log(`job ${job.platform}/${job.taskId} posted: ${result.listingUrl ?? '(no listing URL)'}`)
  } finally {
    await auth.browser.close().catch(() => {})
  }
}

async function main(): Promise<void> {
  const config = loadConfig()
  log(`agent started — polling ${config.dashboardUrl} every ${config.pollSeconds}s`)

  while (!shuttingDown) {
    try {
      const jobs = await fetchQueuedJobs(config)
      if (jobs.length === 0) {
        log('0 queued jobs')
      } else {
        // FIFO by queuedAt; one job per pass, awaited to completion before the
        // next poll — the no-concurrent-browsers guarantee lives right here.
        const queue = [...jobs].sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))
        const next = queue[0]
        log(
          `${jobs.length} queued job(s): ` +
            queue.map((j) => `${j.platform}/${j.taskId}`).join(', ') +
            ` — next up: ${next.platform}/${next.taskId} ("${next.taskTitle}")`
        )
        await processJob(config, next)
      }
    } catch (err) {
      log(`poll failed: ${err instanceof Error ? err.message : String(err)}`)
    }
    if (shuttingDown) break
    await sleep(config.pollSeconds * 1000)
  }

  log('agent stopped')
}

main().catch((err) => {
  console.error(`agent: fatal — ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
