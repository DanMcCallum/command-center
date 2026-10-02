/**
 * Renders the plain-text eBay description written by generate-ad (Step 3L)
 * into the HTML layout eBay's Real Estate > Land sellers use: a light panel,
 * centered serif ALL-CAPS headers in green / navy / red, bold body copy, and
 * a full-width photo between blocks. The structure mirrors the coach's
 * reference listing (eBay item 206391295800); no wording comes from it.
 *
 * Pure string logic, no I/O, so both the API route and tests can use it.
 * The renderer never invents content: every line of the description is
 * emitted in order, and images are only inserted after headers.
 */

export interface EbayImage {
  /** Public https URL eBay will load. */
  url: string;
  alt: string;
}

export interface EbayItemSpecific {
  key: string;
  value: string;
}

export interface ParsedEbayMarkdown {
  headline: string;
  description: string;
  itemSpecifics: EbayItemSpecific[];
}

export interface RenderOptions {
  headline: string;
  description: string;
  /** Property photos in gallery order; the first goes under the banner. */
  photos: EbayImage[];
  /** Area photos, inserted under the LOCATED IN block. */
  areaPhotos?: EbayImage[];
  /** Rendered pixel width for photos (eBay's frame is ~ 800-960 px wide). */
  imageWidth?: number;
}

// ---------------------------------------------------------------------------
// Markdown extraction (mirrors workers/posting/parse-ad-output.ts, which the
// dashboard cannot import because Turbopack refuses files outside dashboard/)
// ---------------------------------------------------------------------------

function extractSection(markdown: string, name: string): string {
  const lines = markdown.split(/\r?\n/);
  const headingRe = new RegExp(`^##\\s+${name}\\b`, 'i');
  const start = lines.findIndex(l => headingRe.test(l));
  if (start === -1) return '';
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,6}\s/.test(lines[i])) break;
    body.push(lines[i]);
  }
  return body.join('\n').trim();
}

export function parseEbayMarkdown(markdown: string): ParsedEbayMarkdown {
  const headline = extractSection(markdown, 'HEADLINE').split('\n')[0]?.trim() ?? '';
  const description = extractSection(markdown, 'DESCRIPTION');
  const specifics = extractSection(markdown, 'ITEM SPECIFICS');
  const itemSpecifics: EbayItemSpecific[] = [];
  for (const raw of specifics.split('\n')) {
    const m = raw.match(/^-\s+([^:]+):\s*(.*)$/);
    if (m) itemSpecifics.push({ key: m[1].trim(), value: m[2].trim() });
  }
  return { headline, description, itemSpecifics };
}

// ---------------------------------------------------------------------------
// Line classification
// ---------------------------------------------------------------------------

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** ALL-CAPS block header or emphasis line (no lowercase letters, short). */
export function isCapsLine(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 90) return false;
  if (t.startsWith('- ')) return false;
  if (!/[A-Z]/.test(t)) return false;
  if (/[a-z]/.test(t)) return false;
  return true;
}

const NUMBERED_LABEL = /^(\d+)\.\s+([A-Z][A-Z0-9 /&'-]*):\s*$/;
const STEP_LEAD = /^(STEP\s+[A-Z]+\.)\s*(.*)$/;
const NICKNAME_TAG = /\s*\(Property:\s*[^)]+\)\s*$/;

// Palette taken from the category's proven listings: dark green headers,
// navy banner, red emphasis, pale green panel. Every rule is inline because
// eBay's editor keeps inline styles reliably and may drop <style> blocks.
const C = {
  panel: '#E9F5E4',
  green: '#006535',
  navy: '#000258',
  red: '#AD001F',
  body: '#111111',
  muted: '#555555',
};
const SERIF = "Georgia,'Times New Roman',Times,serif";
const SANS = 'Arial,Helvetica,sans-serif';

const banner = (t: string) =>
  `<div style="font-family:${SERIF};font-size:34px;line-height:1.25;font-weight:bold;color:${C.navy};text-decoration:underline;margin:10px 0;">${escapeHtml(t)}</div>`;
const header = (t: string) =>
  `<div style="font-family:${SERIF};font-size:27px;line-height:1.25;font-weight:bold;color:${C.green};text-decoration:underline;margin:34px 0 14px;">${escapeHtml(t)}</div>`;
const emphasis = (t: string) =>
  `<div style="font-family:${SERIF};font-size:22px;line-height:1.3;font-weight:bold;color:${C.red};margin:6px 0;">${escapeHtml(t)}</div>`;
const subHeading = (t: string) =>
  `<div style="font-family:${SANS};font-size:19px;font-weight:bold;color:${C.red};margin:16px 0 4px;">${escapeHtml(t)}</div>`;
const subLabel = (n: string, t: string) =>
  `<div style="font-family:${SANS};font-size:19px;font-weight:bold;color:${C.red};margin:16px 0 4px;">${escapeHtml(n)}. ${escapeHtml(t)}:</div>`;
const para = (inner: string) =>
  `<p style="font-family:${SANS};font-size:17px;line-height:1.55;font-weight:bold;color:${C.body};max-width:820px;margin:8px auto;">${inner}</p>`;
const question = (t: string) =>
  `<div style="font-family:${SANS};font-size:17px;line-height:1.5;font-weight:bold;color:${C.navy};max-width:820px;margin:16px auto 2px;">${escapeHtml(t)}</div>`;
const answer = (t: string) =>
  `<div style="font-family:${SANS};font-size:17px;line-height:1.5;color:${C.body};max-width:820px;margin:0 auto 8px;">${escapeHtml(t)}</div>`;
const bullets = (items: string[]) =>
  `<ul style="font-family:${SANS};font-size:17px;line-height:1.6;font-weight:bold;color:${C.body};display:inline-block;text-align:left;margin:8px auto;padding-left:24px;">${items
    .map(i => `<li style="margin:2px 0;">${escapeHtml(i)}</li>`)
    .join('')}</ul>`;
const tag = (t: string) =>
  `<div style="font-family:${SANS};font-size:12px;color:${C.muted};margin-top:24px;">${escapeHtml(t)}</div>`;

function image(img: EbayImage, width: number): string {
  return `<div style="margin:18px 0;"><img src="${escapeHtml(img.url)}" alt="${escapeHtml(img.alt)}" width="${width}" style="max-width:100%;height:auto;border:0;display:inline-block;"></div>`;
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

interface Block {
  lines: string[];
}

function splitBlocks(description: string): Block[] {
  const blocks: Block[] = [];
  let cur: string[] = [];
  for (const raw of description.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (line.trim() === '') {
      if (cur.length) blocks.push({ lines: cur });
      cur = [];
    } else {
      cur.push(line);
    }
  }
  if (cur.length) blocks.push({ lines: cur });
  return blocks;
}

/**
 * Renders one block. `isBanner` is true for the opening block when every
 * line is caps (the BANNER block of the template).
 */
function renderBlock(block: Block, isBanner: boolean, isLast: boolean): { html: string; header: string | null } {
  const out: string[] = [];
  let headerText: string | null = null;
  let bulletBuf: string[] = [];
  const flushBullets = () => {
    if (bulletBuf.length) out.push(bullets(bulletBuf));
    bulletBuf = [];
  };

  // A block of two or more caps lines (NO RECORDING FEES / NO TRANSFER TAX /
  // NO HIDDEN FEES) is an emphasis stack, not a section header, so it gets
  // the red treatment and no photo slot. A single caps line on its own
  // (QUICK NOTES ABOUT THIS PROPERTY) is a header. A caps line ending in ":"
  // that introduces a list (PROPERTY SPECIFICS:) is a sub-label.
  const capsStack = block.lines.length > 1 && block.lines.every(l => isCapsLine(l));

  block.lines.forEach((line, idx) => {
    const t = line.trim();
    if (t.startsWith('- ')) {
      bulletBuf.push(t.slice(2).trim());
      return;
    }
    flushBullets();

    if (isBanner) {
      out.push(banner(t));
      return;
    }
    const num = t.match(NUMBERED_LABEL);
    if (num) {
      out.push(subLabel(num[1], num[2]));
      return;
    }
    if (isCapsLine(t)) {
      if (idx === 0 && !capsStack && !t.endsWith(':')) {
        headerText = t;
        out.push(header(t));
      } else if (t.endsWith(':')) {
        out.push(subHeading(t));
      } else {
        out.push(emphasis(t));
      }
      return;
    }
    if (/^Question:/i.test(t)) {
      out.push(question(t));
      return;
    }
    if (/^Answer:/i.test(t)) {
      out.push(answer(t));
      return;
    }
    let body = t;
    let trailing = '';
    if (isLast && idx === block.lines.length - 1) {
      const m = body.match(NICKNAME_TAG);
      if (m) {
        trailing = m[0].trim();
        body = body.replace(NICKNAME_TAG, '');
      }
    }
    const step = body.match(STEP_LEAD);
    const inner = step
      ? `<span style="color:${C.green};">${escapeHtml(step[1])}</span> ${escapeHtml(step[2])}`
      : escapeHtml(body);
    out.push(para(inner));
    if (trailing) out.push(tag(trailing));
  });
  flushBullets();
  return { html: out.join('\n'), header: headerText };
}

/**
 * Spreads `count` photos over `slots` header positions so the listing has a
 * photo roughly every N blocks instead of a pile at the top. Returns, per
 * slot index, how many photos to place after it.
 */
export function distribute(count: number, slots: number): number[] {
  const plan = new Array<number>(slots).fill(0);
  if (slots === 0 || count === 0) return plan;
  if (count >= slots) {
    // more photos than slots: fill evenly, remainder to the earliest slots
    const base = Math.floor(count / slots);
    const extra = count % slots;
    for (let i = 0; i < slots; i++) plan[i] = base + (i < extra ? 1 : 0);
    return plan;
  }
  // fewer photos than slots: place at evenly spaced slots
  for (let k = 0; k < count; k++) {
    const idx = Math.floor(((k + 0.5) * slots) / count);
    plan[Math.min(idx, slots - 1)] += 1;
  }
  return plan;
}

export function renderEbayListing(opts: RenderOptions): string {
  const width = opts.imageWidth ?? 800;
  const blocks = splitBlocks(opts.description);
  const photos = [...opts.photos];
  const areaPhotos = opts.areaPhotos ?? [];

  const rendered = blocks.map((b, i) => {
    const isBanner = i === 0 && b.lines.every(l => isCapsLine(l));
    return { ...renderBlock(b, isBanner, i === blocks.length - 1), isBanner };
  });

  // Photo slots: after the banner (hero), then after each block header.
  const hero = photos.length ? photos.shift()! : null;
  const slotIdx = rendered
    .map((r, i) => (r.header !== null ? i : -1))
    .filter(i => i >= 0);
  // Skip the final CLOSE block (DON'T MISS THIS ONE): photos belong above it.
  const usableSlots = slotIdx.length > 1 ? slotIdx.slice(0, -1) : slotIdx;
  const plan = distribute(photos.length, usableSlots.length);
  const afterBlock = new Map<number, EbayImage[]>();
  let p = 0;
  usableSlots.forEach((blockIndex, s) => {
    const n = plan[s];
    if (n > 0) afterBlock.set(blockIndex, photos.slice(p, p + n));
    p += n;
  });

  const areaAnchor = rendered.findIndex(
    r => r.header !== null && /^LOCATED IN\b/.test(r.header),
  );

  const parts: string[] = [];
  parts.push(
    `<div style="background:${C.panel};padding:28px 14px 36px;margin:0 auto;max-width:960px;text-align:center;color:${C.body};">`,
  );
  rendered.forEach((r, i) => {
    parts.push(r.html);
    if (i === 0 && hero) parts.push(image(hero, width));
    if (i === areaAnchor) {
      // area photos sit right under the LOCATED IN header, before the copy
      // continues; render them after the block so the header stays attached.
      for (const a of areaPhotos) parts.push(image(a, width));
    }
    const imgs = afterBlock.get(i);
    if (imgs) for (const img of imgs) parts.push(image(img, width));
  });
  if (areaAnchor === -1) for (const a of areaPhotos) parts.push(image(a, width));
  parts.push('</div>');
  return parts.join('\n');
}
