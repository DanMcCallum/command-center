/**
 * Posts one approved ad to Landmodo.
 *
 * Usage: npm run post -- landmodo <taskId> [--dry-run]
 *
 * Drives an already-authenticated page handed in by the caller (the local
 * poster agent's headed browser, or post.ts's headless one built from the
 * saved auth/<platform>.json session). The caller owns the browser lifecycle.
 *
 * Landmodo runs on Brilliant Directories. Posting is a three-page flow,
 * mapped against the live member area on 2026-10-02:
 *
 *   1. /account/properties/view      The member's property list. Scanned
 *      first so a retry after a partial failure reuses the property instead
 *      of creating a duplicate (matched on title).
 *   2. /account/properties/newgroup  The create form. Title, status, a
 *      Google Places box that fills hidden lat/lon, display address, price,
 *      financing terms, a Froala rich-text description, type, APN, acres.
 *      APN is a required field on this site.
 *   3. /account/properties/addphotos/<hash>  The photo uploader. Hard site
 *      limits: 10 photos per property, 10 files and 10 MB per upload batch.
 *
 * The listing URL comes from the new row's "View Post" link; the proof
 * screenshot is taken on that public page.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { Locator, Page } from 'playwright'
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
  resolveLocation,
} from './post-common'

const PLATFORM = 'landmodo'
const SCRIPT = 'post-landmodo.ts'
const ORIGIN = 'https://www.landmodo.com'

/** Site limits read from the uploader's own JavaScript. */
export const LANDMODO_LIMITS = {
  photosPerProperty: 10,
  filesPerUpload: 10,
  /** The site compares the batch's byte sum against 10 * 1000000. */
  bytesPerUpload: 10 * 1000000,
}

/**
 * All Landmodo DOM knowledge lives here so a site redesign is a one-file fix.
 * Verified against the live member area (recon-landmodo-form.ts output).
 */
export const LANDMODO_SELECTORS = {
  // Present on the sign-in page, used to detect an expired session.
  loginForm: 'input[name="user[password]"], form[action*="sign_in"], form[action*="/login"] input[type="password"]',

  // --- property list ---
  listUrl: `${ORIGIN}/account/properties/view`,
  listRow: 'tr[role="row"]',
  rowTitle: '.post-title a',
  rowViewPost: 'a:text-is("View Post")',
  rowPhotos: 'a[href*="/account/properties/addphotos/"]',
  rowStatus: 'td:first-child .label-primary, td:first-child .label-default, td:first-child .label-warning',

  // --- create form ---
  form: 'form[action*="/account/properties/newgroup"]',
  title: 'input[name="group_name"]',
  status: 'select[name="property_status"]',
  publishYes: 'input[name="group_status"][value="1"]',
  placesInput: '#pac-input',
  placesSuggestion: '.pac-container .pac-item',
  location: 'input[name="post_location"]',
  lat: 'input[name="lat"]',
  price: 'input[name="post_promo"][type="text"]',
  downPayment: 'input[name="down_payment"]',
  monthlyPayment: 'input[name="monthly_payment"]',
  months: 'input[name="months"]',
  externalLink: 'input[name="post_link"]',
  descriptionTextarea: 'textarea[name="group_desc"]',
  descriptionEditor: '.fr-element[contenteditable="true"]',
  propertyType: 'select[name="property_type"]',
  apn: 'input[name="apn"]',
  acreage: 'input[name="property_acreage"]',
  submit: 'form[action*="/account/properties/newgroup"] input[type="submit"]',
  validationError: '.has-error .help-block:visible, .alert-danger:visible, .swal2-content, .sweet-alert.visible p',

  // --- photo uploader ---
  photosUrl: (hash: string) => `${ORIGIN}/account/properties/addphotos/${hash}`,
  photoFileInput: 'input#_file[type="file"]',
  photoSubmit: '#_submit',
  // The page loads both SweetAlert 1 and SweetAlert2; accept either.
  alertBox: '.swal2-popup, .sweet-alert.visible',
  alertTitle: '.swal2-title, .sweet-alert.visible h2',
  alertText: '.swal2-content, .sweet-alert.visible p',
  alertConfirm: 'button.swal2-confirm, .sweet-alert.visible button.confirm',
}

const HASH_RE = /\/account\/properties\/(?:addphotos|viewgroup|editgroup|arrange|newgroup)\/([a-f0-9]{32})/i

export const PROPERTY_TYPES = ['Rural', 'Infill', 'Undeveloped', 'Commercial', 'Other']

export interface Financing {
  downPaymentUsd: number | null
  monthlyPaymentUsd: number | null
  months: number | null
}

export interface PropertyRow {
  hash: string
  title: string
  status: string
  viewPostUrl: string | null
  photoCount: number
}

export async function postToLandmodo(
  task: PosterTask,
  adCopy: AdCopy,
  opts: PostOptions & PostContext
): Promise<PostResult> {
  const config = opts.platform ?? loadPlatformConfig(PLATFORM)
  const log = opts.log ?? (() => {})
  const facts = requireListingFacts(task)
  const location = await resolveLocation(facts.location)
  for (const w of location.warnings) log(`landmodo: location: ${w}`)
  const apn = requireApn(task, adCopy)
  const financing = financingFromTask(task, adCopy)
  const owners = financing.downPaymentUsd !== null || financing.monthlyPaymentUsd !== null
  const propertyType = propertyTypeFromTask(task)
  const page = opts.page

  // 1. Property list: duplicate guard.
  await page.goto(LANDMODO_SELECTORS.listUrl, { waitUntil: 'domcontentloaded' })
  if (await onLoginPage(page)) throw loginExpiredError(PLATFORM, page.url())
  const before = await readPropertyRows(page)
  let row = before.find((r) => sameTitle(r.title, adCopy.headline))
  if (row) {
    log(`landmodo: property "${row.title}" already exists (${row.hash}), reusing it instead of creating a second one`)
  }

  // 2. Create form.
  if (!row) {
    await page.goto(config.new_listing_url, { waitUntil: 'domcontentloaded' })
    if (await onLoginPage(page)) throw loginExpiredError(PLATFORM, page.url())
    if ((await page.locator(LANDMODO_SELECTORS.form).count()) === 0) {
      throw new Error(
        `The new-property form was not found at ${page.url()} (expected ${LANDMODO_SELECTORS.form}). ` +
          `Check new_listing_url in config/posting-platforms.json and the SELECTORS block in ${SCRIPT}.`
      )
    }

    await fillField(page, LANDMODO_SELECTORS.title, adCopy.headline, 'title', SCRIPT)
    await fillField(
      page,
      LANDMODO_SELECTORS.status,
      owners ? 'Owner Financed Land' : 'Land for Sale',
      'status',
      SCRIPT
    )

    const placesQuery = `${location.county} County, ${location.stateAbbr}`
    const geocoded = await pickPlacesSuggestion(page, placesQuery)
    if (!geocoded) {
      log(`landmodo: Google Places gave no suggestion for "${placesQuery}", posting without map coordinates`)
    }
    // The site's place handler targets a <textarea> that this form doesn't
    // have, so the display address is always ours to fill.
    const displayAddress = `${location.county} County, ${location.state}`
    await fillField(page, LANDMODO_SELECTORS.location, displayAddress, 'address', SCRIPT)

    await fillField(page, LANDMODO_SELECTORS.price, String(facts.priceUsd), 'price', SCRIPT)
    if (financing.downPaymentUsd !== null) {
      await fillField(page, LANDMODO_SELECTORS.downPayment, String(financing.downPaymentUsd), 'down payment', SCRIPT)
    }
    if (financing.monthlyPaymentUsd !== null) {
      await fillField(page, LANDMODO_SELECTORS.monthlyPayment, String(financing.monthlyPaymentUsd), 'monthly payment', SCRIPT)
    }
    if (financing.months !== null) {
      await fillField(page, LANDMODO_SELECTORS.months, String(financing.months), 'months', SCRIPT)
    }
    const externalLink = stringMeta(task, 'listing_url') ?? stringMeta(task, 'website_url')
    if (externalLink) {
      await fillField(page, LANDMODO_SELECTORS.externalLink, externalLink, 'external link', SCRIPT)
    }

    await setDescription(page, textToHtml(adCopy.description), adCopy.description)

    await fillField(page, LANDMODO_SELECTORS.propertyType, propertyType, 'property type', SCRIPT)
    await fillField(page, LANDMODO_SELECTORS.apn, apn, 'APN', SCRIPT)
    await fillField(page, LANDMODO_SELECTORS.acreage, String(facts.acreage), 'acreage', SCRIPT)

    // "Publish?" is a hidden Yes/No that defaults to No. Say yes.
    await page
      .locator(LANDMODO_SELECTORS.publishYes)
      .evaluate((el) => {
        const input = el as HTMLInputElement
        input.checked = true
        input.dispatchEvent(new Event('change', { bubbles: true }))
      })
      .catch(() => log('landmodo: no "Publish?" radio found, leaving the site default'))

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
    try {
      await page.waitForURL((url) => url.toString() !== formUrl, { timeout: 30_000 })
    } catch {
      const errors = await visibleTexts(page, LANDMODO_SELECTORS.validationError)
      throw new Error(
        `Landmodo did not accept the new property` +
          (errors.length > 0 ? `: ${errors.join(' | ')}` : ' (still on the form after 30s, no error shown)')
      )
    }
    await page.waitForLoadState('domcontentloaded')
    if (await onLoginPage(page)) throw loginExpiredError(PLATFORM, page.url())

    // Find the property we just made: from the redirect URL when it carries
    // the hash, otherwise as the new row in the list.
    const fromUrl = page.url().match(HASH_RE)?.[1]
    await page.goto(LANDMODO_SELECTORS.listUrl, { waitUntil: 'domcontentloaded' })
    const after = await readPropertyRows(page)
    row =
      (fromUrl && after.find((r) => r.hash === fromUrl)) ||
      after.find((r) => sameTitle(r.title, adCopy.headline)) ||
      after.find((r) => !before.some((b) => b.hash === r.hash))
    if (!row) {
      throw new Error(
        `The property form submitted (landed on ${page.url()}) but no new row appeared in the property list. ` +
          `Check Landmodo's My Properties page by hand before publishing again`
      )
    }
    log(`landmodo: created property "${row.title}" (${row.hash}, status ${row.status || 'unknown'})`)
  }

  // 3. Photos.
  const photos = choosePhotos(listPhotos(opts.outputDir), stringMeta(task, 'primaryPhoto'))
  const uploadedNow = await uploadPhotos(page, row.hash, photos, row.photoCount, log)

  // Listing URL + proof from the public page.
  await page.goto(LANDMODO_SELECTORS.listUrl, { waitUntil: 'domcontentloaded' })
  const finalRow = (await readPropertyRows(page)).find((r) => r.hash === row!.hash) ?? row
  if (finalRow.photoCount === 0 && uploadedNow === 0) {
    throw new Error(
      `Property ${finalRow.hash} exists but has no photos. Upload them by hand at ` +
        `${LANDMODO_SELECTORS.photosUrl(finalRow.hash)} (photos are required for the listing to show)`
    )
  }
  const listingUrl = finalRow.viewPostUrl ?? `${ORIGIN}/account/properties/editgroup/${finalRow.hash}/`
  if (!finalRow.viewPostUrl) log(`landmodo: no public "View Post" link yet for ${finalRow.hash}; reporting the edit URL`)
  if (finalRow.status && !/published/i.test(finalRow.status)) {
    log(`landmodo: NOTE the property list shows status "${finalRow.status}", it may need publishing by hand`)
  }

  await page.goto(listingUrl, { waitUntil: 'domcontentloaded' }).catch(() => {})
  const screenshotPath = await saveProofScreenshot(page, opts.outputDir, PLATFORM)
  return { listingUrl, screenshotPath }
}

// --- page helpers -------------------------------------------------------------

async function onLoginPage(page: Page): Promise<boolean> {
  if (/sign_in|\/login/i.test(page.url())) return true
  return (await page.locator(LANDMODO_SELECTORS.loginForm).count()) > 0
}

async function visibleTexts(page: Page, selector: string): Promise<string[]> {
  const texts: string[] = []
  for (const part of selector.split(',')) {
    const loc = page.locator(part.trim())
    const n = await loc.count().catch(() => 0)
    for (let i = 0; i < n; i++) {
      const t = (await loc.nth(i).innerText().catch(() => '')).trim().replace(/\s+/g, ' ')
      if (t) texts.push(t)
    }
  }
  return [...new Set(texts)]
}

/** Reads every property row on the My Properties page. */
export async function readPropertyRows(page: Page): Promise<PropertyRow[]> {
  const rows = page.locator(LANDMODO_SELECTORS.listRow)
  await rows.first().waitFor({ state: 'attached', timeout: 15_000 }).catch(() => {})
  const n = await rows.count()
  const out: PropertyRow[] = []
  for (let i = 0; i < n; i++) {
    const r = rows.nth(i)
    const titleLink = r.locator(LANDMODO_SELECTORS.rowTitle).first()
    if ((await titleLink.count()) === 0) continue
    const href = (await titleLink.getAttribute('href')) ?? ''
    const hash = href.match(HASH_RE)?.[1]
    if (!hash) continue
    const viewHref = await r.locator(LANDMODO_SELECTORS.rowViewPost).first().getAttribute('href').catch(() => null)
    const photosText = await r.locator(LANDMODO_SELECTORS.rowPhotos).first().innerText().catch(() => '')
    const status = (await r.locator(LANDMODO_SELECTORS.rowStatus).first().innerText().catch(() => ''))
      .split('\n')[0]
      .trim()
    out.push({
      hash,
      title: (await titleLink.innerText()).trim(),
      status,
      viewPostUrl: viewHref ? new URL(viewHref, ORIGIN).toString() : null,
      photoCount: Number(photosText.match(/(\d+)\s*Photos?/i)?.[1] ?? 0),
    })
  }
  return out
}

/**
 * Types the query into the Google Places box and accepts the first
 * suggestion, which makes the site fill its hidden lat/lon. Returns false
 * when no suggestion appeared (offline Places, quota, etc.).
 */
async function pickPlacesSuggestion(page: Page, query: string): Promise<boolean> {
  const input = page.locator(LANDMODO_SELECTORS.placesInput).first()
  if ((await input.count()) === 0) return false
  await input.click()
  await input.pressSequentially(query, { delay: 40 })
  const suggestion = page.locator(LANDMODO_SELECTORS.placesSuggestion).first()
  try {
    await suggestion.waitFor({ state: 'visible', timeout: 10_000 })
  } catch {
    return false
  }
  await input.press('ArrowDown')
  await input.press('Enter')
  try {
    await page.waitForFunction(
      (sel) => ((document.querySelector(sel) as HTMLInputElement | null)?.value ?? '') !== '',
      LANDMODO_SELECTORS.lat,
      { timeout: 10_000 }
    )
    return true
  } catch {
    return false
  }
}

/**
 * Puts the ad copy into the Froala editor. Prefers the editor's own API
 * (the site keeps the instance on window under the textarea's id), then
 * falls back to the contenteditable surface, and always mirrors the HTML
 * into the underlying textarea so the form posts it even if Froala's
 * submit hook does not fire.
 */
async function setDescription(page: Page, html: string, plain: string): Promise<void> {
  const textarea = page.locator(LANDMODO_SELECTORS.descriptionTextarea).first()
  if ((await textarea.count()) === 0) {
    throw new Error(
      `Could not find the description field on the listing form ` +
        `(tried: ${LANDMODO_SELECTORS.descriptionTextarea}). Update the SELECTORS block in ${SCRIPT}.`
    )
  }
  await page
    .locator(LANDMODO_SELECTORS.descriptionEditor)
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 })
    .catch(() => {})

  const viaApi = await textarea.evaluate((el, content) => {
    const ta = el as HTMLTextAreaElement
    const w = window as unknown as Record<string, unknown>
    const editor = w[ta.id] as { html?: { set: (h: string) => void }; events?: { trigger: (e: string) => void } } | undefined
    if (editor && editor.html && typeof editor.html.set === 'function') {
      editor.html.set(content)
      editor.events?.trigger('contentChanged')
      ta.value = content
      return true
    }
    return false
  }, html)

  if (!viaApi) {
    const surface = page.locator(LANDMODO_SELECTORS.descriptionEditor).first()
    if ((await surface.count()) > 0) {
      await surface.click()
      await surface.fill(plain)
    }
    await textarea.evaluate((el, content) => {
      ;(el as HTMLTextAreaElement).value = content
    }, html)
  }

  // Verify the words actually landed in the editor surface.
  const probe = plain.split(/\s+/).slice(0, 6).join(' ')
  const shown = await page
    .locator(LANDMODO_SELECTORS.descriptionEditor)
    .first()
    .innerText()
    .catch(() => '')
  if (!shown.replace(/\s+/g, ' ').includes(probe)) {
    throw new Error(
      `The description did not appear in Landmodo's editor (looked for "${probe}..."). ` +
        `Update setDescription() in ${SCRIPT}.`
    )
  }
}

/**
 * Uploads photos through the site's XHR uploader in batches that respect
 * its per-batch and per-property caps. Returns how many files were sent.
 */
async function uploadPhotos(
  page: Page,
  hash: string,
  photos: string[],
  alreadyOnSite: number,
  log: (m: string) => void
): Promise<number> {
  const room = LANDMODO_LIMITS.photosPerProperty - alreadyOnSite
  if (room <= 0) {
    log(`landmodo: property already has ${alreadyOnSite} photos (site cap ${LANDMODO_LIMITS.photosPerProperty}), skipping upload`)
    return 0
  }
  if (photos.length > room) {
    log(`landmodo: ${photos.length} photos available, uploading the first ${room} (site cap ${LANDMODO_LIMITS.photosPerProperty} per property)`)
  }
  const batches = batchPhotos(photos.slice(0, room))
  let sent = 0
  for (const batch of batches) {
    await page.goto(LANDMODO_SELECTORS.photosUrl(hash), { waitUntil: 'domcontentloaded' })
    if (await onLoginPage(page)) throw loginExpiredError(PLATFORM, page.url())
    const fileInput = page.locator(LANDMODO_SELECTORS.photoFileInput).first()
    if ((await fileInput.count()) === 0) {
      throw new Error(
        `Could not find the photo file input on ${page.url()} (tried: ${LANDMODO_SELECTORS.photoFileInput}). ` +
          `Update the SELECTORS block in ${SCRIPT}.`
      )
    }
    await fileInput.setInputFiles(batch)
    const submit = page.locator(LANDMODO_SELECTORS.photoSubmit).first()
    await submit.waitFor({ state: 'visible', timeout: 10_000 })
    await page.waitForFunction(
      (sel) => !(document.querySelector(sel) as HTMLButtonElement | null)?.disabled,
      LANDMODO_SELECTORS.photoSubmit,
      { timeout: 10_000 }
    )
    await submit.click()

    const alert = page.locator(LANDMODO_SELECTORS.alertBox).first()
    await alert.waitFor({ state: 'visible', timeout: 120_000 })
    const title = (await firstText(page.locator(LANDMODO_SELECTORS.alertTitle))).trim()
    const text = (await firstText(page.locator(LANDMODO_SELECTORS.alertText))).trim()
    if (!/success/i.test(title)) {
      throw new Error(`Landmodo rejected the photo upload: ${[title, text].filter(Boolean).join('. ')}`)
    }
    sent += batch.length
    log(`landmodo: uploaded ${batch.length} photo(s) (${text || title})`)
    await page.locator(LANDMODO_SELECTORS.alertConfirm).first().click().catch(() => {})
    await page.waitForTimeout(1500)
  }
  return sent
}

async function firstText(loc: Locator): Promise<string> {
  const n = await loc.count().catch(() => 0)
  for (let i = 0; i < n; i++) {
    if (await loc.nth(i).isVisible().catch(() => false)) return loc.nth(i).innerText().catch(() => '')
  }
  return ''
}

// --- pure helpers (unit-tested) ------------------------------------------------

function stringMeta(task: PosterTask, key: string): string | undefined {
  const v = task.metadata?.[key]
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

export function sameTitle(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  return norm(a) === norm(b)
}

const APN_RE = /\bAPN\s*(?:#|:|No\.?|number)?\s*([A-Z0-9][A-Z0-9.-]{2,}[A-Z0-9])/i

/** Finds an APN in the given texts ("APN R0037546", "APN: 123-45-678"). */
export function extractApn(...texts: Array<string | undefined>): string | null {
  for (const t of texts) {
    const m = t?.match(APN_RE)
    if (m) return m[1]
  }
  return null
}

/**
 * Landmodo requires an APN. Prefer an explicit metadata.apn, then scan the
 * task's free-text fields and the ad copy for an "APN ..." mention.
 */
export function requireApn(task: PosterTask, adCopy: AdCopy): string {
  const m = task.metadata ?? {}
  const explicit = m['apn']
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim()
  if (typeof explicit === 'number') return String(explicit)
  const found = extractApn(
    ...['utilities_notes', 'must_include', 'notes', 'legal_description'].map((k) =>
      typeof m[k] === 'string' ? (m[k] as string) : undefined
    ),
    adCopy.description
  )
  if (found) return found
  throw new Error(
    `Landmodo requires an APN and task ${task.id} has none. Add "apn" to the task metadata ` +
      `(or mention "APN <number>" in the task notes) and Publish again`
  )
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number(v.replace(/[$,\s]/g, ''))
    if (Number.isFinite(n) && v.trim() !== '') return n
  }
  return null
}

/**
 * Owner-financing terms for the form, parsed from free text such as
 * "$10,500 down ... then $1,095/mo for 24 months". The first plan mentioned
 * wins.
 */
export function parseFinancing(text: string): Financing {
  const money = (re: RegExp): number | null => {
    const m = text.match(re)
    return m ? Number(m[1].replace(/,/g, '')) : null
  }
  const down = money(/\$\s?([\d,]+(?:\.\d+)?)\s*(?:\([^)]*\)\s*)?(?:down\b|dn\b)/i)
  const monthly = money(/\$\s?([\d,]+(?:\.\d+)?)\s*(?:\/\s*mo\b|\/\s*month\b|\s+(?:a|per)\s+month\b|\s*monthly\b|\s*mo\b)/i)
  const monthsMatch =
    text.match(/(?:for|over|x)\s+(\d{1,3})\s*(?:months|mos?\b)/i) ?? text.match(/(\d{1,3})\s*(?:-|\s)?months?\b/i)
  const months = monthsMatch ? Number(monthsMatch[1]) : null
  return { downPaymentUsd: down, monthlyPaymentUsd: monthly, months }
}

/**
 * Explicit metadata wins (down_payment_usd, monthly_payment_usd,
 * term_months); otherwise the terms are parsed from must_include and the ad
 * copy. "No financing" with no down-payment figure means a cash listing.
 */
export function financingFromTask(task: PosterTask, adCopy: AdCopy): Financing {
  const m = task.metadata ?? {}
  const explicit: Financing = {
    downPaymentUsd: num(m['down_payment_usd']),
    monthlyPaymentUsd: num(m['monthly_payment_usd']),
    months: num(m['term_months']),
  }
  if (explicit.downPaymentUsd !== null || explicit.monthlyPaymentUsd !== null) return explicit
  const source = [typeof m['must_include'] === 'string' ? m['must_include'] : '', adCopy.description]
    .filter(Boolean)
    .join('\n')
  if (/no (?:owner |seller )?financing/i.test(source) && !/\$\s?[\d,]+\s*(?:\([^)]*\)\s*)?down\b/i.test(source)) {
    return { downPaymentUsd: null, monthlyPaymentUsd: null, months: null }
  }
  return parseFinancing(source)
}

export function propertyTypeFromTask(task: PosterTask): string {
  const v = task.metadata?.['landmodo_property_type']
  if (typeof v === 'string') {
    const hit = PROPERTY_TYPES.find((t) => t.toLowerCase() === v.trim().toLowerCase())
    if (hit) return hit
  }
  return 'Rural'
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Turns the ad copy's plain text into the simple HTML Froala expects:
 * blank-line-separated paragraphs, "- " lines as bullet lists, single
 * newlines inside a paragraph as <br>.
 */
export function textToHtml(text: string): string {
  const bullet = /^[-*•]\s+/
  const blocks = text.replace(/\r\n/g, '\n').trim().split(/\n\s*\n/)
  return blocks
    .map((block) => {
      const lines = block.split('\n').map((l) => l.trim()).filter(Boolean)
      const li = (l: string) => `<li>${escapeHtml(l.replace(bullet, ''))}</li>`
      if (lines.length > 0 && lines.every((l) => bullet.test(l))) {
        return `<ul>${lines.map(li).join('')}</ul>`
      }
      // A lead line followed by bullet lines.
      const firstBullet = lines.findIndex((l) => bullet.test(l))
      if (firstBullet > 0 && lines.slice(firstBullet).every((l) => bullet.test(l))) {
        const lead = lines.slice(0, firstBullet).map(escapeHtml).join('<br>')
        return `<p>${lead}</p><ul>${lines.slice(firstBullet).map(li).join('')}</ul>`
      }
      return `<p>${lines.map(escapeHtml).join('<br>')}</p>`
    })
    .join('')
}

/** Primary photo first, then the rest in filename order. */
export function choosePhotos(photos: string[], primaryPhoto?: string): string[] {
  if (!primaryPhoto) return photos
  const idx = photos.findIndex((p) => path.basename(p) === primaryPhoto)
  if (idx <= 0) return photos
  return [photos[idx], ...photos.slice(0, idx), ...photos.slice(idx + 1)]
}

/**
 * Splits photos into upload batches under the site's per-batch file count
 * and byte caps. A single file over the byte cap throws: the site would
 * reject it, so the operator must shrink it.
 */
export function batchPhotos(
  photos: string[],
  sizeOf: (p: string) => number = (p) => fs.statSync(p).size,
  limits = LANDMODO_LIMITS
): string[][] {
  const batches: string[][] = []
  let current: string[] = []
  let bytes = 0
  for (const p of photos) {
    const size = sizeOf(p)
    if (size >= limits.bytesPerUpload) {
      throw new Error(
        `Photo ${path.basename(p)} is ${(size / 1000000).toFixed(1)} MB; Landmodo caps an upload at ` +
          `${limits.bytesPerUpload / 1000000} MB. Shrink it and Publish again`
      )
    }
    if (current.length >= limits.filesPerUpload || bytes + size >= limits.bytesPerUpload) {
      batches.push(current)
      current = []
      bytes = 0
    }
    current.push(p)
    bytes += size
  }
  if (current.length > 0) batches.push(current)
  return batches
}
