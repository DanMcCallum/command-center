/**
 * Resolves the Ad Builder's free-text location into the county and state the
 * marketplace listing forms need.
 *
 * The form field is labelled "Location (county, state)" but it is free text,
 * and operators type a town: every task in tasks.json says "Elko, NV" or
 * "Elko, Nevada". The old parser split on the last comma and called the left
 * side the county, which is right for the knowledge base's own convention
 * ("Elko County, NV") and silently wrong for a town. Elko happens to be both
 * a town and a county, so it has never bitten. Montello, which is most of the
 * sold corpus, is a town in Elko County, so "Montello, NV" would have posted
 * to Land.com with county "Montello".
 *
 * What is a rule stays a rule: the comma split, stripping a "County" suffix
 * and recognising a state name or postal code are exact lookups and run
 * first, with no model involved. What is left is a judgment about places, so
 * it is asked as one, over option sets that are covered (the 50 states) or
 * grounded in the knowledge base (counties we have sold in), with a no-match
 * option on both.
 *
 * Failure policy. Every path degrades to the old deterministic answer, so a
 * missing TYPESAFE_API_KEY, a timeout or a service error changes nothing
 * about posting. The one new failure is narrow and deliberate: when the model
 * positively reports that the text names a town and it cannot place that town
 * in a county we know, county comes back null and the poster stops with an
 * actionable message. Posting a wrong county to a live marketplace listing is
 * worse than asking the operator for one word.
 */
import {
  asChoice,
  asNoul,
  systemOne,
  TypeSafeUnavailableError,
  type SystemOneFn,
} from './typesafe';
import { lookupState, US_STATES } from './us-states';

export interface ResolvedLocation {
  /** County without the trailing "County", e.g. "Elko". Null when unknown. */
  county: string | null;
  /** Full state name, e.g. "Nevada". Listing forms label options this way. */
  state: string;
  /** Postal abbreviation, e.g. "NV", for forms whose options use codes. */
  stateAbbr: string;
  /** 'exact' when rules alone settled it, 'judgment' when a model helped,
   *  'fallback' when the model was unavailable and rules had the last word. */
  source: 'exact' | 'judgment' | 'fallback';
  /** True when the county is the knowledge base's or the text's own, rather
   *  than a guess carried over from the deterministic split. */
  countyConfirmed: boolean;
  /** Operator-facing notes. Surfaced on the posting record, never swallowed. */
  warnings: string[];
}

/** Minimum Choice confidence to take a judged state or county. Starting
 *  value: evaluate against real tasks before trusting it further. */
export const MIN_LOCATION_CONFIDENCE = 0.6;
/** Noul probability above which we treat a statement as settled. */
const NOUL_YES = 0.7;
/** Noul probability below which we treat a statement as settled the other way. */
const NOUL_NO = 0.3;

export interface DeterministicSplit {
  county: string | null;
  state: string | null;
}

/**
 * The rule half: split on the last comma, strip a "County" suffix. Returns
 * nulls rather than throwing so the caller decides what an unsplittable
 * string means.
 */
export function splitLocationText(location: string): DeterministicSplit {
  const idx = location.lastIndexOf(',');
  if (idx === -1) return { county: null, state: null };
  const county = location.slice(0, idx).trim().replace(/\s+county$/i, '') || null;
  const state = location.slice(idx + 1).trim() || null;
  return { county, state };
}

/** True when the text names its county outright, e.g. "Elko County, NV". */
function textNamesCounty(location: string): boolean {
  const idx = location.lastIndexOf(',');
  if (idx === -1) return false;
  return /\s+county$/i.test(location.slice(0, idx).trim());
}

export interface ResolveDeps {
  ask?: SystemOneFn;
  /** Counties the knowledge base has sold in, e.g. ["Elko County, NV"]. */
  countyCandidates?: string[];
  minConfidence?: number;
}

/**
 * Resolves one free-text location. Never throws for a TypeSafe failure.
 */
export async function resolveLocation(
  location: string,
  deps: ResolveDeps = {},
): Promise<ResolvedLocation> {
  const raw = location.trim();
  const warnings: string[] = [];
  const split = splitLocationText(raw);
  const knownState = split.state ? lookupState(split.state) : null;

  const candidates = dedupe(deps.countyCandidates ?? []);

  // Rules alone settle the knowledge base's own convention, but only when the
  // pair is one we have actually sold in. "Elko County, NV" is grounded and
  // stops here. "Elko County, Utah" is well-formed and impossible, which is
  // the exact case generate-ad warns about, so it goes on to be judged rather
  // than being trusted for looking tidy.
  if (
    knownState &&
    split.county &&
    textNamesCounty(raw) &&
    isKnownCounty(split.county, knownState.abbr, candidates)
  ) {
    return {
      county: split.county,
      state: knownState.name,
      stateAbbr: knownState.abbr,
      source: 'exact',
      countyConfirmed: true,
      warnings,
    };
  }

  const ask = deps.ask ?? systemOne;
  const minConfidence = deps.minConfidence ?? MIN_LOCATION_CONFIDENCE;

  const stateCriteria: Record<string, string> = { unknown: 'No US state is identifiable.' };
  for (const [abbr, name] of Object.entries(US_STATES)) {
    stateCriteria[abbr] = `The property is in ${name}.`;
  }
  const countyCriteria: Record<string, string> = {
    not_in_list: 'The property is not in any of the listed counties.',
  };
  for (const c of candidates) countyCriteria[slugifyCandidate(c)] = `The property is in ${c}.`;

  let result;
  try {
    result = await ask(
      { location_text: raw, known_counties: candidates },
      {
        state: {
          type: 'choice',
          instructions:
            'Which US state is the property in? Judge from the place names in ' +
            '`location_text`. If the text names a state that contradicts the town ' +
            'or county, answer with the state the named town or county is really in.',
          criteria: stateCriteria,
        },
        county: {
          type: 'choice',
          instructions:
            'Which of the known counties contains the place named in ' +
            '`location_text`? A town inside a county counts as that county. ' +
            'Answer not_in_list when the place is somewhere else.',
          criteria: countyCriteria,
        },
        names_county: {
          type: 'noul',
          instructions:
            'Does `location_text` name a county, rather than only a town or city?',
          criteria: {
            true: 'The text names a county, with or without the word "County".',
            false: 'The text names a town, city or settlement, not a county.',
          },
        },
        state_consistent: {
          type: 'noul',
          instructions:
            'Is the place named in `location_text` actually located in the state ' +
            'that the same text names?',
          criteria: {
            true: 'The town or county named really is in the state named.',
            false:
              'The town or county named is in a different state, so the text ' +
              'contradicts itself.',
          },
        },
      },
    );
  } catch (err) {
    if (!(err instanceof TypeSafeUnavailableError)) throw err;
    return fallback(raw, split, knownState, [...warnings, err.message]);
  }

  const stateAnswer = asChoice(result.answers.state);
  const countyAnswer = asChoice(result.answers.county);
  const namesCounty = asNoul(result.answers.names_county);
  const consistent = asNoul(result.answers.state_consistent);

  // State: take the judged one when it is a real state and peaked enough,
  // otherwise whatever the text itself said.
  let state = knownState;
  if (
    stateAnswer &&
    stateAnswer.choice !== 'unknown' &&
    stateAnswer.confidence >= minConfidence &&
    US_STATES[stateAnswer.choice]
  ) {
    const judged = { abbr: stateAnswer.choice, name: US_STATES[stateAnswer.choice] };
    if (knownState && judged.abbr !== knownState.abbr) {
      warnings.push(
        `location says "${split.state}" but ${split.county ?? raw} is in ${judged.name}. ` +
          `Using ${judged.name}.`,
      );
    }
    state = judged;
  }
  if (!state) {
    return fallback(raw, split, knownState, [
      ...warnings,
      `could not identify a US state in "${raw}"`,
    ]);
  }
  if (consistent && consistent.noul <= NOUL_NO && !warnings.length) {
    warnings.push(`"${raw}" names a place and a state that do not go together. Check it.`);
  }

  // County: a grounded candidate first, then the text's own county, then
  // nothing, which is a hard stop rather than a wrong value.
  if (
    countyAnswer &&
    countyAnswer.choice !== 'not_in_list' &&
    countyAnswer.confidence >= minConfidence
  ) {
    const picked = candidates.find(c => slugifyCandidate(c) === countyAnswer.choice);
    if (picked) {
      const county = countyName(picked);
      if (split.county && county.toLowerCase() !== split.county.toLowerCase()) {
        warnings.push(`"${split.county}" resolved to ${county} County, ${state.name}.`);
      }
      return {
        county,
        state: state.name,
        stateAbbr: state.abbr,
        source: 'judgment',
        countyConfirmed: true,
        warnings,
      };
    }
  }

  if (namesCounty && namesCounty.noul >= NOUL_YES && split.county) {
    return {
      county: split.county,
      state: state.name,
      stateAbbr: state.abbr,
      source: 'judgment',
      countyConfirmed: true,
      warnings,
    };
  }

  if (namesCounty && namesCounty.noul <= NOUL_NO) {
    warnings.push(
      `"${split.county ?? raw}" is a town, not a county, and it is not in a county ` +
        `the knowledge base has sold in. Set the task's location to ` +
        `"<county> County, ${state.abbr}" so the listing form gets the right county.`,
    );
    return {
      county: null,
      state: state.name,
      stateAbbr: state.abbr,
      source: 'judgment',
      countyConfirmed: false,
      warnings,
    };
  }

  // Nothing settled it either way. Keep the old answer and say so.
  return fallback(raw, split, state, warnings);
}

function fallback(
  raw: string,
  split: DeterministicSplit,
  knownState: { abbr: string; name: string } | null,
  warnings: string[],
): ResolvedLocation {
  if (!split.county || !split.state) {
    throw new Error(
      `Cannot split location "${raw}" into county and state, expected "<county>, <state>"`,
    );
  }
  const state = knownState ?? lookupState(split.state);
  if (!state) {
    throw new Error(`Cannot resolve "${split.state}" in location "${raw}" to a US state`);
  }
  return {
    county: split.county,
    state: state.name,
    stateAbbr: state.abbr,
    source: 'fallback',
    countyConfirmed: textNamesCounty(raw),
    warnings,
  };
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map(v => v.trim()).filter(Boolean))].sort();
}

/** "Elko County, NV" -> "elko_county_nv", a stable Choice option id. */
function slugifyCandidate(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * True when "<county>, <state>" is one of the knowledge base's own pairs.
 * This is a lookup over real sold ads and area sheets, so it settles the
 * common case without spending an inference call, and it declines to settle
 * a pair we have no evidence for.
 */
function isKnownCounty(county: string, stateAbbr: string, candidates: string[]): boolean {
  const wanted = county.trim().toLowerCase();
  for (const candidate of candidates) {
    const parts = candidate.split(',');
    if (parts.length < 2) continue;
    if (countyName(candidate).toLowerCase() !== wanted) continue;
    const state = lookupState(parts[parts.length - 1].trim());
    if (state && state.abbr === stateAbbr) return true;
  }
  return false;
}

/** "Elko County, NV" -> "Elko", the bare name listing forms want. */
function countyName(value: string): string {
  return value.split(',')[0].trim().replace(/\s+county$/i, '');
}
