/**
 * Rough UPS Ground shipping estimate from a BuyWander size description.
 *
 * BuyWander reports size as "L: 95.3 cm x W: 57.9 cm x H: 101.6 cm,
 * Weight: 11.567 kg" (sometimes only a bin code like "A49"). UPS bills the
 * greater of actual weight and dimensional weight (cubic inches / 139), plus
 * surcharges for big or heavy boxes. The rate table below is an approximate
 * 2026 UPS Ground residential daily rate for a mid-distance zone (5); it is
 * a planning number, not a quote. Pure functions, browser-safe.
 */

export interface PackageDims {
  /** Inches, longest side first. */
  length: number;
  width: number;
  height: number;
  /** Pounds. */
  weight: number;
}

export interface ShippingEstimate {
  /** Dollars; null when UPS Ground would not take it (freight). */
  cost: number | null;
  billable_lbs: number | null;
  /** Short explanation: billable weight, surcharges, or why there is no number. */
  note: string;
}

/** [pounds, dollars] breakpoints, interpolated linearly between. */
export const UPS_GROUND_RATES: ReadonlyArray<readonly [number, number]> = [
  [1, 12],
  [2, 13],
  [3, 14],
  [5, 16],
  [10, 21],
  [15, 27],
  [20, 33],
  [25, 38],
  [30, 43],
  [40, 52],
  [50, 62],
  [70, 82],
  [100, 115],
  [150, 165],
];

/** Dimensional weight divisor for UPS daily rates, cubic inches per pound. */
export const DIM_DIVISOR = 139;
/** Length plus girth above this is a Large Package (surcharge); above MAX, freight. */
export const LARGE_PACKAGE_LG = 130;
export const MAX_GROUND_LG = 165;
export const MAX_GROUND_LBS = 150;
export const LARGE_PACKAGE_SURCHARGE = 125;
/** Additional Handling: over this many pounds, or longest side over this many inches. */
export const ADDL_HANDLING_LBS = 50;
export const ADDL_HANDLING_LENGTH = 48;
export const ADDL_HANDLING_SURCHARGE = 28;

const CM_PER_IN = 2.54;
const KG_PER_LB = 0.45359237;

const UNICODE_FRACTIONS: Record<string, number> = { '¼': 0.25, '½': 0.5, '¾': 0.75, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875, '⅓': 1 / 3, '⅔': 2 / 3 };

/** "15-15/16" -> 15.9375, "26½" -> 26.5, "19 1/4" -> 19.25, "9.1" -> 9.1 */
function parseMixedNumber(raw: string): number | null {
  let text = raw.trim();
  // A fraction slash (U+2044) glued to the whole number, as in "191⁄4" for
  // 19¼: a proper fraction has numerator < denominator, so peel the longest
  // trailing digit run that satisfies that off as the numerator.
  const fs = text.match(/^(\d+)\u2044(\d+)$/);
  if (fs) {
    const digits = fs[1];
    const den = Number(fs[2]);
    if (Number(digits) >= den) {
      for (let n = digits.length - 1; n >= 1; n--) {
        const num = Number(digits.slice(n));
        if (num < den) {
          text = `${digits.slice(0, n)} ${num}/${den}`;
          break;
        }
      }
    } else {
      text = `${digits}/${den}`;
    }
  }
  text = text.replace(/\u2044/g, '/');
  let extra = 0;
  for (const [glyph, value] of Object.entries(UNICODE_FRACTIONS)) {
    if (text.includes(glyph)) {
      extra += value;
      text = text.replace(glyph, '');
    }
  }
  const m = text.match(/^(\d+)(?:[\s-]+(\d+)\/(\d+))?$|^(\d+)\/(\d+)$|^(\d*\.\d+)$/);
  if (!m) return null;
  if (m[6] !== undefined) return Number(m[6]) + extra;
  if (m[4] !== undefined) return Number(m[4]) / Number(m[5]) + extra;
  let v = Number(m[1]);
  if (m[2] !== undefined) v += Number(m[2]) / Number(m[3]);
  return v + extra;
}

const NUMBER_RE = '(\\d*\\.\\d+|\\d+(?:[\\s-]+\\d+\\/\\d+)?[¼½¾⅛⅜⅝⅞⅓⅔]?|\\d+\\u2044\\d+)';
const LENGTH_UNIT_RE = '(cm(?![a-z])|mm(?![a-z])|in(?:ch(?:es)?)?(?![a-z])|"|”|″|\'\'|’’)';

/**
 * Parses a BuyWander size string into inches and pounds. Handles the
 * structured form ("L: 95.3 cm x W: 57.9 cm x H: 101.6 cm, Weight: 11.567 kg"),
 * inch fractions ('11-7/16" (L) x 15-15/16" (W) x 7-1/2" (H)'), furniture
 * style ('44”W x 42”D x 45”H', 'D 19¼" / W 32" / H 26½" / 112.2lbs') and
 * returns null for variant labels like "2TB" or "One Size". Weight may be
 * missing (null): the estimate then uses dimensional weight only.
 */
export function parseSizeDescription(text: string | null | undefined): (Omit<PackageDims, 'weight'> & { weight: number | null }) | null {
  if (!text) return null;
  const lengths: number[] = [];
  const lengthRe = new RegExp(`${NUMBER_RE}\\s*${LENGTH_UNIT_RE}`, 'gi');
  for (const m of text.matchAll(lengthRe)) {
    const v = parseMixedNumber(m[1]);
    if (v === null || !(v > 0)) continue;
    const unit = m[2].toLowerCase();
    lengths.push(unit === 'cm' ? v / CM_PER_IN : unit === 'mm' ? v / (10 * CM_PER_IN) : v);
  }
  if (lengths.length < 3) return null;
  const sides = [...lengths].sort((a, b) => b - a).slice(0, 3);
  let weight: number | null = null;
  const wm = text.match(new RegExp(`${NUMBER_RE}\\s*(kg|kgs|lbs?|pounds?|oz)(?![a-z])`, 'i'));
  if (wm) {
    const v = parseMixedNumber(wm[1]);
    if (v !== null && v > 0) {
      const u = wm[2].toLowerCase();
      weight = u.startsWith('kg') ? v / KG_PER_LB : u === 'oz' ? v / 16 : v;
    }
  }
  return { length: sides[0], width: sides[1], height: sides[2], weight };
}

function rateFor(lbs: number): number {
  const table = UPS_GROUND_RATES;
  if (lbs <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    const [w0, c0] = table[i - 1];
    const [w1, c1] = table[i];
    if (lbs <= w1) return c0 + ((lbs - w0) / (w1 - w0)) * (c1 - c0);
  }
  return table[table.length - 1][1];
}

/** UPS Ground estimate for a package, with surcharges. Pure. */
export function upsGroundEstimate(dims: Omit<PackageDims, 'weight'> & { weight: number | null }, multiplier = 1): ShippingEstimate {
  const lengthGirth = dims.length + 2 * (dims.width + dims.height);
  const dimWeight = (dims.length * dims.width * dims.height) / DIM_DIVISOR;
  const actual = dims.weight ?? 0;
  const billable = Math.max(1, Math.ceil(Math.max(actual, dimWeight)));
  if (billable > MAX_GROUND_LBS || lengthGirth > MAX_GROUND_LG) {
    return {
      cost: null,
      billable_lbs: billable,
      note: `too big for UPS Ground (${Math.round(lengthGirth)} in length+girth, ${billable} lb): freight`,
    };
  }
  let cost = rateFor(billable);
  const notes = [
    `${billable} lb billable` +
      (dims.weight === null ? ' (dimensional, no weight listed)' : dimWeight > dims.weight ? ' (dimensional)' : ''),
  ];
  if (lengthGirth > LARGE_PACKAGE_LG) {
    cost += LARGE_PACKAGE_SURCHARGE;
    notes.push('large package surcharge');
  } else if (billable > ADDL_HANDLING_LBS || dims.length > ADDL_HANDLING_LENGTH) {
    cost += ADDL_HANDLING_SURCHARGE;
    notes.push('additional handling');
  }
  return { cost: Math.round(cost * multiplier), billable_lbs: billable, note: notes.join(', ') };
}

/** Parse and estimate in one step; null dims give a null estimate with a note. */
export function estimateShipping(sizeDescription: string | null | undefined, multiplier = 1): ShippingEstimate {
  const dims = parseSizeDescription(sizeDescription);
  if (!dims) return { cost: null, billable_lbs: null, note: 'no usable dimensions on the lot' };
  return upsGroundEstimate(dims, multiplier);
}
