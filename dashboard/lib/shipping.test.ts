import assert from 'node:assert/strict';
import { test } from 'node:test';
import { estimateShipping, parseSizeDescription, upsGroundEstimate } from './shipping';

test('parseSizeDescription reads BuyWander cm/kg strings and sorts sides', () => {
  const d = parseSizeDescription('L: 95.3 cm x W: 57.9 cm x H: 101.6 cm, Weight: 11.567 kg')!;
  assert.equal(Math.round(d.length * 10) / 10, 40);
  assert.equal(Math.round(d.width * 10) / 10, 37.5);
  assert.equal(Math.round(d.height * 10) / 10, 22.8);
  assert.equal(Math.round(d.weight * 10) / 10, 25.5);
  assert.deepEqual(parseSizeDescription('L: 20 in x W: 12 in x H: 8 in, Weight: 9 lbs'), { length: 20, width: 12, height: 8, weight: 9 });
  assert.equal(parseSizeDescription('A49'), null);
  assert.equal(parseSizeDescription(null), null);
  assert.equal(parseSizeDescription('L: 20 cm x W: 10 cm, Weight: 1 kg'), null);
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
  assert.match(none.note, /no dimensions/);
});
