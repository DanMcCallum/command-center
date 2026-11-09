# Item knowledge base

Reference material for ads that sell consumer goods (BuyWander liquidation lots from Salt Lake City) on eBay, Facebook Marketplace and KSL Classifieds. It is the item-side counterpart of `knowledge-base/ebay/` (land). Nothing in `knowledge-base/ads/`, `headlines/` or `ebay/` applies to items, and nothing here applies to land.

The worker command `workers/commands/generate-item-ad.md` (installed at `~/.claude/commands/generate-item-ad.md`) reads this folder in this order:

1. `seller-terms.md`: pickup area, payment by platform, shipping policy per the task's `shipping` field, returns, contact lines, condition language. Only filled-in lines are used; `TODO` lines are skipped and reported. Lines marked "(operator to confirm)" are assumptions from the 2026-11-09 build and should be confirmed before the first live listing.
2. `listing-template.md`: the eBay block structure (ALL-CAPS headers), the title formula, the short-form patterns for Facebook Marketplace and KSL, and two worked examples built from real BuyWander lots.
3. `platforms.md`: posting notes per platform (caps, categories, Best Offer, KSL flow, fees) from the 2026-11-09 research. Caps themselves live in `config/item-ad-platforms.json`, which is the file the command enforces; this file explains them.

Rules that hold across the folder:

- Facts come from the task metadata and the photos in the task's output dir, never from here. These files carry structure, terms and voice, not product facts. The metadata's `source_description` (the retailer's product copy from the BuyWander lot page) counts as a spec source only, tagged `[retailer]`; it never sets the condition, and photos named `NN_bw-<k>.jpg` came from the lot page and may be stock shots rather than the unit being sold.
- No em dashes anywhere.
- No phone number, email or link in anything headed for eBay. The phone number (385-462-6366) is allowed on Facebook Marketplace and KSL.
- Item ads are not DREAMS-scored. `workers/dreams-gate.sh` keys on `config/ad-platforms.json`, and the item platform keys (`ebay_item`, `fb_item`, `ksl`) must never be added there.

To change a term, edit `seller-terms.md`; the next generation picks it up. To change a cap, edit `config/item-ad-platforms.json` and note the source and date in its `_source` field.
