import { test } from 'node:test';
import assert from 'node:assert';
import { resolveLocation, splitLocationText } from './location';
import { lookupState } from './us-states';
import { TypeSafeUnavailableError, type Answer, type SystemOneFn } from './typesafe';

const CANDIDATES = ['Elko County, NV'];

/** Stub System One returning a fixed answer set for the four questions. */
function stub(answers: Record<string, Answer>, seen?: { state?: unknown }): SystemOneFn {
  return (async state => {
    if (seen) seen.state = state;
    return { answers };
  }) as SystemOneFn;
}

function choice(value: string, confidence: number): Answer {
  return { type: 'choice', choice: value, probabilities: {}, confidence };
}
function noul(p: number): Answer {
  return { type: 'noul', noul: p };
}

const neverCalled: SystemOneFn = (async () => {
  throw new Error('judgment should not have been asked for');
}) as SystemOneFn;

test('lookupState handles codes and full names, either case', () => {
  assert.deepStrictEqual(lookupState('NV'), { abbr: 'NV', name: 'Nevada' });
  assert.deepStrictEqual(lookupState('nevada'), { abbr: 'NV', name: 'Nevada' });
  assert.deepStrictEqual(lookupState('New Mexico'), { abbr: 'NM', name: 'New Mexico' });
  assert.strictEqual(lookupState('Sonora'), null);
});

test('splitLocationText keeps the old rule and returns nulls instead of throwing', () => {
  assert.deepStrictEqual(splitLocationText('Elko County, NV'), { county: 'Elko', state: 'NV' });
  assert.deepStrictEqual(splitLocationText('Rio Arriba, New Mexico'), {
    county: 'Rio Arriba',
    state: 'New Mexico',
  });
  assert.deepStrictEqual(splitLocationText('Nevada'), { county: null, state: null });
});

test('a known "<X> County, <ST>" pair is settled by lookup, with no model call', async () => {
  const r = await resolveLocation('Elko County, NV', {
    countyCandidates: CANDIDATES,
    ask: neverCalled,
  });
  assert.deepStrictEqual(
    { county: r.county, state: r.state, stateAbbr: r.stateAbbr, source: r.source },
    { county: 'Elko', state: 'Nevada', stateAbbr: 'NV', source: 'exact' },
  );
  assert.strictEqual(r.countyConfirmed, true);
  assert.deepStrictEqual(r.warnings, []);
});

test('a full state name is normalised the same way', async () => {
  const r = await resolveLocation('Apache county, Arizona', {
    countyCandidates: ['Apache County, AZ'],
    ask: neverCalled,
  });
  assert.strictEqual(r.county, 'Apache');
  assert.strictEqual(r.state, 'Arizona');
  assert.strictEqual(r.stateAbbr, 'AZ');
  assert.strictEqual(r.source, 'exact');
});

test('a town resolves to its county from the knowledge base, not to itself', async () => {
  const seen: { state?: unknown } = {};
  const r = await resolveLocation('Montello, NV', {
    countyCandidates: CANDIDATES,
    ask: stub(
      {
        state: choice('NV', 0.97),
        county: choice('elko_county_nv', 0.91),
        names_county: noul(0.04),
        state_consistent: noul(0.98),
      },
      seen,
    ),
  });
  assert.strictEqual(r.county, 'Elko');
  assert.strictEqual(r.state, 'Nevada');
  assert.strictEqual(r.source, 'judgment');
  assert.strictEqual(r.countyConfirmed, true);
  assert.match(r.warnings[0], /"Montello" resolved to Elko County, Nevada/);
  // The old parser's answer, which this replaces.
  assert.strictEqual(splitLocationText('Montello, NV').county, 'Montello');
  // Candidates must reach the model or it cannot pick one.
  assert.deepStrictEqual((seen.state as { known_counties: string[] }).known_counties, CANDIDATES);
});

test('"Elko, NV" keeps working, since Elko is a county as well as a town', async () => {
  const r = await resolveLocation('Elko, NV', {
    countyCandidates: CANDIDATES,
    ask: stub({
      state: choice('NV', 0.98),
      county: choice('elko_county_nv', 0.93),
      names_county: noul(0.6),
      state_consistent: noul(0.97),
    }),
  });
  assert.strictEqual(r.county, 'Elko');
  assert.strictEqual(r.state, 'Nevada');
  assert.strictEqual(r.stateAbbr, 'NV');
  assert.deepStrictEqual(r.warnings, []);
});

test('a town in no known county stops with an actionable message, not a wrong county', async () => {
  const r = await resolveLocation('Pahrump, NV', {
    countyCandidates: CANDIDATES,
    ask: stub({
      state: choice('NV', 0.96),
      county: choice('not_in_list', 0.88),
      names_county: noul(0.05),
      state_consistent: noul(0.97),
    }),
  });
  assert.strictEqual(r.county, null);
  assert.strictEqual(r.countyConfirmed, false);
  assert.strictEqual(r.state, 'Nevada');
  assert.match(r.warnings[0], /is a town, not a county/);
  assert.match(r.warnings[0], /"<county> County, NV"/);
});

test('a county the knowledge base has not sold in is judged, then accepted', async () => {
  const r = await resolveLocation('Mohave County, AZ', {
    countyCandidates: CANDIDATES,
    ask: stub({
      state: choice('AZ', 0.97),
      county: choice('not_in_list', 0.92),
      names_county: noul(0.98),
      state_consistent: noul(0.97),
    }),
  });
  assert.strictEqual(r.county, 'Mohave');
  assert.strictEqual(r.state, 'Arizona');
  assert.strictEqual(r.source, 'judgment');
  assert.strictEqual(r.countyConfirmed, true);
});

test('an unnamed county that the model calls a county is taken from the text', async () => {
  const r = await resolveLocation('Rio Arriba, New Mexico', {
    countyCandidates: CANDIDATES,
    ask: stub({
      state: choice('NM', 0.95),
      county: choice('not_in_list', 0.9),
      names_county: noul(0.86),
      state_consistent: noul(0.95),
    }),
  });
  assert.strictEqual(r.county, 'Rio Arriba');
  assert.strictEqual(r.state, 'New Mexico');
  assert.strictEqual(r.countyConfirmed, true);
});

test('an impossible county/state pair is corrected and flagged', async () => {
  // The case generate-ad tells the model to watch for: Elko is in Nevada.
  const r = await resolveLocation('Elko County, Utah', {
    countyCandidates: CANDIDATES,
    ask: stub({
      state: choice('NV', 0.93),
      county: choice('elko_county_nv', 0.95),
      names_county: noul(0.97),
      state_consistent: noul(0.02),
    }),
  });
  assert.strictEqual(r.state, 'Nevada');
  assert.strictEqual(r.county, 'Elko');
  assert.match(r.warnings[0], /location says "Utah" but Elko is in Nevada/);
});

test('a low-confidence state is ignored in favour of what the text says', async () => {
  const r = await resolveLocation('Montello, NV', {
    countyCandidates: CANDIDATES,
    ask: stub({
      state: choice('UT', 0.3),
      county: choice('elko_county_nv', 0.9),
      names_county: noul(0.05),
      state_consistent: noul(0.9),
    }),
  });
  assert.strictEqual(r.state, 'Nevada');
  assert.strictEqual(r.county, 'Elko');
});

test('a low-confidence county falls through rather than being used', async () => {
  const r = await resolveLocation('Somewhere, NV', {
    countyCandidates: CANDIDATES,
    ask: stub({
      state: choice('NV', 0.95),
      county: choice('elko_county_nv', 0.35),
      names_county: noul(0.5),
      state_consistent: noul(0.9),
    }),
  });
  // Neither question settled it: keep the old answer and say so.
  assert.strictEqual(r.county, 'Somewhere');
  assert.strictEqual(r.source, 'fallback');
  assert.strictEqual(r.countyConfirmed, false);
});

test('a TypeSafe outage reproduces the old behaviour exactly, plus a warning', async () => {
  const down: SystemOneFn = (async () => {
    throw new TypeSafeUnavailableError('TYPESAFE_API_KEY is not set');
  }) as SystemOneFn;
  const r = await resolveLocation('Montello, NV', { countyCandidates: CANDIDATES, ask: down });
  assert.strictEqual(r.county, splitLocationText('Montello, NV').county);
  assert.strictEqual(r.state, 'Nevada');
  assert.strictEqual(r.source, 'fallback');
  assert.match(r.warnings[0], /TYPESAFE_API_KEY is not set/);
});

test('a well-formed but impossible pair is not trusted for looking tidy', async () => {
  // Without a judgment available there is nothing better than the text, but
  // the lookup must not have silently blessed it on the way past.
  const down: SystemOneFn = (async () => {
    throw new TypeSafeUnavailableError('offline');
  }) as SystemOneFn;
  const r = await resolveLocation('Elko County, Utah', {
    countyCandidates: CANDIDATES,
    ask: down,
  });
  assert.strictEqual(r.source, 'fallback');
  assert.match(r.warnings[0], /offline/);
});

test('an unsplittable location still throws, as the posters expect', async () => {
  const down: SystemOneFn = (async () => {
    throw new TypeSafeUnavailableError('offline');
  }) as SystemOneFn;
  await assert.rejects(
    () => resolveLocation('Nevada', { ask: down }),
    /expected "<county>, <state>"/,
  );
});

test('an unrecognisable state with no judgment available throws rather than guessing', async () => {
  const down: SystemOneFn = (async () => {
    throw new TypeSafeUnavailableError('offline');
  }) as SystemOneFn;
  await assert.rejects(
    () => resolveLocation('Hermosillo, Sonora', { ask: down }),
    /to a US state/,
  );
});
