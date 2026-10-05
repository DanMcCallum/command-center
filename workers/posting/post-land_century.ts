/**
 * Posts one approved ad to Land Century (landcentury.com), mapped on
 * 2026-10-05 from the site's own front-end source (the Next.js chunk for
 * /admin/listings/form/[slug]) and a logged-out look at the live site. No
 * listing had been created through this script yet when it was written:
 * the first supervised dry run on the operator's machine verifies it.
 *
 * Usage: npm run post -- land_century <taskId> [--dry-run] [--headed]
 *
 * Drives an already-authenticated page handed in by the caller (the local
 * poster agent's headed browser, or post.ts's headless one built from the
 * saved auth/<platform>.json session). The caller owns the browser lifecycle.
 *
 * Land Century is a Next.js single-page app (Ant Design forms) over an API at
 * api-prod.landcentury.com. Everything a seller does sits under /admin and
 * needs a login; logged-out visitors are bounced to the home page, where the
 * account icon opens the Sign In modal (#email, #password). The session is a
 * JWT in localStorage ("apiToken") plus the site's own cookies; Playwright's
 * storageState keeps both.
 *
 * The listing form (/admin/listings/form/create, then
 * /admin/listings/form/<id>?step=N) is a five-step wizard:
 *
 *   0 Main Info      listing type (Vacant Land), categories (multi-select,
 *                    REQUIRED), parcel number, cash price, owner-finance
 *                    checkbox with price + free-text terms. "Next" here POSTs
 *                    /api/admin/properties/create and moves to the new id.
 *   1 Description    a Quill rich-text editor (.ql-editor). There is NO title
 *                    field anywhere: the site names the listing itself
 *                    ("1.00 Acres for Sale in Fairplay, Colorado"), so the ad
 *                    headline goes in as the description's first line.
 *   2 Location       country / state / county / city / street / zip, or
 *                    latitude + longitude with a "Get Location" button that
 *                    reverse-geocodes the address fields.
 *   3 Media          a multi-file input; each file is uploaded on its own
 *                    (jpeg/png/webp, under 20 MB) and the first becomes the
 *                    main image. YouTube link.
 *   4 Detailed Info  acres (sq ft auto-fills on blur), deed type, zoning,
 *                    road access, utilities, taxes, legal description.
 *
 * "Next" / "Save Changes" PATCH /api/admin/properties/<id> and keep the
 * listing unpublished; the step-4 button reads "Publish" and sends
 * isPublished=true. The server may answer with a publishMessage ("Missing
 * Data" / "Listing not published") that the site shows as a notification;
 * the poster reads those and fails loudly. A dry run stops after Save
 * Changes on step 4, leaving a Draft the operator can inspect or publish.
 *
 * Existing listings are read the way the admin pages read them, with the
 * session's own token against /api/v1/users/properties/all, and matched by
 * parcel number, then by price + acres. Public URL:
 * https://www.landcentury.com/land-for-sale/<state>/<slug> where slug comes
 * from the property record.
 *
 * Plans (2026-10-05): Single Listing $5/mo, Basic $50/mo (30 listings), Pro
 * $100/mo. The account must be on a seller plan; the form otherwise shows an
 * "Account update required" company form, which the poster reports.
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
  listPhotos,
  loadPlatformConfig,
  loginExpiredError,
  requireListingFacts,
  resolveLocation,
  saveProofScreenshot,
} from './post-common'
import { Financing, choosePhotos, extractApn, financingFromTask, textToHtml } from './post-landmodo'
import { coordinatesFromTask } from './post-parcelview'

const PLATFORM = 'land_century'
const SCRIPT = 'post-land_century.ts'
const SITE = 'https://www.landcentury.com'
const API = 'https://api-prod.landcentury.com'

export const LANDCENTURY_LIMITS = {
  /** The Quill editor has no cap; config/ad-platforms.json says 1500. Sanity ceiling only. */
  descriptionMaxChars: 6000,
  /** No cap in the uploader; keep uploads bounded like Land.com. metadata.land_century_max_photos overrides. */
  maxPhotos: 20,
  /** The uploader refuses files of 20 MB and over client-side. */
  maxPhotoBytes: 20 * 1024 * 1024,
}

/** Land categories from /api/public/categories/groups (group "Vacant Land"), 2026-10-05. */
export const LAND_CATEGORIES = [
  'Residential Buildable Land',
  'Agricultural & Farm Land',
  'Owner Finance Deals',
  'Commercial & Industrial Land',
  'Recreational & Hunting Land',
  'Mobile Home & RV Land',
  'Waterfront Land',
  'Resort Land',
  'Vacant Land',
  'Auction',
]
export const DEED_TYPES = ['Warranty Deed', 'Special Warranty Deed', 'Grant Deed', 'Quit Claim Deed', 'Contract for Deed']
export const ZONINGS = ['Residential', 'Rural', 'Agricultural', 'Recreational', 'Farm', 'Commercial', 'Waterfront', 'Hunting', 'Resort', 'Mobile Home']
export const ROAD_ACCESSES = ['Paved Road', 'Dirt Road', 'Gravel Road', 'Paved to Dirt Road', 'Verify with the County', 'Unknown Road']
export const UTILITIES = [
  'Please, contract county',
  'City utilities available',
  'Electricity available, septic and well required',
  'No utilities',
]

/**
 * All Land Century DOM knowledge lives here so a site redesign is a one-file
 * fix. The form has no ids or names on its inputs: every field is found by
 * its Ant Design Form.Item label text.
 */
export const LANDCENTURY_SELECTORS = {
  createUrl: `${SITE}/admin/listings/form/create`,
  formUrl: (id: string | number, step: number) => `${SITE}/admin/listings/form/${id}?step=${step}`,
  listingsUrl: `${SITE}/admin/listings/all`,
  /** The wizard form; also present for the "Account update required" company form. */
  form: 'form.properties-admin-form',
  pageTitle: 'h1, h2, h3',
  accountUpdateHeading: 'text=/Account update required/i',
  loginModalPassword: '.ant-modal input#password',
  skeleton: '.ant-skeleton',
  /**
   * Ant Design form item by its label text: the nearest .ant-form-item
   * ancestor of the label, so a nested item (Latitude inside "OR") resolves
   * to itself and not to its parent. The control lives inside it.
   */
  item: (label: string) =>
    `xpath=//label[normalize-space(.)="${label}"]/ancestor::*[contains(concat(" ", normalize-space(@class), " "), " ant-form-item ")][1]`,
  textInput: 'input.ant-input, textarea.ant-input',
  numberInput: 'input.ant-input-number-input',
  select: '.ant-select',
  selectSelector: '.ant-select-selector',
  selectSearch: '.ant-select-selection-search-input',
  selectedTag: '.ant-select-selection-item',
  dropdownOption: '.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option',
  dropdownOptionByText: (text: string) =>
    `.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option:has(.ant-select-item-option-content:text-is("${text}"))`,
  checkboxByText: (text: string) => `label.ant-checkbox-wrapper:has-text("${text}") input[type="checkbox"]`,
  stepTitle: (title: string) => `.ant-steps-item:has-text("${title}")`,
  quillEditor: '.ql-editor',
  quillContainer: '.ql-container',
  photoInput: 'input[type="file"][accept="image/*"]',
  photoCard: 'label.ant-checkbox-wrapper:has-text("Main Image")',
  button: (text: string) => `button:has-text("${text}")`,
  notification: '.ant-notification-notice',
  notificationMessage: '.ant-notification-notice-message',
  notificationDescription: '.ant-notification-notice-description',
  message: '.ant-message-notice',
  modalClose: '.ant-modal-wrap:not([style*="display: none"]) .ant-modal-close',
}

const FORM_URL_RE = /\/admin\/listings\/form\/(\d+)/

export interface PropertyRecord {
  id: number
  name: string
  slug: string | null
  parcelNumber: string | null
  /** Dollars (the API stores cents). */
  cashPrice: number | null
  sizeAcres: number | null
  stateRegion: string | null
  isPublished: boolean
  isSold: boolean
  errors: string[]
}

export async function postToLandCentury(
  task: PosterTask,
  adCopy: AdCopy,
  opts: PostOptions & PostContext
): Promise<PostResult> {
  if (!(opts.platform ?? loadPlatformConfig(PLATFORM)).enabled) {
    throw new Error('Land Century is not enabled in config/posting-platforms.json')
  }
  const log = opts.log ?? (() => {})
  const page = opts.page
  const facts = requireListingFacts(task)
  const location = await resolveLocation(facts.location)
  for (const w of location.warnings) log(`land_century: location: ${w}`)
  const apn = apnForLandCentury(task, adCopy)
  const financing = financingFromTask(task, adCopy)
  const ownerFinanced = financing.downPaymentUsd !== null || financing.monthlyPaymentUsd !== null
  const categories = categoriesForTask(task, adCopy, ownerFinanced)
  const descriptionHtml = descriptionHtmlForLandCentury(adCopy, log)
  const notices = watchNotifications(page, log)
  watchApiResponses(page, log)

  // 1. Existing listings on the account (same call the admin list makes).
  log('land_century: reading the account listings')
  await page.goto(LANDCENTURY_SELECTORS.listingsUrl, { waitUntil: 'domcontentloaded' })
  await settle(page)
  if (await loggedOut(page)) throw loginExpiredError(PLATFORM, page.url())
  await preflightServerSession(page, coordinatesFromTask(task), log)
  const existing = await readProperties(page)
  log(
    `land_century: ${existing.length} listing(s) on the account: ` +
      (existing.map((p) => `${p.id} [${statusOf(p)}] ${p.parcelNumber ?? '?'} ${p.name.slice(0, 40)}`).join('; ') || 'none')
  )
  const match = findProperty(existing, apn, facts.priceUsd, facts.acreage, location.stateAbbr)

  let propertyId: number
  if (match && match.isPublished && !match.isSold) {
    log(`land_century: listing ${match.id} "${match.name}" is already Live (matched on ${match.matchedOn}); recording it, not creating another`)
    return finish(page, match.id, opts.outputDir, log)
  }
  if (match && match.isSold) {
    throw new Error(
      `Land Century already has listing ${match.id} "${match.name}" marked Sold (matched on ${match.matchedOn}). ` +
        `Untick Sold at ${LANDCENTURY_SELECTORS.formUrl(match.id, 0)} by hand, then Publish again`
    )
  }
  if (match) {
    log(`land_century: finishing draft ${match.id} "${match.name}" (matched on ${match.matchedOn})`)
    propertyId = match.id
    await openStep(page, propertyId, 0)
    await fillMainInfo(page, { apn, priceUsd: facts.priceUsd, financing, categories, task, log })
    await clickNext(page, 'Next', log)
  } else {
    log('land_century: opening the create form')
    await page.goto(LANDCENTURY_SELECTORS.createUrl, { waitUntil: 'domcontentloaded' })
    await waitForForm(page)
    await fillMainInfo(page, { apn, priceUsd: facts.priceUsd, financing, categories, task, log })
    await clickNext(page, 'Next', log)
    await page.waitForURL(FORM_URL_RE, { timeout: 30_000 }).catch(() => {})
    const m = page.url().match(FORM_URL_RE)
    if (!m) {
      throw new Error(
        `Clicking Next on Main Info did not create the listing (still at ${page.url()}). ` +
          noticeHint(notices)
      )
    }
    propertyId = Number(m[1])
    log(`land_century: created listing ${propertyId}`)
  }

  // 2. Description (step 1).
  await openStep(page, propertyId, 1)
  await fillDescription(page, descriptionHtml, adCopy.headline, log)
  await clickNext(page, 'Next', log)

  // 3. Location (step 2).
  await openStep(page, propertyId, 2)
  await fillLocation(page, {
    coords: coordinatesFromTask(task),
    stateName: location.state,
    county: location.county,
    city: stringMeta(task, 'city'),
    street: stringMeta(task, 'address') ?? stringMeta(task, 'location_description'),
    zip: stringMeta(task, 'zip'),
    log,
  })
  await clickNext(page, 'Next', log)

  // 4. Media (step 3).
  await openStep(page, propertyId, 3)
  const photos = eligiblePhotos(choosePhotos(listPhotos(opts.outputDir), stringMeta(task, 'primaryPhoto')), maxPhotos(task), log)
  const already = await photoCount(page)
  if (already >= photos.length) {
    log(`land_century: listing already shows ${already} photo(s); nothing to upload`)
  } else {
    const remaining = photos.slice(already)
    log(`land_century: uploading ${remaining.length} photo(s)${already ? ` (${already} already on the listing)` : ''}`)
    await uploadPhotos(page, remaining, already, log)
  }
  const video = stringMeta(task, 'video_url') ?? stringMeta(task, 'youtube_url')
  if (video) await fillItemText(page, 'Listing Video on YouTube', video, true)
  await clickNext(page, 'Next', log)

  // 5. Detailed Info (step 4), then Save Changes (dry run) or Publish.
  await openStep(page, propertyId, 4)
  await fillDetails(page, { acreage: facts.acreage, task, adCopy, log })
  if (opts.dryRun) {
    await clickNext(page, 'Save Changes', log)
    const after = await readProperty(page, propertyId)
    log(
      `land_century: dry run, listing ${propertyId} left as ${after ? statusOf(after) : 'unknown status'} at ` +
        `${LANDCENTURY_SELECTORS.formUrl(propertyId, 0)}` +
        (after?.errors.length ? `; site lists ${after.errors.length} issue(s): ${after.errors.join(' | ')}` : '')
    )
    const screenshotPath = await saveProofScreenshot(page, opts.outputDir, PLATFORM)
    return { listingUrl: null, screenshotPath }
  }

  await clickNext(page, 'Publish', log)
  await page.waitForTimeout(2500)
  const record = await readProperty(page, propertyId)
  if (!record) throw new Error(`Could not read listing ${propertyId} back after Publish. ${noticeHint(notices)}`)
  if (!record.isPublished) {
    throw new Error(
      `Listing ${propertyId} is still a Draft after Publish` +
        (record.errors.length ? `; the site lists: ${record.errors.join(' | ')}` : '') +
        `. ${noticeHint(notices)} Fix it at ${LANDCENTURY_SELECTORS.formUrl(propertyId, 0)} and Publish again`
    )
  }
  log(`land_century: listing ${propertyId} is Live`)
  return finish(page, propertyId, opts.outputDir, log, record)
}

// --- step fillers --------------------------------------------------------------

interface MainInfoArgs {
  apn: string | null
  priceUsd: number
  financing: Financing
  categories: string[]
  task: PosterTask
  log: (m: string) => void
}

async function fillMainInfo(page: Page, a: MainInfoArgs): Promise<void> {
  await waitForForm(page)
  await selectSingle(page, 'Select Listing Type', 'Vacant Land', a.log)
  await selectCategories(page, a.categories, a.log)
  if (a.apn) await fillItemText(page, 'Parcel Number', a.apn)
  await fillItemNumber(page, 'Cash Price', String(a.priceUsd))
  const financed = a.financing.downPaymentUsd !== null || a.financing.monthlyPaymentUsd !== null
  await setCheckbox(page, 'Owner Finance Options', financed)
  if (financed) {
    const financePrice = numberMeta(a.task, 'owner_finance_price_usd') ?? numberMeta(a.task, 'land_century_finance_price_usd') ?? a.priceUsd
    await fillItemNumber(page, 'Owner Finance Price, $', String(financePrice))
    await fillItemText(page, 'Owner Finance Terms', financeTermsForTask(a.task, a.financing))
  }
  await setCheckbox(page, 'Auction Listing', false)
}

async function fillDescription(page: Page, html: string, headline: string, log: (m: string) => void): Promise<void> {
  const editor = page.locator(LANDCENTURY_SELECTORS.quillEditor).first()
  await editor.waitFor({ state: 'visible', timeout: 45_000 })
  const container = page.locator(LANDCENTURY_SELECTORS.quillContainer).first()
  // Preferred: hand the HTML to the Quill instance react-quill keeps on its
  // component (found through the React fiber), which fires the editor's
  // text-change so the form state updates. Built with new Function: tsx
  // injects a __name helper into nested named functions that does not exist
  // in the page.
  const pasted = (await container
    .evaluate(new Function('el', 'html', QUILL_SET_HTML) as (el: Element, html: string) => boolean, html)
    .catch(() => false)) as boolean
  if (!pasted) {
    log('land_century: Quill instance not reachable; typing the description instead')
    await editor.click()
    await page.keyboard.press('Control+A')
    await page.keyboard.press('Delete')
    await page.keyboard.type(htmlToPlainLines(html).join('\n'), { delay: 2 })
  }
  await page.waitForTimeout(500)
  const text = (await editor.innerText().catch(() => '')).replace(/\s+/g, ' ')
  const probe = headline.replace(/\s+/g, ' ').slice(0, 40)
  if (!text.includes(probe)) {
    throw new Error(`The description editor does not show the headline after filling it (editor starts "${text.slice(0, 80)}")`)
  }
}

export const QUILL_SET_HTML = `
  var key = Object.keys(el).find(function (k) { return k.indexOf('__reactFiber$') === 0 })
  var fiber = key ? el[key] : null
  var editor = null
  while (fiber && !editor) {
    var inst = fiber.stateNode
    if (inst && inst.editor && inst.editor.clipboard) editor = inst.editor
    else if (inst && typeof inst.getEditor === 'function') editor = inst.getEditor()
    fiber = fiber.return
  }
  if (!editor) return false
  editor.setText('')
  editor.clipboard.dangerouslyPasteHTML(0, html, 'user')
  editor.setSelection(editor.getLength(), 0, 'silent')
  return true
`

interface LocationArgs {
  coords: { latitude: number; longitude: number } | null
  stateName: string
  county: string
  city?: string
  street?: string
  zip?: string
  log: (m: string) => void
}

async function fillLocation(page: Page, a: LocationArgs): Promise<void> {
  await waitForForm(page)
  if (a.coords) {
    await fillItemText(page, 'Latitude', String(a.coords.latitude))
    await fillItemText(page, 'Logintude', String(a.coords.longitude)) // sic: the site's label
    const before = await readItemText(page, 'County')
    await page.locator(LANDCENTURY_SELECTORS.button('Get Location')).first().click()
    await waitForChange(page, async () => (await readItemText(page, 'County')) !== before, 20_000)
    a.log(`land_century: reverse geocode gave "${await readItemText(page, 'Street')}", ${await readItemText(page, 'City')}, ${await readItemText(page, 'County')}, ${await readItemText(page, 'State/Region')} ${await readItemText(page, 'ZIP')}`)
  } else {
    a.log('land_century: no latitude/longitude on the task; filling the address and asking the site to geocode it')
  }
  // The geocoder's answers are a neighbour's street address; the task's own
  // facts win for everything the operator set.
  if (!(await readItemText(page, 'Country'))) await fillItemText(page, 'Country', 'United States')
  await fillItemText(page, 'State/Region', a.stateName)
  await fillItemText(page, 'County', a.county)
  if (a.city) await fillItemText(page, 'City', a.city)
  if (a.street !== undefined) await fillItemText(page, 'Street', a.street)
  if (a.zip) await fillItemText(page, 'ZIP', a.zip)
  if (!a.coords) {
    // Get GPS refuses unless every address box is filled.
    for (const label of ['Country', 'State/Region', 'County', 'City', 'Street', 'ZIP']) {
      if (!(await readItemText(page, label))) {
        throw new Error(
          `Land Century needs latitude/longitude or a full address to place the pin, and "${label}" is empty. ` +
            'Add "latitude" and "longitude" (or city, address and zip) to the task metadata and Publish again'
        )
      }
    }
    await page.locator(LANDCENTURY_SELECTORS.button('Get GPS')).first().click()
    await waitForChange(page, async () => Boolean(await readItemText(page, 'Latitude')), 20_000)
    if (!(await readItemText(page, 'Latitude'))) {
      throw new Error(
        'Land Century could not geocode the address and the task has no latitude/longitude. ' +
          'Add "latitude" and "longitude" to the task metadata and Publish again'
      )
    }
  }
}

interface DetailsArgs {
  acreage: number
  task: PosterTask
  adCopy: AdCopy
  log: (m: string) => void
}

async function fillDetails(page: Page, a: DetailsArgs): Promise<void> {
  await waitForForm(page)
  const acres = page.locator(LANDCENTURY_SELECTORS.item('Lot Size in Acres')).locator(LANDCENTURY_SELECTORS.textInput).first()
  await acres.fill(String(a.acreage))
  await acres.press('Tab') // blur fills Lot Size in Sq.Ft
  const sqft = await readItemText(page, 'Lot Size in Sq.Ft')
  if (!sqft) await fillItemText(page, 'Lot Size in Sq.Ft', String(Math.round(a.acreage * 43560)))
  const deed = optionMeta(a.task, 'deed_type', DEED_TYPES) ?? optionMeta(a.task, 'land_century_deed_type', DEED_TYPES)
  if (deed) await pickAutoComplete(page, 'Deed Type', deed, a.log)
  const zoning = zoningForTask(a.task, a.adCopy)
  if (zoning) await pickAutoComplete(page, 'Zoning', zoning, a.log)
  const road = roadAccessForTask(a.task)
  if (road) await pickAutoComplete(page, 'Road Access', road, a.log)
  const utilities = utilitiesForTask(a.task)
  if (utilities) await pickAutoComplete(page, 'Utilities', utilities, a.log)
  const taxes = numberMeta(a.task, 'taxes_usd') ?? numberMeta(a.task, 'annual_taxes_usd')
  if (taxes !== undefined) await fillItemText(page, 'Taxes, $', String(taxes), true)
  const legal = stringMeta(a.task, 'legal_description') ?? stringMeta(a.task, 'location_description')
  if (legal) await fillItemText(page, 'Legal Description', legal, true)
}

// --- Ant Design helpers --------------------------------------------------------

async function waitForForm(page: Page): Promise<void> {
  const form = page.locator(LANDCENTURY_SELECTORS.form).first()
  await form.waitFor({ state: 'visible', timeout: 60_000 }).catch(async () => {
    if (await loggedOut(page)) throw loginExpiredError(PLATFORM, page.url())
    throw new Error(
      `The Land Century listing form did not appear at ${page.url()} (tried: ${LANDCENTURY_SELECTORS.form}). ` +
        `Update the SELECTORS block in ${SCRIPT}.`
    )
  })
  if ((await page.locator(LANDCENTURY_SELECTORS.accountUpdateHeading).count()) > 0) {
    throw new Error(
      'Land Century shows "Account update required" instead of the listing form: the account is not a seller ' +
        'account yet. Fill the company name, email and phone at ' +
        `${LANDCENTURY_SELECTORS.createUrl} by hand (and pick a plan at ${SITE}/sell), then Publish again`
    )
  }
  await page.waitForTimeout(300)
}

async function openStep(page: Page, id: number, step: number): Promise<void> {
  const want = LANDCENTURY_SELECTORS.formUrl(id, step)
  if (page.url() !== want) {
    await page.goto(want, { waitUntil: 'domcontentloaded' })
  }
  await waitForForm(page)
  // The wizard loads the record first; wait for the step's own control.
  const marker: Record<number, string> = {
    0: LANDCENTURY_SELECTORS.item('Select Listing Type'),
    1: LANDCENTURY_SELECTORS.quillEditor,
    2: LANDCENTURY_SELECTORS.item('Latitude'),
    3: LANDCENTURY_SELECTORS.photoInput,
    4: LANDCENTURY_SELECTORS.item('Lot Size in Acres'),
  }
  await page.locator(marker[step]).first().waitFor({ state: 'attached', timeout: 45_000 })
  await page.waitForTimeout(500)
}

function itemControl(page: Page, label: string, control: string): Locator {
  return page.locator(LANDCENTURY_SELECTORS.item(label)).first().locator(control).first()
}

async function requireItem(page: Page, label: string, control: string, optional = false): Promise<Locator | null> {
  const loc = itemControl(page, label, control)
  if ((await loc.count()) === 0) {
    if (optional) return null
    throw new Error(
      `Could not find the "${label}" field on the Land Century listing form (tried: ${LANDCENTURY_SELECTORS.item(label)} ${control}). ` +
        `Update the SELECTORS block in ${SCRIPT}.`
    )
  }
  return loc
}

async function fillItemText(page: Page, label: string, value: string, optional = false): Promise<void> {
  const loc = await requireItem(page, label, LANDCENTURY_SELECTORS.textInput, optional)
  if (!loc) return
  await loc.scrollIntoViewIfNeeded().catch(() => {})
  await loc.fill(value)
  const got = await loc.inputValue().catch(() => '')
  if (value.trim() && got.trim() !== value.trim()) {
    throw new Error(`The "${label}" field reads "${got}" after filling "${value}"`)
  }
}

async function fillItemNumber(page: Page, label: string, value: string): Promise<void> {
  const loc = await requireItem(page, label, LANDCENTURY_SELECTORS.numberInput)
  if (!loc) return
  await loc.scrollIntoViewIfNeeded().catch(() => {})
  await loc.fill(value)
  await loc.press('Tab')
  const got = (await loc.inputValue().catch(() => '')).replace(/[^\d.]/g, '')
  if (Number(got) !== Number(value)) throw new Error(`The "${label}" field reads "${got}" after filling "${value}"`)
}

async function readItemText(page: Page, label: string): Promise<string> {
  const loc = itemControl(page, label, LANDCENTURY_SELECTORS.textInput)
  if ((await loc.count()) === 0) return ''
  return (await loc.inputValue().catch(() => '')).trim()
}

async function setCheckbox(page: Page, text: string, checked: boolean): Promise<void> {
  const box = page.locator(LANDCENTURY_SELECTORS.checkboxByText(text)).first()
  if ((await box.count()) === 0) {
    throw new Error(`Could not find the "${text}" checkbox on the Land Century form. Update the SELECTORS block in ${SCRIPT}.`)
  }
  if ((await box.isChecked()) !== checked) {
    await box.click({ force: true })
    await page.waitForTimeout(200)
  }
  if ((await box.isChecked()) !== checked) throw new Error(`The "${text}" checkbox would not ${checked ? 'tick' : 'untick'}`)
}

/** Single-value Ant Select: open it and click the option by text. */
async function selectSingle(page: Page, label: string, option: string, log: (m: string) => void): Promise<void> {
  const sel = await requireItem(page, label, LANDCENTURY_SELECTORS.select)
  if (!sel) return
  const current = (await sel.locator(LANDCENTURY_SELECTORS.selectedTag).first().innerText().catch(() => '')).trim()
  if (current === option) return
  await sel.locator(LANDCENTURY_SELECTORS.selectSelector).first().click()
  const opt = page.locator(LANDCENTURY_SELECTORS.dropdownOption).filter({ hasText: option }).first()
  await opt.waitFor({ state: 'visible', timeout: 10_000 })
  await opt.click()
  await page.waitForTimeout(300)
  log(`land_century: ${label} = ${option}`)
}

/**
 * Multi-select categories: open the dropdown and click each wanted option by
 * its exact text. Never by index: the first live run picked the neighbours of
 * the wanted options because the list re-rendered after the first click.
 */
async function selectCategories(page: Page, wanted: string[], log: (m: string) => void): Promise<void> {
  const sel = await requireItem(page, 'Select Categories', LANDCENTURY_SELECTORS.select)
  if (!sel) return
  const chosen = async () => selectedTags(await sel.locator(LANDCENTURY_SELECTORS.selectedTag).allInnerTexts())
  const have = await chosen()
  const missing = wanted.filter((w) => !have.some((h) => sameText(h, w)))
  if (missing.length === 0) {
    log(`land_century: categories already ${have.join(', ')}`)
    return
  }
  await sel.locator(LANDCENTURY_SELECTORS.selectSelector).first().click()
  const options = page.locator(LANDCENTURY_SELECTORS.dropdownOption)
  await options.first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {})
  const names = (await options.allInnerTexts()).map((t) => t.trim())
  for (const want of missing) {
    const name = names.find((n) => sameText(n, want))
    if (!name) {
      log(`land_century: NOTE category "${want}" is not offered (options: ${names.join(', ')}); skipping it`)
      continue
    }
    const option = page.locator(LANDCENTURY_SELECTORS.dropdownOptionByText(name)).first()
    if ((await option.count()) === 0) {
      log(`land_century: NOTE could not locate the "${name}" option by text; skipping it`)
      continue
    }
    const before = await chosen()
    await option.click()
    await page.waitForTimeout(250)
    const after = await chosen()
    if (!after.some((t) => sameText(t, name)) || after.length <= before.length) {
      throw new Error(`Clicking the "${name}" category did not select it (tags now: ${after.join(', ') || 'none'})`)
    }
  }
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  const now = await chosen()
  if (now.length === 0) {
    throw new Error(`No category got selected (wanted ${wanted.join(', ')}; dropdown offered ${names.join(', ') || 'nothing'})`)
  }
  const wrong = now.filter((t) => !wanted.some((w) => sameText(w, t)))
  if (wrong.length) throw new Error(`Unexpected categories selected: ${wrong.join(', ')} (wanted ${wanted.join(', ')})`)
  log(`land_century: categories = ${now.join(', ')}`)
}

/** The Deed/Zoning/Road/Utilities controls are Ant AutoCompletes: type the value, pick the option. */
async function pickAutoComplete(page: Page, label: string, value: string, log: (m: string) => void): Promise<void> {
  const sel = await requireItem(page, label, LANDCENTURY_SELECTORS.select, true)
  if (!sel) {
    log(`land_century: no "${label}" control on this page; skipping`)
    return
  }
  const input = sel.locator(LANDCENTURY_SELECTORS.selectSearch).first()
  await input.click()
  await input.fill(value)
  const opt = page.locator(LANDCENTURY_SELECTORS.dropdownOption).filter({ hasText: value }).first()
  if (await opt.isVisible().catch(() => false)) await opt.click()
  else await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  const got = (await input.inputValue().catch(() => '')).trim()
  if (!sameText(got, value)) log(`land_century: NOTE ${label} reads "${got}" after choosing "${value}"`)
  else log(`land_century: ${label} = ${value}`)
}

async function clickNext(page: Page, label: 'Next' | 'Save Changes' | 'Publish', log: (m: string) => void): Promise<void> {
  const btn = page.locator(LANDCENTURY_SELECTORS.form).locator(LANDCENTURY_SELECTORS.button(label)).last()
  if ((await btn.count()) === 0) {
    throw new Error(`Could not find the "${label}" button on the Land Century form. Update the SELECTORS block in ${SCRIPT}.`)
  }
  const urlBefore = page.url()
  await btn.scrollIntoViewIfNeeded().catch(() => {})
  await btn.click()
  // The button shows a spinner while the request is in flight.
  await page.waitForTimeout(500)
  await page
    .waitForFunction(() => !document.querySelector('form.properties-admin-form button .ant-btn-loading-icon'), null, { timeout: 60_000 })
    .catch(() => {})
  await page.waitForTimeout(1000)
  const notice = await latestNotification(page)
  if (notice && /error|not published|missing data/i.test(notice)) {
    throw new Error(`Land Century answered "${notice.slice(0, 300)}" after ${label} at ${urlBefore}`)
  }
  log(`land_century: ${label}${notice ? ` -> "${notice.slice(0, 120)}"` : ''}`)
  await dismissModals(page)
}

async function uploadPhotos(page: Page, photos: string[], already: number, log: (m: string) => void): Promise<void> {
  const input = page.locator(LANDCENTURY_SELECTORS.photoInput).first()
  if ((await input.count()) === 0) {
    throw new Error(`Could not find the photo input on the Land Century Media step (tried: ${LANDCENTURY_SELECTORS.photoInput}). Update the SELECTORS block in ${SCRIPT}.`)
  }
  let seen = Math.max(already, await photoCount(page))
  const failed: string[] = []
  for (const photo of photos) {
    const name = path.basename(photo)
    const before = seen
    let landed = false
    for (let attempt = 1; attempt <= 2 && !landed; attempt++) {
      await input.setInputFiles([photo])
      const deadline = Date.now() + 90_000
      while (Date.now() < deadline) {
        seen = await photoCount(page)
        if (seen > before) break
        const msg = await latestMessage(page)
        if (/not uploaded|only upload|smaller than/i.test(msg)) {
          log(`land_century: ${name} attempt ${attempt}: site says "${msg}"`)
          break
        }
        await page.waitForTimeout(1000)
      }
      landed = seen > before
      if (!landed && attempt === 1) await page.waitForTimeout(2000)
    }
    if (landed) log(`land_century: photo ${seen - already}/${photos.length} ${name} uploaded`)
    else failed.push(name)
  }
  if (seen <= already) {
    throw new Error(`No new photo appeared after uploading ${photos.length} file(s)` + (failed.length ? ` (${failed.join(', ')})` : ''))
  }
  log(`land_century: ${seen} photo(s) on the listing`)
  if (failed.length) log(`land_century: NOTE ${failed.length} photo(s) never showed: ${failed.join(', ')}`)
  await page.waitForTimeout(1000)
}

async function photoCount(page: Page): Promise<number> {
  return page.locator(LANDCENTURY_SELECTORS.photoCard).count().catch(() => 0)
}

// --- server-session preflight ----------------------------------------------------

const PREFLIGHT_FN = new Function(
  'return (' +
    `
  async (arg) => {
    var me = await fetch('/api/users/me', { headers: { Accept: 'application/json' }, credentials: 'include' })
    var meBody = me.ok ? await me.json() : null
    var probe = await fetch('/api/admin/reverse-geocoder', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ lat: String(arg.lat), lng: String(arg.lng) }),
    })
    var probeText = ''
    try { probeText = await probe.text() } catch (e) { probeText = '' }
    return {
      meStatus: me.status,
      isLoggedIn: !!(meBody && meBody.isLoggedIn),
      hasUser: !!(meBody && meBody.user),
      hasToken: !!(meBody && meBody.token),
      hasUserToken: !!(meBody && meBody.user && meBody.user.token),
      userType: meBody && meBody.user ? meBody.user.type : null,
      hasLocalToken: !!localStorage.getItem('apiToken'),
      probeStatus: probe.status,
      probeMessage: probeText.slice(0, 200),
    }
  }
` +
    ')'
)() as (arg: { lat: number; lng: number }) => unknown

interface Preflight {
  meStatus: number
  isLoggedIn: boolean
  hasUser: boolean
  hasToken: boolean
  hasUserToken: boolean
  userType: number | null
  hasLocalToken: boolean
  probeStatus: number
  probeMessage: string
}

/**
 * The site has two sessions: the browser-side apiToken (localStorage) that
 * talks to api-prod directly, and the server-side session cookie behind the
 * www.landcentury.com/api/* routes that the listing form posts through. The
 * first dry run (2026-10-05) read the listings with the former while the
 * create call failed "Unauthenticated." through the latter. This asks the
 * server routes the same questions the form will, before anything is
 * created: /api/users/me (does the session hold a user and a token) and the
 * reverse geocoder (an authenticated POST the Location step makes anyway).
 */
async function preflightServerSession(
  page: Page,
  coords: { latitude: number; longitude: number } | null,
  log: (m: string) => void
): Promise<void> {
  const arg = { lat: coords?.latitude ?? 39.0, lng: coords?.longitude ?? -105.5 }
  const r = (await page.evaluate(PREFLIGHT_FN, arg).catch((err) => ({ error: String(err) }))) as Preflight | { error: string }
  if ('error' in r) {
    log(`land_century: preflight could not run (${r.error}); continuing`)
    return
  }
  log(
    `land_century: server session: /api/users/me ${r.meStatus} isLoggedIn=${r.isLoggedIn} user=${r.hasUser} (type ${r.userType}) token=${r.hasToken} user.token=${r.hasUserToken}; ` +
      `browser token=${r.hasLocalToken}; reverse-geocoder ${r.probeStatus}${r.probeMessage ? ` ${r.probeMessage.replace(/\s+/g, ' ').slice(0, 120)}` : ''}`
  )
  if (/unauthenticated/i.test(r.probeMessage) || r.probeStatus === 401 || !r.isLoggedIn) {
    throw new Error(
      'Land Century\'s server session cannot reach its backend (the site answers "Unauthenticated." to the calls the ' +
        'listing form makes) even though the page shows you as signed in. Delete workers/posting/auth/land_century.json ' +
        'and Publish again so the agent takes a fresh login, or run the CLI with --login'
    )
  }
}

/** Logs every non-2xx /api/ response (status and message only, never headers or bodies in full). */
function watchApiResponses(page: Page, log: (m: string) => void): void {
  page.on('response', (res) => {
    const url = res.url()
    if (!/landcentury\.com\/(api|sanctum)\//.test(url)) return
    const status = res.status()
    if (status >= 200 && status < 300) return
    res
      .text()
      .then((body) => {
        const message = body.match(/"message"\s*:\s*"([^"]{0,200})"/)?.[1] ?? body.replace(/\s+/g, ' ').slice(0, 120)
        // Header NAMES only (never values): shows whether the browser sent
        // cookies and an authorization header on the rejected call.
        const sent = Object.keys(res.request().headers()).sort().join(', ')
        log(`land_century: ${res.request().method()} ${url.replace(/^https?:\/\//, '')} -> ${status} ${message} [request headers: ${sent}]`)
      })
      .catch(() => log(`land_century: ${res.request().method()} ${url.replace(/^https?:\/\//, '')} -> ${status}`))
  })
}

// --- reads through the site's own API (session token from the page) ------------

const READ_PROPERTIES = `
  async (arg) => {
    var token = localStorage.getItem('apiToken')
    if (!token) return { error: 'no apiToken in localStorage' }
    var res = await fetch(arg.url, {
      headers: { Accept: 'application/json', authorization: 'Bearer ' + token },
      credentials: 'include',
    })
    if (!res.ok) return { error: 'HTTP ' + res.status }
    return { data: await res.json() }
  }
`

/**
 * The reader as a real function for page.evaluate. Parenthesised on purpose:
 * "return" followed by the string's leading newline would return undefined
 * (automatic semicolon insertion), which is exactly what broke the first
 * live run on 2026-10-05.
 */
export const READ_PROPERTIES_FN = new Function('return (' + READ_PROPERTIES + ')')() as (arg: { url: string }) => unknown

interface ApiRead<T> {
  error?: string
  data?: T
}

async function apiRead<T>(page: Page, url: string): Promise<ApiRead<T>> {
  const res = (await page.evaluate(READ_PROPERTIES_FN, { url })) as ApiRead<T> | undefined
  if (!res || typeof res !== 'object') {
    throw new Error(`Reading ${url} from the page returned nothing (${String(res)}); ${SCRIPT} READ_PROPERTIES is broken`)
  }
  return res
}

/** Every listing on the account, read the way /admin/listings/all reads them. */
export async function readProperties(page: Page): Promise<PropertyRecord[]> {
  const out: PropertyRecord[] = []
  for (let pageNo = 1; pageNo <= 10; pageNo++) {
    const url = `${API}/api/v1/users/properties/all?page=${pageNo}&limit=100`
    const res = await apiRead<{ properties?: { total?: number; properties?: unknown[] } }>(page, url)
    if (res.error) throw new Error(`Could not read the Land Century listings (${res.error}); is the session still valid?`)
    const rows = res.data?.properties?.properties ?? []
    for (const r of rows) out.push(parsePropertyRecord(r))
    const total = res.data?.properties?.total ?? out.length
    if (rows.length === 0 || out.length >= total) break
  }
  return out
}

export async function readProperty(page: Page, id: number): Promise<PropertyRecord | null> {
  const res = await apiRead<{ property?: unknown }>(page, `${API}/api/v1/users/properties/single/${id}`)
  if (res.error || !res.data?.property) return null
  return parsePropertyRecord(res.data.property)
}

// --- finish ----------------------------------------------------------------------

async function finish(page: Page, id: number, outputDir: string, log: (m: string) => void, record?: PropertyRecord): Promise<PostResult> {
  const rec = record ?? (await readProperty(page, id))
  let listingUrl = LANDCENTURY_SELECTORS.formUrl(id, 0)
  if (rec?.slug && rec.stateRegion) {
    listingUrl = publicListingUrl(rec.stateRegion, rec.slug)
  } else {
    log(`land_century: could not read the public slug for ${id}; reporting the edit URL`)
  }
  await page.goto(listingUrl, { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForTimeout(2500)
  await dismissModals(page)
  const title = await page.title().catch(() => '')
  if (/page not found/i.test(title)) {
    log(`land_century: NOTE ${listingUrl} did not render a listing page (title "${title}"); check it by hand`)
  }
  const screenshotPath = await saveProofScreenshot(page, outputDir, PLATFORM)
  return { listingUrl, screenshotPath }
}

// --- page utilities --------------------------------------------------------------

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded').catch(() => {})
  await page.waitForTimeout(1500)
}

/** Logged-out admin visits bounce to the home page; the login modal has #password. */
async function loggedOut(page: Page): Promise<boolean> {
  if ((await page.locator(LANDCENTURY_SELECTORS.loginModalPassword).count()) > 0) return true
  const hasToken = await page.evaluate(() => Boolean(window.localStorage.getItem('apiToken'))).catch(() => false)
  if (!hasToken) return true
  const u = new URL(page.url())
  return !u.pathname.startsWith('/admin') && u.hostname.endsWith('landcentury.com') && u.pathname === '/'
}

async function waitForChange(page: Page, changed: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await changed()) return
    await page.waitForTimeout(500)
  }
}

async function latestNotification(page: Page): Promise<string> {
  const n = page.locator(LANDCENTURY_SELECTORS.notification).last()
  if ((await n.count()) === 0) return ''
  const msg = (await n.locator(LANDCENTURY_SELECTORS.notificationMessage).first().innerText().catch(() => '')).trim()
  const desc = (await n.locator(LANDCENTURY_SELECTORS.notificationDescription).first().innerText().catch(() => '')).trim()
  return [msg, desc].filter(Boolean).join(': ')
}

async function latestMessage(page: Page): Promise<string> {
  const m = page.locator(LANDCENTURY_SELECTORS.message).last()
  if ((await m.count()) === 0) return ''
  return (await m.innerText().catch(() => '')).trim()
}

/** Closes upsell modals (Showcase / add funds / newsletter) that the site opens on top of the admin. */
async function dismissModals(page: Page): Promise<void> {
  for (let i = 0; i < 3; i++) {
    const close = page.locator(LANDCENTURY_SELECTORS.modalClose).first()
    if ((await close.count()) === 0 || !(await close.isVisible().catch(() => false))) return
    await close.click({ force: true }).catch(() => {})
    await page.waitForTimeout(400)
  }
}

/** Records every Ant notification so a failure can quote what the site said. */
function watchNotifications(page: Page, log: (m: string) => void): string[] {
  const seen: string[] = []
  page.on('dialog', (d) => {
    seen.push(d.message())
    log(`land_century: page dialog (${d.type()}): ${d.message().slice(0, 160)}`)
    d.accept().catch(() => {})
  })
  return seen
}

function noticeHint(notices: string[]): string {
  return notices.length ? `The site said: ${notices.slice(-2).join(' | ')}.` : 'The site showed no error notification.'
}

// --- pure helpers (unit-tested) ------------------------------------------------

export function parsePropertyRecord(raw: unknown): PropertyRecord {
  const r = (raw ?? {}) as Record<string, unknown>
  const info = (r['info'] ?? {}) as Record<string, unknown>
  const errors = Array.isArray(r['errors'])
    ? (r['errors'] as Array<Record<string, unknown>>).map((e) => String(e?.['error'] ?? e)).filter(Boolean)
    : []
  const cents = numberOf(r['cashPrice'])
  return {
    id: Number(r['id']),
    name: String(r['name'] ?? ''),
    slug: typeof r['slug'] === 'string' && r['slug'] ? r['slug'] : null,
    parcelNumber: typeof r['parcelNumber'] === 'string' && r['parcelNumber'].trim() ? r['parcelNumber'].trim() : null,
    cashPrice: cents === null ? null : cents / 100,
    sizeAcres: numberOf(info['sizeAcres']),
    stateRegion: typeof r['stateRegion'] === 'string' && r['stateRegion'] ? r['stateRegion'] : null,
    isPublished: Boolean(r['isPublished']),
    isSold: Boolean(r['isSold']),
    errors,
  }
}

export function statusOf(p: PropertyRecord): 'Live' | 'Sold' | 'Draft' {
  return p.isPublished ? (p.isSold ? 'Sold' : 'Live') : 'Draft'
}

export function normalizeApn(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Matches an existing listing: by parcel number first, then by cash price +
 * acres (+ state when the record has one). Picks the Live one over a Draft
 * when several match.
 */
export function findProperty(
  records: PropertyRecord[],
  apn: string | null,
  priceUsd: number,
  acreage: number,
  stateAbbr: string
): (PropertyRecord & { matchedOn: string }) | null {
  const hits: Array<PropertyRecord & { matchedOn: string }> = []
  for (const r of records) {
    if (apn && r.parcelNumber && normalizeApn(r.parcelNumber) === normalizeApn(apn)) {
      hits.push({ ...r, matchedOn: 'parcel number' })
      continue
    }
    const priceOk = r.cashPrice !== null && Math.abs(r.cashPrice - priceUsd) < 1
    const acresOk = r.sizeAcres !== null && Math.abs(r.sizeAcres - acreage) < 0.01
    const stateOk = !r.stateRegion || sameState(r.stateRegion, stateAbbr)
    if (priceOk && acresOk && stateOk) hits.push({ ...r, matchedOn: 'price + acres' })
  }
  if (hits.length === 0) return null
  return hits.find((h) => h.isPublished && !h.isSold) ?? hits[0]
}

const STATE_NAMES: Record<string, string> = {
  AL: 'alabama', AK: 'alaska', AZ: 'arizona', AR: 'arkansas', CA: 'california', CO: 'colorado', CT: 'connecticut',
  DE: 'delaware', FL: 'florida', GA: 'georgia', HI: 'hawaii', ID: 'idaho', IL: 'illinois', IN: 'indiana', IA: 'iowa',
  KS: 'kansas', KY: 'kentucky', LA: 'louisiana', ME: 'maine', MD: 'maryland', MA: 'massachusetts', MI: 'michigan',
  MN: 'minnesota', MS: 'mississippi', MO: 'missouri', MT: 'montana', NE: 'nebraska', NV: 'nevada', NH: 'new hampshire',
  NJ: 'new jersey', NM: 'new mexico', NY: 'new york', NC: 'north carolina', ND: 'north dakota', OH: 'ohio',
  OK: 'oklahoma', OR: 'oregon', PA: 'pennsylvania', RI: 'rhode island', SC: 'south carolina', SD: 'south dakota',
  TN: 'tennessee', TX: 'texas', UT: 'utah', VT: 'vermont', VA: 'virginia', WA: 'washington', WV: 'west virginia',
  WI: 'wisconsin', WY: 'wyoming',
}

export function sameState(a: string, b: string): boolean {
  const norm = (s: string) => {
    const t = s.trim().toLowerCase()
    return STATE_NAMES[t.toUpperCase()] ?? t
  }
  return norm(a) === norm(b)
}

/** https://www.landcentury.com/land-for-sale/<state>/<slug> (the state segment is the lowercase full name). */
export function publicListingUrl(stateRegion: string, slug: string): string {
  const state = (STATE_NAMES[stateRegion.trim().toUpperCase()] ?? stateRegion.trim().toLowerCase()).replace(/\s+/g, '-')
  return `${SITE}/land-for-sale/${state}/${slug}`
}

/**
 * The site has no title field, so the headline becomes the description's
 * first line (a heading), followed by the ad copy as paragraphs and lists.
 */
export function descriptionHtmlForLandCentury(adCopy: AdCopy, log: (m: string) => void = () => {}): string {
  let text = adCopy.description.replace(/\r\n/g, '\n').trim()
  if (text.length > LANDCENTURY_LIMITS.descriptionMaxChars) {
    const cut = text.lastIndexOf('\n\n', LANDCENTURY_LIMITS.descriptionMaxChars)
    text = (cut > LANDCENTURY_LIMITS.descriptionMaxChars * 0.6 ? text.slice(0, cut) : text.slice(0, LANDCENTURY_LIMITS.descriptionMaxChars)).trim()
    log(`land_century: description is over ${LANDCENTURY_LIMITS.descriptionMaxChars} chars; sending the first ${text.length}`)
  }
  const headline = adCopy.headline.trim()
  const head = headline ? `<h3>${escapeHtml(headline)}</h3>` : ''
  return head + textToHtml(text)
}

/** Plain lines for the typing fallback: the heading, then paragraphs and bullets. */
export function htmlToPlainLines(html: string): string[] {
  const raw = html
    .replace(/<\/(h[1-6]|p|ul|ol)>/g, '\n\n')
    .replace(/<li>/g, '- ')
    .replace(/<\/li>/g, '\n')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .split('\n')
    .map((l) => l.trimEnd())
  const out: string[] = []
  for (const line of raw) {
    if (line === '' && (out.length === 0 || out[out.length - 1] === '')) continue
    out.push(line)
  }
  while (out.length && out[out.length - 1] === '') out.pop()
  return out
}

/**
 * Categories: metadata.land_century_categories (names) wins; otherwise
 * "Vacant Land", plus "Owner Finance Deals" when financed, plus one of
 * Residential / Recreational / Waterfront / Agricultural from the zoning and
 * ad copy. Unknown names are reported and skipped at run time.
 */
export function categoriesForTask(task: PosterTask, adCopy: AdCopy, ownerFinanced: boolean): string[] {
  const explicit = task.metadata?.['land_century_categories']
  if (Array.isArray(explicit) && explicit.length) {
    return explicit.map((x) => String(x)).map((x) => LAND_CATEGORIES.find((c) => sameText(c, x)) ?? x)
  }
  const out = ['Vacant Land']
  if (ownerFinanced) out.push('Owner Finance Deals')
  const zoning = (zoningForTask(task, adCopy) ?? '').toLowerCase()
  const text = `${adCopy.headline}\n${adCopy.description}`.toLowerCase()
  if (/resident/.test(zoning)) out.push('Residential Buildable Land')
  else if (/agri|farm/.test(zoning)) out.push('Agricultural & Farm Land')
  else if (/commercial/.test(zoning)) out.push('Commercial & Industrial Land')
  else if (/recreation|hunting/.test(zoning) || /\bhunt(ing)?\b|\bfish(ing)?\b|\bcamp(ing)?\b/.test(text)) out.push('Recreational & Hunting Land')
  if (/waterfront|lakefront|riverfront|river frontage|lake frontage/.test(text)) out.push('Waterfront Land')
  if (/\bmobile homes? (?:allowed|ok|okay|welcome|permitted)\b|\brv (?:friendly|allowed|ok|okay|welcome)/.test(text)) out.push('Mobile Home & RV Land')
  return Array.from(new Set(out))
}

/** The free-text Owner Finance Terms box. metadata.owner_finance_terms wins. */
export function financeTermsForTask(task: PosterTask, financing: Financing): string {
  const override = stringMeta(task, 'owner_finance_terms') ?? stringMeta(task, 'land_century_finance_terms')
  if (override) return override
  const parts: string[] = []
  if (financing.downPaymentUsd !== null) parts.push(`$${money(financing.downPaymentUsd)} down`)
  if (financing.monthlyPaymentUsd !== null) {
    parts.push(`$${money(financing.monthlyPaymentUsd)} a month` + (financing.months !== null ? ` for ${financing.months} months` : ''))
  }
  const mustInclude = stringMeta(task, 'must_include') ?? ''
  const extras: string[] = []
  if (/no credit check/i.test(mustInclude)) extras.push('No credit check')
  if (/no prepayment penalt/i.test(mustInclude)) extras.push('No prepayment penalty')
  const terms = parts.join(', then ')
  return [terms, ...extras].filter(Boolean).join('. ') + (terms || extras.length ? '.' : '')
}

/**
 * Zoning option: metadata.land_century_zoning, else an explicit "zoned X" in
 * the ad copy (the researched fact), else the Ad Builder's free-text zoning.
 */
export function zoningForTask(task: PosterTask, adCopy: AdCopy): string | null {
  const override = optionMeta(task, 'land_century_zoning', ZONINGS)
  if (override) return override
  const zoned = adCopy.description.match(/\bzoned\s+([a-z-]+)/i)?.[1]?.toLowerCase() ?? ''
  const zonedHit = ZONINGS.find((z) => zoned && z.toLowerCase().startsWith(zoned.slice(0, 5)))
  if (zonedHit) return zonedHit
  const raw = (stringMeta(task, 'zoning') ?? '').toLowerCase()
  if (/resident/.test(raw)) return 'Residential'
  if (/agri/.test(raw)) return 'Agricultural'
  if (/farm/.test(raw)) return 'Farm'
  if (/commercial|industrial/.test(raw)) return 'Commercial'
  if (/recreation/.test(raw)) return 'Recreational'
  if (/hunt/.test(raw)) return 'Hunting'
  if (/rural|vacant|unzoned|none|no zoning/.test(raw)) return 'Rural'
  if (/mobile/.test(raw)) return 'Mobile Home'
  if (/resort/.test(raw)) return 'Resort'
  if (/waterfront/.test(raw)) return 'Waterfront'
  return raw ? 'Rural' : null
}

/** metadata.access ("dirt-seasonal", "paved", "gravel") onto the Road Access options. */
export function roadAccessForTask(task: PosterTask): string | null {
  const override = optionMeta(task, 'land_century_road_access', ROAD_ACCESSES)
  if (override) return override
  const raw = (stringMeta(task, 'access') ?? '').toLowerCase()
  if (!raw) return null
  if (/paved.*dirt|dirt.*paved/.test(raw)) return 'Paved to Dirt Road'
  if (/paved/.test(raw)) return 'Paved Road'
  if (/gravel/.test(raw)) return 'Gravel Road'
  if (/dirt|unpaved|seasonal|two.?track/.test(raw)) return 'Dirt Road'
  if (/unknown|verify|none|no legal|landlocked/.test(raw)) return 'Verify with the County'
  return null
}

/** metadata.utilities (array) and utilities_notes onto the four Utilities options. */
export function utilitiesForTask(task: PosterTask): string | null {
  const override = optionMeta(task, 'land_century_utilities', UTILITIES)
  if (override) return override
  const m = task.metadata ?? {}
  const list = Array.isArray(m['utilities']) ? (m['utilities'] as unknown[]).map((u) => String(u).toLowerCase()) : []
  const absent = Array.isArray(m['utilities_absent']) ? (m['utilities_absent'] as unknown[]).map((u) => String(u).toLowerCase()) : []
  const notes = (stringMeta(task, 'utilities_notes') ?? '').toLowerCase()
  const has = (re: RegExp) => list.some((u) => re.test(u))
  const power = has(/electric|power/) || /electric|power (?:at|along|on|to) /.test(notes)
  const water = has(/water/) && !absent.some((u) => /water/.test(u))
  const sewer = has(/sewer/)
  if (water && sewer) return 'City utilities available'
  if (power) return 'Electricity available, septic and well required'
  if (/no utilities|off.?grid/.test(notes) || absent.some((u) => /electric|power/.test(u))) return 'No utilities'
  if (list.length === 0 && !notes) return null
  return 'Please, contract county'
}

export function apnForLandCentury(task: PosterTask, adCopy: AdCopy): string | null {
  const m = task.metadata ?? {}
  const explicit = m['apn']
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim()
  if (typeof explicit === 'number') return String(explicit)
  return extractApn(
    ...['utilities_notes', 'must_include', 'notes', 'legal_description'].map((k) => (typeof m[k] === 'string' ? (m[k] as string) : undefined)),
    adCopy.description
  )
}

export function maxPhotos(task: PosterTask): number {
  const n = numberMeta(task, 'land_century_max_photos')
  return n !== undefined && n > 0 ? Math.floor(n) : LANDCENTURY_LIMITS.maxPhotos
}

/** Photos the uploader accepts (jpeg/png/webp under 20 MB), capped at maxPhotos. */
export function eligiblePhotos(photos: string[], cap: number, log: (m: string) => void = () => {}): string[] {
  const ok: string[] = []
  for (const p of photos) {
    if (!/\.(jpe?g|png|webp)$/i.test(p)) {
      log(`land_century: skipping ${path.basename(p)} (the uploader takes JPG, PNG and WEBP only)`)
      continue
    }
    let size = 0
    try {
      size = fs.statSync(p).size
    } catch {
      continue
    }
    if (size >= LANDCENTURY_LIMITS.maxPhotoBytes) {
      log(`land_century: skipping ${path.basename(p)} (${(size / 1024 / 1024).toFixed(1)} MB, at or over the 20 MB cap)`)
      continue
    }
    ok.push(p)
  }
  if (ok.length > cap) log(`land_century: ${ok.length} photos; sending the first ${cap}`)
  return ok.slice(0, cap)
}

/** Real tag texts from an Ant multi-select: drops the "+ N ..." overflow tag and blanks. */
export function selectedTags(texts: string[]): string[] {
  return texts.map((t) => t.trim()).filter((t) => t && !/^\+\s*\d+/.test(t))
}

export function sameText(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim()
  return norm(a) === norm(b)
}

function stringMeta(task: PosterTask, key: string): string | undefined {
  const v = task.metadata?.[key]
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

function numberMeta(task: PosterTask, key: string): number | undefined {
  const n = numberOf(task.metadata?.[key])
  return n === null ? undefined : n
}

function optionMeta(task: PosterTask, key: string, options: string[]): string | undefined {
  const v = stringMeta(task, key)
  if (!v) return undefined
  return options.find((o) => sameText(o, v)) ?? v
}

function numberOf(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v.replace(/[$,\s]/g, ''))
    if (Number.isFinite(n)) return n
  }
  return null
}

function money(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
