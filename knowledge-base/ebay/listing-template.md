---
type: long-form-template
platform: ebay
status: v1, 2026-09-07
source_structure: eBay items 206391295800 (sold, cash no-reserve), 205086753982 (live, cash no-reserve), 366601359584 (live, 0% land contract). Structure only; no wording is reused.
---

# eBay land listing template

This is the skeleton `generate-ad` follows for `format: "long-form"` platforms. Blocks appear in this order. Each block says whether it is REQUIRED or CONDITIONAL, where its facts come from, and what it has to accomplish. The workflow writes the copy; this file never contains finished sales copy.

**Fact sources, and nothing else:** `metadata` (the task), the matching area sheet's `## Usable now` section, and filled-in lines of `seller-terms.md`. A block that needs a fact you do not have loses that line, not the block. Log the gap in `notes.md`.

**Formatting inside the description:**
- Block headers are one short ALL-CAPS line on their own (for example `QUICK NOTES ABOUT THIS PROPERTY`). Never a markdown `#` heading: the posting parser ends the description at the first one.
- Body copy is sentence case, in the operator's voice. At most one exclamation mark per block. No stacked `!!!`.
- Bullets are `- ` lines. One blank line between blocks. No tables, no HTML.
- The listing repeats its key terms on purpose (price, fee, deadline, contact) because eBay readers skim from the middle. Repeat facts, never invent new ones to fill space.
- The nickname tag ` (Property: <Nickname>)` is the literal last thing in the description, after the CLOSE block.

**Two variants.** The terms blocks (F, G, H, R, U) have a CASH form and a FINANCED form. Use FINANCED when the metadata's `must_include` or price fields carry owner-financing terms; otherwise CASH. State which one you used in `notes.md`.

---

## A. BANNER (REQUIRED)

Two to four short caps lines that name the area and the promise. Pattern: a claim about the kind of buying this is, then "INVEST IN <STATE>", then the subdivision or town name in quotes if it has one. Source: metadata location, area sheet.

## A2. BEFORE YOU BID (REQUIRED, always, regardless of seller-terms)

Header `BEFORE YOU BID`, placed immediately after the banner so it is the first thing a reader hits, not buried mid-listing. This block always carries the payment-method warning, caps-stacked (2+ consecutive ALL-CAPS lines) so the renderer gives it the red emphasis treatment instead of plain body text:

```
EBAY NO LONGER ACCEPTS PAYMENTS FOR REAL ESTATE (THIS IS AN EBAY RULE, NOT OURS)
PAYMENTS MUST BE MADE VIA ZELLE, PAYPAL, VENMO, CASH APP, WIRE TRANSFER, OR ACH
IF YOU DO NOT HAVE ONE OF THESE PAYMENT METHODS, PLEASE DO NOT BID
```

Wording may vary slightly but must keep all three facts: it is eBay's rule and not the seller's, the accepted methods by name, and a plain instruction not to bid without one. Pull the accepted-methods list from seller-terms.md's `## Payment methods` section rather than hardcoding it, so a future change there propagates here too.

If seller-terms also sets a feedback-based pre-screen rule (see the old block E, folded into this one), state it right after the payment-method lines in the same BEFORE YOU BID block: message us first if your account is under the feedback threshold, and ask that all other questions come before bidding too. Skip only the pre-screen half if seller-terms leaves that line as TODO; the payment-method warning itself is never skipped.

## B. WHY THIS AREA (REQUIRED if an area sheet matched, otherwise skip)

Header `WHY <COUNTY OR AREA> IS WORTH A LOOK`, then a numbered list of three to five reasons, each a bold-style caps lead phrase followed by one or two sentence-case sentences. Every reason comes from the area sheet's usable section (drive times, public land, growth, taxes, recreation). Close with one sentence that ties the reasons to buying now.

## C. QUICK NOTES ABOUT THIS PROPERTY (REQUIRED)

The scannable summary the reference listings open with. Numbered, each item `N. LABEL:` on one line and one or two sentences below it:
1. AREA (town, county, state, the one-line character of the place)
2. ACCESS (road type, distance from the nearest town or highway exit)
3. VALUE (comp, assessed value, or per-acre comparison from metadata; skip if none)
4. POWER / UTILITIES (state honestly what is and is not there; use `utilities_absent`)
5. PROXIMITY (drive times to the two or three places a buyer cares about)
6. LISTING FORMAT (one sentence: cash no-reserve auction, fixed price, or land contract with the down payment)

## D. READ THE WHOLE LISTING (REQUIRED)

Header `PLEASE READ THE ENTIRE LISTING BEFORE YOU BUY`. Say plainly that the listing is long because a piece of land deserves more explanation than a gadget, ask for four or five minutes, and point at the FAQ at the bottom. CONDITIONAL sub-line: `BUY FROM SOMEONE WHO HAS STOOD ON THIS LAND` only when seller-terms or the task's `must_include` says we visited the property.

## F. LISTING FORMAT AND TERMS (REQUIRED)

CASH form, header `NO RESERVE` or `CASH PRICE` as applicable: the winning bid or listed price plus the document fee is the whole cost; no other fees; payment due within the seller-terms window; no financing on this listing (and one sentence offering to talk if they need terms on another lot, if we have others).

FINANCED form, header `THIS IS A LAND CONTRACT LISTING`: since seller-terms keeps the format a no-reserve auction, the winning bid becomes the down payment, not the price of the lot. Lead with a caps line `YOU ARE BIDDING ON THE DOWN PAYMENT ONLY`, then one sentence stating the fixed sales price the bidder is assuming, that the down payment and document fee are deducted from that total, and the resulting monthly plan (term length, approximate dollars per month, drawn from metadata). Do not state a fixed down-payment dollar amount anywhere in the listing; it is whatever the auction closes at. Then a `PAYMENT PLAN OPTIONS` list (one line per term length available), then only the caps lines seller-terms confirms among `NO PREPAYMENT PENALTY`, `NO CREDIT CHECK`, `NO QUALIFYING`, `NO INTEREST`. Then the payment deadline (paid within the seller-terms window of the listing ending) and a pointer to payment options at the end.

Both forms end with the four assurance lines, each on its own line, only those that are true per seller-terms and metadata: `NO RECORDING FEES`, `NO TRANSFER TAX`, `TAXES ARE PAID CURRENT`, `NO HIDDEN FEES`.

## G. HOW DOES THIS WORK (REQUIRED)

Header `HOW DOES THIS WORK? THREE EASY STEPS`. Step one: read the listing and message us on eBay with questions, with our reply time from seller-terms. Step two: tell us you want it (and how, if the pre-screen block exists). Step three: pay the down payment or the cash price within the window, and what we send back (contract packet, deed timeline) per seller-terms. Keep each step to three sentences. Contact is eBay messages only, never a phone number: eBay's policy bars off-platform contact info in a listing description.

## H. WHAT IS THIS LOT WORTH (REQUIRED if metadata has a comp, assessed value, or the area sheet has usable comps; otherwise skip)

Header `WHAT IS THIS LOT WORTH?`. Lay the comps out one per line with what they are (listed vs sold, size, price, date if known). Then the contrast with our price. CASH auction form adds one sentence: the bidders decide the price. Fixed-price form adds: make an offer through eBay if the price is not right. Never round a comp up, never mix a listing price with a sold price without labeling each.

## I. PROPERTY INFORMATION (REQUIRED)

Header `PROPERTY INFORMATION`, then `PROPERTY SPECIFICS:` and one fact per line, in this order, dropping any you do not have: subdivision and lot/block, APN, legal description, street or address area, county, exact acreage, square feet (acres x 43,560, rounded to one decimal), approximate elevation, annual property taxes, annual HOA fees (write $0.00 and say there is no HOA when true), then `COORDINATES:` with center and, when given, the four corners. End with one line telling the buyer to paste the center coordinates into Google Maps to see the exact spot.

## J. BASIC LAND DESCRIPTION (REQUIRED)

Header `BASIC LAND DESCRIPTION`. Two to four sentences on terrain, vegetation, slope, and what the views are (from `terrain`). Then the size picture: `A TRUE MINI RANCH` style caps line with the acreage, and a one-line size analogy that is arithmetically honest (one acre is 43,560 square feet; a football field including end zones is about 1.32 acres, so a 2.27-acre lot is "a little under two football fields"). Then the caps line `LOT SIZE: <sq ft> SQUARE FEET`.

## K. ACCESS AND POWER (REQUIRED)

Header `EASY ACCESS` (only if access is paved or year-round dirt; use `ACCESS` otherwise). State the road type and season honestly from `access`, what vehicle gets there, and the power situation from utilities. Close with the `THIS IS THE REAL DEAL` idea in our own words: what makes this a lot someone can actually use, listing only true items (surveyed, power at the road, legal access, real address).

## L. THE AREA AND THE LIFESTYLE (REQUIRED)

Header `LOCATED IN <TOWN / SUBDIVISION>`. Three to five short paragraphs from the area sheet: what the town is and where it sits; the drive times to town, the interstate, the nearest city, the nearest airport; the outdoor life (public land, hunting, riding, fishing, dark skies), each item only if the area sheet or metadata supports it; what a buyer would do here (weekend camp, build, hold). One paragraph headed `WHAT IS BLM LAND?` that spells out Bureau of Land Management in plain words for a buyer who has never heard the term, then why nearby public land matters to a lot owner. Skip the BLM paragraph if neither metadata nor area sheet mentions public land.

## M. COUNTY PROFILE (REQUIRED if the area sheet has a usable county section)

Header `<COUNTY> COUNTY, <STATE>`. One or two sentence-case paragraphs: size, the towns it contains, the economy, the growth story, the climate. Only usable-section facts.

## N. STATE PROFILE (REQUIRED if the area sheet has a usable state section)

Header `<STATE>!`. The two or three state-level buying reasons the area sheet marks usable (taxes, public land share, growth). Do not quote growth statistics that the area sheet does not carry.

## O. NO SURPRISES / WHAT YOU CAN DO HERE (REQUIRED)

Header `NO SURPRISES`. Say what the lot is NOT near or subject to, only where metadata supports it (railroad tracks, washes, rugged terrain, HOA). Then `NO TIME LIMIT TO BUILD` as a caps line with one sentence, when zoning allows the lot to sit vacant. Then `WHAT YOU CAN BUILD OR DO HERE` with a short list drawn from `zoning` and `must_include` (home, cabin, mobile home, camping, RV, animals) and a closing line that the buyer should verify intended uses with the county (seller-terms default disclaimer).

## P. WHO YOU ARE BUYING FROM (REQUIRED)

Header `WHO YOU ARE BUYING FROM`. The seller names, what we do (we sell rural Nevada land, our own inventory), how to reach us (eBay messages only, never a phone number: eBay's policy bars listing off-platform contact info), reply time, references-on-request if seller-terms says yes. Never state feedback scores, years on eBay, or sales counts unless seller-terms carries the number. This block replaces the reference listings' feedback screenshots; it earns trust with specifics, not superlatives.

## Q. DEED AND CLOSING (REQUIRED)

Header `THE DEED`. Name the deed type from seller-terms and explain in two sentences what it guarantees the buyer. If it is a warranty deed, one more sentence on why that is stronger than a special warranty or quitclaim deed. Then who pays recording and transfer costs, when the deed records (at payoff on a land contract, at payment on cash), and that taxes are paid current, all per seller-terms and metadata.

## R. PAYMENT OPTIONS (REQUIRED)

Header `PAYMENT OPTIONS`. One line per accepted method from seller-terms (Zelle, PayPal, Venmo, Cash App, wire transfer, ACH bank transfer). Repeat that eBay no longer supports payment processing for real estate, and that these go directly to us rather than through eBay, which is why these are the only options. FINANCED form adds one sentence on how monthly payments are made. Must stay consistent with the BEFORE YOU BID block (A2); never list a method here that block does not name, or vice versa.

## S. SKEPTICAL? COME SEE IT (REQUIRED if the area sheet has a usable nearest-airport or drive-time entry)

Header `SKEPTICAL? GO STAND ON IT`. Fly-in city and drive time, or the drive from the nearest metro, and an invitation to walk the lot with the coordinates above. No offers of free lodging unless seller-terms adds one.

## T. PARCEL SPECIFIC FEATURES (REQUIRED)

Header `PARCEL SPECIFIC FEATURES`, then one line each: Elevation, Access, Views, Vegetation, Topography, Water, Sewer, Power, Zoning, HOA, Taxes. Drop lines with no fact. This block repeats block I on purpose; keep the wording different.

## U. FREQUENTLY ASKED QUESTIONS (REQUIRED)

Header `FREQUENTLY ASKED QUESTIONS`. Each entry is `Question:` on one line and `Answer:` on the next. Include every question below for which you have a truthful answer from the three fact sources; skip the rest. Order:
1. How does the purchase work?
2. Can more than one name go on the deed, or an LLC or trust?
3. Who pays recording fees and transfer tax?
4. What payment methods do you accept?
5. (FINANCED) Who do I make payments to, and is there a prepayment penalty?
6. (FINANCED) Can I use the land while I am making payments?
7. How is water obtained, how deep are wells, what does drilling cost? (only with `utilities_notes` support)
8. Is there sewer, or do I need septic?
9. How is the property zoned, and what can I build?
10. Is there a time limit to build?
11. When are property taxes due, and are there back taxes or liens?
12. What type of deed do I get?
13. Is there legal access?
14. Is there power?
15. What improvements are on the property?
16. Are there HOA fees or other costs?
17. Is there a mailing address?
18. What is your guarantee? (only if seller-terms has one)

## V. CLOSE (REQUIRED)

Header `DON'T MISS THIS ONE`. A three to five sentence recap in the operator's voice: what it is, where it is, the price and terms in one line, the reason to act (scarcity only if true: number of lots left, or a comp that shows the price is low), and the exact next step (message on eBay; never a phone number, per eBay policy). Then the nickname tag as the final characters.

---

## Title (headline) rules for eBay

Handled by Step 3 headline craft with `headline_max: 80`. Extra rules for this platform:
- ALL CAPS is the category norm and is allowed here (the headline is exempt from the anti-slop caps rule on eBay only).
- Separators are ` - ` or `/`, never em dashes.
- Order: acreage + state (or town) first, standout second, terms last (`CASH - NO RESERVE`, `0% FINANCING`, `$395 DOWN`).
- A buyer here does not know what BLM means: write `PUBLIC LAND` or `FEDERAL LAND`.
- Land between 72 and 80 characters.
