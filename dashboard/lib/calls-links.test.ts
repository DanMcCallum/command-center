import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noteRecordHref } from './calls-links';

test('noteRecordHref prefers the contact record', () => {
  assert.equal(noteRecordHref('7', '5692'), '/calls/record/contact/7');
  assert.equal(noteRecordHref(7, null), '/calls/record/contact/7');
});

test('noteRecordHref falls back to the property record', () => {
  assert.equal(noteRecordHref('', '5692'), '/calls/record/property/5692');
  assert.equal(noteRecordHref(null, ' 5692 '), '/calls/record/property/5692');
});

test('noteRecordHref ignores ids that are not positive integers', () => {
  assert.equal(noteRecordHref(null, null), null);
  assert.equal(noteRecordHref('abc', '0'), null);
  assert.equal(noteRecordHref('7x', '-1'), null);
});
