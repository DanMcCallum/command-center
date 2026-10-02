# Ad for elko-nv-0.12ac-blm-hunting

## Property
A 0.12-acre recreational lot near Elko, Nevada (Elko County), measuring 101 feet by 52 feet, priced at $1,500. BLM public land sits nearby, making it a low-cost hunting and camping basecamp. The parcel is not zoned; Elko County records it as NZ. Power runs along the nearby dirt road; access is a seasonal dirt road. Property taxes are $17.47 a year. Owner financing is available at $1 down and $75/month for 24 months. A same-size lot nearby recently sold for $2,500. Target buyer: hunter.

## Nickname
Sage Basin (reused from registry)

## Top corpus matches
1. 12-montello-nv-89830-elko-county.md: same county, near-BLM + road-frontage; the "thousands of acres of BLM nearby" hook mirrors this lot's core selling angle.
2. 18-debbs-creek-rd-montello-nv-89830-elko-county.md: recent 2025 sale, owner-financing + near-public-land, low-monthly framing ($199/mo or $7/day).
3. 17-heather-dr-cottonwood-nv-montello-nv-89830-elko-county.md: closest on price ($75), recent 2025, off-grid flat desert recreational lot.
4. 15-wescott-rd-montello-nv-89830-elko-county.md: most recent sale (2026-04), owner-financing with a clean monthly-payment lead.
5. 16-stagecoach-rd-montello-nv-89830-elko-county.md: recreational RV/ATV/camping use language that fits the hunter/basecamp buyer.

## Zoning correction (2026-09-08)

The operator's revision note says the zoning is **NZ (not zoned)**, not rural recreation. Every
variant is corrected. Note that the task metadata still carries `zoning: "Rural recreation"`, so
**that field needs updating or the next regeneration will reintroduce the error.** I did not
edit it myself; changing the recorded value of a property fact is the operator's call.

This was not a find-and-replace. Two headlines used the zoning as their standout clause, and
every "so camping and RV use fit" line was an inference from the rural-recreation designation
that no longer holds. Unzoned is the stronger selling point of the two (the sold-title corpus
carries `Unrestricted Use`, `Unrestricted Land`, `No Restrictions`), so it was promoted to the
standout on land_century and folded into land_com's.

Accuracy guard applied throughout: no zoning category is stated as a fact, and the copy never
implies no rules. County building, health and septic requirements are named as still applying
on the platform that has room for it (eBay), and every variant now points the buyer at Elko
County to confirm intended use.

## Lot dimensions correction (2026-09-08)

The operator supplied the real dimensions: **101 feet by 52 feet**. The eBay listing had
described the lot as "a square about 72 feet a side", which was my own derivation from the
acreage (sqrt of 5,227 sq ft) and is disproved by a 101 x 52 rectangle. That sentence is gone
and the sizing note now carries the measured dimensions on every platform.

The two figures corroborate each other: 101 x 52 = 5,252 sq ft against 5,227.2 sq ft for
0.12 acre, a 0.5% difference, which is the normal gap between nominal lot dimensions and
recorded acreage. The football-field comparison survives unchanged (about eleven of these fit
inside one, end zones included).

As with the zoning fix, **the task metadata does not record the dimensions**, so they should be
added there or the next regeneration loses them.

## Property taxes added (2026-09-08)

The operator supplied the annual tax bill: **$17.47 a year**. It is now in all six variants,
framed as a holding cost rather than a bare number, since the ask was to note how cheap it is.
Per-platform framings differ: about a dollar and a half a month (eBay), less than a quarter of
one monthly payment (landhub), almost no carrying cost on a long hold (landflip).

This is the strongest single fact added since the first run. The DREAMS rubric names
"Property taxes only $___ per year" as a top-tier objection-killer under E, and on eBay it
unblocked two template lines that had been dropped for want of the fact: the `annual property
taxes` line in block I and the `Taxes` line in block T, plus a new FAQ entry.

What it does **not** unblock: the block F assurance line `TAXES ARE PAID CURRENT` stays out.
Knowing the annual amount is not the same as knowing the taxes are paid current or that there
are no liens, and `seller-terms.md` treats taxes-paid-current as a per-property fact that belongs
in `must_include`. That is still missing.

Third fact in a row the metadata does not carry, after the NZ zoning and the 101 x 52 dimensions.

## Platform note

The five land-marketplace variants were generated in the first run of this task and are
unchanged. The `ebay` long-form listing was regenerated on 2026-09-07 at the operator's
request, after the listing-HTML pipeline shipped (`specs/ebay-html-listing.md`). `ebay` is
not in the task metadata's `platforms` array; it comes from the task's captain notes.

This pass (2026-09-08) picked up two changes the operator made to the eBay knowledge base:

- **No phone numbers in the description.** `seller-terms.md` now splits the contact line and
  states that eBay policy bars off-platform contact info in a listing description. Blocks G, P
  and V say eBay messages only. The number is gone from all four places it appeared.
- **Block F's FINANCED form was rewritten.** On a no-reserve auction the winning bid is the
  down payment, not the price. The block now leads with `YOU ARE BIDDING ON THE DOWN PAYMENT
  ONLY`, states the fixed $1,500 sales price, and names no fixed down-payment figure anywhere,
  per the template. This resolves the auction-versus-fixed-financing conflict flagged twice in
  earlier runs.

The earlier pass had already aligned the block structure with the HTML renderer
(`dashboard/lib/ebay-html.ts`), so top-level template blocks render as green section headers
with a photo slot while in-block caps lines render as red emphasis. Verified again after this
rewrite: 4 banner lines, 18 headers, 8 emphasis lines, 8 sub-labels, 15 photos placed.

No area sheet matched this property: `knowledge-base/ebay/areas/montello-nv.md` matches on
`montello`, `89830`, and `elko county`, and none of those is a substring of the metadata
location `Elko, NV`. The eBay listing is therefore written from task metadata and seller
terms only, which is why its area, county, state and "come see it" blocks are absent, and why
`areaImages` renders empty. See `notes.md`.

## Selling angles
1. Public-land hunting nearby, hunt and ride the BLM without owning acreage. Buyer: hunter / recreational.
2. Rock-bottom entry with owner financing, $1 down and $75/mo, less than a phone bill. Buyer: first-time / budget.
3. Priced under a proven comp, $1,500 against a $2,500 same-size nearby sale. Buyer: deal-hunter / investor.
4. No zoning on the parcel, recorded NZ by the county, so no zoning category sets what the land is for. Buyer: unrestricted-use / recreational.
5. Power already down the road, easier future setup than raw ground. Buyer: practical recreational.
6. Almost no carrying cost, property taxes are $17.47 a year. Buyer: long-hold investor / budget.

## Variants
| Platform | Headline chars | Description chars | DREAMS |
|---|---|---|---|
| landmodo | 55/60 | 1488/1500 | Pass |
| land_century | 96/100 | 1494/1500 | Pass |
| landflip | 98/100 | 1493/1500 | Pass |
| land_com | 94/100 | 1482/1500 | Pass |
| landhub | 96/100 | 1496/1500 | Pass |
| ebay | 78/80 | 12288/40000 | 1 weak (E) |
