/**
 * CLI runner for the per-platform posting scripts.
 *
 * Usage: npm run post -- <platform> <taskId> [--dry-run]
 *
 * Fetches the task from the dashboard API (DASHBOARD_URL, default
 * http://localhost:3000), parses the generated ad copy for the platform, and
 * hands both to the platform's posting script. Logs go to stderr; the final
 * line on stdout is a JSON PostResult so the caller can parse
 * listingUrl/screenshotPath.
 */
import * as path from 'node:path'
import { parseAdOutput } from './parse-ad-output'
import {
  AdCopy,
  OUTPUTS_DIR,
  PostOptions,
  PosterTask,
  PostResult,
  loadPlatformConfig,
  requirePhotos,
} from './post-common'
import { postToLandCom } from './post-land_com'
import { postToLandmodo } from './post-landmodo'

const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:3000'

type Poster = (
  task: PosterTask,
  adCopy: AdCopy,
  opts: PostOptions & { outputDir: string }
) => Promise<PostResult>

const POSTERS: Record<string, Poster> = {
  landmodo: postToLandmodo,
  land_com: postToLandCom,
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
  const [platformKey, taskId] = args.filter((a) => !a.startsWith('--'))

  if (!platformKey || !taskId) {
    console.error('Usage: npm run post -- <platform> <taskId> [--dry-run]')
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

  const task = await fetchTask(taskId)
  const outputDir = path.join(OUTPUTS_DIR, taskId)
  requirePhotos(outputDir, taskId) // fail fast before any browser launch
  const adCopy = parseAdOutput(outputDir, platformKey)

  console.error(
    `Posting task ${taskId} to ${platform.display_name}${dryRun ? ' (dry run)' : ''}...`
  )
  const result = await poster(task, adCopy, { dryRun, outputDir })
  console.error(
    dryRun
      ? `Dry run complete — form filled, screenshot at ${result.screenshotPath}`
      : `Posted: ${result.listingUrl} (screenshot: ${result.screenshotPath})`
  )
  console.log(JSON.stringify(result))
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
