import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  activitiesFromTask,
  titleForLandCom,
  coordinatesFromTask,
  findMatch,
  isActive,
  locationDescription,
  parseHubRowText,
  propertyTypesFromTask,
} from './post-land_com'

const ROW_TEXT = [
  'ID 28909620',
  '1 Forested Acre in Park County, Co....',
  'Fairplay, CO',
  '$35,000',
  '1.0',
  '9/24/2026',
  'For Sale',
  'Premium',
  'Edit',
].join('\n')

test('parseHubRowText reads id, title, city/state, price, acres, status', () => {
  const r = parseHubRowText('28909620', ROW_TEXT)
  assert.equal(r.title, '1 Forested Acre in Park County, Co....')
  assert.equal(r.city, 'Fairplay')
  assert.equal(r.stateAbbr, 'CO')
  assert.equal(r.priceUsd, 35000)
  assert.equal(r.acres, 1)
  assert.equal(r.status, 'For Sale')
})

test('parseHubRowText handles the ID and title on one line', () => {
  const r = parseHubRowText('29006903', 'ID 29006903New Listing\nFairplay, CO\n$0\n0\nDraft')
  assert.equal(r.title, 'New Listing')
  assert.equal(r.status, 'Draft')
})

test('findMatch: title match, then price+acres+state, never sold/off-market', () => {
  const rows = [
    parseHubRowText('28909620', ROW_TEXT),
    parseHubRowText('2', 'ID 2\nOld deal\nWells, NV\n$35,000\n1.0\n1/1/2026\nSold'),
  ]
  const byFacts = findMatch(rows, 'Some other headline', 35000, 1, 'CO')
  assert.equal(byFacts?.id, '28909620')
  assert.equal(byFacts?.matchedOn, 'price + acreage + state')
  const byTitle = findMatch(rows, '1 forested acre in park county co', 1, 99, 'CO')
  assert.equal(byTitle?.matchedOn, 'title')
  assert.equal(findMatch(rows, 'x', 35000, 1, 'NV'), null)
  assert.equal(findMatch(rows, 'x', 35000, 2.27, 'CO'), null)
})

test('isActive', () => {
  assert.ok(isActive('For Sale'))
  assert.ok(!isActive('Draft'))
  assert.ok(!isActive('Off Market'))
})

test('coordinatesFromTask validates and accepts aliases', () => {
  assert.deepEqual(coordinatesFromTask({ id: 't', title: '', metadata: { latitude: 39.146135, longitude: -105.921237 } }), {
    latitude: 39.146135,
    longitude: -105.921237,
  })
  assert.deepEqual(coordinatesFromTask({ id: 't', title: '', metadata: { lat: '39.1', lng: '-105.9' } }), { latitude: 39.1, longitude: -105.9 })
  assert.equal(coordinatesFromTask({ id: 't', title: '', metadata: {} }), null)
  assert.equal(coordinatesFromTask({ id: 't', title: '', metadata: { latitude: 0, longitude: 0 } }), null)
  assert.equal(coordinatesFromTask({ id: 't', title: '', metadata: { latitude: 95, longitude: 10 } }), null)
})

test('locationDescription prefers explicit metadata, else county + state', () => {
  const loc = { county: 'Park', stateAbbr: 'CO', state: 'Colorado' }
  assert.equal(locationDescription({ id: 't', title: '', metadata: {} }, loc), 'Park County, CO')
  assert.equal(
    locationDescription({ id: 't', title: '', metadata: { location_description: 'Redhill Forest Filing 3, Lot 366' } }, loc),
    'Redhill Forest Filing 3, Lot 366'
  )
  assert.equal(locationDescription({ id: 't', title: '', metadata: { address: '1 Main St' } }, loc), '1 Main St')
})

test('property types and activities default and validate', () => {
  assert.deepEqual(propertyTypesFromTask({ id: 't', title: '', metadata: {} }), ['Undeveloped'])
  assert.deepEqual(propertyTypesFromTask({ id: 't', title: '', metadata: { land_com_property_types: 'recreational, bogus, Timber' } }), [
    'Recreational',
    'Timber',
  ])
  assert.deepEqual(activitiesFromTask({ id: 't', title: '', metadata: {} }), [])
  assert.deepEqual(activitiesFromTask({ id: 't', title: '', metadata: { land_com_activities: ['Camping', 'Skiing'] } }), ['Camping', 'Skiing'])
})

test('titleForLandCom enforces the 75-character cap and honours the override', () => {
  const long = '1 Wooded Acre in Redhill Forest, Fairplay CO. Power at Road, Community Water. $35,000 or 30% Down'
  assert.throws(() => titleForLandCom({ id: 't', title: '', metadata: {} }, long), /cannot be over 75/)
  const short = '1 Wooded Acre, Redhill Forest, Fairplay CO. Power at Road. $35K or 30% Down'
  assert.equal(titleForLandCom({ id: 't', title: '', metadata: {} }, short), short)
  assert.equal(titleForLandCom({ id: 't', title: '', metadata: { land_com_headline: short } }, long), short)
})
