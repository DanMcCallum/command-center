import assert from 'node:assert/strict';
import { test } from 'node:test';
import { estimateShipping, parseSizeDescription, upsGroundEstimate } from './shipping';

test('parseSizeDescription reads BuyWander cm/kg strings and sorts sides', () => {
  const d = parseSizeDescription('L: 95.3 cm x W: 57.9 cm x H: 101.6 cm, Weight: 11.567 kg')!;
  assert.equal(Math.round(d.length * 10) / 10, 40);
  assert.equal(Math.round(d.width * 10) / 10, 37.5);
  assert.equal(Math.round(d.height * 10) / 10, 22.8);
  assert.equal(Math.round(d.weight! * 10) / 10, 25.5);
  assert.deepEqual(parseSizeDescription('L: 20 in x W: 12 in x H: 8 in, Weight: 9 lbs'), { length: 20, width: 12, height: 8, weight: 9 });
  assert.equal(parseSizeDescription('A49'), null);
  assert.equal(parseSizeDescription(null), null);
  assert.equal(parseSizeDescription('L: 20 cm x W: 10 cm, Weight: 1 kg'), null);
});

test('parseSizeDescription handles the messy real-world strings BuyWander serves', () => {
  const r = (s: string) => {
    const d = parseSizeDescription(s);
    return d && { l: +d.length.toFixed(2), w: +d.width.toFixed(2), h: +d.height.toFixed(2), wt: d.weight === null ? null : +d.weight.toFixed(1) };
  };
  assert.deepEqual(r('L: 39.4 cm x W: 28.5 cm x H: 9.1 cm'), { l: 15.51, w: 11.22, h: 3.58, wt: null });
  assert.deepEqual(r('11-7/16" (L) x 15-15/16" (W) x 7-1/2" (H)'), { l: 15.94, w: 11.44, h: 7.5, wt: null });
  assert.deepEqual(r("6'' (L) x 6-7/16'' (W) x 9-5/8'' (H)"), { l: 9.63, w: 6.44, h: 6, wt: null });
  assert.deepEqual(r('Chair: 44”W x 42”D x 45”H'), { l: 45, w: 44, h: 42, wt: null });
  assert.deepEqual(r('D 19¼" / W 32" / H 26½" / 112.2lbs'), { l: 32, w: 26.5, h: 19.25, wt: 112.2 });
  assert.deepEqual(r('D 191⁄4" / W 32" / H 261⁄2" / 112.2lbs'), { l: 32, w: 26.5, h: 19.25, wt: 112.2 });
  for (const label of ['2TB', '256GB', 'One Size', 'King', '12-inch', 'Large', '3', 'EOC06', '24"L x 3"W']) {
    assert.equal(r(label), null, label);
  }
});

test('upsGroundEstimate uses dimensional weight alone when no weight is listed', () => {
  const laptop = upsGroundEstimate({ length: 15.51, width: 11.22, height: 3.58, weight: null });
  assert.equal(laptop.billable_lbs, 5); // 623 cu in / 139 = 4.5 -> 5
  assert.equal(laptop.cost, 16);
  assert.match(laptop.note, /dimensional, no weight listed/);
  const tiny = upsGroundEstimate({ length: 2, width: 2, height: 2, weight: null });
  assert.equal(tiny.billable_lbs, 1);
});

test('upsGroundEstimate bills the greater of actual and dimensional weight', () => {
  const small = upsGroundEstimate({ length: 10, width: 8, height: 6, weight: 2 });
  assert.equal(small.billable_lbs, 4);
  assert.equal(small.cost, 15);
  const heavy = upsGroundEstimate({ length: 12, width: 12, height: 12, weight: 30 });
  assert.equal(heavy.billable_lbs, 30);
  assert.equal(heavy.cost, 43);
  assert.match(heavy.note, /^30 lb billable$/);
});

test('upsGroundEstimate adds surcharges and refuses freight-sized boxes', () => {
  const long = upsGroundEstimate({ length: 60, width: 10, height: 10, weight: 20 });
  assert.match(long.note, /additional handling/);
  assert.equal(long.cost, 84); // 6000 cu in / 139 = 43.2 -> 44 lb billable: 52 + 0.4 * 10 = 56, plus 28 handling
  const big = upsGroundEstimate({ length: 62, width: 20, height: 15, weight: 40 });
  assert.match(big.note, /large package surcharge/); // L+G = 132, dim 134 lb
  const freight = upsGroundEstimate({ length: 60, width: 40, height: 30, weight: 40 });
  assert.equal(freight.cost, null);
  assert.match(freight.note, /freight/);
});

test('estimateShipping scales by the multiplier and explains missing dimensions', () => {
  assert.equal(estimateShipping('L: 12 in x W: 12 in x H: 12 in, Weight: 30 lbs', 1.5).cost, 65);
  const none = estimateShipping('bin 7');
  assert.equal(none.cost, null);
  assert.equal(none.billable_lbs, null);
  assert.match(none.note, /no usable dimensions/);
});
