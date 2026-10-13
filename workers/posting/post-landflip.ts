/**
 * Posts one approved ad to LANDFLIP (landflip.com), mapped against the live
 * seller area on 2026-10-12 from recon dumps of my.landflip.com (/dashboard,
 * /listings, /listing-add, /listing-photos/426576, /upgrade-plan) plus the
 * site's own /js/app.min.js (Foundation Abide patterns, /json/listings
 * actions).
 *
 * Usage: npm run post -- landflip <taskId> [--dry-run]
 *
 * Drives an already-authenticated page handed in by the caller (the local
 * poster agent's headed browser, or post.ts's headless one built from the
 * saved auth/<platform>.json session). The caller owns the browser lifecycle.
 *
 * The seller area is MY LANDFLIP at https://my.landflip.com (jQuery +
 * Foundation 5, server-rendered pages, ajax actions on /json/listings).
 * The public site www.landflip.com sits behind Cloudflare and refuses a
 * headless browser outright, so this poster never visits it: the public URL
 * is built from the listing id (https://www.landflip.com/land/<id>).
 *
 *   1. Listings (/listings). A card per listing (#lb<id>, .list-block) with
 *      title, "<acres> Acre(s) : $<price>", "City : County Co : State" and
 *      Online/Offline + Available/Under Contract/Sold tags. Read first: the
 *      same lot may already exist (matched by title, else price + acres) and
 *      an Offline one from an earlier run is finished, not duplicated.
 *   2. Add Listing (/listing-add). One long form (#add-listing-form): type,
 *      title (10-35 chars, letters digits - , . + / & $ ' and space ONLY),
 *      acreage, price, country/state/county (county options load by ajax
 *      after the state is chosen), city + zip (both required), zoning /
 *      terrain / access selects, taxes, APN, option and utility checkboxes,
 *      description (100 char minimum; no ALL CAPS, HTML, phone, email or web
 *      address), directions. Continue creates the listing and lands on
 *      /listing-photos/<id>. Nothing on the form is paid; the plan limit is
 *      enforced by the site on Continue.
 *   3. Photos (/listing-photos/<id>). <input id=file multiple>; choosing
 *      files submits the form by ajax (action=photoupload) and the page
 *      reloads with the new photos in #sortable .photo-container. Plan cap
 *      per listing is printed on the page ("Your current plan has a N photo
 *      limit"); JPG or PNG, 600 px wide minimum, landscape preferred.
 *   4. Edit (/listing-edit/<id>). Same form as Add (#edit-listing-form,
 *      #save-btn) for finishing an existing listing.
 *
 * Publishing is the "Turn On" link in the status strip (#visible-btn, ajax
 * action=turnon) which flips #visible from Offline to Online. A dry run
 * leaves the listing Offline. Plans (2026-10-12): the account's Entry plan
 * allows 1 listing and 10 photos; Premium $100/mo (50 listings, 25 photos),
 * Pro $200/mo (100 / 50), Pro+ $300/mo (200+ / 50). Deleted listings can
 * only be restored, never purged.
 */
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
import { STATE_NAMES } from './post-land_century'
import { choosePhotos, extractApn, financingFromTask, sameTitle } from './post-landmodo'

const PLATFORM = 'landflip'
const SCRIPT = 'post-landflip.ts'
const SITE = 'https://my.landflip.com'
const PUBLIC_SITE = 'https://www.landflip.com'

export const LANDFLIP_LIMITS = {
  /** Abide pattern "title": /^[a-zA-Z0-9-,.+/&$' ]{10,35}$/ plus maxlength=35. */
  titleMinChars: 10,
  titleMaxChars: 35,
  /** Abide pattern "description": 100 chars minimum. No maximum on the form; config/ad-platforms.json caps the copy at 1500. */
  descriptionMinChars: 100,
  /** Fallback when the photos page does not print its plan limit. */
  defaultPhotoCap: 10,
}

/** Characters the title pattern accepts. Everything else is dropped. */
const TITLE_ALLOWED_RE = /[^a-zA-Z0-9\-,.+/&$' ]/g

/**
 * All LANDFLIP DOM knowledge lives here so a site redesign is a one-file fix.
 * Verified against recon dumps in .agent-cache/recon/my_landflip_com_*.
 */
export const LANDFLIP_SELECTORS = {
  listingsUrl: `${SITE}/listings`,
  addUrl: `${SITE}/listing-add`,
  editUrl: (id: string) => `${SITE}/listing-edit/${id}`,
  photosUrl: (id: string) => `${SITE}/listing-photos/${id}`,
  /** Present on every logged-in page (sidebar Sign Out link). */
  loggedIn: 'a[href="/sign-in/signout"]',
  loginPassword: 'input[type="password"]:visible',

  // --- Listings grid ---
  card: '.list-block[id^="lb"]',
  cardTitle: '.list-info h4 a',
  cardPriceAc: '.tag.price-ac',
  cardWhere: '.list-info p',
  planLimitNotice: 'text=/at your listing plan limit/i',

  // --- Add / Edit form (same ids on both) ---
  addForm: '#add-listing-form',
  editForm: '#edit-listing-form',
  listingType: '#listing-type',
  title: '#title',
  acreage: '#acreage',
  price: '#price',
  acrePrice: '#acre-price',
  country: '#country',
  state: '#state',
  county: '#county',
  address: '#address',
  city: '#city',
  zip: '#zip',
  zoning: '#zoning',
  terrain: '#terrain',
  access: '#access',
  taxes: '#taxes',
  parcelId: '#parcel-id',
  description: '#description',
  directions: '#directions',
  ownerFinance: '#owner-finance',
  restrictions: '#restrictions',
  continueButton: '#continue-btn',
  saveButton: '#save-btn',
  /** Abide marks invalid fields' wrappers and shows <small class="error">. */
  formError: '#add-listing-form .error:visible, #edit-listing-form .error:visible, .alert-box.alert:visible',

  // --- Photos page ---
  photoInput: '#file',
  photoContainer: '#sortable .photo-container',
  photoLimitText: 'text=/photo limit per listing/i',
  photoDropError: '#frmDrop.is-error',

  // --- Map page (/listing-map/<id>): plain POST form once Abide validates ---
  mapUrl: (id: string) => `${SITE}/listing-map/${id}`,
  mapForm: '#map-edit',
  showMap: '#show-map',
  latitude: '#latitude',
  longitude: '#longitude',
  mapSaveButton: '#map-save-btn',

  // --- Status strip (edit / photos / map pages) ---
  editStatus: '#edit-status',
  visible: '#visible',
  visibleButton: '#visible-btn',
}

/** Utility checkbox ids on the form, keyed by the words a task may use. */
export const UTILITY_CHECKBOXES: Array<{ id: string; match: RegExp }> = [
  { id: 'electric', match: /\b(electric(ity)?|power)\b/i },
  { id: 'telephone', match: /\b(telephone|landline|phone line)\b/i },
  { id: 'water', match: /\b(water service|community water|city water|municipal water|water system|public water)\b/i },
  { id: 'well-water', match: /\bwell\b/i },
  { id: 'natural-gas', match: /\b(natural gas|gas)\b/i },
  { id: 'sewer', match: /\bsewer\b/i },
  { id: 'septic', match: /\bseptic\b/i },
  { id: 'cable-sat', match: /\b(cable|satellite|sat tv)\b/i },
  { id: 'cell-service', match: /\b(cell|cellular|mobile signal)\b/i },
  { id: 'broadband', match: /\b(broadband|internet|fiber|dsl)\b/i },
]

const PHOTOS_URL_RE = /\/listing-photos\/(\d+)/
const EDIT_URL_RE = /\/listing-edit\/(\d+)/

export interface ListingCard {
  id: string
  title: string
  priceUsd: number | null
  acres: number | null
  where: string
  online: boolean
  status: 'available' | 'contract' | 'sold' | 'unknown'
}

export async function postToLandflip(
  task: PosterTask,
  adCopy: AdCopy,
  opts: PostOptions & PostContext
): Promise<PostResult> {
  const config = opts.platform ?? loadPlatformConfig(PLATFORM)
  void config
  const log = opts.log ?? (() => {})
  const page = opts.page
  const facts = requireListingFacts(task)
  const location = await resolveLocation(facts.location)
  for (const w of location.warnings) log(`landflip: location: ${w}`)
  const stateName = stateNameFor(location.state)
  const title = titleForLandflip(task, adCopy.headline, log)
  const description = descriptionForLandflip(adCopy.description, log)
  const cityZip = requireCityZip(task)
  const financing = financingFromTask(task, adCopy)
  const ownerFinanced = financing.downPaymentUsd !== null || financing.monthlyPaymentUsd !== null
  const dialogs = watchDialogs(page, log)

  // 1. Listings grid: is this lot already there?
  log('landflip: opening Listings')
  await page.goto(LANDFLIP_SELECTORS.listingsUrl, { waitUntil: 'domcontentloaded' })
  await settle(page)
  if (await onLoginPage(page)) throw loginExpiredError(PLATFORM, page.url())
  const cards = await readListingCards(page)
  const atLimit = (await page.locator(LANDFLIP_SELECTORS.planLimitNotice).count().catch(() => 0)) > 0
  log(
    `landflip: ${cards.length} listing(s)${atLimit ? ' (site shows the plan-limit notice)' : ''}: ` +
      (cards.map((c) => `${c.id} [${c.online ? 'online' : 'offline'}/${c.status}] ${c.title.slice(0, 40)}`).join('; ') || 'none')
  )
  const match = findCard(cards, title, facts.priceUsd, facts.acreage)

  let listingId: string
  if (match && match.online && match.status === 'available') {
    log(`landflip: listing ${match.id} "${match.title}" is already Online (matched on ${match.matchedOn}); recording it, not creating another`)
    return finish(page, match.id, opts.outputDir, log)
  }
  if (match && match.status !== 'available' && match.status !== 'unknown') {
    throw new Error(
      `LANDFLIP already has listing ${match.id} "${match.title}" marked ${match.status === 'contract' ? 'Under Contract' : 'Sold'}. ` +
        `Open ${LANDFLIP_SELECTORS.editUrl(match.id)} and change its status by hand, then Publish again`
    )
  }
  const form = {
    title,
    acreage: facts.acreage,
    priceUsd: facts.priceUsd,
    stateName,
    county: location.county,
    city: cityZip.city,
    zip: cityZip.zip,
    address: stringMeta(task, 'address') ?? '',
    zoning: zoningForLandflip(task, adCopy),
    terrain: terrainForLandflip(task),
    access: accessForLandflip(task),
    taxes: taxesForLandflip(task),
    apn: stringMeta(task, 'apn') ?? extractApn(stringMeta(task, 'must_include'), stringMeta(task, 'utilities_notes'), adCopy.description) ?? '',
    ownerFinanced,
    restrictions: hasRestrictions(task, adCopy),
    utilities: utilitiesForLandflip(task),
    description,
    directions: stringMeta(task, 'directions') ?? '',
    log,
  }
  if (match) {
    log(`landflip: finishing offline listing ${match.id} "${match.title}" (matched on ${match.matchedOn})`)
    listingId = match.id
    await page.goto(LANDFLIP_SELECTORS.editUrl(listingId), { waitUntil: 'domcontentloaded' })
    await page.locator(LANDFLIP_SELECTORS.editForm).first().waitFor({ state: 'attached', timeout: 45_000 })
    await settle(page)
    await fillListingForm(page, form)
    await submitForm(page, LANDFLIP_SELECTORS.saveButton, 'Save', listingId, dialogs)
  } else {
    log('landflip: opening Add Listing')
    await page.goto(LANDFLIP_SELECTORS.addUrl, { waitUntil: 'domcontentloaded' })
    await page.locator(LANDFLIP_SELECTORS.addForm).first().waitFor({ state: 'attached', timeout: 45_000 })
    await settle(page)
    if (await onLoginPage(page)) throw loginExpiredError(PLATFORM, page.url())
    await fillListingForm(page, form)
    await submitForm(page, LANDFLIP_SELECTORS.continueButton, 'Continue', null, dialogs)
    const m = page.url().match(PHOTOS_URL_RE)
    if (!m) {
      const err = await visibleErrors(page)
      throw new Error(
        `After Continue, LANDFLIP stayed on ${page.url()} instead of the photos page` +
          (err ? `: "${err}"` : '') +
          (atLimit ? '. The site reports the account is at its listing plan limit (Entry = 1 listing); turn one off or upgrade' : '') +
          (dialogs.length ? `. Dialogs: ${dialogs.join(' | ')}` : '')
      )
    }
    listingId = m[1]
    log(`landflip: created listing ${listingId}`)
  }

  // 2. Photos.
  await uploadPhotos(page, listingId, choosePhotos(listPhotos(opts.outputDir), stringMeta(task, 'primaryPhoto')), log)

  // 3. Map pin from the task's coordinates (the site geocodes the city otherwise).
  await setMapPin(page, listingId, coordinatesFromTask(task), dialogs, log)

  // 4. Read the edit page back to prove the text landed.
  await page.goto(LANDFLIP_SELECTORS.editUrl(listingId), { waitUntil: 'domcontentloaded' })
  await page.locator(LANDFLIP_SELECTORS.editForm).first().waitFor({ state: 'attached', timeout: 45_000 })
  await settle(page)
  const titleNow = await page.locator(LANDFLIP_SELECTORS.title).first().inputValue().catch(() => '')
  const descNow = await page.locator(LANDFLIP_SELECTORS.description).first().inputValue().catch(() => '')
  const priceNow = await page.locator(LANDFLIP_SELECTORS.price).first().inputValue().catch(() => '')
  if (!sameTitle(titleNow, title)) {
    throw new Error(`After saving, listing ${listingId} reads title "${titleNow}" instead of "${title}"` + (dialogs.length ? `. Dialogs: ${dialogs.join(' | ')}` : ''))
  }
  if (descNow.trim().length < Math.min(description.length, 200) * 0.8) {
    throw new Error(`After saving, listing ${listingId} holds ${descNow.length} description chars (sent ${description.length})` + (dialogs.length ? `. Dialogs: ${dialogs.join(' | ')}` : ''))
  }
  const visibleNow = (await page.locator(LANDFLIP_SELECTORS.visible).first().innerText().catch(() => '')).trim()
  log(`landflip: edit page reads title "${titleNow}", ${descNow.length} description chars, price ${priceNow || '-'}, ${visibleNow || 'visibility unknown'}`)

  if (opts.dryRun) {
    log(`landflip: dry run, listing ${listingId} left ${visibleNow || 'Offline'} at ${LANDFLIP_SELECTORS.editUrl(listingId)} (public URL once Online: ${publicListingUrl(listingId)})`)
    const screenshotPath = await saveProofScreenshot(page, opts.outputDir, PLATFORM)
    return { listingUrl: null, screenshotPath }
  }

  // 5. Turn On.
  if (!/online/i.test(visibleNow)) {
    const btn = page.locator(LANDFLIP_SELECTORS.visibleButton).first()
    if ((await btn.count()) === 0) {
      throw new Error(`Could not find the Turn On link on the edit page (tried: ${LANDFLIP_SELECTORS.visibleButton}). Update the SELECTORS block in ${SCRIPT}.`)
    }
    const label = (await btn.innerText().catch(() => '')).trim()
    if (!/turn on/i.test(label)) {
      throw new Error(`The status strip button reads "${label}" instead of "Turn On" while the listing shows "${visibleNow}"`)
    }
    log('landflip: clicking Turn On')
    await btn.click()
    const deadline = Date.now() + 30_000
    let nowText = ''
    while (Date.now() < deadline) {
      nowText = (await page.locator(LANDFLIP_SELECTORS.visible).first().innerText().catch(() => '')).trim()
      if (/online/i.test(nowText)) break
      await page.waitForTimeout(500)
    }
    if (!/online/i.test(nowText)) {
      throw new Error(`After Turn On, listing ${listingId} still shows "${nowText}"` + (dialogs.length ? `. Dialogs: ${dialogs.join(' | ')}` : ''))
    }
  }
  return finish(page, listingId, opts.outputDir, log)
}

// --- steps ---------------------------------------------------------------------

interface FormValues {
  title: string
  acreage: number
  priceUsd: number
  stateName: string
  county: string
  city: string
  zip: string
  address: string
  zoning: string | null
  terrain: string | null
  access: string | null
  taxes: number | null
  apn: string
  ownerFinanced: boolean
  restrictions: boolean
  utilities: string[]
  description: string
  directions: string
  log: (m: string) => void
}

async function fillListingForm(page: Page, v: FormValues): Promise<void> {
  const { log } = v
  await selectOption(page, LANDFLIP_SELECTORS.listingType, 'For Sale', 'listing type', log)
  await fillText(page, LANDFLIP_SELECTORS.title, v.title, 'title')
  await fillText(page, LANDFLIP_SELECTORS.acreage, String(v.acreage), 'acreage')
  await fillText(page, LANDFLIP_SELECTORS.price, String(Math.round(v.priceUsd)), 'price')
  if (v.acreage > 0) await fillText(page, LANDFLIP_SELECTORS.acrePrice, String(Math.round(v.priceUsd / v.acreage)), 'per acre price')
  await selectOption(page, LANDFLIP_SELECTORS.country, 'United States', 'country', log)
  await selectOption(page, LANDFLIP_SELECTORS.state, v.stateName, 'state', log)
  await selectCounty(page, v.county, log)
  await fillText(page, LANDFLIP_SELECTORS.address, v.address, 'street address')
  await fillText(page, LANDFLIP_SELECTORS.city, v.city, 'city')
  await fillText(page, LANDFLIP_SELECTORS.zip, v.zip, 'zip')
  // The city/zip inputs carry jQuery UI autocomplete; close any open menu.
  await page.keyboard.press('Escape').catch(() => {})
  if (v.zoning) await selectOption(page, LANDFLIP_SELECTORS.zoning, v.zoning, 'zoning', log, true)
  if (v.terrain) await selectOption(page, LANDFLIP_SELECTORS.terrain, v.terrain, 'terrain', log, true)
  if (v.access) await selectOption(page, LANDFLIP_SELECTORS.access, v.access, 'access', log, true)
  if (v.taxes !== null) await fillText(page, LANDFLIP_SELECTORS.taxes, String(Math.round(v.taxes)), 'taxes')
  if (v.apn) await fillText(page, LANDFLIP_SELECTORS.parcelId, v.apn, 'APN')
  await setCheckbox(page, LANDFLIP_SELECTORS.ownerFinance, v.ownerFinanced)
  await setCheckbox(page, LANDFLIP_SELECTORS.restrictions, v.restrictions)
  for (const u of UTILITY_CHECKBOXES) await setCheckbox(page, `#${u.id}`, v.utilities.includes(u.id))
  await fillText(page, LANDFLIP_SELECTORS.description, v.description, 'description')
  if (v.directions) await fillText(page, LANDFLIP_SELECTORS.directions, v.directions, 'directions')
  log(
    `landflip: form filled: "${v.title}" ${v.acreage} ac $${v.priceUsd} ${v.city} ${v.zip} ${v.county} Co ${v.stateName}` +
      `; zoning ${v.zoning ?? '-'}, terrain ${v.terrain ?? '-'}, access ${v.access ?? '-'}, taxes ${v.taxes ?? '-'}, APN ${v.apn || '-'}` +
      `; owner finance ${v.ownerFinanced ? 'on' : 'off'}, restrictions ${v.restrictions ? 'on' : 'off'}, utilities ${v.utilities.join(', ') || 'none'}`
  )
}

/** The county <select> is filled by ajax after the state changes. */
async function selectCounty(page: Page, county: string, log: (m: string) => void): Promise<void> {
  const select = page.locator(LANDFLIP_SELECTORS.county).first()
  const deadline = Date.now() + 20_000
  let labels: string[] = []
  while (Date.now() < deadline) {
    labels = await select.locator('option').allInnerTexts().catch(() => [])
    if (labels.filter((l) => l.trim() && !/select/i.test(l)).length > 0) break
    await page.waitForTimeout(500)
  }
  const pick = pickCountyOption(labels, county)
  if (!pick) {
    throw new Error(
      `LANDFLIP has no county option matching "${county}" (options: ${labels.filter((l) => !/select/i.test(l)).slice(0, 12).join(', ')}...). ` +
        `Set the task's location to "<county> County, <ST>" with the county spelled as the site has it`
    )
  }
  await select.selectOption({ label: pick })
  if (pick.toLowerCase() !== county.toLowerCase()) log(`landflip: county "${county}" matched option "${pick}"`)
}

async function submitForm(page: Page, selector: string, label: string, listingId: string | null, dialogs: string[]): Promise<void> {
  const btn = page.locator(selector).first()
  if ((await btn.count()) === 0) {
    throw new Error(`Could not find the ${label} button (tried: ${selector}). Update the SELECTORS block in ${SCRIPT}.`)
  }
  const before = page.url()
  await Promise.all([
    page.waitForURL((u) => u.toString() !== before, { timeout: 60_000 }).catch(() => {}),
    btn.click(),
  ])
  await settle(page)
  if (page.url() === before) {
    const err = await visibleErrors(page)
    if (err) {
      throw new Error(
        `LANDFLIP rejected the form on ${label}${listingId ? ` for listing ${listingId}` : ''}: "${err}"` +
          (dialogs.length ? `. Dialogs: ${dialogs.join(' | ')}` : '')
      )
    }
  }
}

async function uploadPhotos(page: Page, listingId: string, photos: string[], log: (m: string) => void): Promise<void> {
  await page.goto(LANDFLIP_SELECTORS.photosUrl(listingId), { waitUntil: 'domcontentloaded' })
  await settle(page)
  const cap = parsePhotoCap(await page.locator('body').innerText().catch(() => '')) ?? LANDFLIP_LIMITS.defaultPhotoCap
  const count = () => page.locator(LANDFLIP_SELECTORS.photoContainer).count().catch(() => 0)
  let seen = await count()
  const wanted = photos.slice(0, cap)
  if (seen >= wanted.length) {
    log(`landflip: listing already shows ${seen} photo(s); nothing to upload`)
    return
  }
  const remaining = wanted.slice(seen)
  if (photos.length > cap) log(`landflip: plan allows ${cap} photos per listing; sending the first ${cap} of ${photos.length}`)
  log(`landflip: uploading ${remaining.length} photo(s)${seen ? ` (${seen} already on the listing)` : ''}`)
  const failed: string[] = []
  for (const photo of remaining) {
    const name = path.basename(photo)
    const input = page.locator(LANDFLIP_SELECTORS.photoInput).first()
    if ((await input.count()) === 0) {
      throw new Error(`Could not find the photo input on ${page.url()} (tried: ${LANDFLIP_SELECTORS.photoInput}). Update the SELECTORS block in ${SCRIPT}.`)
    }
    const before = seen
    // Choosing a file submits the drop form by ajax; on success the page reloads.
    await input.setInputFiles([photo])
    const deadline = Date.now() + 120_000
    while (Date.now() < deadline) {
      seen = await count()
      if (seen > before) break
      if ((await page.locator(LANDFLIP_SELECTORS.photoDropError).count().catch(() => 0)) > 0) break
      await page.waitForTimeout(1000)
    }
    if (seen > before) {
      log(`landflip: photo ${seen}/${wanted.length} ${name} uploaded`)
      await settle(page)
    } else {
      failed.push(name)
      log(`landflip: ${name} did not appear after upload; moving on`)
      await page.goto(LANDFLIP_SELECTORS.photosUrl(listingId), { waitUntil: 'domcontentloaded' })
      await settle(page)
      seen = await count()
    }
    if (seen >= cap) break
  }
  if (seen === 0) throw new Error(`No photos appeared on listing ${listingId} after uploading ${remaining.length} file(s)`)
  if (failed.length) log(`landflip: NOTE ${failed.length} photo(s) never showed: ${failed.join(', ')}`)
  log(`landflip: ${seen} photo(s) on the listing`)
}

/**
 * /listing-map/<id>: on load the site drops the marker at the geocoded city
 * and writes that into #latitude/#longitude. Overwrite with the parcel's own
 * coordinates, turn the map on, Save (a normal POST after Abide validation),
 * then read the fields back. Skipped, with a note, when the task has none.
 */
async function setMapPin(
  page: Page,
  listingId: string,
  coords: { latitude: number; longitude: number } | null,
  dialogs: string[],
  log: (m: string) => void
): Promise<void> {
  if (!coords) {
    log('landflip: NOTE no metadata.latitude/longitude on the task; the map pin stays where the site geocoded the city')
    return
  }
  await page.goto(LANDFLIP_SELECTORS.mapUrl(listingId), { waitUntil: 'domcontentloaded' })
  const form = page.locator(LANDFLIP_SELECTORS.mapForm).first()
  if ((await form.count()) === 0) {
    log(`landflip: NOTE no map form on ${page.url()} (tried: ${LANDFLIP_SELECTORS.mapForm}); map pin not set`)
    return
  }
  // The page's own geocode callback fills the boxes a moment after load; let it finish first.
  await page.waitForTimeout(3000)
  const lat = formatCoordinate(coords.latitude)
  const lon = formatCoordinate(coords.longitude)
  await selectOption(page, LANDFLIP_SELECTORS.showMap, 'Yes', 'show listing on maps', log, true)
  await fillText(page, LANDFLIP_SELECTORS.latitude, lat, 'latitude')
  await fillText(page, LANDFLIP_SELECTORS.longitude, lon, 'longitude')
  await submitForm(page, LANDFLIP_SELECTORS.mapSaveButton, 'map Save', listingId, dialogs)
  await page.goto(LANDFLIP_SELECTORS.mapUrl(listingId), { waitUntil: 'domcontentloaded' })
  await settle(page)
  const latNow = await page.locator(LANDFLIP_SELECTORS.latitude).first().inputValue().catch(() => '')
  const lonNow = await page.locator(LANDFLIP_SELECTORS.longitude).first().inputValue().catch(() => '')
  const showNow = await page.locator(LANDFLIP_SELECTORS.showMap).first().inputValue().catch(() => '')
  if (!sameCoordinate(latNow, coords.latitude) || !sameCoordinate(lonNow, coords.longitude)) {
    log(`landflip: NOTE the map page reads ${latNow}, ${lonNow} after saving (sent ${lat}, ${lon}); set the pin by hand at ${LANDFLIP_SELECTORS.mapUrl(listingId)}`)
    return
  }
  log(`landflip: map pin saved at ${latNow}, ${lonNow} (show on maps: ${showNow === '1' ? 'yes' : 'no'})`)
}

async function finish(page: Page, listingId: string, outputDir: string, log: (m: string) => void): Promise<PostResult> {
  // Prove it from the grid: the card's Online tag must be showing.
  await page.goto(LANDFLIP_SELECTORS.listingsUrl, { waitUntil: 'domcontentloaded' })
  await settle(page)
  const cards = await readListingCards(page)
  const card = cards.find((c) => c.id === listingId)
  if (!card) throw new Error(`Listing ${listingId} is missing from the Listings grid after publishing`)
  if (!card.online) throw new Error(`Listing ${listingId} "${card.title}" still shows Offline in the Listings grid after Turn On`)
  const url = publicListingUrl(listingId)
  log(`landflip: listing ${listingId} "${card.title}" is Online; public URL ${url} (not opened: www.landflip.com blocks headless browsers)`)
  const screenshotPath = await saveProofScreenshot(page, outputDir, PLATFORM)
  return { listingUrl: url, screenshotPath }
}

// --- small helpers ---------------------------------------------------------

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded').catch(() => {})
  await page.waitForTimeout(1200)
}

async function onLoginPage(page: Page): Promise<boolean> {
  if (/\/sign-in(\/|\?|$)/i.test(page.url())) return true
  if ((await page.locator(LANDFLIP_SELECTORS.loginPassword).count().catch(() => 0)) > 0) return true
  return (await page.locator(LANDFLIP_SELECTORS.loggedIn).count().catch(() => 0)) === 0
}

async function fillText(page: Page, selector: string, value: string, fieldName: string): Promise<void> {
  const el = page.locator(selector).first()
  if ((await el.count()) === 0) {
    throw new Error(`Could not find the ${fieldName} field on the listing form (tried: ${selector}). Update the SELECTORS block in ${SCRIPT}.`)
  }
  await el.fill(value)
  await el.dispatchEvent('change').catch(() => {})
}

async function selectOption(
  page: Page,
  selector: string,
  label: string,
  fieldName: string,
  log: (m: string) => void,
  optional = false
): Promise<void> {
  const el = page.locator(selector).first()
  if ((await el.count()) === 0) {
    if (optional) {
      log(`landflip: no ${fieldName} select on the form (tried: ${selector}); skipped`)
      return
    }
    throw new Error(`Could not find the ${fieldName} select on the listing form (tried: ${selector}). Update the SELECTORS block in ${SCRIPT}.`)
  }
  try {
    await el.selectOption({ label })
  } catch {
    try {
      await el.selectOption(label)
    } catch {
      if (optional) {
        log(`landflip: ${fieldName} has no option "${label}"; left as is`)
        return
      }
      throw new Error(`The ${fieldName} select has no option "${label}"`)
    }
  }
}

async function setCheckbox(page: Page, selector: string, on: boolean): Promise<void> {
  const el = page.locator(selector).first()
  if ((await el.count()) === 0) return
  const checked = await el.isChecked().catch(() => false)
  if (checked !== on) await el.setChecked(on, { force: true }).catch(() => {})
}

async function visibleErrors(page: Page): Promise<string> {
  const texts = await page.locator(LANDFLIP_SELECTORS.formError).allInnerTexts().catch(() => [] as string[])
  return texts.map((t) => t.trim()).filter(Boolean).slice(0, 5).join(' / ')
}

function watchDialogs(page: Page, log: (m: string) => void): string[] {
  const seen: string[] = []
  page.on('dialog', (d) => {
    seen.push(d.message())
    log(`landflip: site dialog: "${d.message()}"`)
    d.dismiss().catch(() => {})
  })
  return seen
}

// --- pure helpers (unit-tested) -------------------------------------------

export async function readListingCards(page: Page): Promise<ListingCard[]> {
  // No named inner functions here: tsx injects a `__name` helper into them
  // that does not exist inside the page (same quirk as post-parcelview.ts).
  const raw = await page.locator(LANDFLIP_SELECTORS.card).evaluateAll((els) =>
    els.map((el) => {
      const shown = ['.tag.online', '.tag.available', '.tag.uc', '.tag.sold'].map((sel) => {
        const t = el.querySelector(sel)
        return !!t && !t.classList.contains('hide')
      })
      return {
        id: el.id,
        title: (el.querySelector('.list-info h4 a') as HTMLElement | null)?.innerText ?? '',
        priceAc: (el.querySelector('.tag.price-ac') as HTMLElement | null)?.innerText ?? '',
        where: (el.querySelector('.list-info p') as HTMLElement | null)?.innerText ?? '',
        online: shown[0],
        available: shown[1],
        uc: shown[2],
        sold: shown[3],
      }
    })
  )
  return raw.map(parseListingCard)
}

export function parseListingCard(r: {
  id: string
  title: string
  priceAc: string
  where: string
  online: boolean
  available: boolean
  uc: boolean
  sold: boolean
}): ListingCard {
  const acres = r.priceAc.match(/([\d,.]+)\s*acre/i)
  const price = r.priceAc.match(/\$\s*([\d,]+)/)
  return {
    id: r.id.replace(/^lb/, ''),
    title: r.title.trim(),
    acres: acres ? Number(acres[1].replace(/,/g, '')) : null,
    priceUsd: price ? Number(price[1].replace(/,/g, '')) : null,
    where: r.where.trim(),
    online: r.online,
    status: r.sold ? 'sold' : r.uc ? 'contract' : r.available ? 'available' : 'unknown',
  }
}

export function findCard(
  cards: ListingCard[],
  title: string,
  priceUsd: number,
  acreage: number
): (ListingCard & { matchedOn: string }) | null {
  const byTitle = cards.find((c) => sameTitle(c.title, title))
  if (byTitle) return { ...byTitle, matchedOn: 'title' }
  const byFacts = cards.find(
    (c) => c.priceUsd !== null && c.acres !== null && Math.round(c.priceUsd) === Math.round(priceUsd) && Math.abs(c.acres - acreage) < 0.01
  )
  if (byFacts) return { ...byFacts, matchedOn: 'price + acres' }
  return null
}

export function pickCountyOption(labels: string[], county: string): string | null {
  const norm = (s: string) => s.toLowerCase().replace(/\b(county|parish|borough)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
  const want = norm(county)
  if (!want) return null
  const options = labels.map((l) => l.trim()).filter((l) => l && !/^select/i.test(l))
  return options.find((l) => norm(l) === want) ?? options.find((l) => norm(l).startsWith(want) || want.startsWith(norm(l))) ?? null
}

export function publicListingUrl(listingId: string): string {
  return `${PUBLIC_SITE}/land/${listingId}`
}

/** "Your current plan has a 10 photo limit per listing." */
export function parsePhotoCap(text: string): number | null {
  const m = text.match(/plan has a (\d+) photo limit/i)
  return m ? Number(m[1]) : null
}

export function coordinatesFromTask(task: PosterTask): { latitude: number; longitude: number } | null {
  const m = task.metadata ?? {}
  const lat = m['latitude']
  const lon = m['longitude']
  if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) return null
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) return null
  return { latitude: lat, longitude: lon }
}

/** The map inputs take 12 characters: as many decimals as fit, 8 at most. */
export function formatCoordinate(n: number): string {
  for (let d = 8; d >= 4; d--) {
    const s = n.toFixed(d)
    if (s.length <= 12) return s
  }
  return n.toFixed(4)
}

export function sameCoordinate(field: string, n: number): boolean {
  const v = Number(field)
  return Number.isFinite(v) && Math.abs(v - n) < 0.00005
}

export function stateNameFor(state: string): string {
  const t = state.trim()
  const byAbbr = STATE_NAMES[t.toUpperCase()]
  const name = byAbbr ?? t.toLowerCase()
  return name.replace(/\b[a-z]/g, (c) => c.toUpperCase())
}

/**
 * The title must be 10-35 chars of letters, digits, space and - , . + / & $ '.
 * metadata.landflip_headline wins when set; otherwise the ad headline is
 * stripped of other characters and cut at a word boundary.
 */
export function titleForLandflip(task: PosterTask, headline: string, log: (m: string) => void = () => {}): string {
  const explicit = stringMeta(task, 'landflip_headline')
  const source = explicit ?? headline
  let t = source.replace(/[|:;]/g, ',').replace(TITLE_ALLOWED_RE, ' ').replace(/\s+/g, ' ').replace(/\s+,/g, ',').trim()
  t = t.replace(/[-,.+/&$' ]+$/g, '').trim()
  if (t.length > LANDFLIP_LIMITS.titleMaxChars) {
    const cut = t.lastIndexOf(' ', LANDFLIP_LIMITS.titleMaxChars)
    t = (cut >= LANDFLIP_LIMITS.titleMinChars ? t.slice(0, cut) : t.slice(0, LANDFLIP_LIMITS.titleMaxChars)).replace(/[-,.+/&$' ]+$/g, '').trim()
    log(`landflip: ${explicit ? 'metadata.landflip_headline' : 'headline'} is over ${LANDFLIP_LIMITS.titleMaxChars} chars; using "${t}" (set metadata.landflip_headline to choose)`)
  } else if (t !== source.trim()) {
    log(`landflip: title characters outside the site's allowed set were dropped: "${t}"`)
  }
  if (t.length < LANDFLIP_LIMITS.titleMinChars) {
    throw new Error(`The LANDFLIP title "${t}" is under ${LANDFLIP_LIMITS.titleMinChars} chars; set metadata.landflip_headline`)
  }
  return t
}

/** Plain text, no HTML; the site also forbids phone numbers, emails and web addresses. */
export function descriptionForLandflip(description: string, log: (m: string) => void = () => {}): string {
  const text = description.replace(/\r\n/g, '\n').replace(/<[^>]+>/g, '').trim()
  const problems: string[] = []
  if (/\bhttps?:\/\/|\bwww\.|\.(com|net|org|land)\b/i.test(text)) problems.push('a web address')
  if (/[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(text)) problems.push('an email address')
  if (/\b\d{3}[-. ]\d{3}[-. ]\d{4}\b/.test(text)) problems.push('a phone number')
  if (problems.length) log(`landflip: NOTE the description contains ${problems.join(', ')}; the site forbids these and may reject or edit the listing`)
  if (text.length < LANDFLIP_LIMITS.descriptionMinChars) {
    throw new Error(`The LANDFLIP description is ${text.length} chars; the site requires at least ${LANDFLIP_LIMITS.descriptionMinChars}`)
  }
  return text
}

/** Both are required by the form; neither is derivable from "County, ST". */
export function requireCityZip(task: PosterTask): { city: string; zip: string } {
  const city = stringMeta(task, 'city')
  const zip = stringMeta(task, 'zip') ?? stringMeta(task, 'postal_code')
  if (!city || !zip) {
    throw new Error(
      `LANDFLIP requires a city and zip. Add metadata.city and metadata.zip to task ${task.id} (nearest town and its zip code), then Publish again`
    )
  }
  return { city, zip }
}

/** <select id="zoning"> options. */
export const ZONING_OPTIONS = ['No Zoning', 'Agricultural', 'Residential', 'Commercial', 'Industrial', 'Mixed Use']
export function zoningForLandflip(task: PosterTask, adCopy: AdCopy): string | null {
  const explicit = stringMeta(task, 'landflip_zoning')
  if (explicit) return ZONING_OPTIONS.find((o) => o.toLowerCase() === explicit.toLowerCase()) ?? null
  const z = (stringMeta(task, 'zoning') ?? '').toLowerCase()
  const fromMeta = mapZoning(z)
  if (fromMeta) return fromMeta
  const m = adCopy.description.match(/\bzoned\s+([a-z-]+(?:\s+[a-z-]+)?)/i)
  return m ? mapZoning(m[1].toLowerCase()) : null
}
function mapZoning(z: string): string | null {
  if (!z) return null
  if (/mixed/.test(z)) return 'Mixed Use'
  if (/resid/.test(z)) return 'Residential'
  if (/agri|farm|ranch|\bag\b/.test(z)) return 'Agricultural'
  if (/commerc/.test(z)) return 'Commercial'
  if (/industr/.test(z)) return 'Industrial'
  if (/no zoning|unzoned|none|unrestricted/.test(z)) return 'No Zoning'
  return null
}

/** <select id="terrain"> options. */
export const TERRAIN_OPTIONS = ['Desert', 'Flat', 'Gently Rolling', 'Hilly', 'Mountainous', 'Wetland', 'Various']
export function terrainForLandflip(task: PosterTask): string | null {
  const explicit = stringMeta(task, 'landflip_terrain')
  if (explicit) return TERRAIN_OPTIONS.find((o) => o.toLowerCase() === explicit.toLowerCase()) ?? null
  const t = (stringMeta(task, 'terrain') ?? '').toLowerCase()
  if (!t) return null
  if (/mountain|alpine/.test(t)) return 'Mountainous'
  if (/hill|slop|ridge/.test(t)) return 'Hilly'
  if (/rolling/.test(t)) return 'Gently Rolling'
  if (/flat|level/.test(t)) return 'Flat'
  if (/desert|sage|arid/.test(t)) return 'Desert'
  if (/wet|marsh|swamp/.test(t)) return 'Wetland'
  if (/various|mixed/.test(t)) return 'Various'
  return null
}

/** <select id="access"> options. */
export const ACCESS_OPTIONS = ['Paved Road', 'Dirt Road', 'Gravel Road', 'Multiple Roads', 'State Highway', 'Interstate Highway', 'Deeded Easement', 'Land Locked']
export function accessForLandflip(task: PosterTask): string | null {
  const explicit = stringMeta(task, 'landflip_access')
  if (explicit) return ACCESS_OPTIONS.find((o) => o.toLowerCase() === explicit.toLowerCase()) ?? null
  const a = (stringMeta(task, 'access') ?? '').toLowerCase()
  if (!a) return null
  if (/landlock|land locked|no legal/.test(a)) return 'Land Locked'
  if (/easement/.test(a)) return 'Deeded Easement'
  if (/interstate/.test(a)) return 'Interstate Highway'
  if (/highway/.test(a)) return 'State Highway'
  if (/paved|asphalt/.test(a)) return 'Paved Road'
  if (/gravel/.test(a)) return 'Gravel Road'
  if (/dirt|unpaved|seasonal|two.?track|trail/.test(a)) return 'Dirt Road'
  return null
}

export function taxesForLandflip(task: PosterTask): number | null {
  const m = task.metadata ?? {}
  for (const key of ['annual_taxes_usd', 'taxes_usd', 'annual_taxes', 'taxes']) {
    const v = m[key]
    if (typeof v === 'number' && v >= 0) return v
    if (typeof v === 'string') {
      const n = Number(v.replace(/[^0-9.]/g, ''))
      if (Number.isFinite(n) && n > 0) return n
    }
  }
  return null
}

/** Covenants / Restrictions / HOA checkbox when the task or copy says so. */
export function hasRestrictions(task: PosterTask, adCopy: AdCopy): boolean {
  const m = task.metadata ?? {}
  if (typeof m['hoa'] === 'boolean') return m['hoa']
  const text = [stringMeta(task, 'utilities_notes'), stringMeta(task, 'must_include'), stringMeta(task, 'restrictions'), adCopy.description]
    .filter(Boolean)
    .join('\n')
  if (/\bno (?:hoa|covenants|restrictions)\b/i.test(text) && !/\bhoa dues\b/i.test(text)) return false
  return /\b(hoa|poa|covenant|deed restriction|restrictions)\b/i.test(text)
}

/** Utility checkbox ids from metadata.utilities (explicit list) or metadata.landflip_utilities. */
export function utilitiesForLandflip(task: PosterTask): string[] {
  const m = task.metadata ?? {}
  const explicit = m['landflip_utilities']
  const list = Array.isArray(explicit) ? explicit : Array.isArray(m['utilities']) ? m['utilities'] : []
  const words = list.filter((x): x is string => typeof x === 'string').join(' ; ')
  const ids = new Set<string>()
  for (const u of UTILITY_CHECKBOXES) if (u.match.test(words)) ids.add(u.id)
  // "well" also matches "well-water" only; make sure plain "water" does not tick the well box and vice versa.
  if (ids.has('well-water') && !/\b(water service|community water|city water|municipal water|water system|public water)\b/i.test(words)) ids.delete('water')
  return [...ids]
}

function stringMeta(task: PosterTask, key: string): string | undefined {
  const v = task.metadata?.[key]
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}
