# Ad for park-county-co-1ac-forested

## Property
1 forested acre, Lot 366 of Redhill Forest Filing 3, Park County, Colorado (APN R0037546), at about 9,580 ft on the ridge east of CO-9 between Fairplay and Hartsel. Zoned R (Residential) by Park County. Dirt roads owned and maintained year-round by the HOA (graded in summer, plowed in winter). Utilities: CORE Electric along Redhill Rd, HOA community water (no private wells; tap fee stated by the HOA as $17,500+), septic through the county. Asking $40,999 cash, or $44,999 financed with $12,000 down and 24, 36, or 48 month plans (monthly amounts proposed, see below). Comp: a nearby 1 acre lot sold for $150,000, so the cash price is about 27% of that sale.

## Nickname
Timber Park (reused from registry)

## Revision 2026-10-09 (operator: new price and financing)
Operator asked for: price $40,999, financing $12,000 down at a financed price of $44,999, all financing options updated.

What changed in every variant (all seven files, including ParcelView):
- Cash price $35,000 -> $40,999.
- Financing: $44,999 financed, $12,000 down + $249 doc fee, balance $32,999. Monthly plans are the balance split evenly with no added interest: $1,375/mo x 24, $917/mo x 36, $688/mo x 48 (rounded to the dollar; the final payment absorbs the rounding). No credit check, no prepayment penalty, and 10% off the balance if paid within 12 months were kept as standing seller terms.
- Comp math: $40,999 is about 27% of the $150,000 sale and $109,000 less (was 23% / $115,000). "Under a quarter" became "under a third".
- Headline offers: Landmodo "$12,000 Down"; Land Century "$40,999 or $12,000 Down"; Land.com and ParcelView "$40,999 or $12K Down" (lead shortened to "1 Wooded Ac" and "Power at Rd" to fit 75); Landflip "27% of $150K 1 Ac Comp. $40,999"; Land-listings "Under 1/3 of a Nearby 1 Acre Sale. $12K Down"; Landhub "$40,999".
- To fit the caps, four 1,500-char variants (land_century, landflip, land_listings, landhub) dropped "(free trial)" from the LandGlide step and the financed price from the summary bullet (it still appears in the payment line).
- Task metadata updated via PATCH: price_usd 40999, must_include rewritten to the new terms, land_com_headline set to the new Land.com title.

## Revision 2026-10-02 (coach review)
Coach asked for: a down payment plus three financing options; a LandGlide note; nearby cities with distances; things to do; utilities; and 22+ photos. Operator added: Land.com description to about 2,000 characters (cap raised to 2000 in `config/ad-platforms.json`), step-by-step LandGlide instructions, and a list of nearby places to photograph.

What changed in every variant:
- Financing replaces "No financing on this one right now": $10,500 down (30%, per the coach) + $249 doc fee, then $1,095/mo for 24, $750/mo for 36, or $595/mo for 48 months (terms per the coach; the three monthly amounts are my proposal). No credit check, no prepayment penalty, 10% off the balance if paid within 12 months, from `knowledge-base/ebay/seller-terms.md`. Balance financed is $24,500; the plans total $26,280, $27,000, and $28,560.
- LandGlide: four numbered steps keyed to the APN.
- Nearby cities with road miles from the lot (Fairplay 11, Hartsel 11, Alma 16, Breckenridge 33, Buena Vista 38, Colorado Springs 76, Denver 93).
- Top 3 things people do here (per the coach, named as a top 3 in every variant): 1. fly fish the South Platte (private HOA water, plus Antero, Spinney, Eleven Mile); 2. ski Breckenridge over Hoosier Pass and hike Mt Silverheels; 3. South Park City museum in Fairplay.
- Utilities and HOA: CORE Electric, community water with a substantial tap fee, septic, dues about $1,250/yr per recent listings, camping May 1 to Oct 31.
- Photos: now 22. Eight licensed images of the top 3 activities were added to `photos/` (14 to 21) from Wikimedia Commons and the Library of Congress; licenses and attribution in `photos/CREDITS.md`. One (Breckenridge Vista Haus) is CC BY 4.0 and needs the credit line wherever a platform allows captions. `photo-shot-list.md` still lists subjects to shoot yourself if you want to swap any out.

Facts were pulled from the Park County assessor export, the Colorado statewide parcel service, redhillforesthoa.com, Park County camping regulations, and OSRM road routing. All of it is written up with sources in `knowledge-base/ebay/areas/fairplay-redhill-forest-co.md`.

## Operator decisions still open
1. Confirm the monthly amounts ($1,375/24, $917/36, $688/48). They assume $44,999 is the total financed price at every term. If longer terms should cost more (as the old $35K plans did), give me the totals and I'll redo them.
2. Confirm the $249 doc fee and the 10%-off-if-paid-in-12-months term still apply at the new price.
3. The four live listings (Land.com 29013311, Landmodo 411164, ParcelView f5bc2a..., Land Century 26439) still show $35,000 / $10,500 down. They need to be re-posted or edited; nothing was changed on the live sites.
4. The task metadata says access is "dirt-seasonal"; the HOA says all 22 miles of roads are plowed and graded year-round. The copy follows the HOA. Confirm.
5. HOA dues figure (copy says "about $1,250 a year per recent listings"). Current number from KC & Associates, 303-933-6279.
6. The $150,000 comp: confirm it was a vacant lot. If it was improved or had a water tap, the comp line needs a caveat.

## Top corpus matches
The corpus is 24 Elko County, NV lots (2 to 4.6 acres, $75 to $12,775, mostly owner-financed). None is close on location, price, or terrain, so these are used for structure and angle only.
1. 08-montello-nv-89830-elko-county.md: only corpus ad that leads with a comp, the closest analog to this lot's $150,000 comp.
2. 12-montello-nv-89830-elko-county.md: concrete access detail stated plainly; same fact-first style used for the road and distances.
3. 16-stagecoach-rd-montello-nv-89830-elko-county.md: recreational framing, used for the landhub fishing angle.
4. 23-balsam-st-montello-nv-89830-elko-county.md: investor-or-getaway dual pitch, used for landflip.
5. 13-montello-nv-89830-elko-county.md: private spot under trees, used for the landmodo opener.

## Selling angles
1. The price gap: $40,999 for the same acreage as a nearby $150,000 sale (27%). Deal hunters and investors.
2. Private fly fishing: 5.5 miles of Gold Medal South Platte water that comes with the lot. Recreational buyers.
3. Power at the road, community water, plowed roads: a lot you can actually build on. Cabin and retirement buyers.
4. $12,000 down and a 24 to 48 month plan, no credit check. Buyers who want terms (Landmodo, Land Century).
5. Location: 20 minutes to Fairplay, an hour to Breckenridge, two hours to Denver or Colorado Springs. Front Range weekenders.

## Variants
| Platform | Headline chars | Description chars | DREAMS |
|---|---|---|---|
| land_com | 75/75 | 1952/2000 | Pass |
| parcelview | 75/75 | 1993/2000 | Pass |
| landmodo | 59/60 | 1482/1500 | Pass |
| land_century | 99/100 | 1499/1500 | Pass |
| landflip | 99/100 | 1494/1500 | Pass |
| landhub | 98/100 | 1486/1500 | Pass |
| land_listings | 98/100 | 1491/1500 | Pass |
