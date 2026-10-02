import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  distribute,
  escapeHtml,
  isCapsLine,
  parseEbayMarkdown,
  renderEbayListing,
} from './ebay-html';

// Real worker output. Run from dashboard/ (npm test).
const SAMPLE = path.resolve(
  process.cwd(),
  '../workers/workspace/outputs/task-1783741999340-sfsooi/ebay.md',
);
const markdown = fs.readFileSync(SAMPLE, 'utf-8');

const photos = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    url: `https://img.example/photo-${String(i).padStart(2, '0')}.jpg`,
    alt: `photo ${i + 1}`,
  }));

test('parseEbayMarkdown reads headline, description and item specifics from the real sample', () => {
  const parsed = parseEbayMarkdown(markdown);
  assert.equal(parsed.headline.length, 77);
  assert.ok(parsed.headline.startsWith('0.12 AC ELKO COUNTY NV'));
  assert.ok(parsed.description.startsWith('BUY DIRECT FROM THE OWNERS'));
  assert.ok(parsed.description.endsWith('(Property: Sage Basin)'));
  assert.ok(!parsed.description.includes('Why this angle'));
  assert.equal(parsed.itemSpecifics.length, 11);
  assert.deepEqual(parsed.itemSpecifics[0], { key: 'Category', value: 'Real Estate > Land' });
});

test('isCapsLine accepts block headers and rejects body copy and bullets', () => {
  assert.ok(isCapsLine('QUICK NOTES ABOUT THIS PROPERTY'));
  assert.ok(isCapsLine('LOT SIZE: 5,227 SQUARE FEET'));
  assert.ok(isCapsLine("DON'T MISS THIS ONE"));
  assert.ok(!isCapsLine('- Sales price: $1,500'));
  assert.ok(!isCapsLine('Question: Is there power?'));
  assert.ok(!isCapsLine('$1,500'));
});

test('renderEbayListing keeps every line of the description, in order, escaped', () => {
  const parsed = parseEbayMarkdown(markdown);
  const html = renderEbayListing({ ...parsed, photos: photos(15) });
  // Tags collapse to nothing so an inline span (the colored STEP ONE. lead)
  // does not split a line; lines are matched as substrings in order.
  const text = html.replace(/<[^>]+>/g, '');
  let cursor = 0;
  for (const raw of parsed.description.split('\n')) {
    const line = raw.trim().replace(/^- /, '').replace(/\s*\(Property:[^)]+\)$/, '');
    if (!line) continue;
    const idx = text.indexOf(escapeHtml(line), cursor);
    assert.ok(idx >= 0, `line missing or out of order: ${line}`);
    cursor = idx;
  }
  assert.ok(html.includes('(Property: Sage Basin)'));
  assert.ok(!/<script/i.test(html));
});

test('renderEbayListing styles the template blocks the way the reference does', () => {
  const parsed = parseEbayMarkdown(markdown);
  const html = renderEbayListing({ ...parsed, photos: photos(15) });
  const headers = [...html.matchAll(/font-size:27px[^>]*>([^<]+)</g)].map(m => m[1]);
  const banners = [...html.matchAll(/font-size:34px[^>]*>([^<]+)</g)].map(m => m[1]);
  const emphasis = [...html.matchAll(/font-size:22px[^>]*>([^<]+)</g)].map(m => m[1]);

  assert.deepEqual(banners, ['BUY DIRECT FROM THE OWNERS', 'INVEST IN NEVADA', 'ELKO COUNTY, NEVADA']);
  assert.ok(headers.includes('QUICK NOTES ABOUT THIS PROPERTY'));
  assert.ok(headers.includes('FREQUENTLY ASKED QUESTIONS'));
  assert.equal(headers[headers.length - 1], "DON'T MISS THIS ONE");
  // caps stacks are emphasis lines, not headers
  assert.ok(emphasis.includes('NO RECORDING FEES'));
  assert.ok(!headers.includes('NO RECORDING FEES'));
  assert.ok(!headers.includes('NO CREDIT CHECK'));
  // list intros are sub-labels, not headers
  assert.ok(!headers.includes('PROPERTY SPECIFICS:'));
  assert.ok(html.includes('1. AREA:'));
  assert.ok(html.includes('<li style="margin:2px 0;">Sales price: $1,500</li>'));
});

test('renderEbayListing places the hero under the banner and spreads the rest, none after the close', () => {
  const parsed = parseEbayMarkdown(markdown);
  const html = renderEbayListing({ ...parsed, photos: photos(15) });
  const imgs = [...html.matchAll(/<img src="([^"]+)"/g)].map(m => m[1]);
  assert.equal(imgs.length, 15);
  assert.ok(imgs[0].endsWith('photo-00.jpg'));
  const heroAt = html.indexOf('photo-00.jpg');
  const quickNotesAt = html.indexOf('QUICK NOTES ABOUT THIS PROPERTY');
  assert.ok(heroAt < quickNotesAt, 'hero photo comes before the first block');
  const closeAt = html.indexOf("DON'T MISS THIS ONE");
  const lastImgAt = html.lastIndexOf('<img ');
  assert.ok(lastImgAt < closeAt, 'no photo after the closing block');
  assert.ok(html.includes('width="800"'));
});

test('renderEbayListing puts area photos under the LOCATED IN block', () => {
  const parsed = parseEbayMarkdown(markdown);
  const html = renderEbayListing({
    ...parsed,
    photos: photos(2),
    areaPhotos: [{ url: 'https://img.example/area-00.jpg', alt: 'area' }],
  });
  const locatedAt = html.indexOf('LOCATED IN ELKO COUNTY, NEVADA');
  const areaAt = html.indexOf('area-00.jpg');
  const blmAt = html.indexOf('WHAT IS BLM LAND?');
  assert.ok(locatedAt < areaAt && areaAt < blmAt);
});

test('renderEbayListing works with no photos at all', () => {
  const parsed = parseEbayMarkdown(markdown);
  const html = renderEbayListing({ ...parsed, photos: [] });
  assert.ok(!html.includes('<img '));
  assert.ok(html.includes('QUICK NOTES ABOUT THIS PROPERTY'));
});

test('distribute spreads photos over header slots', () => {
  assert.deepEqual(distribute(0, 5), [0, 0, 0, 0, 0]);
  assert.deepEqual(distribute(3, 0), []);
  assert.deepEqual(distribute(2, 4), [0, 1, 0, 1]);
  assert.deepEqual(distribute(7, 3), [3, 2, 2]);
  assert.equal(distribute(14, 22).reduce((a, b) => a + b, 0), 14);
});

test('escapeHtml neutralises markup in copy', () => {
  assert.equal(escapeHtml('<b>"x" & y</b>'), '&lt;b&gt;&quot;x&quot; &amp; y&lt;/b&gt;');
});
