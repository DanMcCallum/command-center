import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shelfPrice, suggestItemPrice } from './item-pricing';

test('shelfPrice rounds down to a 5 and off a round ten', () => {
  assert.equal(shelfPrice(431), 429);
  assert.equal(shelfPrice(386.8), 385);
  assert.equal(shelfPrice(400), 399);
  assert.equal(shelfPrice(12.7), 12);
  assert.equal(shelfPrice(0), 0);
});

test('Marsail sofa: the nightly median is the one sale price', () => {
  const s = suggestItemPrice({ median: 479.04, compCount: 5, match: 'loose', paidUsd: 120.75 });
  assert.equal(s.listPrice, 475);
  // 475 * 0.864 - 0.40 = 410.00; minus 120.75 = 289.25
  assert.ok(Math.abs(s.expectedEbayNet! - 410.0) < 0.01, `net ${s.expectedEbayNet}`);
  assert.ok(Math.abs(s.expectedEbayProfit! - 289.25) < 0.01);
  assert.ok(Math.abs(s.expectedLocalProfit! - 354.25) < 0.01);
  assert.equal(s.confidence, 'low');
  assert.equal(s.warnings.length, 0);
});

test('exact match with many comps is high confidence', () => {
  const s = suggestItemPrice({ median: 200, compCount: 8, match: 'exact', paidUsd: 60 });
  assert.equal(s.listPrice, 199);
  assert.equal(s.confidence, 'high');
});

test('warns when the margin is under the bid rule target', () => {
  // 199 * 0.864 - 0.4 = 171.5; paid 120 -> profit 51.5, margin 26% < 40%
  const s = suggestItemPrice({ median: 200, compCount: 5, match: 'exact', paidUsd: 120 });
  assert.ok(s.warnings.some(w => w.includes('under the 40%')));
});

test('warns when the price does not cover the cost after fees', () => {
  const s = suggestItemPrice({ median: 100, compCount: 5, match: 'exact', paidUsd: 95 });
  assert.ok(s.warnings.some(w => w.includes('does not cover')));
});

test('no comps gives no price', () => {
  const s = suggestItemPrice({ median: null, paidUsd: 50 });
  assert.equal(s.listPrice, null);
  assert.equal(s.confidence, 'none');
  assert.ok(s.warnings[0].includes('no eBay sold comps'));
});

test('without the price paid it still prices and asks for it', () => {
  const s = suggestItemPrice({ median: 250, compCount: 4, match: 'exact', paidUsd: null });
  assert.equal(s.listPrice, 249);
  assert.equal(s.expectedEbayProfit, null);
  assert.ok(s.basis.some(b => b.includes('Enter the price paid')));
});
