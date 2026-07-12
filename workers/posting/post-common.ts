/**
 * Shared plumbing for the per-platform posting scripts (post-landmodo.ts,
 * post-land_com.ts, ...). Platform scripts own their selectors and form flow;
 * everything platform-agnostic lives here.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { Page } from 'playwright'

// Source lives in workers/posting/, two levels below the project root. The
// compiled test build runs from /tmp but with cwd workers/posting/, so fall
// back to cwd when __dirname is outside the repo.
function resolveProjectRoot(): string {
  for (const base of [__dirname, process.cwd()]) {
    const candidate = path.resolve(base, '../..')
    if (fs.existsSync(path.join(candidate, 'config/posting-platforms.json'))) return candidate
  }
  throw new Error('Cannot locate project root (config/posting-platforms.json not found)')
}

export const PROJECT_ROOT = resolveProjectRoot()
export const CONFIG_PATH = path.join(PROJECT_ROOT, 'config/posting-platforms.json')
export const AUTH_DIR = path.resolve(__dirname, 'auth')
export const OUTPUTS_DIR = path.join(PROJECT_ROOT, 'workers/workspace/outputs')

export interface LoginSuccessSignal {
  /** Logged in when a cookie with this name is present. */
  cookie?: string
  /** Logged in when the page URL no longer contains this path. */
  redirect_off?: string
}

export interface PlatformConfig {
  display_name: string
  enabled: boolean
  login_url: string
  new_listing_url: string
  login_success?: LoginSuccessSignal
}

/** The slice of the dashboard Task record the posting scripts need. */
export interface PosterTask {
  id: string
  title: string
  metadata: Record<string, unknown> | null
}

export interface AdCopy {
  headline: string
  description: string
}

export interface PostOptions {
  /** Fill the form and screenshot, but do not submit. */
  dryRun?: boolean
}

/**
 * What a posting script needs from its caller. The caller owns the browser:
 * the page arrives already authenticated (agent.ts hands over the window the
 * operator just logged in through; post.ts builds one from the saved auth
 * state) and is never closed by the poster.
 */
export interface PostContext {
  /** Already-authenticated page the poster drives. */
  page: Page
  /**
   * Base dir holding <platform>.md and photos/ — the server's
   * outputs/<taskId>/ for the CLI, the agent's .agent-cache/<taskId>/ mirror
   * on the operator's machine.
   */
  outputDir: string
  /** Loaded platform config; posters fall back to loadPlatformConfig(). */
  platform?: PlatformConfig
}

export interface PostResult {
  /** Live listing URL after submit; null on --dry-run. */
  listingUrl: string | null
  /** Project-root-relative path to the proof screenshot. */
  screenshotPath: string
}

export function loadPlatformConfig(platformKey: string): PlatformConfig {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
  const platforms = (JSON.parse(raw) as { platforms: Record<string, PlatformConfig> }).platforms
  const platform = platforms[platformKey]
  if (!platform) {
    throw new Error(
      `Unknown platform "${platformKey}". Valid keys: ${Object.keys(platforms).join(', ')}`
    )
  }
  return platform
}

/**
 * Returns the saved storage-state path for a platform, or throws if no
 * session has been captured yet. Sessions are minted by the poster agent's
 * headed login (agent-auth.ts) on the operator's machine.
 */
export function requireAuthState(platformKey: string): string {
  const authPath = path.join(AUTH_DIR, `${platformKey}.json`)
  if (!fs.existsSync(authPath)) {
    throw new Error(
      `No saved login for "${platformKey}" (${authPath} missing). ` +
        `Publish with the poster agent running (npm run agent) to log in`
    )
  }
  return authPath
}

/** Standard error for a session that exists but no longer works. */
export function loginExpiredError(platformKey: string, currentUrl: string): Error {
  return new Error(
    `Login for "${platformKey}" appears expired — landed on a login page (${currentUrl}). ` +
      `Publish with the poster agent running (npm run agent) to log in again`
  )
}

const PHOTO_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif'])

/**
 * Absolute paths of photos a human placed in <outputDir>/photos/, sorted by
 * name. Empty array if the directory is absent — missing photos are only an
 * error if the target site requires them.
 */
export function listPhotos(outputDir: string): string[] {
  const photosDir = path.join(outputDir, 'photos')
  if (!fs.existsSync(photosDir)) return []
  return fs
    .readdirSync(photosDir)
    .filter((f) => PHOTO_EXTENSIONS.has(path.extname(f).toLowerCase()))
    .sort()
    .map((f) => path.join(photosDir, f))
}

/**
 * Preflight for post.ts: every marketplace requires at least one photo, so a
 * photo-less task must fail before a browser is ever launched. The message is
 * recorded verbatim as the posting's lastError — keep it operator-actionable.
 */
export function requirePhotos(outputDir: string, taskId: string): string[] {
  const photos = listPhotos(outputDir)
  if (photos.length === 0) {
    throw new Error(
      `No photos found in outputs/${taskId}/photos — upload photos and Retry`
    )
  }
  return photos
}

export interface ParsedLocation {
  /** County name without the trailing " County" word, e.g. "Elko". */
  county: string
  /** Full state name, e.g. "Nevada". */
  state: string
}

/**
 * Splits the Ad Builder's free-text location ("Elko County, Utah") into
 * county and state. Throws if there is no comma to split on — the posting
 * scripts need both parts for the listing form.
 */
export function splitLocation(location: string): ParsedLocation {
  const idx = location.lastIndexOf(',')
  if (idx === -1) {
    throw new Error(
      `Cannot split location "${location}" into county and state — expected "<county>, <state>"`
    )
  }
  const county = location
    .slice(0, idx)
    .trim()
    .replace(/\s+county$/i, '')
  const state = location.slice(idx + 1).trim()
  if (!county || !state) {
    throw new Error(`Cannot split location "${location}" into county and state`)
  }
  return { county, state }
}

/** Required task metadata for posting; throws a descriptive error if absent. */
export function requireListingFacts(task: PosterTask): {
  priceUsd: number
  acreage: number
  location: string
} {
  const m = task.metadata ?? {}
  const priceUsd = m['price_usd']
  const acreage = m['acreage']
  const location = m['location']
  if (typeof priceUsd !== 'number' || typeof acreage !== 'number' || typeof location !== 'string') {
    throw new Error(
      `Task ${task.id} metadata is missing price_usd/acreage/location — ` +
        `was this task created via the Ad Builder form?`
    )
  }
  return { priceUsd, acreage, location }
}

/**
 * Takes the proof screenshot into <outputDir>/postings/<platform>.png and
 * returns the project-root-relative path for the AdPosting record.
 */
export async function saveProofScreenshot(
  page: Page,
  outputDir: string,
  platformKey: string
): Promise<string> {
  const postingsDir = path.join(outputDir, 'postings')
  fs.mkdirSync(postingsDir, { recursive: true })
  const absPath = path.join(postingsDir, `${platformKey}.png`)
  await page.screenshot({ path: absPath, fullPage: true })
  return path.relative(PROJECT_ROOT, absPath)
}

/**
 * Fills the first element matching a comma-separated candidate selector list.
 * Handles <select> (by visible label, falling back to value) as well as text
 * inputs. Throws a "fix the selectors" error if nothing matches, so a site
 * redesign surfaces as a one-file fix in the platform script.
 */
export async function fillField(
  page: Page,
  selector: string,
  value: string,
  fieldName: string,
  scriptName: string
): Promise<void> {
  const locator = page.locator(selector).first()
  if ((await locator.count()) === 0) {
    throw new Error(
      `Could not find the ${fieldName} field on the listing form ` +
        `(tried: ${selector}). Update the SELECTORS block in ${scriptName}.`
    )
  }
  const tag = await locator.evaluate((el) => el.tagName)
  if (tag === 'SELECT') {
    try {
      await locator.selectOption({ label: value })
    } catch {
      await locator.selectOption(value)
    }
  } else {
    await locator.fill(value)
  }
}
