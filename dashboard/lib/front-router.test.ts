import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCriteria, combine, matchCwd, routeSession } from './front-router';
import type { FrontConfig } from './types';

const HOME = '/home/op';
const fronts: FrontConfig[] = [
  { slug: 'land-sales', name: 'Land sales', description: 'selling land', cwdHints: ['~/claude/command-center'], enabled: true },
  { slug: 'buyer-followup', name: 'Buyer follow-up', description: 'buyers', cwdHints: ['~/claude/followupdominator', '~/claude/command-center/operator-input'], enabled: true },
  { slug: 'day-job', name: 'Day job', description: 'work', cwdHints: [], enabled: true },
  { slug: 'old', name: 'Old', description: 'retired', cwdHints: ['~/claude'], enabled: false },
];

test('matchCwd picks the longest matching hint and ignores disabled fronts', () => {
  assert.equal(matchCwd('/home/op/claude/command-center/operator-input/x', fronts, HOME), 'buyer-followup');
  assert.equal(matchCwd('/home/op/claude/command-center', fronts, HOME), 'land-sales');
  assert.equal(matchCwd('/home/op/claude/command-centerX', fronts, HOME), null);
  assert.equal(matchCwd('/home/op/claude/other', fronts, HOME), null);
  assert.equal(matchCwd(null, fronts, HOME), null);
});

test('buildCriteria lists enabled fronts plus none', () => {
  const c = buildCriteria(fronts);
  assert.deepEqual(Object.keys(c), ['land-sales', 'buyer-followup', 'day-job', 'none']);
  assert.match(c['land-sales'], /^Land sales: selling land/);
});

test('combine applies the cwd bias, drops none, renormalizes and sorts', () => {
  const out = combine({ 'land-sales': 0.4, 'buyer-followup': 0.4, 'day-job': 0, none: 0.2 }, 'buyer-followup', fronts);
  assert.equal(out[0].slug, 'buyer-followup');
  assert.equal(out[0].probability, 0.52); // (0.4+0.25)/1.25
  assert.equal(out[1].slug, 'land-sales');
  assert.equal(out[1].probability, 0.32);
  assert.equal(out.length, 2);
  assert.deepEqual(combine({}, null, fronts), []);
});

test('routeSession uses Jev when configured and reports its confidence', async () => {
  const r = await routeSession(
    { summary: 'Fixed the Landmodo poster', cwd: '/home/op/claude/command-center', filesTouched: ['workers/posting/post-landmodo.ts'] },
    fronts,
    {
      home: HOME,
      configured: () => true,
      ask: async (state, questions) => {
        assert.match(String(state), /Landmodo/);
        assert.equal(questions.front.type, 'choice');
        return { answers: { front: { type: 'choice', choice: 'land-sales', probabilities: { 'land-sales': 0.8, 'buyer-followup': 0.1, 'day-job': 0.05, none: 0.05 }, confidence: 0.85 } } };
      },
      claudeFallback: async () => { throw new Error('should not be called'); },
    },
  );
  assert.equal(r.method, 'jev');
  assert.equal(r.fronts[0].slug, 'land-sales');
  assert.equal(r.confidence, 0.85);
  assert.equal(r.cwdMatch, 'land-sales');
});

test('routeSession falls back to claude, then to cwd, then to none', async () => {
  const viaClaude = await routeSession(
    { summary: 's', cwd: '/home/op/claude/followupdominator', filesTouched: [] },
    fronts,
    { home: HOME, configured: () => false, claudeFallback: async () => ({ 'land-sales': 0.2, 'buyer-followup': 0.7, 'day-job': 0, none: 0.1 }) },
  );
  assert.equal(viaClaude.method, 'claude');
  assert.equal(viaClaude.fronts[0].slug, 'buyer-followup');

  const viaCwd = await routeSession(
    { summary: 's', cwd: '/home/op/claude/followupdominator', filesTouched: [] },
    fronts,
    { home: HOME, configured: () => true, ask: async () => { throw new Error('down'); }, claudeFallback: async () => { throw new Error('down'); } },
  );
  assert.equal(viaCwd.method, 'cwd');
  assert.deepEqual(viaCwd.fronts, [{ slug: 'buyer-followup', probability: 0.7 }]);

  const none = await routeSession(
    { summary: 's', cwd: '/elsewhere', filesTouched: [] },
    fronts,
    { home: HOME, configured: () => false, claudeFallback: async () => { throw new Error('down'); } },
  );
  assert.equal(none.method, 'none');
  assert.deepEqual(none.fronts, []);
});
