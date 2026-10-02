# Source parcels — 35 rows, verified

Generated from `parts/agent-*.json` (six independent transcription agents),
ordered as the parcels appear in the seller's email. Every row was checked by a
second agent that saw only the raw email and the emitted rows — never this table
and never another agent's slice. All six verification passes returned **clean**.

`Src` is the transcription agent that produced the row. Each row also carries a
`source_fragment` in `parts/agent-*.json` — the exact substring of the email it
derives from. Every fragment was asserted to occur exactly once in the raw text,
and together the 35 fragments tile the email's parcel list with nothing left
over and nothing duplicated.

| # | Src | County | APN | Legal description | Situs address | Comment | Pkg |
|---|---|---|---|---|---|---|---|
| 1 | 6 | APACHE COUNTY | `202-04-006` | — | — | just shy of 40 acres | — |
| 2 | 5 | COCHISE COUNTY | `116-09-340` | Ariz sun sites #1, Lot 4 Block 151 | — | — | — |
| 3 | 5 | COCHISE COUNTY | `116-09-341` | Ariz sun sites #1, Lot 5 Block 151 | — | — | — |
| 4 | 5 | COCHISE COUNTY | `117-02-118` | Ariz sun sites #2, Lot 10 Block 200 | — | — | — |
| 5 | 5 | COCHISE COUNTY | `117-02-141` | Ariz sun sites #2, Lot 1 Block 202 | — | — | — |
| 6 | 6 | MOHAVE COUNTY | `353-17-068` | — | — | about 10 acres | — |
| 7 | 1 | PINAL COUNTY | `403-18-188` | — | 4620 N. Toltec | — | — |
| 8 | 1 | PINAL COUNTY | `404-02-056` | — | 4455 N Rillito | — | — |
| 9 | 1 | PINAL COUNTY | `404-02-059` | — | 4450 N Cortez | — | — |
| 10 | 1 | PINAL COUNTY | `404-02-092` | — | 4445 N Cortez | — | — |
| 11 | 1 | PINAL COUNTY | `404-18-038` | — | 3659 N Palm Circle | — | — |
| 12 | 1 | PINAL COUNTY | `404-18-061` | — | 3740 N Palm Circle | — | — |
| 13 | 1 | PINAL COUNTY | `404-18-062` | — | 3730 N Palm Circle | — | — |
| 14 | 1 | PINAL COUNTY | `404-18-066` | — | 3640 N Palm Circle | — | — |
| 15 | 1 | PINAL COUNTY | `404-19-161` | — | 3415 N. Bandelier | — | — |
| 16 | 2 | PINAL COUNTY | `511-70-004G` | — | — | — | — |
| 17 | 2 | PINAL COUNTY | `511-70-010a` | — | — | these 5 to be sold in one sale | **YES** |
| 18 | 2 | PINAL COUNTY | `511-70-017a` | — | — | these 5 to be sold in one sale | **YES** |
| 19 | 2 | PINAL COUNTY | `511-70-017b` | — | — | these 5 to be sold in one sale | **YES** |
| 20 | 2 | PINAL COUNTY | `511-70-017c` | — | — | these 5 to be sold in one sale | **YES** |
| 21 | 2 | PINAL COUNTY | `511-70-018` | — | — | these 5 to be sold in one sale | **YES** |
| 22 | 3 | SANTA CRUZ COUNTY | `119-01-116` | Lot 46, Blk 312 RR Villas #10 | 1930 Circulo Huerta | — | — |
| 23 | 3 | SANTA CRUZ COUNTY | `119-01-139` | Lot 69, blk 312 RR villas #10 | 412 Pelicano Ct | — | — |
| 24 | 3 | SANTA CRUZ COUNTY | `119-01-365` | Lot 20, Blk 333, RR Villas #10 | 430 Circulo Uva | — | — |
| 25 | 3 | SANTA CRUZ COUNTY | `132-04-171` | Lot 6, RR Ranchette #18 | 1744 Via Caguama | — | — |
| 26 | 3 | SANTA CRUZ COUNTY | `132-04-265` | Lot 20, Blk 536, RR Ranchettes #18 | 326 Cuna Ct | — | — |
| 27 | 3 | SANTA CRUZ COUNTY | `132-04-300` | Lot 10, Blk 537 RR Ranchettes #18 | 368 Circulo Hormiga | — | — |
| 28 | 3 | SANTA CRUZ COUNTY | `132-06-076` | Lot 8, blk 544 RR Ranchettes #18 | 403 Brisa Ct | — | — |
| 29 | 4 | SANTA CRUZ COUNTY | `133-03-353` | Lot 71, Blk 506, RR Ranchettes #14 | 293 Zola Ct | — | — |
| 30 | 4 | SANTA CRUZ COUNTY | `133-03-354` | Lot 72, Blk 506, RR Ranchettes #15 | 290 Bagre Ct | — | — |
| 31 | 4 | SANTA CRUZ COUNTY | `133-03-355` | Lot 73, Blk 506, RR Ranchettes #16 | 292 Bagre Ct | — | — |
| 32 | 4 | SANTA CRUZ COUNTY | `133-03-356` | Lot 74, Blk 506, RR Ranchettes #17 | 294 Bagre Ct | — | — |
| 33 | 4 | SANTA CRUZ COUNTY | `133-03-450` | Lot 168, Blk 506 RR Ranchettes #17 | 227 Caiman Ct | — | — |
| 34 | 6 | YAVAPAI COUNTY | `405-06-552` | — | 4830 N Totem Pole Pass | — | — |
| 35 | 6 | YAVAPAI COUNTY | `405-06-554` | — | 4810 N Totem Pole Pass | — | — |

## Per-county counts

| County | Parcels |
|---|---|
| APACHE COUNTY | 1 |
| COCHISE COUNTY | 4 |
| MOHAVE COUNTY | 1 |
| PINAL COUNTY | 15 |
| SANTA CRUZ COUNTY | 12 |
| YAVAPAI COUNTY | 2 |
| **Total** | **35** |

## Verbatim quirks preserved (do not 'correct' these)

- `4620 N. Toltec` and `3415 N. Bandelier` carry a period after `N`; the other seven Pinal addresses do not.
- Palm Circle house numbers do not run monotonically with APN (`404-18-061` = 3740, `404-18-062` = 3730).
- APN letter suffixes are mixed case: `004G` uppercase, `010a`/`017a`/`017b`/`017c` lowercase.
- Santa Cruz casing is inconsistent: `Blk` vs `blk`, `Villas` vs `villas`, `Ranchettes` vs singular `Ranchette`.
- `132-04-171` has no block number at all — the only Santa Cruz row without one.
- Comma after the block number is present on some rows, absent on others (`133-03-450` omits it).
- Yavapai house numbers run descending (4830, 4810) while the APNs run ascending (552, 554). This looks like a transposition and is not one.
- `Ariz sun sites` is lowercase and abbreviated; Cochise uses the full word `Block` where Santa Cruz uses `Blk`/`blk`.
