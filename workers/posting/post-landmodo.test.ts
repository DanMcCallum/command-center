import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  batchPhotos,
  choosePhotos,
  extractApn,
  financingFromTask,
  parseFinancing,
  requireApn,
  sameTitle,
  textToHtml,
} from './post-landmodo'

const adCopy = { headline: 'x', description: 'y' }

test('extractApn finds county-style and dashed APNs', () => {
  assert.equal(extractApn('Redhill Forest Filing 3, Lot 366, APN R0037546.'), 'R0037546')
  assert.equal(extractApn('nothing here', 'APN: 010-123-45-678'), '010-123-45-678')
  assert.equal(extractApn('APN # 1234567'), '1234567')
  assert.equal(extractApn('no parcel number'), null)
})

test('requireApn prefers metadata.apn, then scans notes, then fails clearly', () => {
  assert.equal(requireApn({ id: 't', title: '', metadata: { apn: ' 99-1 ' } }, adCopy), '99-1')
  assert.equal(
    requireApn({ id: 't', title: '', metadata: { utilities_notes: 'Lot 366, APN R0037546.' } }, adCopy),
    'R0037546'
  )
  assert.throws(() => requireApn({ id: 't', title: '', metadata: {} }, adCopy), /requires an APN/)
})

test('parseFinancing reads the first plan from the must_include text', () => {
  const f = parseFinancing(
    'Owner financing: 30% down ($10,500) plus $249 doc fee, then $1,095/mo for 24 months, $750/mo for 36, or $595/mo for 48'
  )
  assert.deepEqual(f, { downPaymentUsd: null, monthlyPaymentUsd: 1095, months: 24 })
  const g = parseFinancing('$10,500 down (30%) and a $249 document fee, then $1,095 a month for 24 months')
  assert.deepEqual(g, { downPaymentUsd: 10500, monthlyPaymentUsd: 1095, months: 24 })
})

test('financingFromTask: explicit metadata wins, cash listings stay blank', () => {
  assert.deepEqual(
    financingFromTask(
      { id: 't', title: '', metadata: { down_payment_usd: 500, monthly_payment_usd: '99', term_months: 60 } },
      adCopy
    ),
    { downPaymentUsd: 500, monthlyPaymentUsd: 99, months: 60 }
  )
  assert.deepEqual(
    financingFromTask(
      { id: 't', title: '', metadata: { must_include: 'No financing on this one right now' } },
      { headline: 'x', description: '$35,000 cash. Message me.' }
    ),
    { downPaymentUsd: null, monthlyPaymentUsd: null, months: null }
  )
  const real = financingFromTask(
    { id: 't', title: '', metadata: {} },
    {
      headline: 'x',
      description:
        'The price:\n\n- $35,000 cash, or\n- $10,500 down (30%) and a $249 document fee, then $1,095 a month for 24 months, $750 for 36 months, or $595 for 48 months',
    }
  )
  assert.deepEqual(real, { downPaymentUsd: 10500, monthlyPaymentUsd: 1095, months: 24 })
})

test('textToHtml makes paragraphs, bullet lists and escapes markup', () => {
  assert.equal(textToHtml('One.\n\nTwo <b>.'), '<p>One.</p><p>Two &lt;b&gt;.</p>')
  assert.equal(
    textToHtml('The price:\n- $35,000 cash, or\n- $10,500 down'),
    '<p>The price:</p><ul><li>$35,000 cash, or</li><li>$10,500 down</li></ul>'
  )
  assert.equal(textToHtml('- a\n- b'), '<ul><li>a</li><li>b</li></ul>')
  assert.equal(textToHtml('line one\nline two'), '<p>line one<br>line two</p>')
})

test('sameTitle ignores case and punctuation', () => {
  assert.ok(sameTitle('1 Ac Fairplay CO. Wooded Ridge, Power at Road. $10,500 Down', '1 ac fairplay co wooded ridge power at road 10 500 down'))
  assert.ok(!sameTitle('a', 'b'))
})

test('choosePhotos puts the primary photo first', () => {
  assert.deepEqual(choosePhotos(['/p/a.jpg', '/p/b.jpg', '/p/c.jpg'], 'c.jpg'), ['/p/c.jpg', '/p/a.jpg', '/p/b.jpg'])
  assert.deepEqual(choosePhotos(['/p/a.jpg', '/p/b.jpg'], 'zzz.jpg'), ['/p/a.jpg', '/p/b.jpg'])
})

test('batchPhotos respects the file-count and byte caps', () => {
  const photos = Array.from({ length: 12 }, (_, i) => `/p/${i}.jpg`)
  const batches = batchPhotos(photos, () => 1_000_000)
  // 12 files at 1 MB: byte cap (10 MB) splits before the count cap does.
  assert.deepEqual(batches.map((b) => b.length), [9, 3])
  assert.deepEqual(batchPhotos(photos, () => 10).map((b) => b.length), [10, 2])
  assert.throws(() => batchPhotos(['/p/huge.jpg'], () => 11_000_000), /caps an upload/)
})
