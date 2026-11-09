/**
 * Sale price for resale items (BuyWander lots sold on eBay, Facebook
 * Marketplace and KSL). Browser-safe: no node imports.
 *
 * There is exactly one price, and it is the value the nightly BuyWander scan
 * already recommended on: the eBay sold median for the product. The scan's
 * max bid is derived from that median with the bid rule (eBay fee, target
 * margin, buyer cost), so listing at the median is what makes the bid
 * recommendation and the ad agree. The same price goes on every platform.
 *
 * This module only rounds that value to a shelf price and reports what it
 * means against the price actually paid, using the same bid rule constants:
 * expected net after eBay fees, profit, margin, and a warning when the margin
 * falls under the target the scan assumed.
 */
import { DEFAULT_BID_RULE } from './buywander-types';

export interface PricingInput {
  /** eBay sold median from the nightly scan; null when no comps were found. */
  median: number | null | undefined;
  compCount?: number | null;
  /** "exact" or "loose" (the scan's second, broader search). */
  match?: string | null;
  /** Settled amount paid for the lot, including buyer-side charges. */
  paidUsd: number | null | undefined;
}

export interface PricingOptions {
  ebayFeeRate: number;
  ebayPerOrderFee: number;
  /** Margin the nightly bid rule targeted; below it the panel warns. */
  targetMargin: number;
}

export const DEFAULT_PRICING_OPTIONS: PricingOptions = {
  ebayFeeRate: DEFAULT_BID_RULE.ebay_fee_rate,
  ebayPerOrderFee: 0.4,
  targetMargin: DEFAULT_BID_RULE.target_margin,
};

export interface PricingSuggestion {
  /** The one asking price for every platform, or null without comps. */
  listPrice: number | null;
  expectedEbayNet: number | null;
  expectedEbayProfit: number | null;
  expectedEbayMargin: number | null;
  /** Profit on a local cash sale at the same price (no fees). */
  expectedLocalProfit: number | null;
  confidence: 'high' | 'medium' | 'low' | 'none';
  /** One line per step, for the UI panel. */
  basis: string[];
  warnings: string[];
}

function isMoney(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

/** Down to a multiple of 5, then off a round ten (430 -> 429, 385 stays). */
export function shelfPrice(n: number): number {
  if (!isMoney(n)) return 0;
  if (n < 20) return Math.max(1, Math.floor(n));
  let p = Math.floor(n / 5) * 5;
  if (p % 10 === 0) p -= 1;
  return p;
}

export function suggestItemPrice(
  input: PricingInput,
  opts: Partial<PricingOptions> = {},
): PricingSuggestion {
  const o = { ...DEFAULT_PRICING_OPTIONS, ...opts };
  const basis: string[] = [];
  const warnings: string[] = [];
  const paid = isMoney(input.paidUsd) ? input.paidUsd : null;
  const loose = (input.match ?? '').toLowerCase() === 'loose';

  if (!isMoney(input.median)) {
    warnings.push('The nightly scan found no eBay sold comps for this lot, so there is no price to carry over. Enter one by hand.');
    return {
      listPrice: null,
      expectedEbayNet: null,
      expectedEbayProfit: null,
      expectedEbayMargin: null,
      expectedLocalProfit: null,
      confidence: 'none',
      basis,
      warnings,
    };
  }

  const median = input.median;
  const listPrice = shelfPrice(median);
  basis.push(
    `Sale price $${listPrice}: the eBay sold median $${median.toFixed(2)}${input.compCount ? ` from ${input.compCount} comps` : ''}${loose ? ' (loose match)' : ''} that the nightly scan recommended on, rounded to a shelf price. Same price on every platform.`,
  );

  const expectedEbayNet = listPrice * (1 - o.ebayFeeRate) - o.ebayPerOrderFee;
  const expectedEbayProfit = paid === null ? null : expectedEbayNet - paid;
  const expectedEbayMargin = expectedEbayProfit === null ? null : expectedEbayProfit / listPrice;
  const expectedLocalProfit = paid === null ? null : listPrice - paid;

  if (paid !== null && expectedEbayProfit !== null && expectedEbayMargin !== null) {
    basis.push(
      `On eBay: net about $${expectedEbayNet.toFixed(2)} after the ${(o.ebayFeeRate * 100).toFixed(1)}% fee and $${o.ebayPerOrderFee.toFixed(2)} order fee, so $${expectedEbayProfit.toFixed(2)} profit on $${paid.toFixed(2)} paid (${Math.round(expectedEbayMargin * 100)}% margin). Local cash sale: $${expectedLocalProfit!.toFixed(2)} profit.`,
    );
    if (expectedEbayProfit <= 0) {
      warnings.push('This price does not cover what you paid after eBay fees. Sell locally or accept a loss.');
    } else if (expectedEbayMargin < o.targetMargin) {
      warnings.push(
        `Margin ${Math.round(expectedEbayMargin * 100)}% is under the ${Math.round(o.targetMargin * 100)}% the nightly bid rule targeted; you paid more than its max bid, or the comps moved.`,
      );
    }
  } else {
    basis.push('Enter the price paid to see the expected profit at this price.');
  }

  const count = input.compCount ?? 0;
  const confidence: PricingSuggestion['confidence'] =
    !loose && count >= 5 ? 'high' : !loose && count >= 3 ? 'medium' : 'low';

  return {
    listPrice,
    expectedEbayNet,
    expectedEbayProfit,
    expectedEbayMargin,
    expectedLocalProfit,
    confidence,
    basis,
    warnings,
  };
}
