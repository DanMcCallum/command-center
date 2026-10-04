/**
 * Posts one approved ad to ParcelView (parcelview.com), mapped against the
 * live site on 2026-10-04 from recon dumps of /new-property/,
 * /edit-property/?id=445, /properties/ and /account/.
 *
 * Usage: npm run post -- parcelview <taskId> [--dry-run]
 *
 * Drives an already-authenticated page handed in by the caller (the local
 * poster agent's headed browser, or post.ts's headless one built from the
 * saved auth/<platform>.json session). The caller owns the browser lifecycle.
 *
 * ParcelView is a WordPress site running the "parcelview3d-saas" plugin. A
 * property is created from its APN and the site pulls the parcel record and
 * boundary itself; the ad copy sits beside that facts panel.
 *
 *   1. My Properties (/properties/). Cards for every property on the account
 *      ("n of 50 properties used (Growth plan)"). Read first: the same lot may
 *      already exist (matched by APN), and an Unlisted one from an earlier run
 *      should be finished rather than duplicated.
 *   2. New Property (/new-property/). One form in a side panel with an APN
 *      search on top: pick "By Parcel ID (APN)", type the APN, choose state and
 *      county, Search Parcels, click the result. That fills name, address,
 *      county, APN, lat/long, acres, elevation and ~70 hidden parcel fields.
 *      Save posts the form by ajax (admin-ajax pv3d_save_property) and the
 *      server answers with a redirect to the edit page.
 *   3. Edit Property (/edit-property/?id=N). Same form plus what a new one
 *      lacks: the description textarea (maxlength 2000), the Listing status /
 *      Badge / Land-or-Home selects in a strip above the form (bound to it via
 *      form="property-form"), and working photo uploads (each file is posted by
 *      ajax against the open property id, 15 max, 5 MB each, behind a
 *      copyright checkbox). Save here shows "Saved!" in #pv3d-msg and reloads.
 *
 * Publishing is Listing status = Available. A dry run leaves it Unlisted.
 * The public page is https://parcelview.com/listing/<hash>/ where <hash> is
 * the 32-hex id in the property's embed / Share URL.
 *
 * Nothing is paid: the Growth plan allows 50 properties, no per-listing credit.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { Page } from 'playwright'
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
import { choosePhotos, extractApn, financingFromTask, sameTitle } from './post-landmodo'

const PLATFORM = 'parcelview'
const SCRIPT = 'post-parcelview.ts'
const SITE = 'https://parcelview.com'

export const PARCELVIEW_LIMITS = {
  /** The description textarea has maxlength=2000 (config/ad-platforms.json agrees). */
  descriptionMaxChars: 2000,
  /** No hard cap on the name field; config/ad-platforms.json headline_max. */
  titleMaxChars: 75,
  /** uploadPropertyPhotos(): maxPhotos = 15, files over 5 MB are skipped client-side. */
  maxPhotos: 15,
  maxPhotoBytes: 5 * 1024 * 1024,
  /**
   * The first dry run (2026-10-04) landed exactly the 5 of 15 photos under
   * 1 MB, and every photo on the account's older listings is under 1 MB as
   * served, so the server's real limit sits near 1 MB. Anything bigger is
   * re-encoded in the browser before upload.
   */
  uploadTargetBytes: 900 * 1024,
  /** Long side after re-encoding; plenty for the gallery. */
  shrinkMaxDimension: 2000,
}

/** <select name="terrain"> option values on the property form. */
export const TERRAINS = [
  'Level', 'Mostly Level', 'Gently Sloped', 'Sloped', 'Hilly', 'Steep', 'Rolling',
  'Wooded', 'Wooded & Level', 'Wooded & Sloped', 'Cleared',
]
/** Feature checkbox names in the Property features section. */
export const FEATURES = ['no_poa', 'rv_living', 'mobile_homes', 'manufactured_homes', 'camping_allowed'] as const
export type Feature = (typeof FEATURES)[number]
/** <select name="listing_badge"> values. */
export const BADGES = ['', 'available', 'new', 'reduced', 'financing']

/**
 * All ParcelView DOM knowledge lives here so a site redesign is a one-file fix.
 * Verified against recon dumps in .agent-cache/recon/parcelview_com_*.
 */
export const PARCELVIEW_SELECTORS = {
  propertiesUrl: `${SITE}/properties/`,
  newPropertyUrl: `${SITE}/new-property/`,
  editUrl: (id: string) => `${SITE}/edit-property/?id=${id}`,
  loginForm: 'form#f input[name="password"]',

  // --- My Properties ---
  countLabel: '#pv3d-count-label',
  card: '.pv3d-card[id^="property-"]',

  // --- parcel lookup (top of the property form) ---
  form: 'form#property-form',
  searchType: '#parcel-search-type',
  lookupApn: '#lookup-apn',
  lookupState: '#lookup-apn-state',
  lookupCounty: '#lookup-county',
  lookupButton: '#parcel-lookup-btn',
  lookupStatus: '#parcel-lookup-status',
  resultsList: '#parcel-results-list',
  resultItem: '#parcel-results-list .pv3d-result-item',

  // --- property form ---
  name: '#prop-name',
  apn: '#prop-apn',
  county: '#prop-county',
  state: '#prop-state',
  city: '#prop-city',
  /** Hidden parcel-record field; the town when the lot has no street address. */
  muniName: '#prop-muni-name',
  zip: '#prop-zip',
  latitude: '#prop-lat',
  longitude: '#prop-lng',
  acres: '#prop-acres',
  cashPrice: 'input[name="cash_price"]',
  monthlyPayment: 'input[name="monthly_payment"]',
  downPayment: 'input[name="down_payment"]',
  loanTermMonths: 'input[name="loan_term_months"]',
  terrain: '#prop-terrain',
  feature: (name: Feature) => `input[type="checkbox"][name="${name}"]`,
  listingKind: 'select[name="listing_kind"]',
  listingStatus: 'select[name="listing_status"]',
  listingBadge: 'select[name="listing_badge"]',
  description: '#pv3d-listing-description',
  accordionHeader: '.pv3d-acc-header',

  // --- photos (edit page) ---
  photoCopyright: '#pv3d-photo-copyright',
  photoInput: 'input[type="file"][onchange*="uploadPropertyPhotos"]',
  photoThumb: '#pv3d-photo-grid .pv3d-photo-thumb',
  photoCount: '#pv3d-photo-count',
  photoStatus: '#pv3d-photo-upload-status',

  // --- save ---
  save: '#pv3d-panel-save-btn',
  saveMessage: '#pv3d-msg',
  embedInput: '#iframe-embed-input',
}

const EDIT_URL_RE = /\/edit-property\/\?id=(\d+)/
const HASH_RE = /\/embed\/([0-9a-f]{32})\//

export interface PropertyCard {
  id: string
  title: string
  apn: string | null
  acres: number | null
  city: string | null
  state: string | null
  /** "available" | "sold" | "pending" | "unlisted" (no badge on the card). */
  status: string
  hash: string | null
  editUrl: string
}

export async function postToParcelView(
  task: PosterTask,
  adCopy: AdCopy,
  opts: PostOptions & PostContext
): Promise<PostResult> {
  const config = opts.platform ?? loadPlatformConfig(PLATFORM)
  const log = opts.log ?? (() => {})
  const page = opts.page
  const facts = requireListingFacts(task)
  const location = await resolveLocation(facts.location)
  for (const w of location.warnings) log(`parcelview: location: ${w}`)
  const apn = requireApnForParcelView(task, adCopy)
  const financing = financingFromTask(task, adCopy)
  const ownerFinanced = financing.downPaymentUsd !== null || financing.monthlyPaymentUsd !== null
  const title = titleForParcelView(task, adCopy.headline)
  if (title !== adCopy.headline) log(`parcelview: using metadata.parcelview_headline as the name (${title.length} chars)`)
  const description = descriptionForParcelView(adCopy.description, log)
  const dialogs = watchDialogs(page, log)

  // 1. My Properties: existing property for this APN? room under the cap?
  log('parcelview: opening My Properties')
  await page.goto(PARCELVIEW_SELECTORS.propertiesUrl, { waitUntil: 'domcontentloaded' })
  await settle(page)
  if (await onLoginPage(page)) throw loginExpiredError(PLATFORM, page.url())
  const usage = parseUsage(await page.locator(PARCELVIEW_SELECTORS.countLabel).first().innerText().catch(() => ''))
  const cards = await readPropertyCards(page)
  log(
    `parcelview: ${usage ? `${usage.used} of ${usage.cap} properties used` : 'usage unknown'}; ` +
      `${cards.length} card(s): ${cards.map((c) => `${c.id} [${c.status}] ${c.apn ?? '?'} ${c.title.slice(0, 30)}`).join('; ') || 'none'}`
  )
  const match = findCard(cards, apn, title)

  let propertyId: string
  let created = false
  if (match && match.status === 'available') {
    log(`parcelview: property ${match.id} "${match.title}" is already Available for APN ${apn} (matched on ${match.matchedOn}); recording it, not creating another`)
    return finish(page, match.id, opts.outputDir, log, match.hash)
  }
  if (match && match.status !== 'unlisted') {
    throw new Error(
      `ParcelView already has property ${match.id} "${match.title}" for APN ${apn} with status "${match.status}". ` +
        `Open ${PARCELVIEW_SELECTORS.editUrl(match.id)} and set its Listing status by hand, then Publish again`
    )
  }
  if (match) {
    log(`parcelview: finishing unlisted property ${match.id} "${match.title}" (matched on ${match.matchedOn})`)
    propertyId = match.id
  } else {
    if (usage && usage.used >= usage.cap) {
      throw new Error(
        `ParcelView account already has ${usage.used} of ${usage.cap} properties. Delete one in My Properties ` +
          `or upgrade the plan, then Publish again`
      )
    }
    propertyId = await createFromApn(page, {
      apn,
      stateAbbr: location.stateAbbr,
      stateName: location.state,
      county: location.county,
      title,
      acreage: facts.acreage,
      priceUsd: facts.priceUsd,
      financing,
      terrain: terrainForParcelView(task),
      features: featuresFromTask(task, adCopy),
      coords: coordinatesFromTask(task),
      log,
    })
    created = true
    log(`parcelview: created property ${propertyId}`)
  }

  // 3. Edit page: description, status, badge, photos, then Save.
  if (!EDIT_URL_RE.test(page.url()) || page.url().match(EDIT_URL_RE)?.[1] !== propertyId) {
    await page.goto(PARCELVIEW_SELECTORS.editUrl(propertyId), { waitUntil: 'domcontentloaded' })
  }
  await page.locator(PARCELVIEW_SELECTORS.description).first().waitFor({ state: 'attached', timeout: 45_000 })
  await settle(page)
  if (await onLoginPage(page)) throw loginExpiredError(PLATFORM, page.url())
  log(`parcelview: filling the edit page for ${propertyId}`)
  await expandAccordions(page)

  // Pure text and selects first; photos upload independently by ajax and do
  // not reload the page, so order only matters for the final Save.
  await fillText(page, PARCELVIEW_SELECTORS.name, title, 'property name')
  await fillText(page, PARCELVIEW_SELECTORS.description, description, 'description')
  // Re-filled on the edit page even right after createFromApn: the first
  // dry run came back without a down payment or loan term, so every save
  // sends the full pricing block and the read-back below reports it.
  await fillCityIfEmpty(page, log)
  await fillText(page, PARCELVIEW_SELECTORS.acres, String(facts.acreage), 'acres')
  await fillPricing(page, facts.priceUsd, financing)
  await selectTerrain(page, terrainForParcelView(task), log)
  await setFeatures(page, featuresFromTask(task, adCopy), log)
  void created
  await selectValue(page, PARCELVIEW_SELECTORS.listingKind, 'land', 'listing kind', log, true)
  await selectValue(page, PARCELVIEW_SELECTORS.listingBadge, badgeForTask(task, ownerFinanced), 'badge', log, true)
  await selectValue(page, PARCELVIEW_SELECTORS.listingStatus, opts.dryRun ? 'unlisted' : 'available', 'listing status', log)

  const photos = eligiblePhotos(choosePhotos(listPhotos(opts.outputDir), stringMeta(task, 'primaryPhoto')), log)
  const already = await photoCount(page)
  const remaining = photos.slice(already)
  if (already >= photos.length) {
    log(`parcelview: property already shows ${already} photo(s); nothing to upload`)
  } else if (remaining.length > 0) {
    log(`parcelview: uploading ${remaining.length} photo(s)${already ? ` (${already} already on the property)` : ''}`)
    const prepared = await shrinkPhotos(page, remaining, task.id, log)
    await uploadPhotos(page, prepared, already, log)
  }

  await saveEditPage(page, propertyId, log)
  // Prove it landed: reload the editor and read back the name, description
  // length and status.
  await page.goto(PARCELVIEW_SELECTORS.editUrl(propertyId), { waitUntil: 'domcontentloaded' })
  await page.locator(PARCELVIEW_SELECTORS.description).first().waitFor({ state: 'attached', timeout: 45_000 })
  await settle(page)
  const nameNow = await page.locator(PARCELVIEW_SELECTORS.name).first().inputValue().catch(() => '')
  const descNow = await page.locator(PARCELVIEW_SELECTORS.description).first().inputValue().catch(() => '')
  const statusNow = await page.locator(PARCELVIEW_SELECTORS.listingStatus).first().inputValue().catch(() => '')
  if (!sameTitle(nameNow, title)) {
    throw new Error(`After saving, property ${propertyId} reads name "${nameNow}" instead of "${title}". ${saveHint(propertyId, dialogs)}`)
  }
  if (descNow.trim().length < Math.min(description.length, 200) * 0.8) {
    throw new Error(`After saving, property ${propertyId} holds ${descNow.length} description chars (sent ${description.length}). ${saveHint(propertyId, dialogs)}`)
  }
  const want = opts.dryRun ? 'unlisted' : 'available'
  if (statusNow !== want) {
    throw new Error(`After saving, property ${propertyId} has Listing status "${statusNow}" instead of "${want}". ${saveHint(propertyId, dialogs)}`)
  }
  const shown = await photoCount(page)
  const pricingNow = await readPricing(page)
  log(
    `parcelview: saved; ${shown} photo(s) on the property, status ${statusNow}, pricing ` +
      `cash ${pricingNow.cash || '-'} / down ${pricingNow.down || '-'} / monthly ${pricingNow.monthly || '-'} / term ${pricingNow.term || '-'}`
  )
  if (financing.downPaymentUsd !== null && !pricingNow.down) {
    log(`parcelview: NOTE the down payment ($${financing.downPaymentUsd}) did not persist; check the Pricing section by hand`)
  }
  if (financing.months !== null && !pricingNow.term) {
    log(`parcelview: NOTE the loan term (${financing.months} months) did not persist; check the Pricing section by hand`)
  }

  if (opts.dryRun) {
    const hash = hashFromEditPage(await page.locator(PARCELVIEW_SELECTORS.embedInput).first().inputValue().catch(() => ''))
    log(
      `parcelview: dry run, property ${propertyId} left Unlisted at ${PARCELVIEW_SELECTORS.editUrl(propertyId)}` +
        (hash ? ` (public URL once Available: ${publicListingUrl(hash)})` : '')
    )
    const screenshotPath = await saveProofScreenshot(page, opts.outputDir, PLATFORM)
    return { listingUrl: null, screenshotPath }
  }
  const hash = hashFromEditPage(await page.locator(PARCELVIEW_SELECTORS.embedInput).first().inputValue().catch(() => ''))
  return finish(page, propertyId, opts.outputDir, log, hash)
}

// --- steps ---------------------------------------------------------------------

interface CreateArgs {
  apn: string
  stateAbbr: string
  stateName: string
  county: string
  title: string
  acreage: number
  priceUsd: number
  financing: ReturnType<typeof financingFromTask>
  terrain: string | null
  features: Feature[]
  coords: { latitude: number; longitude: number } | null
  log: (m: string) => void
}

/** New Property: APN search, pick the parcel, fill the basics, Save, land on the edit page. Returns the new id. */
async function createFromApn(page: Page, a: CreateArgs): Promise<string> {
  const { log } = a
  log(`parcelview: opening New Property`)
  await page.goto(PARCELVIEW_SELECTORS.newPropertyUrl, { waitUntil: 'domcontentloaded' })
  await page.locator(PARCELVIEW_SELECTORS.lookupApn).first().waitFor({ state: 'attached', timeout: 45_000 })
  await settle(page)
  if (await onLoginPage(page)) throw loginExpiredError(PLATFORM, page.url())

  log(`parcelview: searching APN ${a.apn} in ${a.county} County, ${a.stateAbbr}`)
  await selectValue(page, PARCELVIEW_SELECTORS.searchType, 'apn', 'search type', log)
  await page.locator(PARCELVIEW_SELECTORS.lookupApn).first().fill(a.apn)
  // The state select uses postal codes; the county list loads after it.
  const stateSel = page.locator(PARCELVIEW_SELECTORS.lookupState).first()
  await stateSel.selectOption(a.stateAbbr.toUpperCase()).catch(async () => {
    await stateSel.selectOption({ label: a.stateName })
  })
  const countySel = page.locator(PARCELVIEW_SELECTORS.lookupCounty).first()
  const countyDeadline = Date.now() + 20_000
  let countyOptions: Array<{ value: string; label: string }> = []
  while (Date.now() < countyDeadline) {
    countyOptions = await countySel.evaluate((el) =>
      Array.from((el as HTMLSelectElement).options).map((o) => ({ value: o.value, label: o.textContent?.trim() ?? '' }))
    )
    if (countyOptions.length > 1) break
    await page.waitForTimeout(500)
  }
  const countyOption = pickCountyOption(countyOptions, a.county)
  if (!countyOption) {
    throw new Error(
      `ParcelView lists no "${a.county}" county for ${a.stateAbbr} (options: ${countyOptions.map((o) => o.label).slice(0, 12).join(', ') || 'none loaded'}). ` +
        `Check the task location, then Publish again`
    )
  }
  await countySel.selectOption(countyOption.value)
  await page.locator(PARCELVIEW_SELECTORS.lookupButton).first().click()

  // Results render as a list; wait for an entry that mentions the APN, else
  // take the first. "Found parcel!" plus a filled #prop-apn is the done signal.
  const resultsDeadline = Date.now() + 60_000
  let picked = false
  while (Date.now() < resultsDeadline && !picked) {
    const status = (await page.locator(PARCELVIEW_SELECTORS.lookupStatus).first().innerText().catch(() => '')).trim()
    if (/no parcels? found|not found|error/i.test(status) && !/found \d+ parcel/i.test(status)) {
      throw new Error(`ParcelView parcel search for APN ${a.apn} (${a.county} County, ${a.stateAbbr}) failed: "${status}"`)
    }
    const items = page.locator(PARCELVIEW_SELECTORS.resultItem)
    const n = await items.count().catch(() => 0)
    if (n > 0) {
      let target = items.first()
      for (let i = 0; i < n; i++) {
        const t = (await items.nth(i).innerText().catch(() => '')).replace(/\s+/g, ' ')
        if (normalizeApn(t).includes(normalizeApn(a.apn))) {
          target = items.nth(i)
          break
        }
      }
      log(`parcelview: ${n} parcel result(s); selecting "${(await target.innerText().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 80)}"`)
      await target.click()
      picked = true
    } else {
      await page.waitForTimeout(1000)
    }
  }
  if (!picked) throw new Error(`ParcelView showed no parcel results for APN ${a.apn} within 60s`)

  const apnBox = page.locator(PARCELVIEW_SELECTORS.apn).first()
  const fillDeadline = Date.now() + 45_000
  while (Date.now() < fillDeadline) {
    const v = (await apnBox.inputValue().catch(() => '')).trim()
    if (v) break
    await page.waitForTimeout(500)
  }
  const apnFilled = (await apnBox.inputValue().catch(() => '')).trim()
  if (!apnFilled) throw new Error(`The parcel result did not fill the form (APN box stayed empty). Update ${SCRIPT}.`)
  if (normalizeApn(apnFilled) !== normalizeApn(a.apn)) {
    log(`parcelview: NOTE the selected parcel's APN reads "${apnFilled}" (task says ${a.apn})`)
  }
  const autoAcres = await page.locator(PARCELVIEW_SELECTORS.acres).first().inputValue().catch(() => '')
  const autoCounty = await page.locator(PARCELVIEW_SELECTORS.county).first().inputValue().catch(() => '')
  log(`parcelview: parcel loaded (county "${autoCounty}", parcel acreage ${autoAcres || '?'})`)
  await expandAccordions(page)

  await fillText(page, PARCELVIEW_SELECTORS.name, a.title, 'property name')
  if (!autoCounty) await fillText(page, PARCELVIEW_SELECTORS.county, a.county, 'county')
  const stateNow = await page.locator(PARCELVIEW_SELECTORS.state).first().inputValue().catch(() => '')
  if (!stateNow) await selectValue(page, PARCELVIEW_SELECTORS.state, a.stateName, 'state', log)
  const latNow = await page.locator(PARCELVIEW_SELECTORS.latitude).first().inputValue().catch(() => '')
  if (!latNow && a.coords) {
    await fillText(page, PARCELVIEW_SELECTORS.latitude, String(a.coords.latitude), 'latitude')
    await fillText(page, PARCELVIEW_SELECTORS.longitude, String(a.coords.longitude), 'longitude')
  }
  await fillCityIfEmpty(page, log)
  await fillText(page, PARCELVIEW_SELECTORS.acres, String(a.acreage), 'acres')
  await fillPricing(page, a.priceUsd, a.financing)
  await selectTerrain(page, a.terrain, log)
  await setFeatures(page, a.features, log)

  log('parcelview: saving the new property')
  await page.locator(PARCELVIEW_SELECTORS.save).first().click()
  try {
    await page.waitForURL((u) => EDIT_URL_RE.test(u.toString()), { timeout: 60_000 })
  } catch {
    const msg = (await page.locator(PARCELVIEW_SELECTORS.saveMessage).first().innerText().catch(() => '')).trim()
    throw new Error(
      `Save did not open the edit page for the new property` +
        (msg ? `: "${msg}"` : ' (no message shown)') +
        `. Check My Properties for a half-made record before retrying`
    )
  }
  const id = page.url().match(EDIT_URL_RE)?.[1]
  if (!id) throw new Error(`Unexpected edit URL ${page.url()}`)
  return id
}

/**
 * Vacant lots usually come back with "No address" and an empty City box, so
 * the preview reads "COLORADO, 80440". The parcel record still names the
 * town (hidden muni_name, "Fairplay" for the Park County lot); use it.
 */
async function fillCityIfEmpty(page: Page, log: (m: string) => void): Promise<void> {
  const city = page.locator(PARCELVIEW_SELECTORS.city).first()
  if ((await city.count()) === 0) return
  if ((await city.inputValue().catch(() => '')).trim()) return
  const muni = (await page.locator(PARCELVIEW_SELECTORS.muniName).first().inputValue().catch(() => '')).trim()
  if (!muni) return
  const pretty = muni.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase())
  await city.fill(pretty, { force: true })
  await city.dispatchEvent('change').catch(() => {})
  log(`parcelview: city was empty; using the parcel record's town "${pretty}"`)
}

async function fillPricing(page: Page, priceUsd: number, financing: ReturnType<typeof financingFromTask>): Promise<void> {
  await fillText(page, PARCELVIEW_SELECTORS.cashPrice, String(priceUsd), 'cash price')
  if (financing.downPaymentUsd !== null) {
    await fillText(page, PARCELVIEW_SELECTORS.downPayment, String(financing.downPaymentUsd), 'down payment')
  }
  if (financing.monthlyPaymentUsd !== null) {
    await fillText(page, PARCELVIEW_SELECTORS.monthlyPayment, String(financing.monthlyPaymentUsd), 'monthly payment')
  }
  if (financing.months !== null) {
    await fillText(page, PARCELVIEW_SELECTORS.loanTermMonths, String(financing.months), 'loan term')
  }
}

async function selectTerrain(page: Page, terrain: string | null, log: (m: string) => void): Promise<void> {
  if (!terrain) return
  await selectValue(page, PARCELVIEW_SELECTORS.terrain, terrain, 'terrain', log, true)
}

async function setFeatures(page: Page, features: Feature[], log: (m: string) => void): Promise<void> {
  for (const f of FEATURES) {
    const box = page.locator(PARCELVIEW_SELECTORS.feature(f)).first()
    if ((await box.count()) === 0) continue
    const want = features.includes(f)
    const is = await box.isChecked().catch(() => false)
    if (is === want) continue
    await box.setChecked(want, { force: true }).catch(() => {})
    log(`parcelview: feature ${f} ${want ? 'on' : 'off'}`)
  }
}

/**
 * Uploads one file at a time. The site fires one ajax request per file and
 * reports nothing per file on failure, so each upload is confirmed by the
 * thumbnail count going up before the next starts. A file that does not
 * land gets one retry, then is reported by name.
 */
async function uploadPhotos(page: Page, photos: string[], already: number, log: (m: string) => void): Promise<void> {
  const copyright = page.locator(PARCELVIEW_SELECTORS.photoCopyright).first()
  if ((await copyright.count()) > 0 && !(await copyright.isChecked().catch(() => false))) {
    await copyright.setChecked(true, { force: true })
  }
  const input = page.locator(PARCELVIEW_SELECTORS.photoInput).first()
  if ((await input.count()) === 0) {
    throw new Error(
      `Could not find the photo input on the ParcelView edit page (tried: ${PARCELVIEW_SELECTORS.photoInput}). ` +
        `Update the SELECTORS block in ${SCRIPT}.`
    )
  }
  const thumbs = () => page.locator(PARCELVIEW_SELECTORS.photoThumb).count()
  const statusText = async () => (await page.locator(PARCELVIEW_SELECTORS.photoStatus).first().innerText().catch(() => '')).trim()
  let seen = Math.max(already, await thumbs())
  const failed: string[] = []
  for (const photo of photos) {
    const name = path.basename(photo)
    let landed = false
    for (let attempt = 1; attempt <= 2 && !landed; attempt++) {
      const before = seen
      await input.setInputFiles([photo])
      const deadline = Date.now() + 90_000
      while (Date.now() < deadline) {
        seen = await thumbs()
        if (seen > before) break
        const st = await statusText()
        if (/too large|failed|error|limit reached/i.test(st)) {
          log(`parcelview: ${name} attempt ${attempt}: site says "${st}"`)
          break
        }
        await page.waitForTimeout(1000)
      }
      landed = seen > before
      if (!landed && attempt === 1) {
        log(`parcelview: ${name} did not appear after attempt ${attempt}; retrying once`)
        await page.waitForTimeout(2000)
      }
    }
    if (!landed) failed.push(name)
    else log(`parcelview: photo ${seen - already}/${photos.length} ${name} uploaded`)
    if (seen >= PARCELVIEW_LIMITS.maxPhotos) break
  }
  if (seen <= already) {
    const st = await statusText()
    throw new Error(`No new photo thumbnails appeared after uploading ${photos.length} file(s)` + (st ? `: "${st}"` : ''))
  }
  log(`parcelview: ${seen} photo(s) showing on the property`)
  if (failed.length) log(`parcelview: NOTE ${failed.length} photo(s) never showed: ${failed.join(', ')}`)
  await page.waitForTimeout(1500)
}

/**
 * Browser-side re-encoder, kept as source text and turned into a function at
 * runtime: tsx injects a `__name` helper into nested named functions in
 * compiled TypeScript, and that helper does not exist inside the page.
 */
const SHRINK_IN_BROWSER = `async ({ b64, mime, maxBytes, maxDim }) => {
  const img = new Image()
  img.src = 'data:' + mime + ';base64,' + b64
  await img.decode()
  const toB64 = (blob) => new Promise((resolve) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1])
    r.readAsDataURL(blob)
  })
  const encode = (scale, q) => new Promise((resolve) => {
    const w = Math.max(1, Math.round(img.naturalWidth * scale))
    const h = Math.max(1, Math.round(img.naturalHeight * scale))
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    c.getContext('2d').drawImage(img, 0, 0, w, h)
    c.toBlob(resolve, 'image/jpeg', q)
  })
  let scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight))
  for (let round = 0; round < 4; round++) {
    for (const q of [0.85, 0.8, 0.75, 0.7, 0.62, 0.55]) {
      const blob = await encode(scale, q)
      if (blob && blob.size <= maxBytes) return { b64: await toB64(blob), bytes: blob.size, q, scale }
    }
    scale *= 0.8
  }
  return null
}`
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const shrinkInBrowser = new Function('arg', `return (${SHRINK_IN_BROWSER})(arg)`)

/**
 * Re-encodes photos over uploadTargetBytes as JPEG in the poster's own
 * browser (canvas; no image library on the operator's machine) into a temp
 * dir, returning the paths to upload in the same order.
 */
export async function shrinkPhotos(page: Page, photos: string[], taskId: string, log: (m: string) => void): Promise<string[]> {
  const needs = photos.filter((p) => needsShrink(fs.statSync(p).size))
  if (needs.length === 0) return photos
  const tmpDir = path.join(os.tmpdir(), `parcelview-photos-${taskId}`)
  fs.mkdirSync(tmpDir, { recursive: true })
  log(`parcelview: re-encoding ${needs.length} photo(s) over ${Math.round(PARCELVIEW_LIMITS.uploadTargetBytes / 1024)} KB`)
  const worker = await page.context().newPage()
  const out: string[] = []
  try {
    await worker.setContent('<!doctype html><html><body></body></html>')
    for (const p of photos) {
      const size = fs.statSync(p).size
      if (!needsShrink(size)) {
        out.push(p)
        continue
      }
      const b64 = fs.readFileSync(p).toString('base64')
      const mime = /\.png$/i.test(p) ? 'image/png' : /\.webp$/i.test(p) ? 'image/webp' : 'image/jpeg'
      const result = (await worker.evaluate(shrinkInBrowser as (arg: unknown) => unknown, {
        b64,
        mime,
        maxBytes: PARCELVIEW_LIMITS.uploadTargetBytes,
        maxDim: PARCELVIEW_LIMITS.shrinkMaxDimension,
      })) as { b64: string; bytes: number; q: number; scale: number } | null
      if (!result) {
        log(`parcelview: could not get ${path.basename(p)} under the size target; sending it as is`)
        out.push(p)
        continue
      }
      const dest = path.join(tmpDir, path.basename(p).replace(/\.[^.]+$/, '') + '.jpg')
      fs.writeFileSync(dest, Buffer.from(result.b64, 'base64'))
      log(`parcelview: ${path.basename(p)} ${(size / 1024).toFixed(0)} KB -> ${(result.bytes / 1024).toFixed(0)} KB (q ${result.q}, scale ${result.scale.toFixed(2)})`)
      out.push(dest)
    }
  } finally {
    await worker.close().catch(() => {})
  }
  return out
}

async function readPricing(page: Page): Promise<{ cash: string; down: string; monthly: string; term: string }> {
  const v = async (sel: string) => (await page.locator(sel).first().inputValue().catch(() => '')).trim()
  return {
    cash: await v(PARCELVIEW_SELECTORS.cashPrice),
    down: await v(PARCELVIEW_SELECTORS.downPayment),
    monthly: await v(PARCELVIEW_SELECTORS.monthlyPayment),
    term: await v(PARCELVIEW_SELECTORS.loanTermMonths),
  }
}

/** Presses Save on the edit page and waits for "Saved!" (the page then reloads itself). */
async function saveEditPage(page: Page, propertyId: string, log: (m: string) => void): Promise<void> {
  const msg = page.locator(PARCELVIEW_SELECTORS.saveMessage).first()
  log('parcelview: clicking Save')
  await page.locator(PARCELVIEW_SELECTORS.save).first().click()
  const deadline = Date.now() + 45_000
  let text = ''
  while (Date.now() < deadline) {
    text = (await msg.innerText().catch(() => '')).trim()
    if (/saved/i.test(text)) break
    if (text && /error|failed|invalid|required|could not/i.test(text)) {
      throw new Error(`ParcelView did not save property ${propertyId}: "${text}"`)
    }
    // A reload in progress means the save already went through.
    if (!(await msg.count().catch(() => 0))) break
    await page.waitForTimeout(500)
  }
  if (!/saved/i.test(text)) log(`parcelview: no "Saved!" confirmation seen (last message: "${text || 'none'}"); verifying by reload`)
  await page.waitForTimeout(2500)
}

/** Resolve the public URL, screenshot it, return. */
async function finish(
  page: Page,
  id: string,
  outputDir: string,
  log: (m: string) => void,
  hash: string | null
): Promise<PostResult> {
  if (!hash) {
    await page.goto(PARCELVIEW_SELECTORS.editUrl(id), { waitUntil: 'domcontentloaded' })
    await settle(page)
    hash = hashFromEditPage(await page.locator(PARCELVIEW_SELECTORS.embedInput).first().inputValue().catch(() => ''))
  }
  let listingUrl: string
  if (hash) {
    listingUrl = publicListingUrl(hash)
  } else {
    listingUrl = PARCELVIEW_SELECTORS.editUrl(id)
    log(`parcelview: could not read the listing hash for ${id}; reporting the edit URL`)
  }
  await page.goto(listingUrl, { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForTimeout(2000)
  if (hash) {
    const body = (await page.locator('body').innerText().catch(() => '')).slice(0, 4000)
    if (/not found|no longer available|page doesn.t exist/i.test(body) || /\/login\//.test(page.url())) {
      log(`parcelview: NOTE ${listingUrl} did not render a listing page (title "${await page.title()}"); check it by hand`)
    }
  }
  const screenshotPath = await saveProofScreenshot(page, outputDir, PLATFORM)
  return { listingUrl, screenshotPath }
}

// --- page helpers ---------------------------------------------------------------

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded').catch(() => {})
  await page.waitForTimeout(1500)
}

async function onLoginPage(page: Page): Promise<boolean> {
  if (/\/login\/?(\?|$)/i.test(page.url())) return true
  return (await page.locator(PARCELVIEW_SELECTORS.loginForm).count()) > 0
}

/** Opens every collapsed accordion so fields are visible to real clicks. */
async function expandAccordions(page: Page): Promise<void> {
  const headers = page.locator(PARCELVIEW_SELECTORS.accordionHeader)
  const n = await headers.count().catch(() => 0)
  for (let i = 0; i < n; i++) {
    const h = headers.nth(i)
    const open = await h.evaluate((el) => {
      const acc = el.closest('.pv3d-acc')
      const body = acc?.querySelector('.pv3d-acc-body') as HTMLElement | null
      if (!body) return true
      const cs = getComputedStyle(body)
      return cs.display !== 'none' && cs.maxHeight !== '0px' && body.offsetHeight > 0
    }).catch(() => true)
    if (!open) await h.click({ force: true }).catch(() => {})
  }
  await page.waitForTimeout(300)
}

async function fillText(page: Page, selector: string, value: string, fieldName: string): Promise<void> {
  const loc = page.locator(selector).first()
  if ((await loc.count()) === 0) {
    throw new Error(
      `Could not find the ${fieldName} field on the ParcelView property form (tried: ${selector}). ` +
        `Update the SELECTORS block in ${SCRIPT}.`
    )
  }
  await loc.scrollIntoViewIfNeeded().catch(() => {})
  await loc.fill(value, { force: true })
  await loc.dispatchEvent('change').catch(() => {})
  const got = await loc.inputValue().catch(() => '')
  if (value.trim() && !got.trim()) throw new Error(`The ${fieldName} field stayed empty after filling it`)
}

async function selectValue(
  page: Page,
  selector: string,
  value: string,
  fieldName: string,
  log: (m: string) => void,
  optional = false
): Promise<void> {
  const loc = page.locator(selector).first()
  if ((await loc.count()) === 0) {
    if (optional) {
      log(`parcelview: no ${fieldName} select on this page; skipping`)
      return
    }
    throw new Error(`Could not find the ${fieldName} select (tried: ${selector}). Update the SELECTORS block in ${SCRIPT}.`)
  }
  try {
    await loc.selectOption(value, { force: true })
  } catch {
    try {
      await loc.selectOption({ label: value }, { force: true })
    } catch {
      if (optional) {
        log(`parcelview: ${fieldName} has no option "${value}"; leaving it as is`)
        return
      }
      throw new Error(`The ${fieldName} select has no option "${value}"`)
    }
  }
  await loc.dispatchEvent('change').catch(() => {})
}

async function photoCount(page: Page): Promise<number> {
  const thumbs = await page.locator(PARCELVIEW_SELECTORS.photoThumb).count().catch(() => 0)
  if (thumbs > 0) return thumbs
  const label = await page.locator(PARCELVIEW_SELECTORS.photoCount).first().innerText().catch(() => '')
  const n = Number(label.trim())
  return Number.isFinite(n) ? n : 0
}

/** Records (and accepts) alert()/confirm() dialogs so a refused action is explainable. */
function watchDialogs(page: Page, log: (m: string) => void): string[] {
  const seen: string[] = []
  page.on('dialog', (d) => {
    seen.push(d.message())
    log(`parcelview: page dialog (${d.type()}): ${d.message().slice(0, 160)}`)
    d.accept().catch(() => {})
  })
  return seen
}

function saveHint(propertyId: string, dialogs: string[]): string {
  return (
    `Open ${PARCELVIEW_SELECTORS.editUrl(propertyId)} to see what it still wants, then Publish again` +
    (dialogs.length ? ` (the page said: ${dialogs.slice(-2).join(' | ')})` : '')
  )
}

/** Reads the property cards on My Properties. */
export async function readPropertyCards(page: Page): Promise<PropertyCard[]> {
  const raw = await page.locator(PARCELVIEW_SELECTORS.card).evaluateAll((els) =>
    els.map((el) => ({
      id: el.id,
      title: el.querySelector('h3')?.textContent?.trim() ?? '',
      meta: el.querySelector('.pv3d-card-meta')?.textContent?.trim() ?? '',
      badge: Array.from(el.querySelectorAll('.pv3d-card-thumb span'))
        .map((s) => s.textContent?.trim() ?? '')
        .find((t) => /^(available|sold|under contract|pending|unlisted)$/i.test(t)) ?? '',
      embed: (el.querySelector('a[href*="/embed/"]') as HTMLAnchorElement | null)?.href ?? '',
      edit: (el.querySelector('a[href*="edit-property"]') as HTMLAnchorElement | null)?.href ?? '',
    }))
  )
  return raw.map((r) => parsePropertyCard(r))
}

// --- pure helpers (unit-tested) --------------------------------------------------

export function parsePropertyCard(r: {
  id: string
  title: string
  meta: string
  badge: string
  embed: string
  edit: string
}): PropertyCard {
  const id = r.id.replace(/^property-/, '')
  // meta: "0.12 acres · Montello, Nevada · APN 015101079"
  const parts = r.meta.split('·').map((p) => p.trim())
  const acresM = parts[0]?.match(/([\d.]+)\s*acres?/i)
  const place = parts.find((p) => /,/.test(p) && !/^APN/i.test(p)) ?? null
  const apnPart = parts.find((p) => /^APN\b/i.test(p))
  const apn = apnPart ? apnPart.replace(/^APN\s*/i, '').trim() || null : null
  const badge = r.badge.toLowerCase()
  const status = !badge ? 'unlisted' : /under contract|pending/.test(badge) ? 'pending' : badge
  return {
    id,
    title: r.title,
    apn,
    acres: acresM ? Number(acresM[1]) : null,
    city: place ? place.split(',')[0].trim() : null,
    state: place ? place.split(',').slice(1).join(',').trim() : null,
    status,
    hash: r.embed.match(HASH_RE)?.[1] ?? null,
    editUrl: r.edit || PARCELVIEW_SELECTORS.editUrl(id),
  }
}

export function normalizeApn(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** The lot's own card by APN; failing that, a card with the same name. */
export function findCard(cards: PropertyCard[], apn: string, title: string): (PropertyCard & { matchedOn: string }) | null {
  const want = normalizeApn(apn)
  const byApn = cards.find((c) => c.apn && normalizeApn(c.apn) === want)
  if (byApn) return { ...byApn, matchedOn: 'APN' }
  const byTitle = cards.find((c) => c.title && sameTitle(c.title, title))
  if (byTitle) return { ...byTitle, matchedOn: 'name' }
  return null
}

export function parseUsage(text: string): { used: number; cap: number } | null {
  const m = text.match(/(\d+)\s+of\s+(\d+)\s+properties/i)
  return m ? { used: Number(m[1]), cap: Number(m[2]) } : null
}

/** County <option> whose label starts with the county name ("Park", "Park County"). */
export function pickCountyOption(
  options: Array<{ value: string; label: string }>,
  county: string
): { value: string; label: string } | null {
  const norm = (s: string) => s.toLowerCase().replace(/\s+county$/, '').replace(/[^a-z0-9]+/g, ' ').trim()
  const want = norm(county)
  const real = options.filter((o) => o.value !== '')
  return (
    real.find((o) => norm(o.label) === want) ??
    real.find((o) => norm(o.value) === want) ??
    real.find((o) => norm(o.label).startsWith(want + ' ')) ??
    null
  )
}

export function publicListingUrl(hash: string): string {
  return `${SITE}/listing/${hash}/`
}

export function hashFromEditPage(embedInputValue: string): string | null {
  return embedInputValue.match(HASH_RE)?.[1] ?? null
}

export function titleForParcelView(task: PosterTask, headline: string): string {
  const override = stringMeta(task, 'parcelview_headline')
  const title = override ?? headline
  if (title.length > PARCELVIEW_LIMITS.titleMaxChars) {
    throw new Error(
      `ParcelView names are capped at ${PARCELVIEW_LIMITS.titleMaxChars} characters here and this one is ${title.length}: "${title}". ` +
        `Shorten the parcelview headline or set metadata.parcelview_headline, then Publish again`
    )
  }
  return title
}

export function descriptionForParcelView(description: string, log: (m: string) => void = () => {}): string {
  const text = description.replace(/\r\n/g, '\n').trim()
  if (text.length <= PARCELVIEW_LIMITS.descriptionMaxChars) return text
  // The textarea's maxlength would silently truncate mid-word; cut at the
  // last paragraph break that fits instead and say so.
  const cut = text.lastIndexOf('\n\n', PARCELVIEW_LIMITS.descriptionMaxChars)
  const trimmed = (cut > PARCELVIEW_LIMITS.descriptionMaxChars * 0.6 ? text.slice(0, cut) : text.slice(0, PARCELVIEW_LIMITS.descriptionMaxChars)).trim()
  log(`parcelview: description is ${text.length} chars, over the ${PARCELVIEW_LIMITS.descriptionMaxChars} cap; sending the first ${trimmed.length}`)
  return trimmed
}

/** Maps the Ad Builder's free-text terrain ("Forested") onto the form's terrain options. */
export function terrainForParcelView(task: PosterTask): string | null {
  const override = stringMeta(task, 'parcelview_terrain')
  if (override) return TERRAINS.find((t) => t.toLowerCase() === override.toLowerCase()) ?? override
  const raw = stringMeta(task, 'terrain')?.toLowerCase() ?? ''
  if (!raw) return null
  const wooded = /wood|forest|tree|timber|pine/.test(raw)
  const level = /\b(level|flat)\b/.test(raw)
  const sloped = /slop|grade|hillside|incline/.test(raw)
  if (wooded && level) return 'Wooded & Level'
  if (wooded && sloped) return 'Wooded & Sloped'
  if (wooded) return 'Wooded'
  if (/steep/.test(raw)) return 'Steep'
  if (/hilly|hills/.test(raw)) return 'Hilly'
  if (/rolling/.test(raw)) return 'Rolling'
  if (/gentl/.test(raw)) return 'Gently Sloped'
  if (sloped) return 'Sloped'
  if (/mostly level|mostly flat/.test(raw)) return 'Mostly Level'
  if (level) return 'Level'
  if (/clear|open|meadow|pasture/.test(raw)) return 'Cleared'
  return null
}

/**
 * Feature chips. metadata.parcelview_features (array of checkbox names) wins;
 * otherwise camping and RV use are read from the ad copy, and "no POA" from a
 * "no HOA/POA" mention.
 */
export function featuresFromTask(task: PosterTask, adCopy: AdCopy): Feature[] {
  const explicit = task.metadata?.['parcelview_features']
  if (Array.isArray(explicit)) {
    return FEATURES.filter((f) => explicit.map((x) => String(x).toLowerCase()).includes(f))
  }
  const text = [adCopy.description, stringMeta(task, 'must_include') ?? '', stringMeta(task, 'utilities_notes') ?? ''].join('\n')
  const out: Feature[] = []
  if (/\bcamp(ing|ers?|site)?\b/i.test(text) && !/\bno camping\b/i.test(text)) out.push('camping_allowed')
  if (/\bRVs?\b/.test(text) && !/\bno RVs?\b/i.test(text)) out.push('rv_living')
  if (/\bno (?:hoa|poa)\b/i.test(text)) out.push('no_poa')
  if (/\bmobile homes? (?:allowed|ok|okay|welcome|permitted)\b/i.test(text)) out.push('mobile_homes')
  if (/\bmanufactured homes? (?:allowed|ok|okay|welcome|permitted)\b/i.test(text)) out.push('manufactured_homes')
  return out
}

export function badgeForTask(task: PosterTask, ownerFinanced: boolean): string {
  const override = stringMeta(task, 'parcelview_badge')
  if (override !== undefined && BADGES.includes(override.toLowerCase())) return override.toLowerCase()
  return ownerFinanced ? 'financing' : 'new'
}

export function coordinatesFromTask(task: PosterTask): { latitude: number; longitude: number } | null {
  const m = task.metadata ?? {}
  const lat = Number(m['latitude'] ?? m['lat'])
  const lon = Number(m['longitude'] ?? m['lng'] ?? m['lon'])
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat === 0 || lon === 0) return null
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  return { latitude: lat, longitude: lon }
}

export function needsShrink(bytes: number): boolean {
  return bytes > PARCELVIEW_LIMITS.uploadTargetBytes
}

/** First 15 photos under 5 MB (the uploader skips bigger files without saying which). */
export function eligiblePhotos(photos: string[], log: (m: string) => void = () => {}): string[] {
  const ok: string[] = []
  for (const p of photos) {
    let size = 0
    try {
      size = fs.statSync(p).size
    } catch {
      continue
    }
    if (size > PARCELVIEW_LIMITS.maxPhotoBytes) {
      log(`parcelview: skipping ${p.split('/').pop()} (${(size / 1024 / 1024).toFixed(1)} MB, over the 5 MB cap)`)
      continue
    }
    ok.push(p)
  }
  if (ok.length > PARCELVIEW_LIMITS.maxPhotos) {
    log(`parcelview: ${ok.length} photos; sending the first ${PARCELVIEW_LIMITS.maxPhotos}`)
  }
  return ok.slice(0, PARCELVIEW_LIMITS.maxPhotos)
}

export function requireApnForParcelView(task: PosterTask, adCopy: AdCopy): string {
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
    `ParcelView creates the listing from the parcel's APN and task ${task.id} has none. Add "apn" to the task ` +
      `metadata (or mention "APN <number>" in the task notes) and Publish again`
  )
}

function stringMeta(task: PosterTask, key: string): string | undefined {
  const v = task.metadata?.[key]
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}
