/**
 * Posts one approved ad to Land.com.
 *
 * Usage: npm run post -- land_com <taskId> [--dry-run]
 *
 * Drives an already-authenticated page handed in by the caller (the local
 * poster agent's headed browser, or post.ts's headless one built from the
 * saved auth/<platform>.json session) — the caller owns the browser lifecycle.
 * Fills the new-listing form from the parsed ad copy plus task metadata,
 * uploads photos from <outputDir>/photos/ when present, saves a full-page
 * proof screenshot, and returns the live listing URL after submit.
 */
import type { Page } from 'playwright'
import {
  AdCopy,
  PostContext,
  PostOptions,
  PosterTask,
  PostResult,
  fillField,
  listPhotos,
  loadPlatformConfig,
  loginExpiredError,
  requireListingFacts,
  saveProofScreenshot,
  splitLocation,
} from './post-common'

const PLATFORM = 'land_com'
const SCRIPT = 'post-land_com.ts'

/**
 * All Land.com DOM knowledge lives here so a site redesign is a one-file fix.
 * UNVERIFIED best-effort candidates (Land.com is a modern .NET/React app, so
 * these lean on name/id/placeholder guesses rather than Rails conventions) —
 * capture the real selectors against the live listing form on the first
 * operator-supervised run and prune this block down.
 * Comma-separated entries are CSS alternatives; the first match is used.
 */
export const LAND_COM_SELECTORS = {
  // Present on the sign-in page — used to detect an expired session.
  loginForm: 'input[type="password"][name*="assword"], form[action*="login" i]',
  title: 'input[name="title" i], input[id*="title" i], input[placeholder*="title" i]',
  description:
    'textarea[name="description" i], textarea[id*="description" i], textarea[placeholder*="description" i]',
  price: 'input[name="price" i], input[id*="price" i], input[placeholder*="price" i]',
  acreage:
    'input[name="acres" i], input[name="acreage" i], input[id*="acre" i], input[placeholder*="acre" i]',
  state: 'select[name="state" i], select[id*="state" i]',
  county: 'select[name="county" i], input[name="county" i], input[id*="county" i]',
  photos: 'input[type="file"]',
  submit: 'form button[type="submit"], form input[type="submit"]',
}

export async function postToLandCom(
  task: PosterTask,
  adCopy: AdCopy,
  opts: PostOptions & PostContext
): Promise<PostResult> {
  const config = opts.platform ?? loadPlatformConfig(PLATFORM)
  const facts = requireListingFacts(task)
  const { county, state } = splitLocation(facts.location)
  const photos = listPhotos(opts.outputDir)
  const page = opts.page

  await page.goto(config.new_listing_url, { waitUntil: 'domcontentloaded' })
  if (await onLoginPage(page)) {
    throw loginExpiredError(PLATFORM, page.url())
  }

  await fillField(page, LAND_COM_SELECTORS.title, adCopy.headline, 'title', SCRIPT)
  await fillField(page, LAND_COM_SELECTORS.description, adCopy.description, 'description', SCRIPT)
  await fillField(page, LAND_COM_SELECTORS.price, String(facts.priceUsd), 'price', SCRIPT)
  await fillField(page, LAND_COM_SELECTORS.acreage, String(facts.acreage), 'acreage', SCRIPT)
  await fillField(page, LAND_COM_SELECTORS.state, state, 'state', SCRIPT)
  await fillField(page, LAND_COM_SELECTORS.county, county, 'county', SCRIPT)

  const photoInput = page.locator(LAND_COM_SELECTORS.photos).first()
  if (photos.length > 0 && (await photoInput.count()) > 0) {
    await photoInput.setInputFiles(photos)
  }

  if (opts.dryRun) {
    const screenshotPath = await saveProofScreenshot(page, opts.outputDir, PLATFORM)
    return { listingUrl: null, screenshotPath }
  }

  const submit = page.locator(LAND_COM_SELECTORS.submit).first()
  if ((await submit.count()) === 0) {
    throw new Error(
      `Could not find the submit button (tried: ${LAND_COM_SELECTORS.submit}). ` +
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
}

async function onLoginPage(page: Page): Promise<boolean> {
  if (/\/login|\/signin|account\/login/i.test(page.url())) return true
  return (await page.locator(LAND_COM_SELECTORS.loginForm).count()) > 0
}
