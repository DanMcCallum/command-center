# BuyWander nightly deal scan

You are running unattended from cron inside the operator's own Chrome (the
claude-in-chrome tools). Do exactly this job, write the output file, close
the tab you opened, and stop. Never bid, watch, add to cart, or change any
account setting on BuyWander or eBay. Never log in or enter credentials
anywhere; if a page asks you to log in, record that in `notes` and stop.

Inputs for this run:

- Output file (write this exactly): `{{OUTPUT_FILE}}`
- Already-seen auction ids (JSON `{"ids": [...]}`): `{{SEEN_FILE}}`
- Store location: Salt Lake City, id `08dde114-da37-1ddb-6c02-e090d6310000`
- Retail floor: $400
- Max lots to price against eBay this run: {{MAX_ITEMS}}

## 1. Read the BuyWander lots

Create a new tab and navigate it to `https://buywander.com/auctions`. Confirm
the page shows the account menu (initials "DM" in the top right) and not a
login form. Then run this JavaScript in the tab (one call) and keep its result:

```js
const body = {pageNumber:1, pageSize:200, storeLocationIds:['08dde114-da37-1ddb-6c02-e090d6310000'], minRetailPrice:400, sortBy:'NewArrivals'};
const r = await fetch('https://bwapi.buywander.com/api/site/v1/Auctions/search', {method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)});
const j = await r.json();
({status: r.status, total: j.totalCount, lots: j.items.filter(x => x.auction).map(x => ({
  id: x.auction.id, title: x.auction.item?.title, retail: x.auction.item?.price,
  bid: x.auction.winningBid?.amount ?? 0, ends: x.auction.endDate,
  condition: x.auction.item?.condition, category: x.auction.item?.categoryName,
  type: x.auction.item?.type, bwsku: x.auction.item?.bwsku, size: x.auction.item?.sizeDescription ?? null,
  brand: x.auction.item?.brand ?? null, model: x.auction.item?.model ?? null
}))})
```

If `status` is not 200 or `lots` is empty while `total` is above zero, retry
once after 5 seconds, then record the problem in `notes` and still write the
output file with what you have.

Every lot's public page is `https://buywander.com/auctions?auctionId=<id>`.

## 2. Decide what to price

Read the seen file. A lot is NEW when its id is not in `ids`. Put every lot
id from step 1 (new or not) into `scanned_ids`.

From the NEW lots, skip and list under `skipped` (with a short `reason`):

- `type` is `VarietyPack` or the title says variety pack, pallet, lot of
  returns, mixed, or "no returns": these have no single eBay comp.
- `condition` is `MixedCondition` with a generic title.
- Titles with no identifiable product (brand and model, or a specific named
  product) that could be searched on eBay.

Price the rest, newest first, up to the max. If there are more new lots than
the max, list the remainder under `skipped` with reason `over max`.

## 3. eBay sold comps, one lot at a time

For each lot to price, build a search query from the brand, model and the
distinctive words of the title (drop sizes, colours, marketing filler). In
the same tab navigate to

`https://www.ebay.com/sch/i.html?_nkw=<query, URL-encoded>&LH_Sold=1&LH_Complete=1&_ipg=60`

then run:

```js
await new Promise(r => setTimeout(r, 1500));
[...document.querySelectorAll('li.s-card, li.s-item')].map(li => ({
  title: li.querySelector('.s-card__title, .s-item__title')?.innerText?.trim(),
  price: li.querySelector('.s-card__price, .s-item__price')?.innerText?.trim(),
  sold: li.querySelector('.s-card__caption, .s-item__caption, .s-item__title--tag')?.innerText?.trim()
})).filter(x => x.title && x.price && !/Shop on eBay/i.test(x.title)).slice(0, 40)
```

Every eBay search is a real navigation of the tab, one lot at a time. Never
call `fetch()` (or XHR) against ebay.com from page JavaScript and never loop
over several queries in one script: a burst of scripted searches is what gets
this browser refused by eBay. After reading each result page, wait 3 seconds
before the next eBay navigation (add `await new Promise(r => setTimeout(r,
3000))` to the end of the script above, or run it on its own).

If the page is an eBay error page (title "Error Page | eBay", "Something went
wrong on our end"), wait 30 seconds and navigate to the same URL again; if
that fails too, wait 90 seconds and try a third time. If the third try fails,
set `median_sold` to null, `comp_count` 0, `match` `"none"` and the note
"ebay blocked" for that lot. When two lots in a row end "ebay blocked", stop
searching: give every remaining lot the same "ebay blocked" record without
loading eBay again, and say so in `notes`. If the page is a "verify you are
human" challenge, do not retry and do not try to solve it: mark the lot and
every remaining lot "ebay blocked" and say so in `notes`.

From the results keep only comps that are the SAME product (same brand and
model or equivalent; the same generation or version when the title states
one). Drop accessories, parts, bundles of several units, "for parts" or
broken items, and price ranges like "$50 to $80" unless nothing else exists.
Take the single price (the first dollar figure). Use up to 10 comps. The
median is the middle value (average of the two middle values for an even
count). Record `comp_count` as the number of comps you kept, the exact eBay
URL you loaded as `search_url`, and a one-line `note` saying what matched
(for example "6 sold V3 strollers, Oct-Nov, $650-$800; ignored bassinets").
Set `match` to `"exact"` when the comps are the same model.

**Second, looser search.** If the first search leaves you with no
same-product comps, search once more with a broader query: keep the brand
and the product type, drop the model number, size, colour and finish (for
example "Kingston Brass pressure balanced shower faucet" instead of
"Kingston KB8340BXSO", or "Caracole nightstand" instead of "Caracole
Lyon Nightstand"). Keep sold items that are the same kind of product from
the same brand at a comparable tier, still dropping parts, accessories and
bundles. Record these with `match` set to `"loose"`, `search_url` set to
the second URL, and a `note` that says what you widened to. Only if the
second search also finds nothing, set `median_sold` to null, `comp_count`
0, `match` to `"none"`, and `search_url` to the first URL.

Do this in the one tab, sequentially. Do not open extra tabs.

## 4. Write the output

Write `{{OUTPUT_FILE}}` as JSON with exactly this shape (no markdown fence,
no commentary in the file):

```json
{
  "scanned_at": "<ISO 8601 UTC now>",
  "location": "Salt Lake City",
  "scanned_ids": ["<every lot id from step 1>"],
  "finds": [
    {
      "auction_id": "<id>",
      "url": "https://buywander.com/auctions?auctionId=<id>",
      "title": "<title>",
      "retail_value": 899.99,
      "current_bid": 51,
      "ends_at": "<endDate as given>",
      "condition": "<condition as given>",
      "category": "<categoryName as given, trimmed>",
      "bwsku": "<bwsku>",
      "size_description": "<size exactly as given, or null>",
      "ebay": { "median_sold": 725, "comp_count": 6, "match": "exact", "search_url": "<url>", "note": "<one line>" }
    }
  ],
  "skipped": [
    { "auction_id": "<id>", "url": "<url>", "title": "<title>", "retail_value": 400, "reason": "<short>" }
  ],
  "notes": "<empty string, or anything the operator must know>"
}
```

Copy `size_description` verbatim from the lot's `size` (it looks like "L: 95.3 cm x W: 57.9 cm x H: 101.6 cm, Weight: 11.567 kg"; the server turns it into a UPS shipping estimate). `finds` holds only the lots you priced (including ones with null median).
Numbers are numbers, not strings. Then close the tab you created and reply
with one line: how many lots were scanned, new, priced and skipped.
