import { test } from 'node:test';
import assert from 'node:assert';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadAreaSheets,
  matchAreaSheet,
  parseAreaFrontmatter,
  type AreaSheet,
} from './area-sheets';
import { TypeSafeUnavailableError, type SystemOneFn } from './typesafe';

const SHEETS: AreaSheet[] = [
  {
    slug: 'montello-nv',
    area: 'Montello, Elko County, Nevada',
    matches: ['montello', '89830', 'elko county'],
    path: '/kb/montello-nv.md',
  },
  {
    slug: 'costilla-co',
    area: 'San Luis, Costilla County, Colorado',
    matches: ['san luis', 'costilla county'],
    path: '/kb/costilla-co.md',
  },
];

/** Stub System One: returns the given choice, and records what it was asked. */
function stubChoice(choice: string, confidence: number, seen?: { state?: unknown }): SystemOneFn {
  return (async (state, _questions) => {
    if (seen) seen.state = state;
    return { answers: { area: { type: 'choice', choice, probabilities: {}, confidence } } };
  }) as SystemOneFn;
}

const neverCalled: SystemOneFn = (async () => {
  throw new Error('judgment should not have been asked for');
}) as SystemOneFn;

test('parseAreaFrontmatter reads the block form', () => {
  const md = '---\ntype: area-sheet\narea: Montello, Elko County, Nevada\nmatches:\n  - montello\n  - "89830"\n  - elko county\nstatus: v1\n---\n\n# body\n';
  assert.deepStrictEqual(parseAreaFrontmatter(md), {
    area: 'Montello, Elko County, Nevada',
    matches: ['montello', '89830', 'elko county'],
  });
});

test('parseAreaFrontmatter reads the inline form the old parser missed', () => {
  const md = '---\narea: "Montello, NV"\nmatches: [montello, "89830", Elko County]\n---\n';
  assert.deepStrictEqual(parseAreaFrontmatter(md), {
    area: 'Montello, NV',
    matches: ['montello', '89830', 'elko county'],
  });
});

test('parseAreaFrontmatter keeps reading fields after the matches block', () => {
  const md = '---\nmatches:\n  - montello\nstatus: v1\narea: Montello, Elko County, Nevada\n---\n';
  const parsed = parseAreaFrontmatter(md);
  assert.strictEqual(parsed.area, 'Montello, Elko County, Nevada');
  assert.deepStrictEqual(parsed.matches, ['montello']);
});

test('parseAreaFrontmatter returns empties when there is no frontmatter', () => {
  assert.deepStrictEqual(parseAreaFrontmatter('# just a heading\n'), { area: '', matches: [] });
});

test('an exact matches: hit wins and never asks for a judgment', async () => {
  const result = await matchAreaSheet(
    { location: 'Montello, NV 89830' },
    SHEETS,
    { ask: neverCalled },
  );
  assert.strictEqual(result.sheet?.slug, 'montello-nv');
  assert.strictEqual(result.source, 'exact');
});

test('must_include is searched as well as location', async () => {
  const result = await matchAreaSheet(
    { location: 'Nevada', must_include: 'APN 011108042, Elko County' },
    SHEETS,
    { ask: neverCalled },
  );
  assert.strictEqual(result.sheet?.slug, 'montello-nv');
  assert.strictEqual(result.source, 'exact');
});

test('a judgment covers "Elko, NV", which no matches: hint contains', async () => {
  const seen: { state?: unknown } = {};
  const result = await matchAreaSheet(
    { location: 'Elko, NV' },
    SHEETS,
    { ask: stubChoice('montello-nv', 0.88, seen) },
  );
  assert.strictEqual(result.sheet?.slug, 'montello-nv');
  assert.strictEqual(result.source, 'judgment');
  assert.strictEqual(result.confidence, 0.88);
  // Every sheet has to be offered, or the model cannot pick it.
  const state = seen.state as { areas: { id: string }[] };
  assert.deepStrictEqual(state.areas.map(a => a.id), ['montello-nv', 'costilla-co']);
});

test('no_match yields no sheet and a warning naming the location', async () => {
  const result = await matchAreaSheet(
    { location: 'Bangor, ME' },
    SHEETS,
    { ask: stubChoice('no_match', 0.95) },
  );
  assert.strictEqual(result.sheet, null);
  assert.strictEqual(result.source, 'none');
  assert.match(result.warnings[0], /no area sheet matched "Bangor, ME"/);
});

test('a low-confidence pick is discarded rather than used', async () => {
  const result = await matchAreaSheet(
    { location: 'Elko, NV' },
    SHEETS,
    { ask: stubChoice('montello-nv', 0.41) },
  );
  assert.strictEqual(result.sheet, null);
  assert.strictEqual(result.confidence, 0.41);
  assert.match(result.warnings[0], /discarded: confidence 0\.41 below 0\.6/);
});

test('a TypeSafe outage degrades to no match, never an exception', async () => {
  const down: SystemOneFn = (async () => {
    throw new TypeSafeUnavailableError('TYPESAFE_API_KEY is not set');
  }) as SystemOneFn;
  const result = await matchAreaSheet({ location: 'Elko, NV' }, SHEETS, { ask: down });
  assert.strictEqual(result.sheet, null);
  assert.strictEqual(result.source, 'none');
  assert.match(result.warnings[0], /TYPESAFE_API_KEY is not set/);
});

test('an empty location or an empty sheet list short-circuits', async () => {
  const noLocation = await matchAreaSheet({}, SHEETS, { ask: neverCalled });
  assert.deepStrictEqual(noLocation.warnings, ['task has no location']);
  const noSheets = await matchAreaSheet({ location: 'Elko, NV' }, [], { ask: neverCalled });
  assert.deepStrictEqual(noSheets.warnings, ['no area sheets on disk']);
});

test('loadAreaSheets reads a directory and tolerates a missing one', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'areas-'));
  try {
    await fs.writeFile(
      path.join(dir, 'montello-nv.md'),
      '---\narea: Montello, Elko County, Nevada\nmatches:\n  - montello\n---\n# sheet\n',
    );
    await fs.writeFile(path.join(dir, 'notes.txt'), 'ignored');
    const sheets = await loadAreaSheets(dir);
    assert.strictEqual(sheets.length, 1);
    assert.strictEqual(sheets[0].slug, 'montello-nv');
    assert.strictEqual(sheets[0].area, 'Montello, Elko County, Nevada');
    assert.deepStrictEqual(await loadAreaSheets(path.join(dir, 'nope')), []);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('the real montello-nv.md still matches by hint, and Elko, NV still does not', async () => {
  const sheets = await loadAreaSheets(
    path.resolve(process.cwd(), '..', 'knowledge-base', 'ebay', 'areas'),
  );
  assert.ok(sheets.length > 0, 'expected area sheets on disk');
  const byHint = await matchAreaSheet({ location: 'Montello, NV' }, sheets, { ask: neverCalled });
  assert.strictEqual(byHint.source, 'exact');
  // The regression this whole path exists for: the shipped task locations.
  const real = await matchAreaSheet({ location: 'Elko, NV' }, sheets, {
    ask: stubChoice('no_match', 0.9),
  });
  assert.strictEqual(real.source, 'none');
});
