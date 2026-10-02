/**
 * Picks the knowledge-base area sheet that describes a property's area.
 *
 * An area sheet (knowledge-base/ebay/areas/<slug>.md) carries reusable,
 * corpus-grounded facts about a place, plus the sibling photo folder the eBay
 * renderer drops under the LOCATED IN block. Matching the right one matters
 * because the long-form listing's fact sources are closed: a sheet that
 * matches supplies real area copy, and a sheet that matches wrongly puts
 * another town's facts into a live listing.
 *
 * Matching used to be a substring test of the sheet's `matches:` list against
 * the task's location. That is an exact lookup, so it stays, and it runs
 * first: it is free and it is right whenever it fires. It just does not fire
 * often. Every real task in tasks.json carries `location: "Elko, NV"`, which
 * contains none of montello-nv.md's `montello` / `89830` / `elko county`, so
 * no listing has ever picked up an area sheet or its photos.
 *
 * Deciding that a lot in Elko, NV belongs to the Montello sheet is a
 * judgment about places, not a string operation, so the fallback asks for
 * one. A no_match option is always present, and a pick that the model is not
 * peaked on is discarded rather than used, because a wrong sheet is worse
 * here than no sheet.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  asChoice,
  systemOne,
  TypeSafeUnavailableError,
  type SystemOneFn,
} from './typesafe';

export interface AreaSheet {
  /** Filename without .md, e.g. "montello-nv". Also the photo folder name. */
  slug: string;
  /** The sheet's `area:` frontmatter line, e.g. "Montello, Elko County, Nevada". */
  area: string;
  /** Lowercased `matches:` hints used by the exact pass. */
  matches: string[];
  path: string;
}

export type MatchSource = 'exact' | 'judgment' | 'none';

export interface AreaSheetMatch {
  sheet: AreaSheet | null;
  source: MatchSource;
  /** Choice confidence when source is 'judgment'; null otherwise. */
  confidence: number | null;
  /** Operator-facing notes: why nothing matched, or why a pick was dropped. */
  warnings: string[];
}

/**
 * Minimum Choice confidence to accept a judged sheet.
 *
 * Starting value, not a validated one. Confidence reports how peaked the
 * distribution is, not whether the pick is correct, so this needs evaluating
 * against real tasks and the sheets that exist at the time. Raise it if a
 * wrong sheet ever reaches a listing; lower it only with examples in hand.
 */
export const MIN_MATCH_CONFIDENCE = 0.6;

/**
 * Parses the `area:` and `matches:` fields out of a sheet's frontmatter.
 * Handles both the block form (`matches:` then `  - montello`) and the
 * inline form (`matches: [montello, 89830]`); the previous parser in the
 * eBay route read only the block form and stopped at the first line that
 * did not look like an item.
 */
export function parseAreaFrontmatter(markdown: string): { area: string; matches: string[] } {
  const fm = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return { area: '', matches: [] };
  const lines = fm[1].split(/\r?\n/);
  let area = '';
  const matches: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const areaMatch = line.match(/^area:\s*(.+?)\s*$/);
    if (areaMatch) {
      area = unquote(areaMatch[1]);
      continue;
    }
    const inline = line.match(/^matches:\s*\[(.*)\]\s*$/);
    if (inline) {
      for (const part of inline[1].split(',')) {
        const v = unquote(part.trim());
        if (v) matches.push(v.toLowerCase());
      }
      continue;
    }
    if (/^matches:\s*$/.test(line)) {
      for (let j = i + 1; j < lines.length; j++) {
        const item = lines[j].match(/^\s+-\s+(.+?)\s*$/);
        if (!item) break;
        const v = unquote(item[1]);
        if (v) matches.push(v.toLowerCase());
        i = j;
      }
    }
  }
  return { area, matches };
}

function unquote(value: string): string {
  return value.replace(/^(["'])([\s\S]*)\1$/, '$2').trim();
}

/** Loads every sheet in areasDir. Returns [] when the directory is absent. */
export async function loadAreaSheets(areasDir: string): Promise<AreaSheet[]> {
  let names: string[];
  try {
    names = (await fs.readdir(areasDir)).filter(f => f.endsWith('.md')).sort();
  } catch {
    return [];
  }
  const sheets: AreaSheet[] = [];
  for (const name of names) {
    const full = path.join(areasDir, name);
    const { area, matches } = parseAreaFrontmatter(await fs.readFile(full, 'utf-8'));
    const slug = name.replace(/\.md$/, '');
    sheets.push({ slug, area: area || slug, matches, path: full });
  }
  return sheets;
}

export interface PropertyLocation {
  location?: unknown;
  must_include?: unknown;
}

/**
 * Finds the sheet for a property. Exact `matches:` hits win; otherwise one
 * Choice over the loaded sheets decides, with no_match always available.
 *
 * Never throws for a TypeSafe failure: a missing key, a timeout or a service
 * error returns source 'none' with a warning, which is exactly what the old
 * substring-only path did on a miss.
 */
export async function matchAreaSheet(
  metadata: PropertyLocation | null,
  sheets: AreaSheet[],
  deps: { ask?: SystemOneFn; minConfidence?: number } = {},
): Promise<AreaSheetMatch> {
  const warnings: string[] = [];
  const location = typeof metadata?.location === 'string' ? metadata.location : '';
  const mustInclude = typeof metadata?.must_include === 'string' ? metadata.must_include : '';
  const haystack = `${location} ${mustInclude}`.trim().toLowerCase();

  if (!haystack) {
    return { sheet: null, source: 'none', confidence: null, warnings: ['task has no location'] };
  }
  if (sheets.length === 0) {
    return { sheet: null, source: 'none', confidence: null, warnings: ['no area sheets on disk'] };
  }

  const exact = sheets.find(s => s.matches.some(m => haystack.includes(m)));
  if (exact) return { sheet: exact, source: 'exact', confidence: null, warnings };

  const ask = deps.ask ?? systemOne;
  const minConfidence = deps.minConfidence ?? MIN_MATCH_CONFIDENCE;

  const criteria: Record<string, string> = {};
  for (const sheet of sheets) {
    criteria[sheet.slug] = `The property is in or near ${sheet.area}.`;
  }
  criteria.no_match = 'None of these areas covers where this property is.';

  let result;
  try {
    result = await ask(
      {
        property_location: location,
        property_listing_notes: mustInclude,
        areas: sheets.map(s => ({ id: s.slug, area: s.area })),
      },
      {
        area: {
          type: 'choice',
          instructions:
            'Which of these areas is the property located in or immediately around? ' +
            'Judge by whether the reusable area facts (drive times, county, nearby ' +
            'towns and public land) would be true of this property. A town inside ' +
            "the named county counts. Answer no_match when the property is in a " +
            'different part of the state or a different state.',
          criteria,
        },
      },
    );
  } catch (err) {
    if (err instanceof TypeSafeUnavailableError) {
      warnings.push(`no area sheet matched (${err.message})`);
      return { sheet: null, source: 'none', confidence: null, warnings };
    }
    throw err;
  }

  const answer = asChoice(result.answers.area);
  if (!answer || answer.choice === 'no_match') {
    warnings.push(`no area sheet matched "${location}"`);
    return { sheet: null, source: 'none', confidence: null, warnings };
  }
  if (answer.confidence < minConfidence) {
    warnings.push(
      `area sheet "${answer.choice}" discarded: confidence ${answer.confidence.toFixed(2)} ` +
        `below ${minConfidence}. Add a matches: hint to that sheet to make this exact.`,
    );
    return { sheet: null, source: 'none', confidence: answer.confidence, warnings };
  }
  const sheet = sheets.find(s => s.slug === answer.choice) ?? null;
  if (!sheet) {
    warnings.push(`area sheet "${answer.choice}" is not on disk`);
    return { sheet: null, source: 'none', confidence: answer.confidence, warnings };
  }
  return { sheet, source: 'judgment', confidence: answer.confidence, warnings };
}
