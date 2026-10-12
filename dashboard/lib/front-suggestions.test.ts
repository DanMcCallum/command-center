import assert from 'node:assert/strict';
import { test } from 'node:test';
import { suggestionToTask } from './front-suggestions';
import type { FrontSuggestion } from './types';

const base: FrontSuggestion = {
  id: 'fs-1',
  frontSlug: 'land-sales',
  kind: 'task',
  title: 'Draft the Fairplay Landmodo relist',
  body: 'Relist the Fairplay lot on Landmodo with the new price.',
  type: 'Content',
  model: 'opus',
  slashCommand: '/generate-ad',
  sourceSessionId: 'sess-1',
  sourceMemoryFile: '2026-10-12-0930-sess1.md',
  status: 'open',
  createdAt: '2026-10-12T09:30:00.000Z',
};

test('suggestionToTask maps fields and folds operator notes into the description', () => {
  const t = suggestionToTask(base, '  Use the drone photos.  ');
  assert.equal(t.title, base.title);
  assert.equal(t.description, 'Relist the Fairplay lot on Landmodo with the new price.\n\n## Operator notes\nUse the drone photos.\n');
  assert.equal(t.type, 'Content');
  assert.equal(t.model, 'opus');
  assert.equal(t.priority, 3);
  assert.equal(t.slashCommand, '/generate-ad');
  assert.deepEqual(t.tags, ['front:land-sales']);
  assert.deepEqual(t.metadata, {
    frontSlug: 'land-sales',
    suggestionId: 'fs-1',
    sourceSessionId: 'sess-1',
    sourceMemoryFile: '2026-10-12-0930-sess1.md',
  });
});

test('suggestionToTask falls back on unknown type and model, keeps body without notes', () => {
  const t = suggestionToTask({ ...base, type: 'Weird', model: undefined, slashCommand: undefined }, '');
  assert.equal(t.description, base.body);
  assert.equal(t.type, 'Building');
  assert.equal(t.model, 'sonnet');
  assert.equal(t.slashCommand, null);
});
