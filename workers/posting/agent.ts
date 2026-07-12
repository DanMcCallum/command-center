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
import { PROJECT_ROOT } from './post-common'

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

// --- poll loop ---------------------------------------------------------------

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
        // Claiming and processing land in US-002…US-005.
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
