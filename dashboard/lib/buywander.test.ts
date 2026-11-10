import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  hasPricedFind,
  idsToRemember,
  median,
  ntfyMessage,
  pruneSeen,
  scoreFind,
  sortFinds,
  suggestedMaxBid,
  validateAgentOutput,
  type BuywanderAgentOutput,
  type BuywanderFind,
} from './buywander';

const find = (over: Partial<BuywanderFind> = {}): BuywanderFind => ({
  auction_id: 'a1',
  url: 'https://buywander.com/auctions?auctionId=a1',
  title: 'UPPAbaby Cruz V3 Stroller',
  retail_value: 899.99,
  current_bid: 51,
  ends_at: '2026-11-10T02:02:00+00:00',
  condition: 'AppearsNew',
  category: 'Strollers & Car Seats',
  ebay: { median_sold: 650, comp_count: 4, search_url: 'https://www.ebay.com/sch/i.html?_nkw=x&LH_Sold=1' },
  ...over,
});

const output = (over: Partial<BuywanderAgentOutput> = {}): BuywanderAgentOutput => ({
  scanned_at: '2026-11-08T23:00:00Z',
  location: 'Salt Lake City',
  scanned_ids: ['a1', 'a2'],
  finds: [find()],
  ...over,
});

test('median handles empty, odd and even lists', () => {
  assert.equal(median([]), null);
  assert.equal(median([5]), 5);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
});

const FREE = { ebay_fee_rate: 0, target_margin: 0, buyer_cost_rate: 0, shipping_multiplier: 1, default_shipping: 0 };

test('suggestedMaxBid applies fee, margin and pickup cost, floored, ignoring shipping', () => {
  // 650 * 0.864 = 561.6 net; * 0.6 = 336.96; / 1.0725 = 314.18 -> 314
  assert.equal(suggestedMaxBid(650), 314);
  assert.equal(suggestedMaxBid(650, FREE), 650);
  assert.equal(suggestedMaxBid(10, { ...FREE, target_margin: 0.95 }), 0);
});

test('scoreFind prices shipping from the size string without touching the max bid', () => {
  // 37.5 x 22.8 x 40 in, 25.5 lb actual; dim weight 37.5*22.8*40/139 = 246 lb -> freight? L+G = 37.5+2*(22.8+40) = 163 < 165, 246 lb > 150 -> freight
  const stroller = scoreFind(find({ size_description: 'L: 95.3 cm x W: 57.9 cm x H: 101.6 cm, Weight: 11.567 kg' }));
  assert.equal(stroller.shipping_est, null);
  assert.match(stroller.shipping_note!, /freight/);
  assert.equal(stroller.max_bid, 314);
  // 20 x 12 x 8 in, 9 lb: dim 13.8 -> 14 lb billable -> 25.8 -> $26
  const box = scoreFind(find({ size_description: 'L: 20 in x W: 12 in x H: 8 in, Weight: 9 lbs' }));
  assert.equal(box.shipping_est, 26);
  assert.match(box.shipping_note!, /14 lb billable \(dimensional\)/);
  assert.equal(box.max_bid, 314);
  const none = scoreFind(find({ size_description: 'A49' }));
  assert.equal(none.shipping_est, 20);
  assert.match(none.shipping_note!, /assuming \$20/);
});

test('scoreFind computes spread, margin and max bid, null without comps', () => {
  const scored = scoreFind(find());
  assert.equal(scored.spread, 599);
  assert.equal(scored.margin, 0.92);
  assert.equal(scored.shipping_est, 20);
  assert.equal(scored.max_bid, 314);
  const none = scoreFind(find({ ebay: { median_sold: null, comp_count: 0, search_url: '' } }));
  assert.equal(none.spread, null);
  assert.equal(none.margin, null);
  assert.equal(none.max_bid, null);
});

test('sortFinds puts the best spread first and comp-less finds last', () => {
  const a = scoreFind(find({ auction_id: 'a', ebay: { median_sold: 500, comp_count: 2, search_url: '' } }));
  const b = scoreFind(find({ auction_id: 'b', ebay: { median_sold: 900, comp_count: 2, search_url: '' } }));
  const c = scoreFind(find({ auction_id: 'c', ebay: { median_sold: null, comp_count: 0, search_url: '' } }));
  assert.deepEqual(sortFinds([a, c, b]).map(f => f.auction_id), ['b', 'a', 'c']);
});

test('pruneSeen drops ids older than the TTL and keeps unparseable dates', () => {
  const now = new Date('2026-11-08T00:00:00Z');
  const seen = pruneSeen(
    { old: '2026-09-01T00:00:00Z', fresh: '2026-11-07T00:00:00Z', weird: 'not a date' },
    now,
  );
  assert.deepEqual(Object.keys(seen).sort(), ['fresh', 'weird']);
});

test('validateAgentOutput accepts a good payload and names the bad field', () => {
  assert.equal(validateAgentOutput(output()), null);
  assert.equal(validateAgentOutput('nope'), 'body must be an object');
  assert.equal(validateAgentOutput(output({ scanned_ids: [1] as unknown as string[] })), 'scanned_ids must be an array of strings');
  assert.match(validateAgentOutput(output({ finds: [find({ retail_value: '9' as unknown as number })] }))!, /retail_value/);
  assert.match(validateAgentOutput(output({ finds: [find({ ebay: { median_sold: 'x' as unknown as number, comp_count: 1, search_url: '' } })] }))!, /median_sold/);
  assert.match(validateAgentOutput(output({ finds: [find({ ebay: { median_sold: 1, comp_count: 1, search_url: '', match: 'fuzzy' as 'loose' } })] }))!, /match/);
  assert.equal(validateAgentOutput(output({ finds: [find({ ebay: { median_sold: 1, comp_count: 1, search_url: '', match: 'loose' } })] })), null);
  assert.equal(validateAgentOutput(output({ skipped: [{ auction_id: 's', url: '', title: 't', retail_value: 500, reason: 'pallet' }] })), null);
});

test('ntfyMessage leads with the count and lists finds best spread first', () => {
  const low = find({ auction_id: 'low', title: 'Salt Cell Chlorine Generator Replacement Fit for Pentair Intellichlor', current_bid: 0, ebay: { median_sold: 275, comp_count: 10, search_url: '' } });
  const none = find({ auction_id: 'none', title: 'Kingston valve', ebay: { median_sold: null, comp_count: 0, search_url: '' } });
  const msg = ntfyMessage(output({ finds: [low, none, find()] }), 'https://dash.example/');
  assert.equal(msg.title, 'BuyWander Salt Lake City: 3 new lots over $400');
  const lines = msg.body.split('\n');
  assert.match(lines[0], /^UPPAbaby Cruz V3 Stroller: eBay \$650 vs bid \$51, spread \$599 \(92%\), ship \$20, max bid \$314$/);
  assert.match(lines[1], /^Salt Cell Chlorine Generator Replacement Fit fo…: eBay \$275 vs bid \$0, spread \$275 \(100%\), ship \$20, max bid \$132$/);
  assert.equal(lines[2], '1 more with no eBay comps');
  assert.equal(msg.click, 'https://dash.example/deals');
  assert.equal(msg.priority, 4);
  assert.deepEqual(msg.tags, ['moneybag']);
});

test('ntfyMessage uses normal priority for thin margins and singular wording', () => {
  const msg = ntfyMessage(output({ finds: [find({ ebay: { median_sold: 60, comp_count: 3, search_url: '' } })] }));
  assert.equal(msg.title, 'BuyWander Salt Lake City: 1 new lot over $400');
  assert.equal(msg.priority, 3);
  assert.equal(msg.click, 'https://dashboard.ownaloha.land/deals');
});

test('idsToRemember keeps priced and skipped-for-cause lots, not over-max or no-comp ones', () => {
  const ids = idsToRemember(
    output({
      scanned_ids: ['a1', 'p1', 'n1', 'c1', 'x1'],
      finds: [find({ auction_id: 'p1' }), find({ auction_id: 'n1', ebay: { median_sold: null, comp_count: 0, search_url: '' } })],
      skipped: [
        { auction_id: 'c1', url: '', title: 'pallet', retail_value: 400, reason: 'mixed pallet' },
        { auction_id: 'x1', url: '', title: 'later', retail_value: 500, reason: 'Over max' },
      ],
    }),
  );
  assert.deepEqual(ids.sort(), ['c1', 'p1']);
});

test('hasPricedFind is false when eBay priced nothing, true with one priced find', () => {
  const blocked = find({ auction_id: 'n1', ebay: { median_sold: null, comp_count: 0, search_url: '' } });
  assert.equal(hasPricedFind(output({ finds: [] })), false);
  assert.equal(hasPricedFind(output({ finds: [blocked, blocked] })), false);
  assert.equal(hasPricedFind(output({ finds: [blocked, find()] })), true);
});
