/**
 * Posts one approved ad to Landmodo.
 *
 * Usage: npm run post -- landmodo <taskId> [--dry-run]
 *
 * Requires a saved session from `npm run capture-login -- landmodo`.
 * Fills the new-listing form from the parsed ad copy plus task metadata,
 * uploads photos from <outputDir>/photos/ when present, saves a full-page
 * proof screenshot, and returns the live listing URL after submit.
 */
import { chromium } from 'playwright'
import type { Page } from 'playwright'
import {
  AdCopy,
  PostOptions,
  PosterTask,
  PostResult,
  fillField,
  listPhotos,
  loadPlatformConfig,
  loginExpiredError,
  requireAuthState,
  requireListingFacts,
  saveProofScreenshot,
  splitLocation,
} from './post-common'

const PLATFORM = 'landmodo'
const SCRIPT = 'post-landmodo.ts'

/**
 * All Landmodo DOM knowledge lives here so a site redesign is a one-file fix.
 * UNVERIFIED best-effort candidates (Rails-style field names guessed from the
 * public site) — capture the real selectors against the live listing form on
 * the first operator-supervised run and prune this block down.
 * Comma-separated entries are CSS alternatives; the first match is used.
 */
export const LANDMODO_SELECTORS = {
  // Present on the sign-in page — used to detect an expired session.
  loginForm: 'input[name="user[password]"], form[action*="sign_in"]',
  title: 'input[name="listing[title]"], input[name="listing[name]"], #listing_title',
  description:
    'textarea[name="listing[description]"], textarea[name="listing[body]"], #listing_description',
  price: 'input[name="listing[price]"], #listing_price',
  acreage: 'input[name="listing[acreage]"], input[name="listing[acres]"], #listing_acreage',
  state: 'select[name="listing[state]"], select[name="listing[state_id]"], #listing_state',
  county: 'input[name="listing[county]"], select[name="listing[county]"], #listing_county',
  photos: 'input[type="file"]',
  submit: 'form button[type="submit"], form input[type="submit"]',
}

export async function postToLandmodo(
  task: PosterTask,
  adCopy: AdCopy,
  opts: PostOptions & { outputDir: string }
): Promise<PostResult> {
  const config = loadPlatformConfig(PLATFORM)
  const authPath = requireAuthState(PLATFORM)
  const facts = requireListingFacts(task)
  const { county, state } = splitLocation(facts.location)
  const photos = listPhotos(opts.outputDir)

  const browser = await chromium.launch()
  try {
    const context = await browser.newContext({ storageState: authPath })
    const page = await context.newPage()
    await page.goto(config.new_listing_url, { waitUntil: 'domcontentloaded' })

    if (await onLoginPage(page)) {
      throw loginExpiredError(PLATFORM, page.url())
    }

    await fillField(page, LANDMODO_SELECTORS.title, adCopy.headline, 'title', SCRIPT)
    await fillField(page, LANDMODO_SELECTORS.description, adCopy.description, 'description', SCRIPT)
    await fillField(page, LANDMODO_SELECTORS.price, String(facts.priceUsd), 'price', SCRIPT)
    await fillField(page, LANDMODO_SELECTORS.acreage, String(facts.acreage), 'acreage', SCRIPT)
    await fillField(page, LANDMODO_SELECTORS.state, state, 'state', SCRIPT)
    await fillField(page, LANDMODO_SELECTORS.county, county, 'county', SCRIPT)

    const photoInput = page.locator(LANDMODO_SELECTORS.photos).first()
    if (photos.length > 0 && (await photoInput.count()) > 0) {
      await photoInput.setInputFiles(photos)
    }

    if (opts.dryRun) {
      const screenshotPath = await saveProofScreenshot(page, opts.outputDir, PLATFORM)
      return { listingUrl: null, screenshotPath }
    }

    const submit = page.locator(LANDMODO_SELECTORS.submit).first()
    if ((await submit.count()) === 0) {
      throw new Error(
        `Could not find the submit button (tried: ${LANDMODO_SELECTORS.submit}). ` +
          `Update the SELECTORS block in ${SCRIPT}.`
      )
    }
    const formUrl = page.url()
    await submit.click()
    // A successful create navigates away from the form; staying put means
    // validation errors (or a silent rejection) — surface that as a failure.
    await page.waitForURL((url) => url.toString() !== formUrl, { timeout: 30_000 })
    await page.waitForLoadState('domcontentloaded')
    if (await onLoginPage(page)) {
      throw loginExpiredError(PLATFORM, page.url())
    }

    const listingUrl = page.url()
    const screenshotPath = await saveProofScreenshot(page, opts.outputDir, PLATFORM)
    return { listingUrl, screenshotPath }
  } finally {
    await browser.close()
  }
}

async function onLoginPage(page: Page): Promise<boolean> {
  if (/sign_in|\/login/i.test(page.url())) return true
  return (await page.locator(LANDMODO_SELECTORS.loginForm).count()) > 0
}
