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

/**
 * Parses BuyWander's size string. Accepts cm/in and kg/lb(s) units in any
 * order; returns null for bin codes or partial data.
 */
export function parseSizeDescription(text: string | null | undefined): PackageDims | null {
  if (!text) return null;
  const dim = (label: string) => {
    const m = text.match(new RegExp(`${label}\\s*:?\\s*([0-9]+(?:\\.[0-9]+)?)\\s*(cm|in(?:ch(?:es)?)?|")`, 'i'));
    if (!m) return null;
    const v = Number(m[1]);
    return m[2].toLowerCase() === 'cm' ? v / CM_PER_IN : v;
  };
  const l = dim('L'), w = dim('W'), h = dim('H');
  const wm = text.match(/Weight\s*:?\s*([0-9]+(?:\.[0-9]+)?)\s*(kg|lbs?|pounds?)/i);
  if (l === null || w === null || h === null || !wm) return null;
  let weight = Number(wm[1]);
  if (wm[2].toLowerCase() === 'kg') weight /= KG_PER_LB;
  const sides = [l, w, h].sort((a, b) => b - a);
  if (sides.some(s => !(s > 0)) || !(weight > 0)) return null;
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
export function upsGroundEstimate(dims: PackageDims, multiplier = 1): ShippingEstimate {
  const lengthGirth = dims.length + 2 * (dims.width + dims.height);
  const dimWeight = (dims.length * dims.width * dims.height) / DIM_DIVISOR;
  const billable = Math.ceil(Math.max(dims.weight, dimWeight));
  if (billable > MAX_GROUND_LBS || lengthGirth > MAX_GROUND_LG) {
    return {
      cost: null,
      billable_lbs: billable,
      note: `too big for UPS Ground (${Math.round(lengthGirth)} in length+girth, ${billable} lb): freight`,
    };
  }
  let cost = rateFor(billable);
  const notes = [`${billable} lb billable` + (dimWeight > dims.weight ? ' (dimensional)' : '')];
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
  if (!dims) return { cost: null, billable_lbs: null, note: 'no dimensions on the lot' };
  return upsGroundEstimate(dims, multiplier);
}
