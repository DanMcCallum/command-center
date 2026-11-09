import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  cleanImageUrls,
  extractFinalAmount,
  isAuctionId,
  normalizeLot,
  planImportFilenames,
  stripHtml,
} from './buywander-lot';

const fixture = JSON.parse(
  readFileSync(path.join(__dirname, 'fixtures', 'buywander-lot-ended.json'), 'utf8'),
) as Record<string, unknown>;

test('isAuctionId accepts GUIDs and rejects everything else', () => {
  assert.equal(isAuctionId('08df3c6c-cb5d-5e67-0a58-a9feac020000'), true);
  assert.equal(isAuctionId('08DF3C6C-CB5D-5E67-0A58-A9FEAC020000'), true);
  assert.equal(isAuctionId('not-a-guid'), false);
  assert.equal(isAuctionId('08df3c6c-cb5d-5e67-0a58-a9feac02000'), false);
  assert.equal(isAuctionId('../etc'), false);
  assert.equal(isAuctionId(42), false);
});

test('normalizeLot shapes a captured ended lot', () => {
  const lot = normalizeLot(fixture, new Date('2026-11-09T12:00:00Z'));
  assert.equal(lot.auction_id, '08df3c6c-cb5d-5e67-0a58-a9feac020000');
  assert.match(lot.title, /Sofa|Couch/i);
  assert.equal(lot.bwsku, 'SLC-716197');
  assert.equal(lot.condition, 'AppearsNew');
  assert.equal(lot.category, 'Furniture');
  assert.equal(lot.size_description, '142 Inch-U Shape');
  assert.equal(lot.retail_value, 679.99);
  assert.equal(lot.final_amount, 120.75);
  assert.equal(lot.end_date, '2026-11-09T02:21:00+00:00');
  assert.equal(lot.ended, true);
  assert.equal(lot.images.length, 12);
  assert.ok(lot.images.every((u) => u.startsWith('https://')));
  assert.ok(lot.description && lot.description.startsWith('Convertible & Custom Layout'));
  assert.ok(!lot.description!.includes('<'));
});

test('normalizeLot reports a live lot as not ended and tolerates missing fields', () => {
  const lot = normalizeLot(fixture, new Date('2026-11-08T12:00:00Z'));
  assert.equal(lot.ended, false);
  const bare = normalizeLot({ id: 'x', item: {} });
  assert.deepEqual(bare, {
    auction_id: 'x', title: '', description: null, bwsku: null, condition: null, category: null,
    size_description: null, retail_value: null, final_amount: null, end_date: null, ended: false, images: [],
  });
  assert.equal(normalizeLot(null).auction_id, '');
});

test('stripHtml flattens tags, entities and whitespace and caps length', () => {
  assert.equal(stripHtml('<p>Hello&nbsp;<b>world</b></p><ul><li>one</li><li>two &amp; three</li></ul>'), 'Hello world\n- one\n- two & three');
  assert.equal(stripHtml('line<br/>break   here\n\n\n\nend'), 'line\nbreak here\nend');
  assert.equal(stripHtml('<style>p{}</style>&#39;quoted&#x27; &mdash; ok'), "'quoted' - ok");
  assert.equal(stripHtml('   '), null);
  assert.equal(stripHtml(undefined), null);
  assert.equal(stripHtml('a'.repeat(5000))!.length, 4000);
  assert.equal(stripHtml('abcdef', 3), 'abc');
});

test('cleanImageUrls keeps https only, de-duplicates and preserves order', () => {
  assert.deepEqual(
    cleanImageUrls([
      'https://cdn.buywander.com/items/a',
      'http://insecure.example/x.jpg',
      ' https://m.media-amazon.com/images/I/1.jpg ',
      'https://cdn.buywander.com/items/a',
      42,
      'javascript:alert(1)',
      'https://i5.walmartimages.com/x.png?odnHeight=612',
    ]),
    ['https://cdn.buywander.com/items/a', 'https://m.media-amazon.com/images/I/1.jpg', 'https://i5.walmartimages.com/x.png?odnHeight=612'],
  );
  assert.deepEqual(cleanImageUrls(null), []);
});

test('extractFinalAmount prefers finalAmount, then winningBid, then the last bid', () => {
  assert.equal(extractFinalAmount(fixture), 120.75);
  assert.equal(extractFinalAmount({ finalAmount: null, winningBid: { amount: 105 } }), 105);
  assert.equal(extractFinalAmount({ finalAmount: 0, computedBidHistory: [{ amount: 1 }, { amount: 7 }] }), 7);
  assert.equal(extractFinalAmount({ finalAmount: '42.5' }), 42.5);
  assert.equal(extractFinalAmount({ computedBidHistory: [] }), null);
  assert.equal(extractFinalAmount(undefined), null);
});

test('planImportFilenames puts the primary first and numbers the rest in order', () => {
  const urls = ['https://a/1', 'https://a/2', 'https://a/3'];
  assert.deepEqual(planImportFilenames(urls, 1).map((e) => e.filename), ['00_bw-2.jpg', '01_bw-1.jpg', '02_bw-3.jpg']);
  assert.deepEqual(planImportFilenames(urls).map((e) => e.filename), ['00_bw-1.jpg', '01_bw-2.jpg', '02_bw-3.jpg']);
  assert.deepEqual(planImportFilenames(urls, 2, 5).map((e) => e.filename), ['05_bw-3.jpg', '06_bw-1.jpg', '07_bw-2.jpg']);
  assert.deepEqual(planImportFilenames(urls, 9).map((e) => e.filename), ['00_bw-1.jpg', '01_bw-2.jpg', '02_bw-3.jpg']);
  const [first] = planImportFilenames(urls, 1);
  assert.deepEqual(first, { url: 'https://a/2', k: 2, index: 0, filename: '00_bw-2.jpg' });
  assert.deepEqual(planImportFilenames([]), []);
});
