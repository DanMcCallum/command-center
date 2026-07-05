import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { parseAdOutput } from './parse-ad-output'

// Real worker output sample. Run tests from workers/posting/ (see README).
const SAMPLE_DIR = path.resolve(
  process.cwd(),
  '../workspace/outputs/task-1780891259218-ppunbv'
)

test('parses headline and description from a real landmodo sample', () => {
  const ad = parseAdOutput(SAMPLE_DIR, 'landmodo')
  assert.equal(ad.headline, '0.12 Ac Near Montello, NV. BLM Hunting & Camping. $99 Down')
  assert.ok(ad.description.startsWith('Own a piece of wide-open Nevada for $99 down.'))
  assert.ok(ad.description.endsWith('Reply now for parcel details and GPS location.'))
  assert.ok(!ad.description.includes('Why this angle'))
  assert.ok(!ad.description.includes('##'))
})

test('parses a real land_com sample', () => {
  const ad = parseAdOutput(SAMPLE_DIR, 'land_com')
  assert.ok(ad.headline.includes('0.12 Acres Near Montello, NV'))
  assert.ok(ad.description.includes('The cash price is $1,500.'))
  assert.ok(!ad.description.includes('Why this angle'))
})

test('throws a descriptive error when the platform file is missing', () => {
  assert.throws(
    () => parseAdOutput(SAMPLE_DIR, 'no_such_platform'),
    /Ad output file not found for platform "no_such_platform"/
  )
})

test('throws a descriptive error when a section is missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parse-ad-'))
  try {
    fs.writeFileSync(
      path.join(dir, 'landmodo.md'),
      '# Landmodo\n\n## HEADLINE (10/60 chars)\nSome title\n'
    )
    assert.throws(
      () => parseAdOutput(dir, 'landmodo'),
      /Missing "## DESCRIPTION" section/
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('throws when a section heading exists but the body is empty', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parse-ad-'))
  try {
    fs.writeFileSync(
      path.join(dir, 'landmodo.md'),
      '# Landmodo\n\n## HEADLINE (10/60 chars)\n\n## DESCRIPTION (5/100 chars)\nBody\n'
    )
    assert.throws(() => parseAdOutput(dir, 'landmodo'), /section .* is empty/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
