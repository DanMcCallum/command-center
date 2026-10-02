---
type: area-sheet
area: Montello, Elko County, Nevada
matches:
  - montello
  - "89830"
  - elko county
status: v1, 2026-09-07. Usable section is corpus-grounded; confirmation section is unverified.
---

# Montello, NV area sheet

Reusable area copy for every Montello-area listing. `generate-ad` matches this file when the property's town, ZIP, or county appears in `matches:`. It may write from `## Usable now` only. Everything under `## Needs operator confirmation` stays out of listings until you check it and move it up; when you do, add the source next to the fact.

Wording here is a fact list, not finished copy. The workflow writes the sentences in the operator's voice each time.

## Usable now

### Where it is
- Montello, NV 89830 is an unincorporated town in Elko County, in the high desert of northeastern Nevada, on the Utah-Nevada border. (sold-ad corpus)
- Salt Lake City is a little over two hours' drive. (corpus, ad 13)
- The lots we sell around Montello sit at different distances from town: the corpus has lots 3 miles, 7 miles, and 17 miles out. Use the distance in the task metadata; never assume one.

### What you see and do
- Views of Pilot Peak from many lots south and east of town. Use only when the task's `terrain` or `must_include` mentions the view, or the lot is in a subdivision the operator has confirmed faces it. (corpus, ads 09 and 13)
- Thousands of acres of BLM public land nearby. (corpus, ad 12)
- Off-grid area: no power on most lots, water by well, sewer by septic. Say so plainly; use the task's `utilities` and `utilities_absent` for the specific lot.

### Comps from our sold-ad corpus (Land.com, Montello-area lots)
Use these in block H when the task metadata carries no comp of its own. Label them as sold listings from the area, with size and year. Never mix them with a task comp without labeling both.
- 2.06 ac, $4,999, 2024
- 2.27 ac, $4,699, 2025
- 2.06 ac, $4,699, 2025
- 2.27 ac, $4,799, 2025
- 2.06 ac, $6,499, 2024
- 2.16 ac, $3,790, 2024
- 2.27 ac, $7,800, 2025
- 2.27 ac, $4,988, 2024
- 2.13 ac (Cedar St), $12,775, 2024
- 2.27 ac, $7,788, 2023
- 2.28 ac, $8,760, 2024
- 2.06 ac, $6,150, 2022
- 3.49 ac (Wescott Rd), $9,995, 2026
- 2.06 ac (Stagecoach Rd), $6,000, 2021
- 2.06 ac (Debbs Creek Rd), $10,999, 2025
- 2.27 ac, $7,488, 2025
- 2.48 ac, $6,100, 2022
- 2.82 ac (Elm St), $6,100, 2022
- 2.27 ac (Balsam St), $6,500, 2021
- 2.06 ac (Balsam St), $6,000, 2021
Summary line the workflow may use: two-acre lots around Montello have sold on Land.com between roughly $3,800 and $12,800 since 2021, most between $4,700 and $8,800, and owner financing at about $100 to $200 a month was the usual offer. (corpus frontmatter; two entries at $200 and $75 are monthly-payment listings, not prices, and are excluded)

### County (one-line facts)
- Elko County is in the northeastern corner of Nevada and contains Montello along with the cities of Elko, Wells, Carlin, and West Wendover. (public fact)

## Needs operator confirmation

Check each item, add the source, then move it up. Ordered by how much it would help the listing.

### Roads and drive times
- Montello sits on Nevada State Route 233, which reaches Interstate 80 at Oasis about 25 miles to the southwest and continues northeast into Utah as SR-30.
- Wells, NV (I-80 and US-93 junction; fuel, groceries, motels, a clinic) is roughly 50 miles by road.
- West Wendover, NV (casinos, fuel, the Utah state line) is roughly 60 miles by road.
- Elko, NV (county seat, hospital, Walmart, Home Depot, regional airport) is roughly 100 miles west.
- Salt Lake City International Airport is roughly 150 miles east; the fly-in-and-drive visit in the template's SKEPTICAL block depends on this line.

### Landmarks and setting
- Pilot Peak is 10,716 feet, the high point of the Pilot Range, and was the landmark emigrants on the California Trail steered for after crossing the Great Salt Lake Desert.
- Montello's elevation is about 4,900 feet. High-desert climate: four seasons, cold winters, hot dry summers, low annual precipitation, clear night skies.
- Montello began as a Central Pacific (later Southern Pacific) railroad town; today it has well under 100 residents. Local services are minimal (confirm what is currently open before naming a bar, store, or fuel).

### Outdoor life
- Elko County hunting: mule deer, pronghorn, chukar; confirm species, units, and seasons with the Nevada Department of Wildlife before naming any.
- Nearby BLM land is open to hiking, ATV riding, camping, and rockhounding; confirm the actual acreage figure before replacing "thousands of acres".

### County and state numbers
- Elko County population 46,000 or more (seen in a competing listing; check the latest census estimate).
- Elko was listed among the 100 Best Small Towns in America in 2005 (competing listing; verify before use).
- Nevada has no state income tax.
- More than 80% of Nevada is federally managed land, with the Bureau of Land Management holding the largest share.
- Nevada led the nation in population growth for many years running (competing listings claim 21 straight years; do not repeat without a census source).

### Lots, zoning, utilities
- Many Montello-area lots are Elko County AR (Agricultural Residential) zoning; the generic statements (one single-family residence allowed, camping allowed, RV stays subject to county rules) need county confirmation. Always use the task's own `zoning`.
- Platted subdivision lots around Montello commonly have about 330 feet of road frontage (corpus pattern from two ads); use only when the task metadata gives the frontage.
- Wells in the area: one task's utilities notes cited 14 monitored wells nearby and a typical depth around 300 feet. That was for a Wells, NV lot; confirm per property.
- Cell coverage and internet options: unknown.
