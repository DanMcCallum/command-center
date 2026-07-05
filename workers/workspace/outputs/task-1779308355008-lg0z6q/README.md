# Ad for 4.13 ac · Elko County · $7,000

## Property
4.13 acres of raw, off-grid land in Elko County, Nevada (metadata lists Utah; Elko County exists only in NV, flagged in notes), Montello area. Cash price $7,000 with owner financing at $350 down plus $150 per month for 60 months. One property line adjoins thousands of acres of Bureau of Land Management public land. Dirt-seasonal access. OS-Open Space zoning. Recent local comparable: 2.39 acres sold for $15,500 nearby (~$6,485/acre versus ~$1,695/acre on this lot, or roughly 26% of the per-acre rate at nearly twice the acreage).

## Top corpus matches
1. `12-montello-nv-89830-elko-county.md`. Only corpus listing tagged `near-blm`, explicit "thousands of acres of BLM nearby" framing.
2. `15-wescott-rd-montello-nv-89830-elko-county.md`. Closest acreage match (3.49 ac), most recent sale (2026-04-02), owner-finance lead.
3. `13-montello-nv-89830-elko-county.md`. Explicit off-grid tag, "build an off-grid home" framing matches buyer hint.
4. `18-debbs-creek-rd-montello-nv-89830-elko-county.md`. `near-public-land` plus owner-financing, Pilot Peak landmark.
5. `25-balsam-st-montello-nv-89830-elko-county.md`. Off-grid tag, closest sold price ($6,000).

## Selling angles
1. Per-acre value gap: ~$1,695/ac versus comp ~$6,485/ac, roughly 1/4 the rate at nearly 2x the size. Buyer segment: bargain hunters and investors.
2. Property line adjoining thousands of BLM acres, a permanent buffer. Only 2 of 24 corpus listings carry this. Buyer segment: off-gridders, hunters, ATV/recreation buyers.
3. Larger than the Montello norm at a lower price band. Buyer segment: comparison shoppers filtering on acreage and per-acre price.
4. Low-friction owner financing ($350 down, $150/mo, no credit check). Buyer segment: first-time land buyers, distressed-credit buyers.
5. Off-grid weekend / RV-base lifestyle with BLM step-off. Buyer segment: remote-work weekenders, retirees, secondary-property buyers.

## Variants
| Platform | Headline chars | Description chars |
|---|---|---|
| landmodo | 55/60 | 1391/1500 |
| land_century | 94/100 | 1447/1500 |
| landflip | 97/100 | 1424/1500 |
| land_com | 97/100 | 1366/1500 |
| land_listings | 96/100 | 1354/1500 |
| landhub | 99/100 | 1371/1500 |

Each headline uses a different standout angle (per the Step 3 assignment in `notes.md`) so a buyer scanning the same property across these 6 sites sees a different reason to click each time.

## Operator-flagged data issues
1. Metadata `platforms` array is stale (still shows the old 8-platform list). All 6 variants generated against the new rotation in `config/ad-platforms.json`. Please update the metadata field to match.
2. Metadata `location` says "Elko County, Utah" but Elko County only exists in Nevada. All headlines use "Elko County" alone; descriptions reference northeastern Nevada per voice samples and corpus.
3. Metadata `utilities` is `["power"]` but the prior revision's claudeNotes confirms the operator corrected to no-power. Treated as fully off-grid in all variants.
4. Recommended metadata additions for future runs: APN, parcel-specific elevation, confirmed Pilot Peak viewshed, parcel-specific annual tax, confirmed survey status, and an explicit county-confirmed permitted-use determination for OS-Open Space.

Full headline-craft check table, anti-slop log, voice pass, and step-by-step ranking lives in `workers/workspace/notes/task-1779308355008-lg0z6q.md`.
