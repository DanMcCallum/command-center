# PRD: eBay listing HTML (photos in the description, copy-paste from the dashboard)

**Status:** Implemented (2026-09-07), image host live at `img.ownaloha.land` the same day. Durable facts summarized in [specs.md](specs.md); read this file when changing the HTML layout, the photo placement, or the image host.

## Introduction

[ebay-long-form.md](ebay-long-form.md) shipped `ebay.md` as plain text with caps headers. The coach's reference listing (eBay item 206391295800, 1.5 acres near Lovelock NV, sold 2026-08-02) is not plain text: its body was captured live this time (the description frame at `https://itm.ebaydesc.com/itmdesc/206391295800` still serves it, 776 KB) and it is an HTML page on a pale green panel, centered serif ALL-CAPS headers in green, navy and red, bold body copy, and a full-width photo between almost every block. It carries 107 unique images: the lot, the area, maps, drive-time screenshots, and seller badges, all hosted off-eBay on Photobucket and a Wix site.

Two facts drive the design:

- eBay does not host description images. The listing gallery (up to 24 photos) lives on eBay Picture Service, but every `<img>` in the description must be an `https` URL on a host the seller controls. eBay strips active content (scripts, iframes, forms) and keeps inline styles.
- eBay's description editor has an HTML view (the `</>` toggle). Paste the HTML source there, switch back to Standard, and the listing renders. Nothing else is needed on the eBay side.

So the dashboard renders `ebay.md` into that HTML with the task's photos already placed, and the operator copies it from a modal. The copy itself stays in `ebay.md`, which remains the single editable source: edit the markdown, reopen the modal, copy again.

## Goals

- One click from the task card produces the pasteable HTML for the description, with the title and item specifics next to it
- The layout matches the reference's shape (panel, header hierarchy, photo cadence) without copying its wording, badges, or reputation claims
- Photos come from the task's `photos/` folder in gallery order and from an optional per-area photo folder in the knowledge base; the renderer never invents an image
- Images are served from a host we control over `https`, resized once to web size so a 39 MB photo folder becomes about 3 MB of derivatives
- Nothing downstream changes: `ebay.md` keeps its sections, the parser, DREAMS audit, nickname tag, and manual-post status all stay as they are

## User Stories

### US-001: Renderer
- [x] `dashboard/lib/ebay-html.ts` (pure, no I/O): `parseEbayMarkdown` extracts `## HEADLINE`, `## DESCRIPTION`, and `## ITEM SPECIFICS`; `renderEbayListing` turns the description into inline-styled HTML
- [x] Line rules: the opening all-caps block is the BANNER (navy, 34 px, underlined); a block whose first line is caps is a section header (green, 27 px, underlined) and a photo slot; a block of two or more caps lines is an emphasis stack (red, 22 px, no slot); a caps line ending in `:` is a sub-label; `N. LABEL:` lines are sub-labels; `- ` lines become a list; `Question:` / `Answer:` pairs are styled; `STEP ONE.` leads are colored; the trailing `(Property: Nickname)` tag renders small and muted
- [x] Photo placement: photo 1 under the banner, the rest spread evenly across section headers, never after the closing block; area photos under `LOCATED IN`
- [x] Every line of the description appears in the output in order, HTML-escaped; no `<script>`, `<style>`, or external CSS
- [x] `dashboard/lib/ebay-html.test.ts` covers the real sample task (`npm test` in `dashboard/`, runs `node --test` through `tsx`)

### US-002: API route
- [x] `GET /api/tasks/<id>/ebay-listing` reads `outputs/<id>/ebay.md`, resizes `photos/*` and the matching area folder into `outputs/<id>/ebay-images/*.jpg` with `sharp` (EXIF rotate, max `image_max_width`, quality 82, skipped when the derivative is newer than its source), and returns JSON: `headline`, `itemSpecifics`, `html` (public image URLs), `previewHtml` (dashboard-local URLs), `images`, `areaImages`, `hosting`
- [x] `hosting` probes the first public image URL (HEAD, 4 s) so the modal can say whether eBay will be able to load the photos
- [x] `?format=html` returns the preview as a page for quick checks
- [x] Area photos: the sheet whose `matches:` list hits `metadata.location` or `must_include` (same rule as generate-ad Step 3L) names a sibling folder `knowledge-base/ebay/areas/<slug>/`; images in it are inserted in filename order. No folder means no area photos, silently
- [x] `sharp` is declared in `dashboard/package.json` (it was already present as a Next.js dependency)

### US-003: Dashboard
- [x] `TaskCard` shows a **Listing HTML** button beside `ebay.md` in the Outputs list
- [x] `EbayListingModal`: left column with the four steps in eBay's form order (title with character count and Copy; item specifics and Copy; description with **Copy description HTML**; photos note with the hosting status), right side a sandboxed iframe preview
- [x] Copy writes both `text/plain` and `text/html` clipboard flavors when the browser allows, so the paste works in eBay's HTML view (plain source) and in rich editors
- [x] Typecheck passes

### US-004: Config and image host
- [x] `config/ad-platforms.json` `ebay` gains `image_base_url`, `image_max_width` (1000), `image_render_width` (800) and a `_html_doc` line
- [x] `img.ownaloha.land` exposed through the existing tunnel (applied 2026-09-07 with operator approval, see below). The modal's hosting probe reports the host reachable

## Image host: tunnel setup (applied 2026-09-07)

`dashboard.ownaloha.land` sits behind Cloudflare Access, so eBay cannot fetch from it. A second hostname on the same `cloudflared` tunnel reaches only the `ebay-images/` derivatives; every other path on that hostname is a 404 at the tunnel edge, so nothing else on the dashboard became public. Verified from outside after the restart: a derivative URL returns `200 image/jpeg`; `ebay.md`, the original `photos/*.png`, `/api/tasks`, and `/` on that host return 404; a `PUT` to a derivative returns 415 (the files route refuses to write image types); `dashboard.ownaloha.land` still 302s anonymous requests to Access. The previous config is at `~/.cloudflared/config.yml.bak-2026-09-07`.

`~/.cloudflared/config.yml`:

```yaml
tunnel: d7d07571-a85c-435a-8899-85afec196ec9
credentials-file: /home/mazer/.cloudflared/d7d07571-a85c-435a-8899-85afec196ec9.json

ingress:
  - hostname: dashboard.ownaloha.land
    service: http://localhost:3000
  - hostname: img.ownaloha.land
    path: ^/api/files/workspace/outputs/task-[A-Za-z0-9-]+/ebay-images/[A-Za-z0-9_.-]+\.jpg$
    service: http://localhost:3000
  - hostname: img.ownaloha.land
    service: http_status:404
  - service: http_status:404
```

Commands that were run (repeat them on a new box, or to re-verify):

```bash
cp ~/.cloudflared/config.yml ~/.cloudflared/config.yml.bak-$(date +%F)
# edit config.yml as above
cloudflared tunnel --config ~/.cloudflared/config.yml ingress validate
cloudflared tunnel route dns d7d07571-a85c-435a-8899-85afec196ec9 img.ownaloha.land   # one-time CNAME
systemctl --user restart cloudflared
curl -sI https://img.ownaloha.land/api/files/workspace/outputs/task-1783741999340-sfsooi/ebay-images/photo-00.jpg | head -3   # expect 200 image/jpeg
curl -sI https://img.ownaloha.land/api/tasks | head -1   # expect 404
```

No Cloudflare Access application matched `img.ownaloha.land` (the images returned 200, not a 302 to a login page). If Access is ever widened to a wildcard, add a Bypass policy for this hostname.

Note the crontab's redundant `@reboot cloudflared tunnel run` line (see memory note on the tunnel): it reads the same config file, so it picks up the new ingress too.

**Trade-off:** listing photos now depend on the worker box and its tunnel staying up for as long as a listing is live, and on the task's `ebay-images/` folder never being deleted. The reference seller's Photobucket setup has the same dependency on a third party. A Cloudflare R2 public bucket on `img.ownaloha.land` would remove the box from the path; switching later is a change to `image_base_url` plus an upload step, because the renderer only concatenates base URL, task id, and file name.

## Posting checklist (eBay side)

1. Sell > Create listing > Real Estate > Land. Title: paste from the modal (80 max).
2. Item specifics: acreage, state, city, ZIP, zoning, type, APN from the modal's list.
3. Photos: upload the originals from `photos/` to the gallery (eBay hosts these; up to 24).
4. Description: click the `</>` HTML toggle, paste **Copy description HTML**, switch back to Standard, scroll through once. Photos should show; if they are broken, the image host is not reachable yet.
5. Format: no-reserve auction per `seller-terms.md`; check the current Real Estate insertion fee before listing.

## Non-Goals

- No automated posting. eBay stays `enabled: false` in `config/posting-platforms.json`.
- No seller badges, feedback screenshots, or "years on eBay" graphics. The reference uses them; our template earns trust in the WHO YOU ARE BUYING FROM block with facts from `seller-terms.md`.
- No maps or drive-time screenshots generated by the system. If the operator wants them, they go in `photos/` (lot-specific) or `knowledge-base/ebay/areas/<slug>/` (area-wide) as image files and the renderer places them.
- No `<style>` block or external CSS. Everything is inline so eBay's editor cannot strip it.

## Technical Considerations

- **Turbopack boundary (AGENTS.md):** the renderer lives in `dashboard/lib/` and re-implements the small section extractor from `workers/posting/parse-ad-output.ts` rather than importing it.
- **Derivative naming:** `photo-NN.jpg` keeps the operator's `NN_` gallery prefix, `area-NN.jpg` follows folder order. Derivatives are regenerated only when the source is newer, so re-uploading a photo refreshes it on the next modal open.
- **`listPhotos()` in `workers/posting` is unaffected:** it reads `photos/` only; `ebay-images/` is a sibling folder.
- **eBay guidance says fixed-width objects should stay under about 700 px;** the reference uses 960 and eBay's frame is responsive, so images carry `width="800"` plus `max-width:100%`.
- **Alt text** is `<headline> - photo N`; the sample photos' filenames carry no useful caption.
- **Dashboard deploy gotcha:** port 3000 serves the last `next build`; after merging, rebuild and relaunch `start.sh` or the Listing HTML button will not appear. Verified on a throwaway `next dev -p 3001`.
