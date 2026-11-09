/**
 * One BuyWander lot read from the public by-auction endpoint, plus the pure
 * helpers behind /api/buywander/lot/[auctionId] and
 * /api/tasks/[id]/photos/import. Browser-safe (no node imports) so the
 * item-ad-builder page can import the type.
 *
 * Endpoint (verified anonymous 2026-11-09):
 *   GET https://bwapi.buywander.com/api/site/v1/Auctions/by-auction/<id>
 *   with Origin: https://buywander.com. 200 for live and ended lots, 404
 *   problem+json for an unknown id.
 */

export interface BuywanderLot {
  auction_id: string;
  title: string;
  /** Retailer copy with HTML stripped, whitespace collapsed, capped at 4000 chars. */
  description: string | null;
  bwsku: string | null;
  condition: string | null;
  category: string | null;
  size_description: string | null;
  /** Retail price (item.price). */
  retail_value: number | null;
  /**
   * What the winner paid: finalAmount (hammer plus buyer-side charges),
   * else the winning bid amount, else the last computed bid. Null while
   * nobody has bid or the lot is still live with no final figure.
   */
  final_amount: number | null;
  end_date: string | null;
  ended: boolean;
  /** https URLs only, de-duplicated, upstream order kept. */
  images: string[];
}

export const BUYWANDER_API_BASE = 'https://bwapi.buywander.com/api/site/v1';
export const BUYWANDER_ORIGIN = 'https://buywander.com';
export const LOT_DESCRIPTION_CAP = 4000;

/** BuyWander ids are .NET sequential GUIDs: 8-4-4-4-12 hex. */
const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isAuctionId(value: unknown): value is string {
  return typeof value === 'string' && GUID_PATTERN.test(value);
}

export function lotUrl(auctionId: string): string {
  return `${BUYWANDER_API_BASE}/Auctions/by-auction/${encodeURIComponent(auctionId)}`;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', hellip: '...',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/**
 * Plain text from retailer copy that may be HTML or plain. Block-level
 * closers and <br> become newlines, tags are dropped, entities decoded,
 * runs of spaces collapsed and blank lines reduced to one. Returns null
 * for empty input.
 */
export function stripHtml(input: unknown, cap: number = LOT_DESCRIPTION_CAP): string | null {
  if (typeof input !== 'string') return null;
  let text = input
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|li|ul|ol|h[1-6]|tr|table|blockquote|section)\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, ' ');
  text = decodeEntities(text)
    .replace(/ /g, ' ')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
  if (text === '') return null;
  return text.length > cap ? text.slice(0, cap).trimEnd() : text;
}

/** Keeps https URLs only, drops duplicates, preserves first-seen order. */
export function cleanImageUrls(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const url = raw.trim();
    if (!/^https:\/\/[^\s"'<>]+$/i.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function str(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t === '' ? null : t;
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {});

/**
 * finalAmount when BuyWander has settled the lot, else the winning bid's
 * amount, else the last bid in computedBidHistory. Null when none apply.
 */
export function extractFinalAmount(raw: unknown): number | null {
  const r = rec(raw);
  const settled = num(r.finalAmount);
  if (settled !== null && settled > 0) return settled;
  const winning = num(rec(r.winningBid).amount);
  if (winning !== null && winning > 0) return winning;
  const history = Array.isArray(r.computedBidHistory) ? r.computedBidHistory : [];
  for (let i = history.length - 1; i >= 0; i--) {
    const amount = num(rec(history[i]).amount);
    if (amount !== null && amount > 0) return amount;
  }
  return null;
}

/** Shapes a by-auction response into the dashboard's BuywanderLot. */
export function normalizeLot(raw: unknown, now: Date = new Date()): BuywanderLot {
  const r = rec(raw);
  const item = rec(r.item);
  const endDate = str(r.endDate);
  const endMs = endDate ? Date.parse(endDate) : NaN;
  const ended = Number.isFinite(endMs) ? endMs <= now.getTime() : r.isProcessed === true;
  return {
    auction_id: str(r.id) ?? '',
    title: str(item.title) ?? '',
    description: stripHtml(item.description),
    bwsku: str(item.bwsku),
    condition: str(item.condition),
    category: str(item.categoryName),
    size_description: str(item.sizeDescription),
    retail_value: num(item.price),
    final_amount: extractFinalAmount(r),
    end_date: endDate,
    ended,
    images: cleanImageUrls(item.images),
  };
}

/* ---------- photo import naming (shared with the import route's tests) ---------- */

export interface ImportPlanEntry {
  url: string;
  /** 1-based position in the submitted list. */
  k: number;
  /** Two-digit order prefix. */
  index: number;
  filename: string;
}

export const IMPORT_MAX_URLS = 30;

/**
 * Assigns NN_bw-<k>.jpg names: the url at primaryIndex takes startIndex,
 * the rest follow in submitted order. k is the 1-based input position so
 * a filename always says which upstream image it came from.
 */
export function planImportFilenames(urls: string[], primaryIndex = 0, startIndex = 0): ImportPlanEntry[] {
  const order = urls.map((_, i) => i);
  if (primaryIndex > 0 && primaryIndex < urls.length) {
    order.splice(primaryIndex, 1);
    order.unshift(primaryIndex);
  }
  return order.map((i, pos) => {
    const index = startIndex + pos;
    return { url: urls[i], k: i + 1, index, filename: `${String(index).padStart(2, '0')}_bw-${i + 1}.jpg` };
  });
}
