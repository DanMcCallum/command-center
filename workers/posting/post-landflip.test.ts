import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  accessForLandflip,
  coordinatesFromTask,
  formatCoordinate,
  sameCoordinate,
  descriptionForLandflip,
  findCard,
  hasRestrictions,
  parseListingCard,
  parsePhotoCap,
  pickCountyOption,
  publicListingUrl,
  requireCityZip,
  stateNameFor,
  taxesForLandflip,
  terrainForLandflip,
  titleForLandflip,
  utilitiesForLandflip,
  zoningForLandflip,
} from './post-landflip'

const task = (metadata: Record<string, unknown>) => ({ id: 'task-x', title: 't', metadata })
const ad = (description: string, headline = 'h') => ({ headline, description })

test('parseListingCard reads id, acres, price and the visible tags from a grid card', () => {
  const c = parseListingCard({
    id: 'lb426576',
    title: '1 Wooded Acre, Redhill Forest, CO',
    priceAc: ' 1 Acre : $40,999 ',
    where: 'Fairplay : Park Co : Colorado',
    online: false,
    available: true,
    uc: false,
    sold: false,
  })
  assert.equal(c.id, '426576')
  assert.equal(c.acres, 1)
  assert.equal(c.priceUsd, 40999)
  assert.equal(c.online, false)
  assert.equal(c.status, 'available')
  assert.equal(c.where, 'Fairplay : Park Co : Colorado')
})

test('parseListingCard: sold beats under contract beats available; fractional acres parse', () => {
  const base = { id: 'lb1', title: 'x', priceAc: '0.12 Acres : $1,500', where: '', online: true, available: true, uc: true, sold: false }
  assert.equal(parseListingCard(base).status, 'contract')
  assert.equal(parseListingCard({ ...base, sold: true }).status, 'sold')
  assert.equal(parseListingCard(base).acres, 0.12)
})

test('findCard matches on title first, then price + acres', () => {
  const cards = [
    parseListingCard({ id: 'lb1', title: 'Other Lot', priceAc: '5 Acres : $9,000', where: '', online: true, available: true, uc: false, sold: false }),
    parseListingCard({ id: 'lb2', title: '1 Wooded Acre, Redhill Forest, CO', priceAc: '1 Acre : $40,999', where: '', online: false, available: true, uc: false, sold: false }),
  ]
  assert.equal(findCard(cards, '1 wooded acre redhill forest co', 1, 1)?.matchedOn, 'title')
  assert.equal(findCard(cards, 'Wooded Acre, Fairplay CO, $12K Down', 40999, 1)?.id, '2')
  assert.equal(findCard(cards, 'Wooded Acre, Fairplay CO, $12K Down', 40999, 1)?.matchedOn, 'price + acres')
  assert.equal(findCard(cards, 'nope', 1, 2), null)
})

test('titleForLandflip prefers metadata.landflip_headline and keeps it under 35 chars', () => {
  assert.equal(titleForLandflip(task({ landflip_headline: 'Wooded Acre, Fairplay CO, $12K Down' }), 'ignored'), 'Wooded Acre, Fairplay CO, $12K Down')
})

test('titleForLandflip strips characters the site rejects and cuts at a word boundary', () => {
  const warnings: string[] = []
  const t = titleForLandflip(task({}), '1 Ac Redhill Forest, Fairplay CO. Zoned Residential, Power at Road. 27% of $150K 1 Ac Comp. $40,999', (m) => warnings.push(m))
  assert.ok(t.length <= 35, t)
  assert.ok(t.length >= 10, t)
  assert.match(t, /^[a-zA-Z0-9\-,.+/&$' ]+$/)
  assert.equal(t, '1 Ac Redhill Forest, Fairplay CO')
  assert.equal(warnings.length, 1)
})

test('titleForLandflip turns a pipe or colon into a comma and drops hashes', () => {
  assert.equal(titleForLandflip(task({}), 'Elko County NV | Hunting Camp #2'), 'Elko County NV, Hunting Camp 2')
})

test('titleForLandflip throws when the title is under 10 chars', () => {
  assert.throws(() => titleForLandflip(task({}), '!!! ###'), /under 10 chars/)
})

test('descriptionForLandflip strips HTML, enforces the 100-char minimum and warns about contact details', () => {
  assert.throws(() => descriptionForLandflip('too short'), /at least 100/)
  const notes: string[] = []
  const long = 'A'.repeat(50) + ' call 385-462-6366 or see www.example.com ' + 'B'.repeat(60)
  const out = descriptionForLandflip(`<p>${long}</p>`, (m) => notes.push(m))
  assert.ok(!out.includes('<p>'))
  assert.equal(notes.length, 1)
  assert.match(notes[0], /web address/)
  assert.match(notes[0], /phone number/)
  assert.equal(descriptionForLandflip('x'.repeat(120), (m) => notes.push(m)).length, 120)
  assert.equal(notes.length, 1)
})

test('requireCityZip needs both, accepting postal_code for zip', () => {
  assert.deepEqual(requireCityZip(task({ city: 'Fairplay', zip: '80440' })), { city: 'Fairplay', zip: '80440' })
  assert.deepEqual(requireCityZip(task({ city: 'Fairplay', postal_code: '80440' })), { city: 'Fairplay', zip: '80440' })
  assert.throws(() => requireCityZip(task({ city: 'Fairplay' })), /metadata\.city and metadata\.zip/)
})

test('pickCountyOption matches by name, ignoring "County" and case, with a prefix fallback', () => {
  const opts = ['SELECT', 'Adams', 'Park', 'Park County Alt', 'Pitkin']
  assert.equal(pickCountyOption(opts, 'Park'), 'Park')
  assert.equal(pickCountyOption(opts, 'park county'), 'Park')
  assert.equal(pickCountyOption(opts, 'Pit'), 'Pitkin')
  assert.equal(pickCountyOption(opts, 'Elko'), null)
})

test('stateNameFor expands abbreviations and title-cases names', () => {
  assert.equal(stateNameFor('CO'), 'Colorado')
  assert.equal(stateNameFor('Colorado'), 'Colorado')
  assert.equal(stateNameFor('nv'), 'Nevada')
  assert.equal(stateNameFor('new mexico'), 'New Mexico')
})

test('zoning, terrain and access map task words onto the site options', () => {
  assert.equal(zoningForLandflip(task({ zoning: 'Vacant land' }), ad('Zoned Residential, HOA roads')), 'Residential')
  assert.equal(zoningForLandflip(task({ zoning: 'Rural recreation' }), ad('nothing')), null)
  assert.equal(zoningForLandflip(task({ landflip_zoning: 'no zoning' }), ad('Zoned Residential')), 'No Zoning')
  assert.equal(terrainForLandflip(task({ terrain: 'Forested' })), null)
  assert.equal(terrainForLandflip(task({ terrain: 'Mountainous, forested' })), 'Mountainous')
  assert.equal(terrainForLandflip(task({ terrain: 'High desert, sage' })), 'Desert')
  assert.equal(accessForLandflip(task({ access: 'dirt-seasonal' })), 'Dirt Road')
  assert.equal(accessForLandflip(task({ access: 'paved county road' })), 'Paved Road')
  assert.equal(accessForLandflip(task({ access: 'legal easement over dirt' })), 'Deeded Easement')
  assert.equal(accessForLandflip(task({})), null)
})

test('taxesForLandflip reads a number or a dollar string', () => {
  assert.equal(taxesForLandflip(task({ annual_taxes_usd: 17.47 })), 17.47)
  assert.equal(taxesForLandflip(task({ taxes: '$1,250' })), 1250)
  assert.equal(taxesForLandflip(task({})), null)
})

test('hasRestrictions: HOA in the notes or copy turns the checkbox on; "no HOA" keeps it off', () => {
  assert.equal(hasRestrictions(task({ utilities_notes: 'HOA community water system' }), ad('x')), true)
  assert.equal(hasRestrictions(task({}), ad('No HOA, no covenants, camp as you like')), false)
  assert.equal(hasRestrictions(task({ hoa: false }), ad('HOA dues $1,250')), false)
  assert.equal(hasRestrictions(task({}), ad('Quiet lot')), false)
})

test('utilitiesForLandflip maps the explicit utilities list onto checkbox ids', () => {
  assert.deepEqual(utilitiesForLandflip(task({ utilities: ['Electricity at road', 'Septic allowed'] })).sort(), ['electric', 'septic'])
  assert.deepEqual(utilitiesForLandflip(task({ utilities: ['Well water'] })), ['well-water'])
  assert.deepEqual(utilitiesForLandflip(task({ utilities: ['community water system'] })), ['water'])
  assert.deepEqual(utilitiesForLandflip(task({ landflip_utilities: ['power', 'cell'], utilities: ['sewer'] })).sort(), ['cell-service', 'electric'])
  assert.deepEqual(utilitiesForLandflip(task({ landflip_utilities: ['electric', 'water'] })).sort(), ['electric', 'water'])
  assert.deepEqual(utilitiesForLandflip(task({ landflip_utilities: ['Well Water', 'natural gas'] })).sort(), ['natural-gas', 'well-water'])
  assert.deepEqual(utilitiesForLandflip(task({})), [])
})

test('parsePhotoCap and publicListingUrl', () => {
  assert.equal(parsePhotoCap('Your current plan has a 10 photo limit per listing. You can upload 10 more'), 10)
  assert.equal(parsePhotoCap('nothing here'), null)
  assert.equal(publicListingUrl('426576'), 'https://www.landflip.com/land/426576')
})

test('coordinatesFromTask needs finite numbers inside range; 0,0 counts as missing', () => {
  assert.deepEqual(coordinatesFromTask(task({ latitude: 39.146135, longitude: -105.921237 })), { latitude: 39.146135, longitude: -105.921237 })
  assert.equal(coordinatesFromTask(task({ latitude: '39.1', longitude: -105.9 })), null)
  assert.equal(coordinatesFromTask(task({ latitude: 0, longitude: 0 })), null)
  assert.equal(coordinatesFromTask(task({})), null)
})

test('formatCoordinate fits the 12-char inputs and sameCoordinate tolerates rounding', () => {
  assert.equal(formatCoordinate(39.146135), '39.14613500')
  assert.equal(formatCoordinate(-105.921237), '-105.9212370')
  assert.ok(formatCoordinate(-105.921237).length <= 12)
  assert.ok(formatCoordinate(-179.12345678).length <= 12)
  assert.equal(sameCoordinate('39.14613500', 39.146135), true)
  assert.equal(sameCoordinate('39.15', 39.146135), false)
  assert.equal(sameCoordinate('', 39.1), false)
})
