---
type: seller-terms
scope: items (consumer goods from BuyWander liquidation lots)
status: SEEDED 2026-11-09 by the item ad builder build. Every line marked "(operator to confirm)" is an assumption; confirm before the first item listing goes live.
---

# Seller terms for item listings

Operator-maintained. `generate-item-ad` reads this file for the terms, shipping, returns and contact lines in every platform variant. It uses only lines that are filled in. Any line containing `TODO` is skipped and reported in that task's notes file under "Seller terms still TODO". The land file (`knowledge-base/ebay/seller-terms.md`) is separate; nothing from it applies to items.

## Who is selling

- Seller names: Daniel & Chantel McCallum
- What we sell: name-brand household goods, electronics, tools and furniture bought in liquidation lots in Salt Lake City. Most of it is retail returns and open-box stock, which is why the prices are under retail. (operator to confirm the wording)
- How we describe ourselves on a listing: a local Salt Lake City seller, not a store. (operator to confirm)
- Contact line, eBay: message us through eBay. eBay policy bars phone numbers, email addresses and links in a listing, so this is the only contact line the eBay variant may carry.
- Contact line, Facebook Marketplace and KSL: message me, or call or text 385-462-6366.
- Reply time: within 24 hours, usually the same day.
- Sign-off name on messages: Daniel.

## Pickup

- Area: Salt Lake City, Utah. The exact meeting spot is set per listing from the task's `pickup_area` (a city or neighborhood, never a street address in the ad). (operator to confirm the default area if `pickup_area` is empty: Salt Lake City)
- How pickup works: message first, agree on a time, pay at pickup. We hold an item only after payment. "First come, first served" otherwise. (operator to confirm)
- Inspection: the buyer may look the item over and, where it plugs in, see it power on before paying.
- Heavy items (furniture, mattresses): buyer brings help and a vehicle that fits it; we state the dimensions in the ad so there are no surprises. (operator to confirm)

## Payment

- eBay: eBay checkout only. Nothing else may be named in an eBay listing.
- Facebook Marketplace and KSL: cash, Venmo or Zelle at pickup. (operator to confirm Zelle; Venmo and cash assumed)
- No holds without payment. No deposits. No checks, no payment plans, no financing of any kind.
- Sales tax: not collected on local private sales. eBay collects and remits its own. (operator to confirm)

## Shipping

The task's `shipping` field picks one of these. The ad states only the one that applies.

- "Buyer pays calculated shipping": shipped from Salt Lake City by UPS Ground or USPS, cost calculated at checkout on eBay. On Facebook and KSL the line reads "can ship at the buyer's cost, ask for a quote". (operator to confirm carriers)
- "Free shipping": shipping is included in the price; ships from Salt Lake City.
- "Local pickup only": not shipped. Pickup in the area named above.
- Handling time: ships within 2 business days of payment. (operator to confirm)
- Packaging: original box when we have it, otherwise packed by us; the ad says which when the metadata's `included` field names the box.

## Returns

- eBay: 30-day returns accepted, buyer pays return shipping unless the item arrives not as described, in which case we pay. Refund on receipt of the item in the condition it was sent. (operator to confirm the window and who pays; eBay's seller tiers reward a 30-day policy)
- Facebook Marketplace and KSL (local sales): sold as is. Inspect it at pickup; once it leaves with the buyer the sale is final. If something was missed in the ad, message within 24 hours and we will work it out. (operator to confirm)

## Condition language

- Every item came from a liquidation lot. In plain words that means retail return, open box, or overstock. The ad says which when the task's `condition_notes` says so, and says "liquidation lot" when it does not.
- Condition words follow the task's `condition` field exactly: New; Appears new / open box; Used, good; Used, fair; For parts. "New" appears only when the field says New.
- Everything in `defects` and `condition_notes` goes in the ad. We never write around a flaw.
- What we have not tested, we say we have not tested.

## Always include

- Disclaimer for local sales: Sold as is, inspected and accepted at pickup.
- Disclaimer for eBay: Please read the condition notes and look at every photo before buying; message us through eBay with any question and we will answer within 24 hours.
