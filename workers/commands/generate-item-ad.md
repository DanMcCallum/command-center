---
description: Generate a consumer-goods ad (per-platform title + description) for one BuyWander lot
disable-model-invocation: true
---

You are generating a resale ad for the item described in the task metadata. The item was bought in a liquidation lot at BuyWander (Salt Lake City) and is being sold on eBay, Facebook Marketplace and KSL Classifieds. There is no DREAMS gate, no nickname and no sold-ad corpus for items; this command is shorter than the land one on purpose.

The project root is `/home/mazer/claude/command-center`. All paths below are relative to it unless absolute. `OUTPUT_DIR` and the notes file path are given in the task prompt's Output section.

## Inputs (read these FIRST, in this order)

1. **Item facts**: the `metadata` field of the task JSON (`kind: item-ad-builder`). The task description also carries a rendered summary, but the JSON metadata is authoritative. Fields: `auction_id`, `bwsku`, `source_url`, `item_title`, `brand`, `model`, `category`, `condition` (one of: New; Appears new / open box; Used, good; Used, fair; For parts), `condition_notes`, `included`, `defects`, `dimensions`, `retail_value`, `paid_usd`, `price_usd` (the asking price, the same on every platform), `pricing` (how it was derived from the nightly scan; context only, never printed), `accept_offers`, `local_pickup`, `pickup_area`, `shipping` (one of: Buyer pays calculated shipping; Free shipping; Local pickup only), `ebay_median_sold`, `ebay_search_url`, `ebay_comp_note`, `must_include`, `platforms` (subset of `ebay_item`, `fb_item`, `ksl`), `source_description`, `source_images`, `photoCount`, `primaryPhoto`. `paid_usd` and the eBay comp fields are for your angle reasoning only and never appear in the copy.
   - `source_description` (string or null) is the retailer's product copy, fetched from the BuyWander lot page. Use it as a fact source for specs, materials, dimensions, included parts and model numbers, and tag every fact taken from it `[retailer]` in the Facts list and in the README's Facts used. Never copy its marketing sentences or its adjectives; never let it override the operator's `condition`, `condition_notes` or `defects` (the retailer describes a new product, the operator describes this one). A retailer claim you cannot check against the photos (wattage, capacity, compatibility, "tested") goes in as the retailer's claim ("the maker lists 20V", "the product page says it includes two batteries"), never as a flat statement, and still counts as a fact to list; if `included` or a photo contradicts it, the operator and the photos win and the disagreement goes under open questions.
   - `source_images` is the list of lot image urls the operator kept; it is for the record only, read the files in `OUTPUT_DIR/photos/` instead.
2. **Photos**: every file in `OUTPUT_DIR/photos/` (`NN_name.ext`, `00_` is the primary). Files named `NN_bw-<k>.jpg` came from the BuyWander lot page: some are BuyWander's own photos of the actual item, others are the retailer's stock shots of a new unit, and the filename does not say which. Read each one with the Read tool and write down, in the notes file, what is visible: colour, finish, visible wear, what accessories are in frame, whether the box is present, any label or model sticker you can read, and whether the shot looks like a studio stock image (white background, rendered lighting, no wear) or a warehouse photo of this unit. Describe only what the photos show. When judging wear, missing parts or box condition, prefer the warehouse photos over the stock shots and never let a stock shot of a complete kit stand in for what is actually in the lot. The photos are a fact source equal to the metadata. If the folder is missing or empty, note it and work from metadata alone.
3. **Knowledge base**: `knowledge-base/items/README.md`, then `knowledge-base/items/seller-terms.md` (terms, shipping, returns, contact lines; only filled-in lines, any `TODO` line is skipped and listed in the notes file under "Seller terms still TODO"), then `knowledge-base/items/listing-template.md` (block structure, title formula, short-form patterns, two worked examples), then `knowledge-base/items/platforms.md` (posting notes).
4. **Platform constraints**: `config/item-ad-platforms.json`. For each key in the task's `platforms` array use its `display_name`, `headline_max`, `description_max`, `buyer_profile`, `rules`, `condition_values` and, where the platform has one, `categories`. Caps are hard limits. If a requested key is not in the file, write no file for it and report it in the notes and in `claudeNotes`.
5. **Voice samples**: every file in `voice/clean/`. These are the operator's phone calls about land; borrow the cadence (plain, short sentences, direct answers, numbers stated flat) and nothing about land. Never quote a sample.
6. **Anti-slop rules**: `skills/anti-slop.md`. Apply during self-critique (step 4).

## Method

### Step 1: Build the fact sheet

Write a `## Facts` section in the notes file with one line per fact, each tagged with its source: `[meta]` for metadata, `[photo NN]` for something seen in a photo, `[retailer]` for a spec taken from `source_description`, `[terms]` for a seller-terms line. This is the closed set of facts the copy may use. Anything not on this list does not go in the ad. Specifically:
- Brand, model, type, colour, material, dimensions, what is included, every defect, the condition word, condition notes.
- Price facts: asking price (`price_usd`, the same on every platform), retail value (`retail_value`, if present), `accept_offers`.
- Logistics: `shipping` value, `local_pickup`, `pickup_area`.
- `must_include` text, verbatim.

Also write a `## Not known` list: facts a buyer would ask for that you do not have (UPC, weight, year, whether it was tested, missing accessories). These become the README's open questions.

### Step 2: Pick the selling angle

One or two sentences in the notes file. The angles available for liquidation goods are few and concrete; pick the one the facts support best and name the buyer it is for:
- **Retail gap**: `retail_value` versus `price_usd` when the gap is large and the condition is New or Appears new / open box. State both numbers.
- **Honest condition**: for Used or For parts items, the angle is the full disclosure itself plus what still works (`condition_notes`). Buyers of liquidation goods have been burned; a flat list of flaws earns the sale.
- **Local pickup convenience**: for bulky or heavy items (furniture, mattresses, appliances) on Facebook and KSL, the angle is "no shipping, come see it in <pickup_area>, pay when you have looked at it".
- **Complete kit**: when `included` lists everything a buyer needs (box, cords, accessories) and the photos confirm it.

The angle changes emphasis and the first line of each variant; it never adds a fact. Vary across platforms only where the buyer profile asks for it (eBay leads with searchable specs, Facebook and KSL lead with what it is and the price).

### Step 3: Draft one variant per requested platform

For each platform in `metadata.platforms`, write the title first, then the description, following `listing-template.md`:

**Title.** `Brand + Model + key spec(s) + condition word`, within `headline_max`. eBay puts searchable keywords first; Facebook and KSL put plain words for what the object is first. No filler words, no ALL CAPS beyond brand names and model codes, no punctuation runs, no em dashes. The condition word must match the mapped value for `metadata.condition`: New only when the field is New; Open Box for Appears new / open box; Used for the two Used values; For Parts for For parts. Aim for 70 to 100 percent of the cap when the facts fill it; never pad to reach it, never exceed it.

**Description, `ebay_item`.** Build the blocks from the template in order: WHAT IT IS, CONDITION, WHAT IS INCLUDED, SPECS, SHIPPING AND PICKUP, OUR TERMS. ALL-CAPS header lines, `- ` bullets, no markdown `#`, no HTML, no phone number, email, link or payment method name anywhere. The SHIPPING AND PICKUP block uses the seller-terms line that matches `metadata.shipping`. OUR TERMS uses the eBay section of seller-terms (returns, Best Offer line only when `accept_offers` is true, disclaimer, "message us through eBay"). Stay under `description_max`.

**Description, `fb_item` and `ksl`.** Follow the short-form pattern in the template: line 1 says what it is, brand and the price; line 2 the condition in plain words and the retail comparison when present; line 3 pickup (and shipping only when `shipping` allows it); then `Condition:`, `Included:`, `Specs:` lists with one fact per line; `must_include` verbatim; the payment line from seller-terms (cash, Venmo or Zelle at pickup, no holds without payment); the close with "message me" and the phone number from seller-terms. On KSL "Reasonable offers considered" appears only when `accept_offers` is true; on Facebook "Open to offers" likewise. No financing words anywhere. Stay under `description_max`.

**Every variant** states the asking price (`price_usd`) in the description, states the condition word honestly, and carries every defect and every line of `condition_notes`. `must_include` appears verbatim in every variant where the platform's rules allow it (if it holds a phone number or link it is dropped from `ebay_item` and the drop is logged).

**Form fields (category and condition).** These are dropdowns on the posting form, not copy, and the operator sets them by hand from the dashboard card.
- Condition, every platform: look up `metadata.condition` in the platform's `condition_values` and take the option name only, dropping any bracketed guidance (`Used - Like New`, not the note after it). This is a lookup, never a judgement from the photos.
- Category, only for a platform whose config has a `categories` list (today `fb_item`): pick exactly one entry from that list, copied character for character, using `metadata.category`, the item type and the config's `_categories_note`. Never invent a category that is not on the list; when nothing fits, use the Miscellaneous entry and say so in the notes file.

**eBay item specifics.** Build the `## ITEM SPECIFICS` section for `ebay_item.md` from the template's list: Category (best guess from `metadata.category`, marked "operator to confirm"), Listing format, Condition (mapped), Condition description (one line), Brand, Model, Type, Color, Material, Dimensions, MPN and UPC ("Does not apply" unless metadata names one), Shipping, Returns. Never guess a UPC, MPN, weight or year.

### Step 4: Self-critique (exactly one pass)

Read `skills/anti-slop.md`. For each variant (title and description), list in the notes file every violation with the offending phrase and the rule, then rewrite. Also check, and log the result of each:
1. Every sentence traces to a line in the `## Facts` list. Strike anything that does not.
2. The condition word is right for `metadata.condition` on every platform, and the word "new" appears only when the field is New (the phrase "appears new" is allowed for the open-box value because that is the field's own wording).
3. Asking price present in every description. Retail value, when used, is labelled as retail.
4. `ebay_item` contains no phone number, email address, URL, or the words Venmo, Zelle, cash, PayPal.
5. Facebook and KSL contain no financing words (down payment, monthly, payments, no credit check, financing).
6. Character counts: compute `len()` of each title and description and compare with the caps. Over the cap is a failure; cut facts of least value to the buyer, never the condition notes or the price.
7. No em dashes in any file, including the notes.
8. At most one exclamation mark per variant.
9. Each file's `## CONDITION` line is the `condition_values` option for `metadata.condition`, and each `## CATEGORY` line appears verbatim in that platform's `categories` list.

Then one voice pass: read each variant against the cadence of `voice/clean/`. Rewrite any sentence that sounds like marketing copy rather than the operator explaining the item to a buyer on the phone. No quoting of samples.

### Step 5: Write the output files

Write to `OUTPUT_DIR`:

- **`README.md`**:
  ```markdown
  # Item ad for <brand> <model> (<bwsku>)

  ## Item
  <one paragraph: what it is, condition word, asking price, retail value if present, pickup/shipping, BuyWander auction id and source_url>

  ## Facts used
  - <fact> [meta|photo NN|retailer|terms]
  ...

  ## Selling angle
  <one or two sentences from step 2>

  ## Variants
  | Platform | Headline chars | Description chars |
  |---|---|---|
  | ebay_item | 74/80 | 1850/5000 |
  | fb_item | 71/99 | 980/2000 |
  | ksl | 70/95 | 940/2000 |

  ## Open questions for the operator
  - <each item from the Not known list, and each seller-terms line marked "(operator to confirm)" that this ad relied on>
  ```

- **One file per platform**, named `<platform_key>.md` (`ebay_item.md`, `fb_item.md`, `ksl.md`), in exactly this shape:
  ```markdown
  # <Display name from config>

  ## HEADLINE (X/Y chars)
  <the title>

  ## DESCRIPTION (X/Y chars)
  <the description, plain text, no # headings inside>

  ## CATEGORY
  <one entry from the platform's categories list, e.g. Home & Garden > Furniture>

  ## CONDITION
  <the mapped option name from condition_values, e.g. Used - Like New>

  ## Why this angle
  <one sentence>
  ```
  `## CONDITION` goes in every platform file. `## CATEGORY` goes only in files for platforms whose config has a `categories` list (`fb_item.md`); leave the section out of the others. Each is a single line with nothing after it. `ebay_item.md` adds `## ITEM SPECIFICS` (the list from step 3) after `## Why this angle`. X is the exact character count, Y the cap from the config. Nothing else goes in these files; the dashboard parses the sections by these headers.

- **Notes file** (path from the task prompt): the `## Facts` and `## Not known` lists, the photo observations, the step-2 angle, the step-4 violations log with before and after text, "Seller terms still TODO" and any dropped `must_include` text with the reason.

### Step 6: Update the task

Use the exact curl command from the task prompt's Output section. Set `status` to `needs_review` (never `completed`; the operator decides that), `completionFile` to `workers/workspace/outputs/<task id>/README.md`, and `claudeNotes` to a short summary the operator can act on: the item and price, which platform files were written with their character counts, the selling angle, the category and condition set for each form, and the open questions (condition word used, any assumed seller terms, any dropped `must_include`). If a platform could not be written, say which and why. If the API call fails, record the full response in the notes file and try once more; if it still fails, leave the notes for manual reconciliation.

## Hard constraints

- Never invent item facts. Every sentence traces to the task metadata, a photo in `OUTPUT_DIR/photos/`, a spec in `metadata.source_description` (tagged `[retailer]`, phrased as the maker's claim when the photos cannot confirm it), or a filled-in seller-terms line. No guessed UPC, MPN, weight, year, wattage, capacity or compatibility. If a fact would help and is missing, write the variant without it and list it under open questions.
- The retailer copy never sets the condition. Condition, wear, defects and what is included come from the operator's fields and the photos; `source_description` may only add specs.
- Never write "new" unless `metadata.condition` is New. Open-box items are "open box" or "appears new, open box". Used items say used. Parts items say for parts or not working.
- No em dashes anywhere, including the notes and the README.
- No phone number, email address, URL or payment method name in anything headed for eBay (`ebay_item.md`). The phone number from seller-terms is allowed on `fb_item` and `ksl`.
- Caps from `config/item-ad-platforms.json` are hard limits; the `(X/Y chars)` headers carry real counts.
- The asking price (`price_usd`) appears in every variant's description. Never print `paid_usd`, the margin or anything from `pricing`.
- `must_include` appears verbatim in every variant where the platform rules allow it; any drop is logged.
- No financing or payment-plan language on any platform. Cash, Venmo or Zelle at pickup for the local platforms; eBay checkout for eBay.
- Apply every rule in `skills/anti-slop.md`. Never quote a voice sample.
- Do not run `workers/dreams-gate.sh`, do not touch `knowledge-base/property-nicknames.md`, and do not read the land corpus (`knowledge-base/ads/`, `headlines/`, `ebay/`); none of it applies to items.
