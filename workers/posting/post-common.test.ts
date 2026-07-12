import { test } from 'node:test'
import * as assert from 'node:assert'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  listPhotos,
  loadPlatformConfig,
  requireAuthState,
  requireListingFacts,
  requirePhotos,
  splitLocation,
} from './post-common'

test('splitLocation splits county and state, stripping the County suffix', () => {
  assert.deepStrictEqual(splitLocation('Elko County, Utah'), { county: 'Elko', state: 'Utah' })
  assert.deepStrictEqual(splitLocation('Apache county, Arizona'), {
    county: 'Apache',
    state: 'Arizona',
  })
  assert.deepStrictEqual(splitLocation('Rio Arriba, New Mexico'), {
    county: 'Rio Arriba',
    state: 'New Mexico',
  })
})

test('splitLocation throws on unsplittable input', () => {
  assert.throws(() => splitLocation('Nevada'), /expected "<county>, <state>"/)
  assert.throws(() => splitLocation('Elko County,'), /county and state/)
})

test('requireListingFacts returns metadata facts and rejects incomplete tasks', () => {
  const facts = requireListingFacts({
    id: 't1',
    title: 'x',
    metadata: { price_usd: 5599, acreage: 4.13, location: 'Elko County, Utah' },
  })
  assert.deepStrictEqual(facts, { priceUsd: 5599, acreage: 4.13, location: 'Elko County, Utah' })

  assert.throws(
    () => requireListingFacts({ id: 't2', title: 'x', metadata: null }),
    /missing price_usd\/acreage\/location/
  )
  assert.throws(
    () => requireListingFacts({ id: 't3', title: 'x', metadata: { price_usd: '5599' } }),
    /missing price_usd\/acreage\/location/
  )
})

test('listPhotos returns sorted image files and [] when photos/ is absent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'post-common-'))
  try {
    assert.deepStrictEqual(listPhotos(dir), [])
    const photosDir = path.join(dir, 'photos')
    fs.mkdirSync(photosDir)
    for (const f of ['b.JPG', 'a.png', 'notes.txt', 'c.webp']) {
      fs.writeFileSync(path.join(photosDir, f), '')
    }
    assert.deepStrictEqual(
      listPhotos(dir).map((p) => path.basename(p)),
      ['a.png', 'b.JPG', 'c.webp']
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('requirePhotos throws the upload-and-Retry error only when photos are missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'post-common-'))
  try {
    assert.throws(
      () => requirePhotos(dir, 'task-abc'),
      (err: Error) =>
        err.message === 'No photos found in outputs/task-abc/photos — upload photos and Retry'
    )
    const photosDir = path.join(dir, 'photos')
    fs.mkdirSync(photosDir)
    fs.writeFileSync(path.join(photosDir, 'notes.txt'), '') // non-image only: still missing
    assert.throws(() => requirePhotos(dir, 'task-abc'), /No photos found/)
    fs.writeFileSync(path.join(photosDir, '00_a.png'), '')
    assert.deepStrictEqual(
      requirePhotos(dir, 'task-abc').map((p) => path.basename(p)),
      ['00_a.png']
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('loadPlatformConfig throws on unknown platform', () => {
  assert.throws(() => loadPlatformConfig('nope'), /Unknown platform "nope"/)
  assert.strictEqual(loadPlatformConfig('landmodo').display_name, 'Landmodo')
})

test('requireAuthState errors with poster-agent hint when session is missing', () => {
  assert.throws(
    () => requireAuthState('no-such-platform'),
    /No saved login for "no-such-platform".*poster agent/
  )
})
