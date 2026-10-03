/**
 * Posts one approved ad to Land.com through its Marketing Hub
 * (market.land.com), mapped against the live app on 2026-10-03.
 *
 * Usage: npm run post -- land_com <taskId> [--dry-run]
 *
 * Drives an already-authenticated page handed in by the caller (the local
 * poster agent's headed browser, or post.ts's headless one built from the
 * saved auth/<platform>.json session). The caller owns the browser lifecycle.
 *
 * The hub is a single-page React app:
 *
 *   1. Listing Manager (hub root). An ag-grid of the member's listings with
 *      Active / Draft / Off Market / Sold tabs. Read first, for three reasons:
 *      the account allows a fixed number of Active listings (5), a listing
 *      for the same lot may already exist by hand, and a half-finished draft
 *      from an earlier run should be finished rather than duplicated.
 *   2. Add Listing -> location step. Switched to Lat/Long mode and fed the
 *      task's coordinates; the app fills city/state/county/zip from the
 *      point and also guesses a street address by reverse geocoding, which
 *      is usually a neighbour's house number on vacant land. The poster
 *      overwrites it with a location description (the field is required).
 *      Confirm Location creates a Draft and opens the editor.
 *   3. Editor at /listing/edit/<id>. Plain inputs with stable names: Price,
 *      Acres, owner-financing checkbox, Title, Description textarea, a
 *      multi-file photo input, property-type toggle buttons, Publish Changes.
 *
 * Nothing is paid: listings are free on this account, the cap is on Active
 * count only, and drafts do not count.
 */
import type { Locator, Page } from 'playwright'
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
  saveProofScreenshot,
  resolveLocation,
} from './post-common'
import { choosePhotos, financingFromTask, sameTitle } from './post-landmodo'

const PLATFORM = 'land_com'
const SCRIPT = 'post-land_com.ts'
const HUB = 'https://market.land.com'

export const LAND_COM_LIMITS = {
  /** Active listings allowed on the account (metadata.land_com_active_cap overrides). */
  activeCap: 5,
  /** Photos sent per listing (the app shows no hard cap; it nudges toward 16). */
  maxPhotos: 20,
}

export const PROPERTY_TYPES = [
  'Farm', 'Ranch', 'Recreational', 'Residential', 'Timber', 'Undeveloped', 'Commercial',
  'Hunting', 'Horse', 'Lakefront', 'Beachfront', 'Riverfront',
]
export const ACTIVITIES = [
  'Aviation', 'Beach', 'Boating', 'Camping', 'Canoeing/Kayaking', 'Conservation', 'Fishing',
  'Horseback Riding', 'Hunting', 'Off-roading', 'RVing', 'Golfing', 'Aquatic Sporting', 'Skiing',
]

/**
 * All Land.com DOM knowledge lives here so a site redesign is a one-file fix.
 * Verified against the live Marketing Hub (recon-form.ts dumps).
 */
export const LAND_COM_SELECTORS = {
  hubUrl: `${HUB}/`,
  // The hub shows its sign-in form at the root URL.
  loginForm: 'form#login, input#login-password',
  loggedIn: 'button:has-text("Add Listing")',

  // --- Listing Manager grid ---
  tab: (name: string) => `button:has-text("${name}")`,
  row: '.ag-row[row-id]',
  rowEditMenu: '[data-testid="tippy-toggle-button"]',
  viewOnNetwork: 'button:has-text("View on Land Network")',

  // --- location step ---
  addListing: 'button:has-text("Add Listing")',
  placesSearch: '#places-autocomplete',
  modeAddress: '[role="button"]:has-text("Address")',
  modeLatLong: '[role="button"]:has-text("Lat/Long")',
  latitude: '#latitude',
  longitude: '#longitude',
  latLongSearch: 'xpath=//input[@id="longitude"]/following::button[1]',
  streetAddress: '#address',
  zip: '#zip',
  confirmLocation: 'button:has-text("Confirm Location")',
  fieldError: 'text=/This field is required/i',

  // --- editor ---
  editUrl: (id: string) => `${HUB}/listing/edit/${id}`,
  price: 'input[name="Price"]',
  acres: 'input[name="Acres"]',
  ownerFinancing: 'input[name="Is Owner Financing Available"]',
  ownerFinancingLabel: 'text=Is Owner Financing Available',
  title: 'input[name="Title"]',
  description: 'textarea[name="Description"]',
  photoInput: 'input#imageUploadText',
  photoThumb: 'button[aria-label="Make Cover Photo"], button[aria-label="Cover Photo"]',
  save: 'button:text-is("Save")',
  savedIndicator: 'text=/no unsaved changes/i',
  publish: 'button:has-text("Publish Changes")',
  validation: '[role="alert"], text=/required|invalid|must be/i',
}

const EDIT_URL_RE = /\/listing\/edit\/(\d+)/

export interface HubRow {
  id: string
  title: string
  city: string | null
  stateAbbr: string | null
  priceUsd: number | null
  acres: number | null
  status: string
}

export async function postToLandCom(
  task: PosterTask,
  adCopy: AdCopy,
  opts: PostOptions & PostContext
): Promise<PostResult> {
  const config = opts.platform ?? loadPlatformConfig(PLATFORM)
  const log = opts.log ?? (() => {})
  const facts = requireListingFacts(task)
  const location = await resolveLocation(facts.location)
  for (const w of location.warnings) log(`land_com: location: ${w}`)
  const coords = coordinatesFromTask(task)
  const financing = financingFromTask(task, adCopy)
  const ownerFinanced = financing.downPaymentUsd !== null || financing.monthlyPaymentUsd !== null
  const page = opts.page
  const cap = numberMeta(task, 'land_com_active_cap') ?? LAND_COM_LIMITS.activeCap

  // 1. Listing Manager: existing listing? draft to finish? room under the cap?
  log(`land_com: opening the Marketing Hub`)
  await page.goto(config.new_listing_url || LAND_COM_SELECTORS.hubUrl, { waitUntil: 'domcontentloaded' })
  await waitForHub(page)
  if (await onLoginPage(page)) throw loginExpiredError(PLATFORM, page.url())
  if ((await page.locator(LAND_COM_SELECTORS.loggedIn).count()) === 0) {
    throw new Error(
      `The Marketing Hub loaded at ${page.url()} (title "${await page.title()}") but shows neither the listings ` +
        `page nor a login form. Update the SELECTORS block in ${SCRIPT}.`
    )
  }

  const activeCount = await readTabCount(page, 'Active')
  log(`land_com: hub open, ${activeCount ?? '?'} active listing(s), cap ${cap}`)
  const rows = await readAllRows(page)
  log(`land_com: ${rows.length} row(s) across All Listings + Draft: ${rows.map((r) => `${r.id} [${r.status || '?'}] ${r.title.slice(0, 40)}`).join('; ') || 'none'}`)
  const match = findMatch(rows, adCopy.headline, facts.priceUsd, facts.acreage, location.stateAbbr)

  if (match && isActive(match.status)) {
    log(`land_com: listing ${match.id} "${match.title}" is already active for this lot (matched on ${match.matchedOn}); recording it, not creating another`)
    return finish(page, match.id, opts.outputDir, log)
  }

  let listingId: string
  let freshDraft = false
  if (match && /draft/i.test(match.status)) {
    log(`land_com: finishing existing draft ${match.id} "${match.title}" (matched on ${match.matchedOn})`)
    listingId = match.id
    await page.goto(LAND_COM_SELECTORS.editUrl(listingId), { waitUntil: 'domcontentloaded' })
    await page.locator(LAND_COM_SELECTORS.title).first().waitFor({ state: 'visible', timeout: 30_000 })
  } else {
    if (activeCount !== null && activeCount >= cap) {
      throw new Error(
        `Land.com account already has ${activeCount} active listings (cap ${cap}). ` +
          `Take one Off Market in the Marketing Hub, then Publish again`
      )
    }
    listingId = await createDraftAtLocation(page, coords, locationDescription(task, location), log)
    freshDraft = true
    log(`land_com: created draft ${listingId}`)
  }

  // 3. Editor. Photos first: when an upload finishes the editor reloads
  // itself from the server and drops any unsaved text, so text goes last.
  log(`land_com: filling the editor for ${listingId}`)
  const photos = choosePhotos(listPhotos(opts.outputDir), stringMeta(task, 'primaryPhoto')).slice(
    0,
    LAND_COM_LIMITS.maxPhotos
  )
  const already = await page.locator(LAND_COM_SELECTORS.photoThumb).count()
  if (already > 0) {
    log(`land_com: draft already shows ${already} photo(s); not uploading again`)
  } else if (photos.length > 0) {
    log(`land_com: uploading ${photos.length} photo(s)`)
    await uploadPhotos(page, photos, log)
    await page.waitForTimeout(3000)
  }

  // A selected toggle shows a count badge after its label ("Undeveloped1"),
  // which is the only readable selected state, so clicks are idempotent.
  for (const t of propertyTypesFromTask(task)) await ensureToggle(page, t, 'property type', log)
  for (const a of activitiesFromTask(task)) await ensureToggle(page, a, 'activity', log)
  void freshDraft

  await fillText(page, LAND_COM_SELECTORS.price, String(facts.priceUsd), 'price')
  await fillText(page, LAND_COM_SELECTORS.acres, String(facts.acreage), 'acres')
  if (ownerFinanced) await setOwnerFinancing(page, log)
  await fillText(page, LAND_COM_SELECTORS.title, adCopy.headline, 'title')
  await fillText(page, LAND_COM_SELECTORS.description, adCopy.description, 'description')
  // Make sure nothing reset the text before we save.
  const titleNow = await page.locator(LAND_COM_SELECTORS.title).first().inputValue().catch(() => '')
  if (!sameTitle(titleNow, adCopy.headline)) {
    throw new Error(`The title field reads "${titleNow}" right after filling it; the editor is resetting fields. Update ${SCRIPT}.`)
  }

  if (opts.dryRun) {
    await saveAndVerify(page, listingId, adCopy.headline, log)
    log(`land_com: dry run, leaving draft ${listingId} filled, saved and unpublished in the Marketing Hub`)
    const screenshotPath = await saveProofScreenshot(page, opts.outputDir, PLATFORM)
    return { listingUrl: null, screenshotPath }
  }

  // Publish. Text fields only persist on Save, and Publish Changes stays
  // disabled until the draft is saved, so save first and prove it landed.
  await saveAndVerify(page, listingId, adCopy.headline, log)
  const publish = page.locator(LAND_COM_SELECTORS.publish).first()
  await publish.waitFor({ state: 'visible', timeout: 15_000 })
  const publishDeadline = Date.now() + 20_000
  while (!(await publish.isEnabled().catch(() => false)) && Date.now() < publishDeadline) {
    await page.waitForTimeout(500)
  }
  if (!(await publish.isEnabled().catch(() => false))) {
    const errors = await visibleTexts(page, LAND_COM_SELECTORS.validation)
    throw new Error(
      `Publish Changes stayed disabled after saving draft ${listingId}` +
        (errors.length ? `: ${errors.slice(0, 5).join(' | ')}` : '. Open it in the Marketing Hub to see what it still needs')
    )
  }
  log('land_com: clicking Publish Changes')
  await publish.click()
  await page.waitForTimeout(3000)
  const errors = await visibleTexts(page, LAND_COM_SELECTORS.validation)
  if (errors.length > 0 && !/published|success/i.test(errors.join(' '))) {
    throw new Error(`Land.com did not accept the listing: ${errors.slice(0, 5).join(' | ')}`)
  }
  await page.goto(LAND_COM_SELECTORS.hubUrl, { waitUntil: 'domcontentloaded' })
  await waitForHub(page)
  const after = (await readAllRows(page)).find((r) => r.id === listingId)
  if (!after) throw new Error(`Published listing ${listingId} but it is missing from the Listing Manager grid`)
  if (!isActive(after.status)) {
    throw new Error(
      `Listing ${listingId} is still "${after.status}" after Publish Changes. Open ${LAND_COM_SELECTORS.editUrl(listingId)} ` +
        `in the Marketing Hub to see what it still wants, then Publish again`
    )
  }
  log(`land_com: listing ${listingId} is ${after.status}`)
  return finish(page, listingId, opts.outputDir, log)
}

// --- steps ---------------------------------------------------------------------

async function createDraftAtLocation(
  page: Page,
  coords: { latitude: number; longitude: number } | null,
  description: string,
  log: (m: string) => void
): Promise<string> {
  if (!coords) {
    throw new Error(
      `Land.com needs the parcel's coordinates: add "latitude" and "longitude" to the task metadata and Publish again`
    )
  }
  log('land_com: clicking Add Listing')
  await page.locator(LAND_COM_SELECTORS.addListing).first().click()
  // The location step opens in Address mode: the address search box is
  // visible and the coordinate boxes exist but are hidden until the mode
  // switch. Wait for the visible one.
  await page.locator(LAND_COM_SELECTORS.placesSearch).first().waitFor({ state: 'visible', timeout: 30_000 })

  // Switch the search box from Address to Lat/Long.
  log('land_com: switching the location search to Lat/Long')
  await page.locator(LAND_COM_SELECTORS.modeAddress).first().click()
  await page.locator(LAND_COM_SELECTORS.modeLatLong).first().waitFor({ state: 'visible', timeout: 10_000 })
  await page.locator(LAND_COM_SELECTORS.modeLatLong).first().click()
  await page.locator(LAND_COM_SELECTORS.latitude).first().waitFor({ state: 'visible', timeout: 15_000 })
  await page.waitForTimeout(300)

  log(`land_com: entering coordinates ${coords.latitude}, ${coords.longitude}`)
  const latBox = page.locator(LAND_COM_SELECTORS.latitude).first()
  const lonBox = page.locator(LAND_COM_SELECTORS.longitude).first()
  await latBox.click()
  await latBox.pressSequentially(String(coords.latitude), { delay: 30 })
  await lonBox.click()
  await lonBox.pressSequentially(String(coords.longitude), { delay: 30 })
  await page.locator(LAND_COM_SELECTORS.latLongSearch).first().click()

  const street = page.locator(LAND_COM_SELECTORS.streetAddress).first()
  await street.waitFor({ state: 'visible', timeout: 30_000 })
  log('land_com: location details appeared')
  await page.waitForTimeout(1000)
  const guessed = await street.inputValue().catch(() => '')
  if (guessed) log(`land_com: replacing the reverse-geocoded street "${guessed}" with "${description}"`)
  await street.fill(description)
  await street.press('Tab')

  log('land_com: confirming location')
  const confirm = page.locator(LAND_COM_SELECTORS.confirmLocation).first()
  await confirm.click()
  try {
    await page.waitForURL((u) => EDIT_URL_RE.test(u.toString()), { timeout: 45_000 })
  } catch {
    const errs = await visibleTexts(page, LAND_COM_SELECTORS.fieldError)
    throw new Error(
      `Confirm Location did not open the editor` + (errs.length ? `: ${errs.join(' | ')}` : ' (no error shown)')
    )
  }
  const id = page.url().match(EDIT_URL_RE)?.[1]
  if (!id) throw new Error(`Unexpected editor URL ${page.url()}`)
  await page.locator(LAND_COM_SELECTORS.title).first().waitFor({ state: 'visible', timeout: 30_000 })
  return id
}

async function fillText(page: Page, selector: string, value: string, fieldName: string): Promise<void> {
  const loc = page.locator(selector).first()
  if ((await loc.count()) === 0) {
    throw new Error(
      `Could not find the ${fieldName} field in the Land.com editor (tried: ${selector}). ` +
        `Update the SELECTORS block in ${SCRIPT}.`
    )
  }
  await loc.scrollIntoViewIfNeeded().catch(() => {})
  await loc.fill(value)
  await loc.press('Tab')
  const got = (await loc.inputValue().catch(() => '')).replace(/[$,\s]/g, '')
  if (!got) throw new Error(`The ${fieldName} field stayed empty after filling it`)
}

async function setOwnerFinancing(page: Page, log: (m: string) => void): Promise<void> {
  const box = page.locator(LAND_COM_SELECTORS.ownerFinancing).first()
  if ((await box.count()) === 0) {
    log('land_com: no owner-financing checkbox found; skipping')
    return
  }
  const checked = async () => (await box.getAttribute('aria-checked')) === 'true' || (await box.isChecked().catch(() => false))
  if (await checked()) return
  await page.locator(LAND_COM_SELECTORS.ownerFinancingLabel).first().click()
  await page.waitForTimeout(300)
  if (!(await checked())) {
    await box.check({ force: true }).catch(() => {})
  }
  if (!(await checked())) log('land_com: could not tick "Is Owner Financing Available"; continuing without it')
}

/**
 * Selects a property-type or activity toggle by its accessible name. The
 * label text lives in a child element, so match the button's name, not its
 * own text. "Hunting" exists in both groups; activities take the second.
 */
async function ensureToggle(page: Page, name: string, kind: string, log: (m: string) => void): Promise<void> {
  const pattern = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\s*\d*$`)
  // Match on the button's visible content (label plus optional count
  // badge), not its accessible name: an aria-labelled overlay button with no
  // text also answers to the name and reports nothing useful.
  const all = page.locator('button').filter({ hasText: pattern })
  const index = kind === 'activity' && PROPERTY_TYPES.includes(name) ? 1 : 0
  if ((await all.count()) <= index) throw new Error(`No ${kind} button labelled "${name}" in the Land.com editor`)
  const btn = all.nth(index)
  // The badge is in the button's content (textContent) but not always in
  // its rendered innerText, so read the content.
  const content = async () => ((await btn.evaluate((el) => el.textContent ?? '').catch(() => '')) as string).trim()
  const before = await content()
  if (/\d$/.test(before)) {
    log(`land_com: ${kind} "${name}" already selected`)
    return
  }
  await btn.scrollIntoViewIfNeeded().catch(() => {})
  await btn.click()
  let after = ''
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(250)
    after = await content()
    if (/\d$/.test(after)) break
  }
  log(`land_com: ${kind} "${name}" ${/\d$/.test(after) ? 'selected' : `clicked (content now "${after}")`}`)
}

async function uploadPhotos(page: Page, photos: string[], log: (m: string) => void): Promise<void> {
  const input = page.locator(LAND_COM_SELECTORS.photoInput).first()
  if ((await input.count()) === 0) {
    throw new Error(
      `Could not find the photo input in the Land.com editor (tried: ${LAND_COM_SELECTORS.photoInput}). ` +
        `Update the SELECTORS block in ${SCRIPT}.`
    )
  }
  await input.setInputFiles(photos)
  const want = photos.length
  const deadline = Date.now() + 240_000
  let seen = 0
  while (Date.now() < deadline) {
    seen = await page.locator(LAND_COM_SELECTORS.photoThumb).count()
    if (seen >= want) break
    await page.waitForTimeout(2000)
  }
  if (seen === 0) throw new Error(`No photo thumbnails appeared after uploading ${want} file(s)`)
  log(`land_com: ${seen} of ${want} photo(s) showing in the editor`)
  if (seen < want) log(`land_com: NOTE ${want - seen} photo(s) did not show within 4 minutes; check the Photos tab`)
}

/** Resolve the public URL (via the row's "View on Land Network"), screenshot it, return. */
async function finish(page: Page, id: string, outputDir: string, log: (m: string) => void): Promise<PostResult> {
  let listingUrl: string | null = null
  try {
    await page.goto(LAND_COM_SELECTORS.hubUrl, { waitUntil: 'domcontentloaded' })
    await waitForHub(page)
    await page.locator(LAND_COM_SELECTORS.tab('All Listings')).first().click().catch(() => {})
    await page.waitForTimeout(1500)
    const row = page.locator(`${LAND_COM_SELECTORS.row}[row-id="${id}"]`).first()
    await row.locator(LAND_COM_SELECTORS.rowEditMenu).first().click()
    const view = page.locator(LAND_COM_SELECTORS.viewOnNetwork).first()
    await view.waitFor({ state: 'visible', timeout: 10_000 })
    const popupPromise = page.context().waitForEvent('page', { timeout: 15_000 }).catch(() => null)
    await view.click()
    const popup = await popupPromise
    if (popup) {
      await popup.waitForLoadState('domcontentloaded').catch(() => {})
      listingUrl = popup.url()
      await popup.close().catch(() => {})
    } else if (!page.url().startsWith(HUB)) {
      listingUrl = page.url()
    }
  } catch (err) {
    log(`land_com: could not open "View on Land Network" for ${id}: ${err instanceof Error ? err.message.split('\n')[0] : err}`)
  }
  if (!listingUrl || listingUrl.startsWith(HUB)) {
    listingUrl = LAND_COM_SELECTORS.editUrl(id)
    log(`land_com: reporting the Marketing Hub edit URL for ${id}; the public URL was not available`)
  }
  await page.goto(listingUrl, { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForTimeout(1500)
  const screenshotPath = await saveProofScreenshot(page, outputDir, PLATFORM)
  return { listingUrl, screenshotPath }
}

// --- hub helpers ---------------------------------------------------------------

async function waitForHub(page: Page): Promise<void> {
  await page
    .locator(`${LAND_COM_SELECTORS.loggedIn}, ${LAND_COM_SELECTORS.loginForm}`)
    .first()
    .waitFor({ state: 'visible', timeout: 30_000 })
    .catch(() => {})
  await page.waitForTimeout(1000)
}

async function onLoginPage(page: Page): Promise<boolean> {
  if (/\/login|\/signin/i.test(page.url())) return true
  return (await page.locator(LAND_COM_SELECTORS.loginForm).count()) > 0
}

async function readTabCount(page: Page, tab: string): Promise<number | null> {
  const text = await page.locator(LAND_COM_SELECTORS.tab(tab)).first().innerText().catch(() => '')
  const m = text.match(/\((\d+)\)/)
  return m ? Number(m[1]) : null
}

/** All Listings leaves drafts out, so read that tab and the Draft tab and merge. */
async function readAllRows(page: Page): Promise<HubRow[]> {
  const seen = new Map<string, HubRow>()
  for (const tab of ['All Listings', 'Draft']) {
    const btn = page.locator(LAND_COM_SELECTORS.tab(tab)).first()
    if ((await btn.count()) === 0) continue
    await btn.click().catch(() => {})
    await page.waitForTimeout(1500)
    for (const r of await readHubRows(page)) {
      const prev = seen.get(r.id)
      // The Draft tab is authoritative for status when both list a row.
      if (!prev || tab === 'Draft') seen.set(r.id, { ...r, status: r.status || (tab === 'Draft' ? 'Draft' : prev?.status ?? '') })
    }
  }
  return [...seen.values()]
}

/**
 * Presses Save, waits for the editor to report nothing unsaved, surfaces any
 * validation text, then reloads the editor and checks the title persisted.
 * Throws with what it saw when the save did not stick.
 */
async function saveAndVerify(page: Page, listingId: string, expectedTitle: string, log: (m: string) => void): Promise<void> {
  const pressed = await clickIfEnabled(page, LAND_COM_SELECTORS.save, log)
  if (!pressed) log('land_com: Save was not enabled (nothing to save, or the editor is not ready)')
  const indicator = page.locator(LAND_COM_SELECTORS.savedIndicator).first()
  const settled = await indicator
    .waitFor({ state: 'visible', timeout: 30_000 })
    .then(() => true)
    .catch(() => false)
  const complaints = await visibleTexts(page, LAND_COM_SELECTORS.validation)
  if (complaints.length > 0) log(`land_com: editor messages after Save: ${complaints.slice(0, 6).join(' | ')}`)
  log(`land_com: after Save the editor ${settled ? 'reports no unsaved changes' : 'never reported "no unsaved changes" within 30s'}`)
  await page.waitForTimeout(1500)

  await page.goto(LAND_COM_SELECTORS.editUrl(listingId), { waitUntil: 'domcontentloaded' })
  const titleBox = page.locator(LAND_COM_SELECTORS.title).first()
  await titleBox.waitFor({ state: 'visible', timeout: 30_000 })
  await page.waitForTimeout(1500)
  const title = await titleBox.inputValue().catch(() => '')
  const price = await page.locator(LAND_COM_SELECTORS.price).first().inputValue().catch(() => '')
  if (!title.trim() || !sameTitle(title, expectedTitle)) {
    throw new Error(
      `Draft ${listingId} did not keep its fields after Save (title reads "${title}", price "${price}")` +
        (complaints.length ? `; editor said: ${complaints.slice(0, 4).join(' | ')}` : '')
    )
  }
  log(`land_com: draft ${listingId} saved and verified after reload (price ${price || 'blank'})`)
}

async function clickIfEnabled(page: Page, selector: string, log: (m: string) => void): Promise<boolean> {
  const btn = page.locator(selector).first()
  if ((await btn.count()) === 0) return false
  if (!(await btn.isEnabled().catch(() => false))) return false
  await btn.click()
  await page.waitForTimeout(2000)
  log(`land_com: pressed ${selector.replace(/^button:(text-is|has-text)\("(.*)"\)$/, '$2')}`)
  return true
}

/** Reads the Listing Manager grid rows currently rendered. */
export async function readHubRows(page: Page): Promise<HubRow[]> {
  const rows = page.locator(LAND_COM_SELECTORS.row)
  const n = await rows.count()
  const out: HubRow[] = []
  for (let i = 0; i < n; i++) {
    const r = rows.nth(i)
    const id = (await r.getAttribute('row-id')) ?? ''
    if (!id) continue
    const text = await r.innerText().catch(() => '')
    out.push(parseHubRowText(id, text))
  }
  return out
}

async function visibleTexts(page: Page, selector: string): Promise<string[]> {
  const texts: string[] = []
  for (const part of selector.split(/,(?![^(]*\))/)) {
    const loc = page.locator(part.trim())
    const n = await loc.count().catch(() => 0)
    for (let i = 0; i < Math.min(n, 10); i++) {
      if (!(await loc.nth(i).isVisible().catch(() => false))) continue
      const t = (await loc.nth(i).innerText().catch(() => '')).trim().replace(/\s+/g, ' ')
      if (t) texts.push(t.slice(0, 160))
    }
  }
  return [...new Set(texts)]
}

// --- pure helpers (unit-tested) ------------------------------------------------

const STATUS_RE = /^(For Sale|Draft|Off[ -]?Market|Sold|Pending|Active|Under Contract|Inactive|Expired|Deleted|Removed|Withdrawn)$/i

/** Parses an ag-grid row's innerText (one cell per line) into a HubRow. */
export function parseHubRowText(id: string, text: string): HubRow {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const row: HubRow = { id, title: '', city: null, stateAbbr: null, priceUsd: null, acres: null, status: '' }
  // The ID cell renders as "ID 28909620" and the title may follow on the
  // same line with no separator ("ID 29006903New Listing") or on the next.
  const idIdx = lines.findIndex((l) => l.startsWith(`ID ${id}`) || l.startsWith(`ID${id}`))
  if (idIdx !== -1) {
    const rest = lines[idIdx].slice(lines[idIdx].indexOf(id) + id.length).trim()
    row.title = rest || lines[idIdx + 1] || ''
  }
  for (const l of lines) {
    let m: RegExpMatchArray | null
    if ((m = l.match(/^(.+?),\s*([A-Z]{2})$/)) && row.city === null) {
      row.city = m[1]
      row.stateAbbr = m[2]
    } else if ((m = l.match(/^\$([\d,]+)(?:\.\d+)?$/)) && row.priceUsd === null) {
      row.priceUsd = Number(m[1].replace(/,/g, ''))
    } else if (/^\d+(\.\d+)?$/.test(l) && row.acres === null && row.priceUsd !== null) {
      row.acres = Number(l)
    } else if (STATUS_RE.test(l) && !row.status) {
      row.status = l
    }
  }
  return row
}

export function isActive(status: string): boolean {
  return /for sale|active|pending|under contract/i.test(status)
}

/**
 * The listing already on the account for this lot, if any: same title, or
 * same price + acreage + state (catches a listing posted by hand under a
 * different headline). Sold / Off Market rows never count.
 */
export function findMatch(
  rows: HubRow[],
  headline: string,
  priceUsd: number,
  acreage: number,
  stateAbbr: string
): (HubRow & { matchedOn: string }) | null {
  const live = rows.filter((r) => !/sold|off[ -]?market|inactive|expired|deleted|removed|withdrawn/i.test(r.status))
  const byTitle = live.find((r) => r.title && sameTitle(r.title, headline))
  if (byTitle) return { ...byTitle, matchedOn: 'title' }
  const byFacts = live.find(
    (r) =>
      r.priceUsd === priceUsd &&
      r.acres !== null &&
      Math.abs(r.acres - acreage) < 0.05 &&
      (r.stateAbbr === null || stateAbbr.length !== 2 || r.stateAbbr === stateAbbr.toUpperCase())
  )
  if (byFacts) return { ...byFacts, matchedOn: 'price + acreage + state' }
  return null
}

export function coordinatesFromTask(task: PosterTask): { latitude: number; longitude: number } | null {
  const m = task.metadata ?? {}
  const lat = Number(m['latitude'] ?? m['lat'])
  const lon = Number(m['longitude'] ?? m['lng'] ?? m['lon'])
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat === 0 || lon === 0) return null
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  return { latitude: lat, longitude: lon }
}

/**
 * Text for the required "Location Description / Street Address" box.
 * Never the reverse-geocoded street. Explicit metadata first, then the
 * county and state.
 */
export function locationDescription(task: PosterTask, location: { county: string; stateAbbr: string; state: string }): string {
  return (
    stringMeta(task, 'address') ??
    stringMeta(task, 'location_description') ??
    `${location.county} County, ${location.stateAbbr.length === 2 ? location.stateAbbr : location.state}`
  )
}

export function propertyTypesFromTask(task: PosterTask): string[] {
  return pickFromList(task, 'land_com_property_types', PROPERTY_TYPES, ['Undeveloped'])
}

export function activitiesFromTask(task: PosterTask): string[] {
  return pickFromList(task, 'land_com_activities', ACTIVITIES, [])
}

function pickFromList(task: PosterTask, key: string, allowed: string[], fallback: string[]): string[] {
  const raw = task.metadata?.[key]
  const values = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : null
  if (!values) return fallback
  const out: string[] = []
  for (const v of values) {
    if (typeof v !== 'string') continue
    const hit = allowed.find((a) => a.toLowerCase() === v.trim().toLowerCase())
    if (hit && !out.includes(hit)) out.push(hit)
  }
  return out.length > 0 ? out : fallback
}

function stringMeta(task: PosterTask, key: string): string | undefined {
  const v = task.metadata?.[key]
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

function numberMeta(task: PosterTask, key: string): number | undefined {
  const v = task.metadata?.[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

