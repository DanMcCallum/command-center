import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  LAND_CATEGORIES,
  QUILL_SET_HTML,
  READ_PROPERTIES_FN,
  apnForLandCentury,
  categoriesForTask,
  descriptionHtmlForLandCentury,
  financeTermsForTask,
  findProperty,
  htmlToPlainLines,
  parsePropertyRecord,
  publicListingUrl,
  roadAccessForTask,
  sameState,
  sameText,
  statusOf,
  utilitiesForTask,
  zoningForTask,
} from './post-land_century'

const task = (metadata: Record<string, unknown>) => ({ id: 'task-x', title: 't', metadata })
const parkCounty = task({
  location: 'Park County, Colorado',
  acreage: 1,
  price_usd: 35000,
  access: 'dirt-seasonal',
  utilities: [],
  utilities_notes: 'CORE Electric along Redhill Rd; HOA community water system; septic via Park County. APN R0037546.',
  terrain: 'Forested',
  zoning: 'Vacant land',
  must_include: 'Owner financing: 30% down ($10,500) plus $249 doc fee, then $1,095/mo for 24 months. No credit check, no prepayment penalty.',
  apn: 'R0037546',
})
const adCopy = {
  headline: '1 Acre in Park County, CO. Wooded. $35,000 or $10,500 Down',
  description:
    'Your own wooded acre on the Redhill Forest ridge.\n\nThe deal in numbers:\n\n- 1 acre, Lot 366\n- Forested, zoned Residential\n- $35,000 cash, or $10,500 down\n\nTop things people do here: fly fish the South Platte and camp May to October. (Property: Timber Park)',
}

test('parsePropertyRecord reads the admin API shape (cents, nested info, error list)', () => {
  const p = parsePropertyRecord({
    id: 191067,
    name: '1.00 Acres for Sale in Fairplay, Colorado',
    slug: '1-acre-for-sale-in-fairplay-colorado-191067',
    parcelNumber: 'R0037546',
    cashPrice: 3500000,
    stateRegion: 'Colorado',
    isPublished: true,
    isSold: false,
    info: { sizeAcres: '1' },
    errors: [{ id: 1, error: 'Missing images' }],
  })
  assert.equal(p.id, 191067)
  assert.equal(p.cashPrice, 35000)
  assert.equal(p.sizeAcres, 1)
  assert.equal(p.parcelNumber, 'R0037546')
  assert.deepEqual(p.errors, ['Missing images'])
  assert.equal(statusOf(p), 'Live')
  assert.equal(statusOf({ ...p, isPublished: false }), 'Draft')
  assert.equal(statusOf({ ...p, isSold: true }), 'Sold')
  const bare = parsePropertyRecord({ id: '5', name: 'x', info: null })
  assert.equal(bare.cashPrice, null)
  assert.equal(bare.slug, null)
  assert.deepEqual(bare.errors, [])
})

test('findProperty matches by parcel number first, then price + acres, preferring the Live one', () => {
  const draft = parsePropertyRecord({ id: 1, name: 'a', parcelNumber: 'r-0037546', cashPrice: 100, isPublished: false, info: {} })
  const live = parsePropertyRecord({ id: 2, name: 'b', parcelNumber: null, cashPrice: 3500000, stateRegion: 'CO', isPublished: true, info: { sizeAcres: 1 } })
  const other = parsePropertyRecord({ id: 3, name: 'c', parcelNumber: null, cashPrice: 3500000, stateRegion: 'Nevada', isPublished: true, info: { sizeAcres: 1 } })
  assert.equal(findProperty([draft, live, other], 'R0037546', 35000, 1, 'CO')?.id, 2)
  assert.equal(findProperty([draft, other], 'R0037546', 35000, 1, 'CO')?.matchedOn, 'parcel number')
  assert.equal(findProperty([other], 'R0037546', 35000, 1, 'CO'), null)
  assert.equal(findProperty([live], null, 35000, 1, 'CO')?.matchedOn, 'price + acres')
})

test('sameState accepts abbreviations and names; publicListingUrl uses the lowercase state name', () => {
  assert.equal(sameState('Colorado', 'CO'), true)
  assert.equal(sameState('co', 'Colorado'), true)
  assert.equal(sameState('Nevada', 'CO'), false)
  assert.equal(
    publicListingUrl('CO', '1-acre-for-sale-in-fairplay-colorado-191067'),
    'https://www.landcentury.com/land-for-sale/colorado/1-acre-for-sale-in-fairplay-colorado-191067'
  )
  assert.equal(publicListingUrl('New Mexico', 'x-1'), 'https://www.landcentury.com/land-for-sale/new-mexico/x-1')
})

test('descriptionHtmlForLandCentury leads with the headline as a heading, then paragraphs and bullets', () => {
  const html = descriptionHtmlForLandCentury(adCopy)
  assert.ok(html.startsWith('<h3>1 Acre in Park County, CO. Wooded. $35,000 or $10,500 Down</h3><p>Your own wooded acre'))
  assert.ok(html.includes('<ul><li>1 acre, Lot 366</li><li>Forested, zoned Residential</li>'))
  const lines = htmlToPlainLines(html)
  assert.equal(lines[0], '1 Acre in Park County, CO. Wooded. $35,000 or $10,500 Down')
  assert.equal(lines[1], '')
  assert.ok(lines.includes('- 1 acre, Lot 366'))
  assert.notEqual(lines[lines.length - 1], '')
})

test('categoriesForTask: Vacant Land plus Owner Finance Deals, Residential from the ad copy, Recreational from fishing/camping', () => {
  const cats = categoriesForTask(parkCounty, adCopy, true)
  assert.deepEqual(cats, ['Vacant Land', 'Owner Finance Deals', 'Residential Buildable Land'])
  for (const c of cats) assert.ok(LAND_CATEGORIES.includes(c))
  const cash = categoriesForTask(task({ zoning: 'Rural recreation' }), { headline: 'x', description: 'hunting nearby' }, false)
  assert.deepEqual(cash, ['Vacant Land', 'Recreational & Hunting Land'])
  const explicit = categoriesForTask(task({ land_century_categories: ['waterfront land', 'Auction'] }), adCopy, true)
  assert.deepEqual(explicit, ['Waterfront Land', 'Auction'])
})

test('zoningForTask prefers an explicit "zoned X" in the ad, then the metadata', () => {
  assert.equal(zoningForTask(parkCounty, adCopy), 'Residential')
  assert.equal(zoningForTask(task({ zoning: 'Vacant land' }), { headline: '', description: '' }), 'Rural')
  assert.equal(zoningForTask(task({ zoning: 'Agricultural/Residential' }), { headline: '', description: '' }), 'Residential')
  assert.equal(zoningForTask(task({ land_century_zoning: 'hunting' }), adCopy), 'Hunting')
  assert.equal(zoningForTask(task({}), { headline: '', description: '' }), null)
})

test('roadAccessForTask and utilitiesForTask map the Ad Builder fields onto the form options', () => {
  assert.equal(roadAccessForTask(parkCounty), 'Dirt Road')
  assert.equal(roadAccessForTask(task({ access: 'paved' })), 'Paved Road')
  assert.equal(roadAccessForTask(task({ access: 'gravel county road' })), 'Gravel Road')
  assert.equal(roadAccessForTask(task({})), null)
  assert.equal(utilitiesForTask(parkCounty), 'Electricity available, septic and well required')
  assert.equal(utilitiesForTask(task({ utilities: ['water', 'sewer', 'electricity'] })), 'City utilities available')
  assert.equal(utilitiesForTask(task({ utilities: [], utilities_notes: 'No utilities, fully off-grid' })), 'No utilities')
  assert.equal(utilitiesForTask(task({})), null)
  assert.equal(utilitiesForTask(task({ land_century_utilities: 'no utilities' })), 'No utilities')
})

test('financeTermsForTask builds the terms line from the parsed financing; metadata wins', () => {
  assert.equal(
    financeTermsForTask(parkCounty, { downPaymentUsd: 10500, monthlyPaymentUsd: 1095, months: 24 }),
    '$10,500 down, then $1,095 a month for 24 months. No credit check. No prepayment penalty.'
  )
  assert.equal(financeTermsForTask(task({ owner_finance_terms: 'Call for terms' }), { downPaymentUsd: 1, monthlyPaymentUsd: 1, months: 1 }), 'Call for terms')
  assert.equal(financeTermsForTask(task({}), { downPaymentUsd: null, monthlyPaymentUsd: null, months: null }), '')
})

test('apnForLandCentury is optional: metadata, then an APN mention, else null', () => {
  assert.equal(apnForLandCentury(parkCounty, adCopy), 'R0037546')
  assert.equal(apnForLandCentury(task({ utilities_notes: 'APN 011108042 per county' }), adCopy), '011108042')
  assert.equal(apnForLandCentury(task({}), adCopy), null)
})

test('sameText ignores case, punctuation and the ampersand spelling', () => {
  assert.equal(sameText('Recreational & Hunting Land', 'recreational and hunting land'), true)
  assert.equal(sameText('Vacant Land', 'Vacant Lot'), false)
})

test('the in-page reader and the Quill setter are real functions (no "return" + newline swallow)', () => {
  assert.equal(typeof READ_PROPERTIES_FN, 'function')
  assert.ok(READ_PROPERTIES_FN.toString().includes('apiToken'))
  const quill = new Function('el', 'html', QUILL_SET_HTML)
  assert.equal(typeof quill, 'function')
  assert.equal(quill({}, '<p>x</p>'), false)
})
