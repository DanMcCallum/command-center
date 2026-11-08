/**
 * BuyWander scan types and display formatting. Browser-safe: no node imports,
 * so client components (app/deals) can use it. Storage and email live in
 * ./buywander.ts, which re-exports everything here.
 */

export interface BuywanderEbayComps {
  /** Median sold price of the matching comps, null when none matched. */
  median_sold: number | null;
  comp_count: number;
  /**
   * exact: same model. loose: same brand and product type after a second,
   * broader search (model, size, colour dropped). none: nothing matched.
   * Absent on runs before 2026-11-08 evening.
   */
  match?: 'exact' | 'loose' | 'none';
  /** The eBay sold-items search the agent used (the broader one for loose). */
  search_url: string;
  /** Free text: what matched, why it was skipped, etc. */
  note?: string;
}

/** One lot the agent scored. Written by the agent, enriched by the server. */
export interface BuywanderFind {
  auction_id: string;
  url: string;
  title: string;
  retail_value: number;
  /** Current winning bid in dollars, 0 when there are no bids. */
  current_bid: number;
  ends_at: string;
  condition: string;
  category: string;
  bwsku?: string;
  /** BuyWander's size string, e.g. "L: 95.3 cm x W: 57.9 cm x H: 101.6 cm, Weight: 11.567 kg". */
  size_description?: string | null;
  ebay: BuywanderEbayComps;
  /** eBay median minus current bid; null without comps. Server-computed. */
  spread?: number | null;
  /** spread / median, 0..1; null without comps. Server-computed. */
  margin?: number | null;
  /**
   * Suggested maximum bid: eBay median net of eBay fees, less the target
   * margin, divided by the buyer-side cost rate (tax, premium). Shipping is
   * not subtracted (the lot may sell locally). Null without comps.
   * Server-computed from the run's bid_rule.
   */
  max_bid?: number | null;
  /** Estimated UPS Ground cost to ship it to a buyer; the rule's default when the lot has no dimensions. Server-computed. */
  shipping_est?: number | null;
  /** How shipping_est was reached (billable weight, surcharges, default). */
  shipping_note?: string;
}

/** The inputs behind max_bid, stored on the run so the page can explain it. */
export interface BuywanderBidRule {
  /** eBay final value fee as a fraction of the sale, e.g. 0.136. */
  ebay_fee_rate: number;
  /** Profit kept as a fraction of net resale, e.g. 0.4. */
  target_margin: number;
  /** Added to the hammer price at BuyWander (sales tax, premium), e.g. 0.0725. */
  buyer_cost_rate: number;
  /** Scales the UPS table (1 = table as is); use to tune toward real invoices. */
  shipping_multiplier: number;
  /** Dollars assumed when a lot has no dimensions. */
  default_shipping: number;
}

export const DEFAULT_BID_RULE: BuywanderBidRule = {
  ebay_fee_rate: 0.136,
  target_margin: 0.4,
  buyer_cost_rate: 0.0725,
  shipping_multiplier: 1,
  default_shipping: 20,
};

export interface BuywanderSkipped {
  auction_id: string;
  url: string;
  title: string;
  retail_value: number;
  reason: string;
}

/** The JSON the agent writes; `POST /api/buywander/runs` accepts this. */
export interface BuywanderAgentOutput {
  scanned_at: string;
  location: string;
  /** Every auction id at or above the retail floor the agent saw this run. */
  scanned_ids: string[];
  finds: BuywanderFind[];
  skipped?: BuywanderSkipped[];
  /** Anything the agent wants the operator to know (blocks, errors). */
  notes?: string;
}

export interface BuywanderRun extends BuywanderAgentOutput {
  id: string;
  received_at: string;
  /** How many of scanned_ids were new to this run. */
  new_count: number;
  /** Rule used for max_bid on this run's finds. */
  bid_rule?: BuywanderBidRule;
  /** Result of the ntfy push for this run (nothing is pushed when there are no finds). */
  notify: BuywanderNotify;
  /** Runs stored before the switch from email to ntfy (2026-11-08) carry this instead. */
  email?: { sent: boolean; to: string | null; error: string | null };
}

export interface BuywanderNotify {
  sent: boolean;
  channel: 'ntfy';
  error: string | null;
}

export type BuywanderSeen = Record<string, string>; // auction id -> first seen ISO

// --- Display formatting ------------------------------------------------------

export function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '';
  return `${Math.round(n * 100)}%`;
}

export function fmtEnds(iso: string, timeZone = 'America/Denver'): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleString('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Turns BuyWander's enum-ish condition into words. */
export function fmtCondition(c: string): string {
  return c.replace(/([a-z])([A-Z])/g, '$1 $2');
}
