---
type: listing-template
scope: items (consumer goods)
status: v1, 2026-11-09
---

# Item listing template

The skeleton `generate-item-ad` follows. The command writes the copy; this file carries structure, formulas and two worked examples. Facts in a real ad come only from the task metadata and the photos in the task's output dir.

**Formatting rules shared by every platform**

- No em dashes. Use commas, periods or " - ".
- Block headers (eBay) are one short ALL-CAPS line on their own. Never a markdown `#` heading inside a description: the file renderer stops at the first one.
- Bullets are `- ` lines. One blank line between blocks. No tables, no HTML, no bold or italics (the copy is pasted as plain text).
- Condition words follow the task's `condition` field exactly: New; Appears new / open box; Used, good; Used, fair; For parts. The word "new" appears only when the field is New. Open-box items are "open box" or "appears new, open box", never "new".
- The asking price (`price_usd`) appears in every variant's description. The retail value (`retail_value`) may appear as a comparison when present ("retails for $680"); never as the price.
- `must_include` text appears verbatim wherever it fits the platform's rules (it is dropped only if it would break a rule, for example a phone number on eBay, and that is logged).
- At most one exclamation mark per variant.

## Title formula (all platforms)

`Brand + Model + key spec(s) + condition word`, within the platform cap, no filler words. The spec is what a searcher types: size, capacity, colour, count, compatible device. The condition word is short: New, Open Box, Used, For Parts.

- eBay (80): keywords first because search decides whether the listing is seen. `Marsail 142" U-Shaped Modular Sectional Sofa Corduroy Beige, Open Box`. Brand names and model codes may be capitalised as the maker writes them; nothing else is ALL CAPS.
- Facebook Marketplace (99): plain words first, because the grid shows the first 60 characters and the buyer is scrolling, not searching. `U-Shaped Modular Sectional Sofa, 142", Beige Corduroy (Marsail) - Open Box`.
- KSL (95): same plain-words-first order as Facebook, Utah buyers skim a list. `Modular Sectional Sofa 142" U-Shape, Beige Corduroy, Marsail, Open Box`.

Length: aim for 70 to 100 percent of the cap when there are enough true specs to fill it. Never pad with adjectives (nice, great, rare, look) to reach the cap, and never go over.

## eBay description blocks (`ebay_item`)

Blocks appear in this order. REQUIRED blocks always appear; CONDITIONAL blocks appear when their condition holds. A block that needs a fact we do not have loses the line, not the block, and the gap is logged in the notes file.

### WHAT IT IS (REQUIRED)

Header `WHAT IT IS`. Two to four sentences: the brand and model, what it does or is for, the one or two specs that define it (size, capacity, power), and the colour or finish. Sentence case, operator's voice: plain, direct, no superlatives. If `retail_value` is present, one sentence placing the asking price against it ("Retails for $679.99. Asking $350.").

### CONDITION (REQUIRED)

Header `CONDITION`. First line is the condition word from the task, in plain words ("Appears new, open box."). Then `- ` bullets: how it came to us (retail return, open box, overstock, or "liquidation lot" when `condition_notes` does not say), every line of `condition_notes`, every item in `defects`, what was tested and what was not, and what the photos show that a buyer should look at. Honesty here is the whole listing; eBay buyers of liquidation goods read this block first.

### WHAT IS INCLUDED (REQUIRED)

Header `WHAT IS INCLUDED`. One `- ` bullet per item from `included` (box, cords, manual, remote, accessories). If `included` is empty, one line: "Exactly what is pictured; nothing else is included." Never list a part the metadata and photos do not show.

### SPECS (REQUIRED)

Header `SPECS`. One fact per line from metadata and photos: Brand, Model, Type, Colour, Material, Dimensions (`dimensions` as given, with units), Weight when known, Power or capacity when known. Drop any line without a fact. This is the prose twin of the ITEM SPECIFICS section; keep wording different from WHAT IT IS.

### SHIPPING AND PICKUP (REQUIRED)

Header `SHIPPING AND PICKUP`. The line that matches the task's `shipping` field, taken from `seller-terms.md`:
- Buyer pays calculated shipping: "Ships from Salt Lake City, Utah. Shipping is calculated at checkout from the package size and weight. Ships within 2 business days of payment."
- Free shipping: "Free shipping from Salt Lake City, Utah. Ships within 2 business days of payment."
- Local pickup only: "Local pickup only in the <pickup_area> area. Not shipped."
If `local_pickup` is true on a shipped listing, add "Local pickup in the <pickup_area> area is welcome too; choose it at checkout." Never a street address.

### OUR TERMS (REQUIRED)

Header `OUR TERMS`. From `seller-terms.md`, eBay section only: who we are (local Salt Lake City seller, name-brand goods from liquidation lots), returns line, "Best Offer welcome" when `accept_offers` is true, the eBay disclaimer line, and the contact line "message us through eBay, we answer within 24 hours". Never a phone number, email, link or payment method name.

## ITEM SPECIFICS section (eBay file only)

Sits after `## Why this angle` in `ebay_item.md`. These are form fields, not description text:

```
## ITEM SPECIFICS
- Category: <eBay category path, best guess from metadata.category; "operator to confirm">
- Listing format: <Fixed price with Best Offer | Fixed price>
- Condition: <mapped value from config/item-ad-platforms.json condition_values>
- Condition description: <one line: the condition notes and defects, under 1000 chars>
- Brand: <metadata.brand>
- Model: <metadata.model or "Does not apply">
- Type: <what it is, two or three words>
- Color: <from metadata or photos, or "operator to fill">
- Material: <from metadata or photos, or "operator to fill">
- Dimensions: <metadata.dimensions or "operator to fill">
- MPN: Does not apply (unless metadata names one)
- UPC: Does not apply (unless metadata names one)
- Shipping: <Calculated | Free | Local pickup only>
- Returns: <the seller-terms eBay returns line, short>
```

## CATEGORY and CONDITION sections (form fields)

Every platform file carries `## CONDITION` between `## DESCRIPTION` and `## Why this angle`: one line, the option name mapped from `metadata.condition` through the platform's `condition_values` in `config/item-ad-platforms.json`. `fb_item.md` also carries `## CATEGORY` just above it: one line, an entry from the platform's `categories` list ("Home & Garden > Furniture"). These are dropdowns the operator sets on the form; the dashboard card shows them beside the title and price. They are never part of the description text.

## Short-form pattern: Facebook Marketplace (`fb_item`)

Plain text, phone-screen shape, within 2000 characters.

1. Line 1: what it is, brand, and the price. "Marsail 142 inch U-shaped modular sectional, beige corduroy. $350."
2. Line 2: condition in plain words plus the retail comparison when present. "Open box, appears new. Retails for $680."
3. Line 3: pickup. "Pickup in <pickup_area>." Plus "Can ship at your cost, ask for a quote." only when `shipping` allows it.
4. Blank line, then a short list headed `Condition:` with one fact per line (notes, defects, tested or not).
5. A short list headed `Included:` from `included`.
6. A short list headed `Specs:` (dimensions, colour, material, power).
7. Payment and pickup line from seller-terms: "Cash, Venmo or Zelle at pickup. No holds without payment. Inspect it before you pay."
8. Close: "Message me on Marketplace, or call or text 385-462-6366. Daniel." (phone allowed here; drop it only if the operator's `must_include` says to).

No financing words, no "DM for price", no emoji walls, no external links. `must_include` goes in verbatim where it reads naturally, usually after the Specs list.

## Short-form pattern: KSL Classifieds (`ksl`)

Same shape as Facebook with Utah local cues, within 2000 characters.

1. Line 1: what it is, brand, price. "Marsail 142 inch U-shaped modular sectional sofa, beige corduroy, $350."
2. Line 2: condition and retail comparison. "Open box, appears new, retails around $680."
3. Line 3: "Pickup in <pickup_area>. Cash or Venmo at pickup, no holds without payment."
4. `Condition:`, `Included:`, `Specs:` lists as on Facebook.
5. "Reasonable offers considered." only when `accept_offers` is true.
6. Close: "Call or text 385-462-6366 or message through KSL. Daniel."

## Worked example 1: Marsail modular sectional

Source lot: BuyWander SLC-716197 (`dashboard/data/buywander-runs.json`), title "Marsail Modular Sectional Sofa, 142" U-Shaped Modular Sectional Couch with Deep Seat, Freely Combinable Sectional Cloud Sofa for Living Room, No Assembly, Plush Corduroy Fabric, Beige", retail $679.99, BuyWander condition AppearsNew, eBay loose comps median $479 (five 133 to 146 inch U-shaped sectionals, no brand match). The task fields below that the lot does not carry (asking price, included, defects, pickup area, shipping) are EXAMPLE INPUTS written for this template, not facts about the lot.

Example metadata: condition "Appears new / open box"; condition_notes "Open box retail return. All pieces unwrapped and set up to check; no stains or tears found."; included "6 seat modules, 4 back cushions, 2 ottoman pieces, original boxes"; defects "One ottoman box is torn open; corduroy on one seat has light compression from shipping."; dimensions "142 x 85 x 33 inches assembled, U shape"; retail_value 679.99; price_usd 350; accept_offers true; local_pickup true; pickup_area "Murray, UT"; shipping "Local pickup only"; must_include "Bring a truck or SUV, the modules are bulky."

### eBay (ebay_item)

HEADLINE (69/80 chars)
Marsail 142" U-Shaped Modular Sectional Sofa Corduroy Beige, Open Box

DESCRIPTION
WHAT IT IS
Marsail 142 inch U-shaped modular sectional in beige corduroy. Six seat modules, four back cushions and two ottoman pieces that connect in any layout, so it fits a long wall or wraps a corner. Deep seats, no tools needed. Retails for $679.99. Asking $350.

CONDITION
Appears new, open box.
- Open box retail return from a liquidation lot.
- All pieces unwrapped and set up to check; no stains or tears found.
- One ottoman box is torn open.
- Corduroy on one seat has light compression from shipping; see photo 6.
- Not slept on or used beyond the check.

WHAT IS INCLUDED
- 6 seat modules
- 4 back cushions
- 2 ottoman pieces
- Original boxes (one torn)

SPECS
- Brand: Marsail
- Type: modular sectional sofa, U shape
- Colour: beige
- Fabric: corduroy
- Dimensions: 142 x 85 x 33 inches assembled

SHIPPING AND PICKUP
Local pickup only in the Murray, Utah area. Not shipped. Bring a truck or SUV, the modules are bulky.

OUR TERMS
We are a local Salt Lake City seller of name-brand goods from liquidation lots, which is why the price is under retail. Best Offer welcome. Local pickup items are sold as is, inspected and accepted at pickup. Please read the condition notes and look at every photo before buying; message us through eBay with any question and we will answer within 24 hours.

### Facebook Marketplace (fb_item)

HEADLINE (74/99 chars)
U-Shaped Modular Sectional Sofa, 142", Beige Corduroy (Marsail) - Open Box

DESCRIPTION
Marsail 142 inch U-shaped modular sectional, beige corduroy. $350.
Open box, appears new. Retails for $680.
Pickup in Murray.

Condition:
- Open box retail return, all pieces set up and checked, no stains or tears
- One ottoman box torn open
- Light compression on one seat from shipping (see the photos)

Included:
- 6 seat modules, 4 back cushions, 2 ottoman pieces
- Original boxes

Specs:
- 142 x 85 x 33 inches assembled, U shape
- Modules connect in any layout, no tools

Bring a truck or SUV, the modules are bulky.

Cash, Venmo or Zelle at pickup. No holds without payment. Inspect it before you pay. Open to offers.

Message me on Marketplace, or call or text 385-462-6366. Daniel.

### KSL Classifieds (ksl)

HEADLINE (70/95 chars)
Modular Sectional Sofa 142" U-Shape, Beige Corduroy, Marsail, Open Box

DESCRIPTION
Marsail 142 inch U-shaped modular sectional sofa, beige corduroy, $350.
Open box, appears new, retails around $680.
Pickup in Murray. Cash or Venmo at pickup, no holds without payment.

Condition:
- Open box retail return, every piece set up and checked, no stains or tears
- One ottoman box torn open
- Light compression on one seat from shipping

Included:
- 6 seat modules, 4 back cushions, 2 ottoman pieces, original boxes

Specs:
- 142 x 85 x 33 inches assembled
- Modules connect in any layout, no tools

Bring a truck or SUV, the modules are bulky. Reasonable offers considered.

Call or text 385-462-6366 or message through KSL. Daniel.

## Worked example 2: Nespresso Creatista Plus

Source lot: BuyWander SLC-741426, "Nespresso Creatista Plus Espresso Machine by Breville, Brushed Stainless Steel", retail $649.95, BuyWander condition GentlyUsed, eBay comps median $249.99 (nine sold, $200 to $300). Example inputs, not lot facts: condition "Used, good"; condition_notes "Retail return. Powered on, heats, pulls a shot and steams milk."; included "Machine, steam wand, drip tray, water tank, milk jug. No box, no capsules, no descaling kit."; defects "Light scuffs on the drip tray; a faint water mark on the base."; dimensions "6.7 x 16.1 x 12.2 inches"; price_usd 225; accept_offers false; local_pickup true; pickup_area "Salt Lake City"; shipping "Buyer pays calculated shipping"; must_include empty.

### eBay (ebay_item)

HEADLINE (75/80 chars)
Nespresso Creatista Plus Espresso Machine by Breville Stainless Steel, Used

DESCRIPTION
WHAT IT IS
Nespresso Creatista Plus by Breville, the capsule espresso machine with a built-in steam wand that textures milk automatically. Brushed stainless steel. Retails for $649.95. Asking $225.

CONDITION
Used, good.
- Retail return from a liquidation lot.
- Powered on, heats, pulls a shot and steams milk.
- Light scuffs on the drip tray.
- A faint water mark on the base; see the last photo.
- Not descaled by us.

WHAT IS INCLUDED
- Machine
- Steam wand
- Drip tray
- Water tank
- Milk jug
- No box, no capsules, no descaling kit

SPECS
- Brand: Nespresso, made by Breville
- Model: Creatista Plus
- Type: capsule espresso machine with steam wand
- Finish: brushed stainless steel
- Dimensions: 6.7 x 16.1 x 12.2 inches

SHIPPING AND PICKUP
Ships from Salt Lake City, Utah. Shipping is calculated at checkout from the package size and weight. Ships within 2 business days of payment. Local pickup in the Salt Lake City area is welcome too; choose it at checkout.

OUR TERMS
We are a local Salt Lake City seller of name-brand goods from liquidation lots, which is why the price is under retail. 30-day returns, buyer pays return shipping unless the item arrives not as described. Please read the condition notes and look at every photo before buying; message us through eBay with any question and we will answer within 24 hours.

### Facebook Marketplace (fb_item)

HEADLINE (69/99 chars)
Nespresso Creatista Plus Espresso Machine (Breville), Stainless, Used

DESCRIPTION
Nespresso Creatista Plus espresso machine by Breville, brushed stainless. $225.
Used, good condition. Retails for $650.
Pickup in Salt Lake City. Can ship at your cost, ask for a quote.

Condition:
- Retail return, powered on, heats, pulls a shot and steams milk
- Light scuffs on the drip tray
- Faint water mark on the base (see photos)

Included:
- Machine, steam wand, drip tray, water tank, milk jug
- No box, capsules or descaling kit

Specs:
- 6.7 x 16.1 x 12.2 inches
- Capsule machine with automatic milk texturing

Cash, Venmo or Zelle at pickup. No holds without payment. Plug it in and see it run before you pay.

Message me on Marketplace, or call or text 385-462-6366. Daniel.

### KSL Classifieds (ksl)

HEADLINE (74/95 chars)
Nespresso Creatista Plus Espresso Machine, Breville, Stainless Steel, Used

DESCRIPTION
Nespresso Creatista Plus espresso machine by Breville, brushed stainless, $225.
Used, good condition, retails around $650.
Pickup in Salt Lake City. Cash or Venmo at pickup, no holds without payment. Can ship at your cost if you are out of the area.

Condition:
- Retail return, powered on, heats, pulls a shot and steams milk
- Light scuffs on the drip tray
- Faint water mark on the base

Included:
- Machine, steam wand, drip tray, water tank, milk jug, no box or capsules

Specs:
- 6.7 x 16.1 x 12.2 inches
- Capsule machine with automatic milk texturing

Plug it in and see it run before you pay.

Call or text 385-462-6366 or message through KSL. Daniel.
