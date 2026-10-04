import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  badgeForTask,
  descriptionForParcelView,
  featuresFromTask,
  findCard,
  hashFromEditPage,
  needsShrink,
  normalizeApn,
  parsePropertyCard,
  parseUsage,
  pickCountyOption,
  publicListingUrl,
  terrainForParcelView,
  titleForParcelView,
} from './post-parcelview'

const task = (metadata: Record<string, unknown>) => ({ id: 'task-x', title: 't', metadata })

test('parsePropertyCard reads id, apn, acres, place, status and hash from a My Properties card', () => {
  const c = parsePropertyCard({
    id: 'property-445',
    title: '0.12 Ac Near Montello, NV. BLM Hunting & Camping. $99 Down',
    meta: '0.12 acres · Montello, Nevada · APN 015101079',
    badge: 'Available',
    embed: 'https://parcelview.com/embed/744578cc4134b5e1385c5bfbf65af249/',
    edit: 'https://parcelview.com/edit-property/?id=445',
  })
  assert.equal(c.id, '445')
  assert.equal(c.apn, '015101079')
  assert.equal(c.acres, 0.12)
  assert.equal(c.city, 'Montello')
  assert.equal(c.state, 'Nevada')
  assert.equal(c.status, 'available')
  assert.equal(c.hash, '744578cc4134b5e1385c5bfbf65af249')
})

test('parsePropertyCard: no badge means unlisted; Under Contract maps to pending', () => {
  const base = { id: 'property-1', title: 'x', meta: '1 acres · Fairplay, Colorado · APN R0037546', embed: '', edit: '' }
  assert.equal(parsePropertyCard({ ...base, badge: '' }).status, 'unlisted')
  assert.equal(parsePropertyCard({ ...base, badge: 'Under Contract' }).status, 'pending')
  assert.equal(parsePropertyCard({ ...base, badge: 'Sold' }).status, 'sold')
  assert.equal(parsePropertyCard({ ...base, badge: '' }).editUrl, 'https://parcelview.com/edit-property/?id=1')
})

test('findCard matches by APN ignoring punctuation and case, then by name', () => {
  const cards = [
    parsePropertyCard({ id: 'property-1', title: 'Old', meta: '1 acres · Fairplay, Colorado · APN R0037546', badge: '', embed: '', edit: '' }),
    parsePropertyCard({ id: 'property-2', title: 'Same Name Here', meta: '2 acres · Wells, Nevada · APN 011108042', badge: 'Available', embed: '', edit: '' }),
  ]
  assert.equal(findCard(cards, 'r-0037546', 'nope')?.id, '1')
  assert.equal(findCard(cards, 'r-0037546', 'nope')?.matchedOn, 'APN')
  assert.equal(findCard(cards, '999', 'same name here!')?.id, '2')
  assert.equal(findCard(cards, '999', 'nope'), null)
  assert.equal(normalizeApn('R00-375.46'), 'r0037546')
})

test('parseUsage reads the plan counter', () => {
  assert.deepEqual(parseUsage('5 of 50 properties used (Growth plan)'), { used: 5, cap: 50 })
  assert.equal(parseUsage(''), null)
})

test('pickCountyOption tolerates "County" suffixes and codes', () => {
  const opts = [
    { value: '', label: 'Select county' },
    { value: '08093', label: 'Park County' },
    { value: '08095', label: 'Phillips' },
  ]
  assert.equal(pickCountyOption(opts, 'Park')?.value, '08093')
  assert.equal(pickCountyOption(opts, 'Park County')?.value, '08093')
  assert.equal(pickCountyOption(opts, 'Phillips')?.value, '08095')
  assert.equal(pickCountyOption(opts, 'Teller'), null)
})

test('public URL is built from the embed hash on the edit page', () => {
  const embed = '<iframe src="https://parcelview.com/embed/744578cc4134b5e1385c5bfbf65af249/" width="100%"></iframe>'
  assert.equal(hashFromEditPage(embed), '744578cc4134b5e1385c5bfbf65af249')
  assert.equal(publicListingUrl('744578cc4134b5e1385c5bfbf65af249'), 'https://parcelview.com/listing/744578cc4134b5e1385c5bfbf65af249/')
  assert.equal(hashFromEditPage(''), null)
})

test('titleForParcelView: override wins, 75-char cap', () => {
  assert.equal(titleForParcelView(task({ parcelview_headline: 'Short' }), 'Long headline'), 'Short')
  assert.throws(() => titleForParcelView(task({}), 'x'.repeat(76)), /75 characters/)
})

test('descriptionForParcelView trims at a paragraph break when over 2000 chars', () => {
  const para = 'word '.repeat(100).trim() // 499 chars
  const text = [para, para, para, para, para].join('\n\n') // 2503 chars
  const out = descriptionForParcelView(text)
  assert.ok(out.length <= 2000)
  assert.ok(out.endsWith('word'))
  assert.equal(out.split('\n\n').length, 3)
  assert.equal(descriptionForParcelView('fine\r\n'), 'fine')
})

test('terrainForParcelView maps Ad Builder terrain words onto the form options', () => {
  assert.equal(terrainForParcelView(task({ terrain: 'Forested' })), 'Wooded')
  assert.equal(terrainForParcelView(task({ terrain: 'Wooded, mostly flat' })), 'Wooded & Level')
  assert.equal(terrainForParcelView(task({ terrain: 'Gently sloping' })), 'Gently Sloped')
  assert.equal(terrainForParcelView(task({ terrain: 'Open pasture' })), 'Cleared')
  assert.equal(terrainForParcelView(task({ terrain: 'Lunar' })), null)
  assert.equal(terrainForParcelView(task({ terrain: 'Forested', parcelview_terrain: 'hilly' })), 'Hilly')
  assert.equal(terrainForParcelView(task({})), null)
})

test('featuresFromTask: explicit list wins, else camping/RV/no-POA from the copy', () => {
  const ad = { headline: 'h', description: 'Camping on your lot runs May 1 to October 31. HOA dues about $1,250.' }
  assert.deepEqual(featuresFromTask(task({}), ad), ['camping_allowed'])
  assert.deepEqual(featuresFromTask(task({}), { headline: 'h', description: 'Bring your RV. No HOA.' }), ['rv_living', 'no_poa'])
  assert.deepEqual(featuresFromTask(task({}), { headline: 'h', description: 'No camping, no RVs.' }), [])
  assert.deepEqual(featuresFromTask(task({ parcelview_features: ['mobile_homes', 'bogus'] }), ad), ['mobile_homes'])
})

test('badgeForTask: financing when owner financed, else new; metadata override', () => {
  assert.equal(badgeForTask(task({}), true), 'financing')
  assert.equal(badgeForTask(task({}), false), 'new')
  assert.equal(badgeForTask(task({ parcelview_badge: 'reduced' }), true), 'reduced')
  assert.equal(badgeForTask(task({ parcelview_badge: 'bogus' }), true), 'financing')
})

test('needsShrink: anything over 900 KB is re-encoded before upload', () => {
  assert.equal(needsShrink(276 * 1024), false)
  assert.equal(needsShrink(900 * 1024), false)
  assert.equal(needsShrink(1003 * 1024), true)
  assert.equal(needsShrink(1.5 * 1024 * 1024), true)
})
