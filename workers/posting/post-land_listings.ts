/**
 * Posts one approved ad to Land-listings.com (www.land-listings.com).
 *
 * Usage: npm run post -- land_listings <taskId> [--dry-run] [--headed]
 *
 * Drives an already-authenticated page handed in by the caller (the local
 * poster agent's headed browser, or post.ts's headless one built from the
 * saved auth/<platform>.json session). The caller owns the browser lifecycle.
 *
 * What is known about the site (mapped 2026-10-05 from the logged-out site,
 * its public stylesheet and scripts, and its published API documentation at
 * /api-documentation; the logged-in listing form itself was NOT yet seen,
 * see the SELECTORS block):
 *
 *   - A classic Laravel + Bootstrap + jQuery site (CSRF meta tag, SweetAlert2
 *     v11 for dialogs). Login is a plain POST form at /login (#email,
 *     #password); the account home is /dashboard; "Sell Land" for a logged-in
 *     member goes to /add-a-listing (both bounce to /login when logged out;
 *     Laravel's guest middleware bounces a logged-in visit to /login away
 *     again, which is the agent's redirect_off signal). Public listing pages
 *     are /listing/<id>; a seller's public inventory is /user-listings/<uid>.
 *   - The listing record (from the API field contract, which a Laravel app
 *     shares with its web form): title (255), description (50,000), price,
 *     acres (two decimals), owner_financing, general_location (255),
 *     address, city, state (two-letter), county (must be one of the site's
 *     canonical names for the state, public lookup GET /api/counties/<ST>),
 *     postal_code, has_residence, mls_number, latitude + longitude,
 *     map_zoom, directions (20,000), custom_map_url, video_url.
 *   - Photos: JPEG/PNG/GIF, 10,485,760 bytes hard cap, 5 MB recommended.
 *     The cap per listing is the membership's: Free 1, Premium Standard 20,
 *     Premium Deluxe 100.
 *   - Membership gates publishing. A Free Account can only save listings as
 *     Unlisted; Premium Standard ($49.95/mo) or Premium Deluxe ($149.95/mo)
 *     is required for an Active listing. The poster reads the membership off
 *     the dashboard and refuses a real publish on a Free account before it
 *     touches the form (a dry run still fills the form and screenshots it).
 *   - A dry run fills the form and screenshots it without submitting, like
 *     the Landmodo poster: there is no draft concept to leave behind that
 *     the operator could not create by hand.
 *
 * Every field is found by a candidate list (name/id first, then the label
 * text), so when the real form differs, the fix is the SELECTORS block.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { Frame, Locator, Page } from 'playwright'
import {
  AdCopy,
  PostContext,
  PostOptions,
  PosterTask,
  PostResult,
  listPhotos,
  loadPlatformConfig,
  loginExpiredError,
  requireListingFacts,
  resolveLocation,
  saveProofScreenshot,
} from './post-common'
import { Financing, choosePhotos, financingFromTask, sameTitle } from './post-landmodo'
import { coordinatesFromTask } from './post-parcelview'

const PLATFORM = 'land_listings'
const SCRIPT = 'post-land_listings.ts'
const SITE = 'https://www.land-listings.com'

export type Membership = 'free' | 'standard' | 'deluxe' | 'unknown'

export const LANDLISTINGS_LIMITS = {
  /** The record's title column (API contract). The ad cap in config/ad-platforms.json is 100. */
  titleMaxChars: 255,
  /** The record's description column (API contract); the ad cap is 1500. */
  descriptionMaxChars: 50_000,
  generalLocationMaxChars: 255,
  directionsMaxChars: 20_000,
  /** Technical maximum per image from the API documentation. */
  maxPhotoBytes: 10_485_760,
  /** Per-listing photo cap by membership (premium-options page, 2026-10-05). */
  photosByMembership: { free: 1, standard: 20, deluxe: 100, unknown: 20 } as Record<Membership, number>,
}

/**
 * All Land-listings.com DOM knowledge lives here so a site redesign (or the
 * first look at the real logged-in form) is a one-file fix.
 *
 * UNVERIFIED: the listing form at /add-a-listing has not been seen logged
 * in. Field candidates are the API/database column names a Laravel Blade
 * form normally reuses, each followed by a label-text fallback. Run
 *   npx tsx recon-form.ts land_listings --login
 * on the machine with the session to dump the real fields, then correct
 * this block.
 */
export const LANDLISTINGS_SELECTORS = {
  dashboardUrl: `${SITE}/dashboard`,
  createUrl: `${SITE}/add-a-listing`,
  loginPath: '/login',
  listingUrl: (id: string | number) => `${SITE}/listing/${id}`,
  countiesUrl: (stateAbbr: string) => `${SITE}/api/counties/${stateAbbr}`,
  /** Present only when logged in (dashboard sidebar; Laravel's logout is a POST form). */
  loggedIn: '#dashboard-menu, form[action$="/logout"], a[href$="/logout"]',
  loginForm: 'form[action$="/login"] input[name="password"]',
  /** The listing form: the first form on the create page that carries a title field. */
  form: 'form:has([name="title"]), form:has(#title), form.myaccount-form, main form',
  fields: {
    title: { candidates: ['[name="title"]', '#title'], label: 'Title' },
    description: { candidates: ['[name="description"]', '#description'], label: 'Description' },
    price: { candidates: ['[name="price"]', '#price'], label: 'Price' },
    acres: { candidates: ['[name="acres"]', '#acres', '[name="acreage"]'], label: 'Acres' },
    ownerFinancing: { candidates: ['[name="owner_financing"]', '#owner_financing', '[name="owner_finance"]'], label: 'Owner Financing' },
    generalLocation: { candidates: ['[name="general_location"]', '#general_location'], label: 'General Location' },
    address: { candidates: ['[name="address"]', '#address'], label: 'Address' },
    city: { candidates: ['[name="city"]', '#city'], label: 'City' },
    state: { candidates: ['[name="state"]', '#state', '[name="state_id"]'], label: 'State' },
    county: { candidates: ['[name="county"]', '#county', '[name="county_id"]'], label: 'County' },
    postalCode: { candidates: ['[name="postal_code"]', '#postal_code', '[name="zip"]', '#zip'], label: 'Zip' },
    hasResidence: { candidates: ['[name="has_residence"]', '#has_residence'], label: 'Residence' },
    mlsNumber: { candidates: ['[name="mls_number"]', '#mls_number', '[name="mls"]'], label: 'MLS' },
    latitude: { candidates: ['[name="latitude"]', '#latitude', '[name="lat"]'], label: 'Latitude' },
    longitude: { candidates: ['[name="longitude"]', '#longitude', '[name="lng"]', '[name="lon"]'], label: 'Longitude' },
    directions: { candidates: ['[name="directions"]', '#directions'], label: 'Directions' },
    videoUrl: { candidates: ['[name="video_url"]', '#video_url'], label: 'Video' },
    /** Active vs Unlisted, when the form offers it (the membership may decide instead). */
    status: { candidates: ['[name="status"]', '#status', '[name="is_active"]'], label: 'Status' },
  } as Record<string, FieldSpec>,
  /** Rich-text editors the description may be hiding behind, in detection order. */
  editors: {
    quill: '.ql-editor',
    summernote: '.note-editable',
    ckeditor: '.ck-editor__editable',
    tinymceFrame: 'iframe.tox-edit-area__iframe, iframe[id$="_ifr"]',
    contentEditable: '[contenteditable="true"]',
  },
  photoInput: 'input[type="file"]',
  /** Uploaded photos as shown on the create/edit page (thumbnails in the upload box). */
  photoThumb: '.image-upload-div img, .uploaded-image img, .listing-images img, .dz-preview',
  submit: 'button[type="submit"], input[type="submit"]',
  /** Bootstrap validation and flash messages. */
  errors: '.invalid-feedback:visible, .alert-danger, .text-danger:visible, .is-invalid',
  flash: '.alert-success, .alert-info',
  swal: '.swal2-popup',
  swalTitle: '.swal2-title',
  swalBody: '.swal2-html-container',
  swalConfirm: '.swal2-confirm',
  swalCancel: '.swal2-cancel',
  /** Listing cards on the dashboard / seller page carry a link to /listing/<id>. */
  listingLink: 'a[href*="/listing/"]',
  editLink: 'a[href*="edit"]',
  sellerPageLink: 'a[href*="/user-listings/"]',
}

export interface FieldSpec {
  candidates: string[]
  label: string
}

export interface ListingCard {
  id: string
  title: string
  price: number | null
  acres: number | null
  status: 'active' | 'unlisted' | 'sold' | 'pending' | 'unknown'
  editUrl: string | null
  text: string
}

export async function postToLandListings(
  task: PosterTask,
  adCopy: AdCopy,
  opts: PostOptions & PostContext
): Promise<PostResult> {
  if (!(opts.platform ?? loadPlatformConfig(PLATFORM)).enabled) {
    throw new Error('Land-listings.com is not enabled in config/posting-platforms.json')
  }
  const log = opts.log ?? (() => {})
  const page = opts.page
  const facts = requireListingFacts(task)
  const location = await resolveLocation(facts.location)
  for (const w of location.warnings) log(`land_listings: location: ${w}`)
  const financing = financingFromTask(task, adCopy)
  const ownerFinanced = financing.downPaymentUsd !== null || financing.monthlyPaymentUsd !== null
  const title = titleForLandListings(task, adCopy.headline)
  const description = descriptionForLandListings(adCopy.description, log)
  const coords = coordinatesFromTask(task)
  watchDialogs(page, log)

  // 1. Dashboard: login check, membership, existing listings.
  log('land_listings: opening the dashboard')
  await page.goto(LANDLISTINGS_SELECTORS.dashboardUrl, { waitUntil: 'domcontentloaded' })
  await settle(page)
  if (await loggedOut(page)) throw loginExpiredError(PLATFORM, page.url())
  const bodyText = await page.locator('body').innerText().catch(() => '')
  const membership = membershipFromText(bodyText)
  const photoCap = photoCapFor(membership, task)
  log(`land_listings: membership reads as ${describeMembership(membership)}; photo cap ${photoCap}`)
  if (membership === 'free' && !opts.dryRun) {
    throw new Error(
      'Land-listings.com will not publish from a Free Account: free accounts can only save listings as Unlisted. ' +
        `Pick Premium Standard ($49.95/mo, 20 photos) or Premium Deluxe ($149.95/mo) at ${SITE}/premium-options, then Publish again. ` +
        '(A --dry-run still fills the form for inspection.)'
    )
  }
  const existing = await readListingCards(page)
  const sellerLink = await page.locator(LANDLISTINGS_SELECTORS.sellerPageLink).first().getAttribute('href').catch(() => null)
  if (existing.length === 0 && sellerLink) {
    await page.goto(sellerLink, { waitUntil: 'domcontentloaded' }).catch(() => {})
    await settle(page)
    existing.push(...(await readListingCards(page)))
  }
  log(
    `land_listings: ${existing.length} listing(s) found on the account: ` +
      (existing.map((c) => `${c.id} [${c.status}] ${c.title.slice(0, 40)}`).join('; ') || 'none')
  )
  const match = findListing(existing, title, facts.priceUsd, facts.acreage)
  if (match && match.status === 'active') {
    log(`land_listings: listing ${match.id} "${match.title}" is already Active (matched on ${match.matchedOn}); recording it, not creating another`)
    return finish(page, match.id, opts.outputDir, log)
  }
  if (match && match.status === 'sold') {
    throw new Error(
      `Land-listings.com already has listing ${match.id} "${match.title}" marked Sold (matched on ${match.matchedOn}). ` +
        `Reactivate it by hand at ${LANDLISTINGS_SELECTORS.listingUrl(match.id)}, then Publish again`
    )
  }

  // 2. The listing form: finish the matched Unlisted one when its edit page is known, else create.
  if (match && match.editUrl) {
    log(`land_listings: finishing unlisted listing ${match.id} "${match.title}" (matched on ${match.matchedOn}) at ${match.editUrl}`)
    await page.goto(match.editUrl, { waitUntil: 'domcontentloaded' })
  } else {
    if (match) log(`land_listings: listing ${match.id} matched but has no edit link on its card; creating a new one`)
    log('land_listings: opening the create form')
    await page.goto(LANDLISTINGS_SELECTORS.createUrl, { waitUntil: 'domcontentloaded' })
  }
  await settle(page)
  if (await loggedOut(page)) throw loginExpiredError(PLATFORM, page.url())
  const form = await requireForm(page)

  const counties = await countiesFor(page, location.stateAbbr, log)
  const county = pickCounty(counties, location.county)
  if (counties.length && !county) {
    log(`land_listings: NOTE "${location.county}" is not one of the site's ${counties.length} ${location.stateAbbr} counties; leaving County blank`)
  }

  const filled: string[] = []
  const missing: string[] = []
  const fill = async (key: string, value: string | null | undefined, kind: 'text' | 'select' | 'check' = 'text') => {
    if (value === null || value === undefined || value === '') return
    const ok = await fillSpec(page, form, key, value, kind)
    ;(ok ? filled : missing).push(key)
  }

  await fill('title', title)
  await fillDescription(page, form, description, log)
  await fill('price', String(facts.priceUsd))
  await fill('acres', String(roundAcres(facts.acreage)))
  await fill('ownerFinancing', ownerFinanced ? 'on' : 'off', 'check')
  await fill('generalLocation', generalLocationFor(task, location))
  await fill('address', stringMeta(task, 'address') ?? stringMeta(task, 'location_description'))
  await fill('city', stringMeta(task, 'city'))
  await fillState(page, form, location.stateAbbr, location.state, filled, missing)
  await fill('county', county ?? location.county, 'select')
  await fill('postalCode', stringMeta(task, 'zip') ?? stringMeta(task, 'postal_code'))
  await fill('hasResidence', 'off', 'check')
  await fill('mlsNumber', stringMeta(task, 'mls_number'))
  if (coords) {
    await fill('latitude', String(coords.latitude))
    await fill('longitude', String(coords.longitude))
  }
  await fill('directions', directionsFor(task))
  await fill('videoUrl', stringMeta(task, 'video_url') ?? stringMeta(task, 'youtube_url'))
  await fill('status', opts.dryRun ? 'Unlisted' : 'Active', 'select')
  log(`land_listings: filled ${filled.join(', ') || 'nothing'}${missing.length ? `; no control found for ${missing.join(', ')}` : ''}`)
  if (!filled.includes('title')) {
    throw new Error(
      `Could not find the title field on the Land-listings.com form at ${page.url()} ` +
        `(tried: ${LANDLISTINGS_SELECTORS.fields.title.candidates.join(', ')} and the label "${LANDLISTINGS_SELECTORS.fields.title.label}"). ` +
        `Update the SELECTORS block in ${SCRIPT}.`
    )
  }

  // 3. Photos on the form, when it has an uploader; the rest go on the edit page.
  const photos = eligiblePhotos(choosePhotos(listPhotos(opts.outputDir), stringMeta(task, 'primaryPhoto')), photoCap, log)
  let pending = photos
  const formInput = form.locator(LANDLISTINGS_SELECTORS.photoInput).first()
  if ((await formInput.count()) > 0) {
    pending = await attachPhotos(page, formInput, photos, log)
  } else {
    log('land_listings: no photo input on the form; photos go on the listing page after it is saved')
  }

  if (opts.dryRun) {
    log(`land_listings: dry run, form filled and left unsubmitted at ${page.url()}`)
    const screenshotPath = await saveProofScreenshot(page, opts.outputDir, PLATFORM)
    return { listingUrl: null, screenshotPath }
  }

  // 4. Submit and find the new listing's id.
  const before = new Set(existing.map((c) => c.id))
  await submitForm(page, form, log)
  let id = listingIdFromUrl(page.url())
  if (!id) {
    await page.goto(LANDLISTINGS_SELECTORS.dashboardUrl, { waitUntil: 'domcontentloaded' })
    await settle(page)
    const after = await readListingCards(page)
    const fresh = after.filter((c) => !before.has(c.id))
    const hit = findListing(fresh.length ? fresh : after, title, facts.priceUsd, facts.acreage)
    id = hit?.id ?? null
    if (hit?.editUrl && pending.length) {
      await page.goto(hit.editUrl, { waitUntil: 'domcontentloaded' })
      await settle(page)
    }
  }
  if (!id) {
    throw new Error(
      `The form was submitted but no listing titled "${title.slice(0, 60)}" appeared on the dashboard afterwards ` +
        `(landed on ${page.url()}). Check ${LANDLISTINGS_SELECTORS.dashboardUrl} by hand`
    )
  }
  log(`land_listings: listing ${id} saved`)

  // 5. Remaining photos on the saved listing's page, if it has an uploader.
  if (pending.length) {
    const input = page.locator(LANDLISTINGS_SELECTORS.photoInput).first()
    if ((await input.count()) > 0) {
      const left = await attachPhotos(page, input, pending, log)
      if (left.length) log(`land_listings: NOTE ${left.length} photo(s) not uploaded: ${left.map((p) => path.basename(p)).join(', ')}`)
    } else {
      log(`land_listings: NOTE no uploader on ${page.url()}; ${pending.length} photo(s) still to add by hand`)
    }
  }

  return finish(page, id, opts.outputDir, log, { expectTitle: title, membership })
}

// --- form helpers --------------------------------------------------------------

async function requireForm(page: Page): Promise<Locator> {
  for (const sel of LANDLISTINGS_SELECTORS.form.split(',').map((s) => s.trim())) {
    const loc = page.locator(sel).first()
    if ((await loc.count()) > 0) return loc
  }
  throw new Error(
    `The Land-listings.com listing form did not appear at ${page.url()} (tried: ${LANDLISTINGS_SELECTORS.form}). ` +
      `Update the SELECTORS block in ${SCRIPT}.`
  )
}

/** First visible control matching the spec's candidates, then its label text. */
async function findControl(form: Locator, spec: FieldSpec): Promise<Locator | null> {
  const selectors = [...spec.candidates, labelXpath(spec.label)]
  for (const sel of selectors) {
    const loc = form.locator(sel).first()
    if ((await loc.count()) === 0) continue
    const type = (await loc.getAttribute('type').catch(() => null)) ?? ''
    if (type === 'hidden') continue
    return loc
  }
  return null
}

/**
 * The control a label points at (its `for` id), else the first control after
 * a label starting with the given text. Relative paths (".//") so the lookup
 * stays inside the form locator it runs under.
 */
export function labelXpath(label: string): string {
  const l = label.replace(/"/g, '')
  const lbl = `.//label[starts-with(normalize-space(.), "${l}")]`
  return (
    `xpath=(.//*[(self::input or self::textarea or self::select) and @id = ${lbl}/@for]` +
    ` | ${lbl}/following::*[(self::input or self::textarea or self::select) and not(@type="hidden")][1])[1]`
  )
}

async function fillSpec(
  page: Page,
  form: Locator,
  key: string,
  value: string,
  kind: 'text' | 'select' | 'check'
): Promise<boolean> {
  const spec = LANDLISTINGS_SELECTORS.fields[key]
  const loc = await findControl(form, spec)
  if (!loc) return false
  const tag = (await loc.evaluate((el) => el.tagName).catch(() => '')).toUpperCase()
  const type = ((await loc.getAttribute('type').catch(() => null)) ?? '').toLowerCase()
  if (kind === 'check' || type === 'checkbox') {
    const want = value === 'on' || value === 'true' || value === '1'
    await loc.setChecked(want).catch(async () => {
      if ((await loc.isChecked().catch(() => !want)) !== want) await loc.click({ force: true })
    })
    return true
  }
  if (tag === 'SELECT') {
    const ok = await selectOption(loc, value)
    if (!ok) return false
    return true
  }
  if (type === 'radio') {
    const radio = form.locator(`input[type="radio"][name="${await loc.getAttribute('name')}"][value="${value}" i]`).first()
    if ((await radio.count()) === 0) return false
    await radio.check({ force: true })
    return true
  }
  await loc.fill(value)
  await loc.dispatchEvent('change').catch(() => {})
  return true
}

/** Picks a <select> option by label, then by value, case-insensitively. */
async function selectOption(loc: Locator, value: string): Promise<boolean> {
  const options = await loc.locator('option').evaluateAll((els) =>
    els.map((o) => ({ value: (o as HTMLOptionElement).value, label: (o.textContent ?? '').trim() }))
  )
  const want = value.trim().toLowerCase()
  const hit =
    options.find((o) => o.label.toLowerCase() === want) ??
    options.find((o) => o.value.toLowerCase() === want) ??
    options.find((o) => o.label.toLowerCase().replace(/\s+county$/, '') === want.replace(/\s+county$/, ''))
  if (!hit) return false
  await loc.selectOption(hit.value)
  await loc.dispatchEvent('change').catch(() => {})
  return true
}

/** State as a <select> (by code or name) or a text box (code). */
async function fillState(page: Page, form: Locator, abbr: string, name: string, filled: string[], missing: string[]): Promise<void> {
  const loc = await findControl(form, LANDLISTINGS_SELECTORS.fields.state)
  if (!loc) {
    missing.push('state')
    return
  }
  const tag = (await loc.evaluate((el) => el.tagName).catch(() => '')).toUpperCase()
  if (tag === 'SELECT') {
    const ok = (await selectOption(loc, abbr)) || (await selectOption(loc, name))
    ;(ok ? filled : missing).push('state')
    // A county <select> is often filled by ajax after the state changes.
    await page.waitForTimeout(1500)
    return
  }
  await loc.fill(abbr)
  filled.push('state')
}

/**
 * The description may be a plain textarea or a rich-text editor. A textarea
 * gets the text as-is (the site keeps the line breaks); an editor is typed
 * into so its own change handlers fire.
 */
async function fillDescription(page: Page, form: Locator, text: string, log: (m: string) => void): Promise<void> {
  const spec = LANDLISTINGS_SELECTORS.fields.description
  const textarea = await findControl(form, spec)
  const visibleTextarea = textarea && (await textarea.isVisible().catch(() => false)) ? textarea : null
  if (visibleTextarea) {
    await visibleTextarea.fill(text)
    await visibleTextarea.dispatchEvent('change').catch(() => {})
    return
  }
  const ed = LANDLISTINGS_SELECTORS.editors
  for (const [name, sel] of [
    ['quill', ed.quill],
    ['summernote', ed.summernote],
    ['ckeditor', ed.ckeditor],
    ['contenteditable', ed.contentEditable],
  ] as const) {
    const editor = page.locator(sel).first()
    if ((await editor.count()) === 0) continue
    log(`land_listings: description is a ${name} editor; typing into it`)
    await typeInto(page, editor, text)
    return
  }
  const frameEl = page.locator(ed.tinymceFrame).first()
  if ((await frameEl.count()) > 0) {
    const frame: Frame | null = await frameEl.elementHandle().then((h) => h?.contentFrame() ?? null)
    if (frame) {
      log('land_listings: description is a TinyMCE editor; typing into its frame')
      await typeInto(page, frame.locator('body'), text)
      return
    }
  }
  if (textarea) {
    // Hidden textarea behind an editor the detection missed: set it directly.
    log('land_listings: description textarea is hidden; setting its value directly')
    await textarea.evaluate((el, v) => {
      ;(el as HTMLTextAreaElement).value = v
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }, text)
    return
  }
  throw new Error(
    `Could not find the description field on the Land-listings.com form (tried: ${spec.candidates.join(', ')}, ` +
      `the label "${spec.label}", and the editors in SELECTORS.editors). Update the SELECTORS block in ${SCRIPT}.`
  )
}

async function typeInto(page: Page, target: Locator, text: string): Promise<void> {
  await target.click()
  await page.keyboard.press('Control+A')
  await page.keyboard.press('Delete')
  await page.keyboard.type(text, { delay: 1 })
}

/**
 * Attaches photos to a file input. A `multiple` input takes them all at
 * once; a single-file input takes the first, and the rest are returned for
 * the listing's edit page. Returns the photos still to upload.
 */
async function attachPhotos(page: Page, input: Locator, photos: string[], log: (m: string) => void): Promise<string[]> {
  if (photos.length === 0) return []
  const multiple = (await input.getAttribute('multiple').catch(() => null)) !== null
  const before = await page.locator(LANDLISTINGS_SELECTORS.photoThumb).count().catch(() => 0)
  if (multiple) {
    await input.setInputFiles(photos)
    await waitForThumbs(page, before, 30_000)
    log(`land_listings: attached ${photos.length} photo(s)`)
    return []
  }
  await input.setInputFiles([photos[0]])
  await waitForThumbs(page, before, 30_000)
  log(`land_listings: attached ${path.basename(photos[0])} (single-file input); ${photos.length - 1} more to add on the listing page`)
  // Some single inputs are reusable after each upload (ajax). Try the rest in turn.
  const rest = photos.slice(1)
  const left: string[] = []
  for (const photo of rest) {
    const seen = await page.locator(LANDLISTINGS_SELECTORS.photoThumb).count().catch(() => 0)
    const again = page.locator(LANDLISTINGS_SELECTORS.photoInput).first()
    if ((await again.count()) === 0) {
      left.push(photo, ...rest.slice(rest.indexOf(photo) + 1))
      break
    }
    await again.setInputFiles([photo]).catch(() => {})
    const landed = await waitForThumbs(page, seen, 20_000)
    if (!landed) {
      left.push(photo, ...rest.slice(rest.indexOf(photo) + 1))
      break
    }
    log(`land_listings: photo ${path.basename(photo)} uploaded`)
  }
  return left
}

async function waitForThumbs(page: Page, before: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const n = await page.locator(LANDLISTINGS_SELECTORS.photoThumb).count().catch(() => 0)
    if (n > before) return true
    await page.waitForTimeout(500)
  }
  return false
}

async function submitForm(page: Page, form: Locator, log: (m: string) => void): Promise<void> {
  const btn = form.locator(LANDLISTINGS_SELECTORS.submit).last()
  if ((await btn.count()) === 0) {
    throw new Error(`Could not find the submit button on the Land-listings.com form (tried: ${LANDLISTINGS_SELECTORS.submit}). Update the SELECTORS block in ${SCRIPT}.`)
  }
  const label = (await btn.innerText().catch(() => '')).trim() || (await btn.getAttribute('value').catch(() => '')) || 'submit'
  const urlBefore = page.url()
  await btn.scrollIntoViewIfNeeded().catch(() => {})
  await Promise.all([
    page.waitForLoadState('domcontentloaded', { timeout: 60_000 }).catch(() => {}),
    btn.click(),
  ])
  await page.waitForTimeout(1500)
  // A SweetAlert confirmation ("Publish this listing?") is answered yes once.
  const swal = page.locator(LANDLISTINGS_SELECTORS.swal).first()
  if ((await swal.count()) > 0 && (await swal.isVisible().catch(() => false))) {
    const text = [
      await swal.locator(LANDLISTINGS_SELECTORS.swalTitle).innerText().catch(() => ''),
      await swal.locator(LANDLISTINGS_SELECTORS.swalBody).innerText().catch(() => ''),
    ]
      .map((s) => s.trim())
      .filter(Boolean)
      .join(': ')
    log(`land_listings: dialog after "${label}": "${text.slice(0, 200)}"`)
    if (/error|fail|invalid|required|limit|upgrade|membership/i.test(text)) {
      throw new Error(`Land-listings.com answered "${text.slice(0, 300)}" after ${label}`)
    }
    const confirm = swal.locator(LANDLISTINGS_SELECTORS.swalConfirm).first()
    if ((await confirm.count()) > 0) {
      await Promise.all([
        page.waitForLoadState('domcontentloaded', { timeout: 60_000 }).catch(() => {}),
        confirm.click(),
      ])
      await page.waitForTimeout(1500)
    }
  }
  await settle(page)
  const errors = await page.locator(LANDLISTINGS_SELECTORS.errors).allInnerTexts().catch(() => [] as string[])
  const said = errors.map((e) => e.trim()).filter(Boolean)
  if (said.length) {
    throw new Error(`Land-listings.com rejected the form after ${label} at ${urlBefore}: ${said.slice(0, 5).join(' | ').slice(0, 400)}`)
  }
  const flash = (await page.locator(LANDLISTINGS_SELECTORS.flash).first().innerText().catch(() => '')).trim()
  log(`land_listings: ${label} -> ${page.url()}${flash ? ` "${flash.slice(0, 120)}"` : ''}`)
}

// --- reading the account ----------------------------------------------------------

/** Listing cards on the current page: each /listing/<id> link and the card text around it. */
export async function readListingCards(page: Page): Promise<ListingCard[]> {
  const raw = (await page
    .locator(LANDLISTINGS_SELECTORS.listingLink)
    .evaluateAll((links) => {
      const out: Array<{ href: string; text: string; edit: string | null }> = []
      const seen = new Set<string>()
      for (const a of links as HTMLAnchorElement[]) {
        const m = a.href.match(/\/listing\/(\d+)/)
        if (!m || seen.has(m[1])) continue
        seen.add(m[1])
        // Walk up to the card: the first ancestor whose text mentions a price or acres.
        let card: HTMLElement | null = a
        for (let i = 0; i < 6 && card; i++) {
          const t = card.innerText ?? ''
          if (/\$\s?[\d,]+/.test(t) && /acre/i.test(t)) break
          card = card.parentElement
        }
        const el = card ?? a
        const edit = Array.from(el.querySelectorAll('a[href]')).find((x) => /edit/i.test((x as HTMLAnchorElement).href)) as HTMLAnchorElement | undefined
        out.push({ href: a.href, text: (el.innerText ?? '').trim(), edit: edit?.href ?? null })
      }
      return out
    })
    .catch(() => [])) as Array<{ href: string; text: string; edit: string | null }>
  return raw.map((r) => parseListingCard(r.href, r.text, r.edit)).filter((c): c is ListingCard => c !== null)
}

/**
 * Reads a card like the public ones ("Listing id : #24839 ... $80,000 ...
 * 3.00 Acres +/- ... Status : Active"); the title is the first line that is
 * none of those facts.
 */
export function parseListingCard(href: string, text: string, editUrl: string | null = null): ListingCard | null {
  const m = href.match(/\/listing\/(\d+)/)
  if (!m) return null
  const lines = text
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  const priceM = text.match(/\$\s?([\d,]+(?:\.\d+)?)/)
  const acresM = text.match(/([\d,]+(?:\.\d+)?)\s*acres?\b/i)
  const statusM = text.match(/status\s*:?\s*([a-z ]+)/i)
  const status = statusOf(statusM?.[1] ?? '')
  const isFact = (l: string) =>
    /^(listing id|listed on|posted|status|mls|premium|view |\$|📞)/i.test(l) ||
    /^[\d,.]+\s*acres?\s*(\+\s*[/\\]\s*-)?$/i.test(l) ||
    /^(call seller|view details|view seller)/i.test(l) ||
    l.length < 4
  const title = lines.find((l) => !isFact(l)) ?? ''
  return {
    id: m[1],
    title,
    price: priceM ? Number(priceM[1].replace(/,/g, '')) : null,
    acres: acresM ? Number(acresM[1].replace(/,/g, '')) : null,
    status,
    editUrl,
    text,
  }
}

export function statusOf(s: string): ListingCard['status'] {
  const t = s.trim().toLowerCase()
  if (!t) return 'unknown'
  if (/^active|^published|^live/.test(t)) return 'active'
  if (/^sold/.test(t)) return 'sold'
  if (/pending|under contract/.test(t)) return 'pending'
  if (/unlisted|inactive|draft|unpublished/.test(t)) return 'unlisted'
  return 'unknown'
}

/** By title first, then price + acres; an Active card wins over an Unlisted twin. */
export function findListing(
  cards: ListingCard[],
  title: string,
  priceUsd: number,
  acreage: number
): (ListingCard & { matchedOn: string }) | null {
  const rank = (c: ListingCard) => (c.status === 'active' ? 0 : c.status === 'unlisted' ? 1 : 2)
  const byTitle = cards.filter((c) => c.title && sameTitle(c.title, title)).sort((a, b) => rank(a) - rank(b))
  if (byTitle.length) return { ...byTitle[0], matchedOn: 'title' }
  const byFacts = cards
    .filter((c) => c.price === priceUsd && c.acres !== null && Math.abs(c.acres - acreage) < 0.01)
    .sort((a, b) => rank(a) - rank(b))
  if (byFacts.length) return { ...byFacts[0], matchedOn: 'price + acres' }
  return null
}

/** The membership as the dashboard names it. */
export function membershipFromText(text: string): Membership {
  const t = text.replace(/\s+/g, ' ')
  if (/premium deluxe/i.test(t) && !/upgrade to premium deluxe|start premium deluxe|view premium deluxe/i.test(t)) return 'deluxe'
  if (/premium standard/i.test(t) && !/upgrade to premium standard|start premium standard|view premium standard/i.test(t)) return 'standard'
  if (/\b(deluxe (member|seller|listing|account))/i.test(t)) return 'deluxe'
  if (/\b(standard (member|seller|listing|account))/i.test(t)) return 'standard'
  if (/free account|free member|membership required|seller membership is required/i.test(t)) return 'free'
  return 'unknown'
}

export function describeMembership(m: Membership): string {
  return { free: 'Free Account (cannot publish)', standard: 'Premium Standard', deluxe: 'Premium Deluxe', unknown: 'unknown (no membership text on the dashboard)' }[m]
}

export function photoCapFor(membership: Membership, task?: PosterTask): number {
  const n = task ? numberMeta(task, 'land_listings_max_photos') : undefined
  const cap = LANDLISTINGS_LIMITS.photosByMembership[membership]
  return n !== undefined && n > 0 ? Math.min(Math.floor(n), cap) : cap
}

/** The site's canonical county names for a state (public JSON, same origin). */
async function countiesFor(page: Page, stateAbbr: string, log: (m: string) => void): Promise<string[]> {
  const url = LANDLISTINGS_SELECTORS.countiesUrl(stateAbbr.toUpperCase())
  try {
    const body = (await page.evaluate(async (u) => {
      const r = await fetch(u, { headers: { Accept: 'application/json' }, credentials: 'same-origin' })
      return r.ok ? r.json() : null
    }, url)) as { data?: Array<{ county?: string }> } | null
    const names = (body?.data ?? []).map((c) => c.county ?? '').filter(Boolean)
    if (!names.length) log(`land_listings: county lookup ${url} returned no counties`)
    return names
  } catch (err) {
    log(`land_listings: county lookup failed (${err instanceof Error ? err.message : err}); using the task's county as-is`)
    return []
  }
}

/** The canonical spelling of a county from the site's list, or null when absent. */
export function pickCounty(canonical: string[], county: string): string | null {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/\s+(county|parish|borough)$/i, '')
      .replace(/^st\.?\s/, 'saint ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
  const want = norm(county)
  return canonical.find((c) => norm(c) === want) ?? null
}

// --- finishing -------------------------------------------------------------------------

async function finish(
  page: Page,
  id: string,
  outputDir: string,
  log: (m: string) => void,
  check?: { expectTitle: string; membership: Membership }
): Promise<PostResult> {
  const listingUrl = publicListingUrl(id)
  const res = await page.goto(listingUrl, { waitUntil: 'domcontentloaded' }).catch(() => null)
  await page.waitForTimeout(1500)
  const status = res?.status() ?? 0
  const body = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ')
  const screenshotPath = await saveProofScreenshot(page, outputDir, PLATFORM)
  if (check) {
    const probe = check.expectTitle.replace(/\s+/g, ' ').slice(0, 40).toLowerCase()
    const shown = status < 400 && body.toLowerCase().includes(probe)
    if (!shown) {
      throw new Error(
        `Listing ${id} was saved but ${listingUrl} does not show it publicly (HTTP ${status || 'n/a'}` +
          (/unlisted|not published|inactive/i.test(body) ? ', the page says it is unlisted' : '') +
          `). ${check.membership === 'free' ? 'A Free Account cannot publish; ' : ''}` +
          `set it Active from ${LANDLISTINGS_SELECTORS.dashboardUrl} (membership at ${SITE}/premium-options), then Publish again`
      )
    }
  }
  log(`land_listings: listing ${id} is live at ${listingUrl}`)
  return { listingUrl, screenshotPath }
}

export function publicListingUrl(id: string | number): string {
  return LANDLISTINGS_SELECTORS.listingUrl(id)
}

/** The listing id from a post-submit URL (/listing/123, /listing/123/edit, /edit-listing/123, ?id=123). */
export function listingIdFromUrl(url: string): string | null {
  const m = url.match(/\/listing\/(\d+)/) ?? url.match(/\/(?:edit-listing|listings?\/edit|edit)\/(\d+)/) ?? url.match(/[?&](?:id|listing_id|listing)=(\d+)/)
  return m ? m[1] : null
}

// --- page utilities --------------------------------------------------------------

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded').catch(() => {})
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {})
  await page.waitForTimeout(500)
}

/** Logged-out account pages bounce to /login, which carries the password box. */
async function loggedOut(page: Page): Promise<boolean> {
  const u = new URL(page.url())
  if (u.pathname.startsWith(LANDLISTINGS_SELECTORS.loginPath)) return true
  if ((await page.locator(LANDLISTINGS_SELECTORS.loggedIn).count()) > 0) return false
  return (await page.locator(LANDLISTINGS_SELECTORS.loginForm).count()) > 0
}

function watchDialogs(page: Page, log: (m: string) => void): void {
  page.on('dialog', (d) => {
    log(`land_listings: page dialog (${d.type()}): ${d.message().slice(0, 160)}`)
    d.accept().catch(() => {})
  })
}

// --- pure helpers (unit-tested) ------------------------------------------------

/** metadata.land_listings_headline overrides the ad headline; the site's column is 255. */
export function titleForLandListings(task: PosterTask, headline: string): string {
  const override = stringMeta(task, 'land_listings_headline')
  const t = (override ?? headline).replace(/\s+/g, ' ').trim()
  return t.length > LANDLISTINGS_LIMITS.titleMaxChars ? t.slice(0, LANDLISTINGS_LIMITS.titleMaxChars).trim() : t
}

/** Plain text with the ad's paragraphs and "- " bullets kept; the column takes 50,000. */
export function descriptionForLandListings(description: string, log: (m: string) => void = () => {}): string {
  const text = description.replace(/\r\n/g, '\n').trim()
  if (text.length <= LANDLISTINGS_LIMITS.descriptionMaxChars) return text
  log(`land_listings: description is ${text.length} chars; cutting to ${LANDLISTINGS_LIMITS.descriptionMaxChars}`)
  return text.slice(0, LANDLISTINGS_LIMITS.descriptionMaxChars).trim()
}

/** "Approximately 11 miles from Fairplay" style line: metadata.general_location, else "<County> County, <ST>". */
export function generalLocationFor(task: PosterTask, location: { county: string; stateAbbr: string }): string {
  const explicit = stringMeta(task, 'general_location') ?? stringMeta(task, 'location_description')
  const t = (explicit ?? `${location.county} County, ${location.stateAbbr}`).replace(/\s+/g, ' ').trim()
  return t.slice(0, LANDLISTINGS_LIMITS.generalLocationMaxChars)
}

/** metadata.directions, else the access note when it reads like driving directions. */
export function directionsFor(task: PosterTask): string | undefined {
  const explicit = stringMeta(task, 'directions')
  if (explicit) return explicit.slice(0, LANDLISTINGS_LIMITS.directionsMaxChars)
  const access = stringMeta(task, 'access_notes') ?? stringMeta(task, 'directions_notes')
  return access?.slice(0, LANDLISTINGS_LIMITS.directionsMaxChars)
}

/** The site takes two decimals. */
export function roundAcres(acres: number): number {
  return Math.round((acres + Number.EPSILON) * 100) / 100
}

/** Photos the uploader accepts (JPEG/PNG/GIF under the byte cap), capped at the membership's count. */
export function eligiblePhotos(photos: string[], cap: number, log: (m: string) => void = () => {}): string[] {
  const ok: string[] = []
  for (const p of photos) {
    if (!/\.(jpe?g|png|gif)$/i.test(p)) {
      log(`land_listings: skipping ${path.basename(p)} (the uploader takes JPG, PNG and GIF only)`)
      continue
    }
    let size = 0
    try {
      size = fs.statSync(p).size
    } catch {
      continue
    }
    if (size > LANDLISTINGS_LIMITS.maxPhotoBytes) {
      log(`land_listings: skipping ${path.basename(p)} (${(size / 1024 / 1024).toFixed(1)} MB, over the 10 MB cap)`)
      continue
    }
    ok.push(p)
  }
  if (ok.length > cap) log(`land_listings: ${ok.length} photos; the membership allows ${cap}, sending the first ${cap}`)
  return ok.slice(0, cap)
}

export function ownerFinancingFor(financing: Financing): boolean {
  return financing.downPaymentUsd !== null || financing.monthlyPaymentUsd !== null
}

function stringMeta(task: PosterTask, key: string): string | undefined {
  const v = task.metadata?.[key]
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

function numberMeta(task: PosterTask, key: string): number | undefined {
  const v = task.metadata?.[key]
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v)
  return undefined
}
