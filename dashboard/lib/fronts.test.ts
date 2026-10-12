import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractAnswersSection, parseFrontmatter, parseMemoryEntry } from './fronts';

test('parseFrontmatter splits fields and body, strips quotes', () => {
  const { fields, body } = parseFrontmatter(
    '---\nsession_id: "abc"\ncwd: /home/x\nfront: [land-sales, day-job]\n---\n# Summary\n\nDid things.\n',
  );
  assert.equal(fields.session_id, 'abc');
  assert.equal(fields.cwd, '/home/x');
  assert.equal(fields.front, '[land-sales, day-job]');
  assert.equal(body.trim(), '# Summary\n\nDid things.');
});

test('parseFrontmatter returns the whole text as body when no frontmatter', () => {
  const { fields, body } = parseFrontmatter('just text');
  assert.deepEqual(fields, {});
  assert.equal(body, 'just text');
});

test('parseMemoryEntry maps fields, lists, and defaults', () => {
  const e = parseMemoryEntry(
    '2026-10-12-0930-016d446a.md',
    '---\nsession_id: 016d446a\ncwd: /home/mazer/claude/command-center\nstarted_at: 2026-10-12T09:00:00Z\nended_at: 2026-10-12T09:30:00Z\nfront: [land-sales, buyer-followup]\nuser_turns: 7\n---\nBody here.\n',
  );
  assert.equal(e.file, '2026-10-12-0930-016d446a.md');
  assert.equal(e.sessionId, '016d446a');
  assert.deepEqual(e.fronts, ['land-sales', 'buyer-followup']);
  assert.equal(e.userTurns, 7);
  assert.equal(e.summary, 'Body here.');
  assert.equal(e.endedAt, '2026-10-12T09:30:00Z');
});

test('parseMemoryEntry falls back to unrouted and null turns', () => {
  const e = parseMemoryEntry('x.md', '---\nfront: \n---\nhi');
  assert.deepEqual(e.fronts, ['unrouted']);
  assert.equal(e.userTurns, null);
  assert.equal(e.sessionId, null);
});

test('extractAnswersSection returns the section up to the next heading', () => {
  const now = '# Front: now\n\n## Where we are\nx\n\n## Answers from Daniel\n- 2026-10-12: Q: a? A: b\n\n## Open questions\n(none)\n';
  assert.equal(extractAnswersSection(now), '## Answers from Daniel\n- 2026-10-12: Q: a? A: b');
  assert.equal(extractAnswersSection('no section'), null);
  assert.equal(
    extractAnswersSection('## Answers from Daniel\n- last section, no trailing heading\n'),
    '## Answers from Daniel\n- last section, no trailing heading',
  );
});
