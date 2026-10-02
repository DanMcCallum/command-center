# Reconciliation — Glenn R Rink 35-parcel API load

Read back live from `property_get.php` with `oid=6240` after the load.
All 35 CSV rows are present exactly once. Verified, not assumed.

| # | APN | property_id | owner_id | County | City | ZIP | Address | Status |
|---|-----|-------------|----------|--------|------|-----|---------|--------|
| 1 | 202-04-006 | 8481 | 6240 | Apache | St. Johns | 85936 | APN 202-04-006 | Pending Preliminary Research |
| 2 | 116-09-340 | 8482 | 6240 | Cochise | Cochise | 85606 | APN 116-09-340 | Pending Preliminary Research |
| 3 | 116-09-341 | 8483 | 6240 | Cochise | Cochise | 85606 | APN 116-09-341 | Pending Preliminary Research |
| 4 | 117-02-118 | 8484 | 6240 | Cochise | Pearce | 85625 | APN 117-02-118 | Pending Preliminary Research |
| 5 | 117-02-141 | 8485 | 6240 | Cochise | Pearce | 85625 | APN 117-02-141 | Pending Preliminary Research |
| 6 | 353-17-068 | 8486 | 6240 | Mohave | Kingman | 86401 | APN 353-17-068 | Pending Preliminary Research |
| 7 | 403-18-188 | 8480 | 6240 | Pinal | Eloy | 85131 | 4620 N Toltec Rd | Pending Preliminary Research |
| 8 | 404-02-056 | 8487 | 6240 | Pinal | Eloy | 85131 | 4455 N Rillito Cir | Pending Preliminary Research |
| 9 | 404-02-059 | 8488 | 6240 | Pinal | Eloy | 85131 | 4450 N Cortez Dr | Pending Preliminary Research |
| 10 | 404-02-092 | 8489 | 6240 | Pinal | Eloy | 85131 | 4445 N Cortez Dr | Pending Preliminary Research |
| 11 | 404-18-038 | 8490 | 6240 | Pinal | Eloy | 85131 | 3655 N Palm Cir | Pending Preliminary Research |
| 12 | 404-18-061 | 8491 | 6240 | Pinal | Eloy | 85131 | 3740 N Palm Cir | Pending Preliminary Research |
| 13 | 404-18-062 | 8492 | 6240 | Pinal | Eloy | 85131 | 3730 N Palm Cir | Pending Preliminary Research |
| 14 | 404-18-066 | 8493 | 6240 | Pinal | Eloy | 85131 | 3640 N Palm Cir | Pending Preliminary Research |
| 15 | 404-19-161 | 8494 | 6240 | Pinal | Eloy | 85131 | 3415 N Bandelier Dr | Pending Preliminary Research |
| 16 | 511-70-004G | 8495 | 6240 | Pinal | Casa Grande | 85193 | APN 511-70-004G | Pending Preliminary Research |
| 17 | 511-70-010A | 8496 | 6240 | Pinal | Casa Grande | 85193 | APN 511-70-010A | Pending Preliminary Research |
| 18 | 511-70-017A | 8497 | 6240 | Pinal | Casa Grande | 85193 | APN 511-70-017A | Pending Preliminary Research |
| 19 | 511-70-017B | 8498 | 6240 | Pinal | Casa Grande | 85193 | APN 511-70-017B | Pending Preliminary Research |
| 20 | 511-70-017C | 8499 | 6240 | Pinal | Casa Grande | 85193 | APN 511-70-017C | Pending Preliminary Research |
| 21 | 511-70-018 | 8500 | 6240 | Pinal | Casa Grande | 85193 | APN 511-70-018 | Pending Preliminary Research |
| 22 | 119-01-116 | 8501 | 6240 | Santa Cruz | Rio Rico | 85648 | 1930 Circulo Huerta | Pending Preliminary Research |
| 23 | 119-01-139 | 8502 | 6240 | Santa Cruz | Rio Rico | 85648 | 412 Pelicano Ct | Pending Preliminary Research |
| 24 | 119-01-365 | 8503 | 6240 | Santa Cruz | Rio Rico | 85648 | 430 Circulo Uva | Pending Preliminary Research |
| 25 | 132-04-171 | 8504 | 6240 | Santa Cruz | Rio Rico | 85648 | 1744 Via Caguama | Pending Preliminary Research |
| 26 | 132-04-265 | 8505 | 6240 | Santa Cruz | Rio Rico | 85648 | 326 Cuna Ct | Pending Preliminary Research |
| 27 | 132-04-300 | 8506 | 6240 | Santa Cruz | Rio Rico | 85648 | 368 Circulo Hormiga | Pending Preliminary Research |
| 28 | 132-06-076 | 8507 | 6240 | Santa Cruz | Rio Rico | 85648 | 403 Brisa Ct | Pending Preliminary Research |
| 29 | 133-03-353 | 8508 | 6240 | Santa Cruz | Rio Rico | 85648 | 293 Zola Ct | Pending Preliminary Research |
| 30 | 133-03-354 | 8509 | 6240 | Santa Cruz | Rio Rico | 85648 | 290 Bagre Ct | Pending Preliminary Research |
| 31 | 133-03-355 | 8510 | 6240 | Santa Cruz | Rio Rico | 85648 | 292 Bagre Ct | Pending Preliminary Research |
| 32 | 133-03-356 | 8511 | 6240 | Santa Cruz | Rio Rico | 85648 | 294 Bagre Ct | Pending Preliminary Research |
| 33 | 133-03-450 | 8512 | 6240 | Santa Cruz | Rio Rico | 85648 | 227 Caiman Ct | Pending Preliminary Research |
| 34 | 405-06-552 | 8513 | 6240 | Yavapai | Rimrock | 86335 | 4830 N Totem Pole Pass | Pending Preliminary Research |
| 35 | 405-06-554 | 8514 | 6240 | Yavapai | Rimrock | 86335 | 4810 N Totem Pole Pass | Pending Preliminary Research |

## Pre-existing record under the same owner (not part of this load)

| APN | property_id | owner_id | County | City | Status |
|---|---|---|---|---|---|
| 404-08-0130 | 7237 | 6240 | Pinal | Eloy | Mailed Letter 1 |

## Totals

- CSV rows: 35
- Records created: 35 (property_id **8480–8514**, contiguous, no gaps)
- Duplicate APNs: **none** (every APN appears exactly once)
- Missing APNs: **none**
- All 35 carry `owner_id` **6240** — attached to Glenn's existing owner, no duplicate owner created
- All 35 status: **Pending Preliminary Research**; all 35 type: **Land**
- Field mismatches vs CSV across 17 checked fields x 35 records: **0**

County breakdown (matches the brief's expected split):

| County | Records | Expected |
|---|---|---|
| Apache | 1 | 1 — OK |
| Cochise | 4 | 4 — OK |
| Mohave | 1 | 1 — OK |
| Pinal | 15 | 15 — OK |
| Santa Cruz | 12 | 12 — OK |
| Yavapai | 2 | 2 — OK |
