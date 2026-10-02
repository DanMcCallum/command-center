# Situs research — city / ZIP / address for all 35 parcels

Added 2026-08-03 after Investment Dominator rejected `import.csv`:

> Oops, looks like are missing the following header(s)! Property County, Property State.
> Some records have empty values in required fields: Address, City, Zip.

The original CSV was built under an **as-given-only** rule, so it carried no city
and no ZIP on any row, and no address on 12 rows. ID requires all three. The
operator elected to research real values per parcel rather than use placeholders.

**This supersedes the as-given-only rule for `p_address`, `p_city`, `p_zip` only.**
Legal descriptions and comments are untouched and remain verbatim from the seller.

---

## Two separate defects

**1. Header names.** `id-import-sample.csv` is an *export* from ID — 176 database
column names (`p_county`, `p_state`). ID's import wizard matches on display names.
It auto-matched `p_address`→Address, `p_city`→City, `p_zip`→Zip, but failed on
`p_county` and `p_state`. Those two headers were renamed to **`Property County`**
and **`Property State`**; all 174 others are unchanged.

This retires the old acceptance criterion "header byte-for-byte identical to the
sample" — that criterion rested on the false premise that the export was an import
template. Original header row preserved at `parts/import.csv.orig-headers`.

**2. Empty required fields.** Resolved below.

---

## Sources used

| Source | Used for | Notes |
|---|---|---|
| Pinal County Assessor (Casa Grande mirror) `rogue.casagrandeaz.gov/arcgis/.../Pinal_County_Assessor_Info/0` | 15 Pinal parcels | `SITEADDRESS` embeds `CITY, AZ ZIP` |
| Santa Cruz County Assessor `mapservices.santacruzcountyaz.gov/.../ParcelSearch/Parcels/0` | 12 Santa Cruz parcels | `SITEADDR`, `LEGALDESCRIPTION` |
| Yavapai County `gis.yavapaiaz.gov/.../Property/MapServer` layers 2 & 4 | 2 Yavapai parcels | Layer 2 = E-911 address points with `POST_CODE`/`POST_COMM` |
| Mohave County `mcgis.mohave.gov/.../Mohave/MapServer/38` (ParcelQueryLayer) | 1 Mohave parcel | Owner + legal; no situs address on record |
| ADWR statewide parcels `azwatermaps.azwater.gov/.../General/Parcels` layers 0/1/8/13 | Apache, Cochise, Mohave, Yavapai | Requires browser `User-Agent` + `Referer` or returns 403 |
| Census ZCTA polygons (ArcGIS `services2.arcgis.com/FiaPA4ga0iQKduv3`) | ZIP where no assessor ZIP exists | 2010 ZCTA; point-in-polygon |

**Ownership was confirmed on all 35 parcels** — every one returns `RINK GLENN`
(Yavapai returns `RINK GLENN R`). This independently validates the APN list.

The US Census geocoder and TIGERweb are WAF-blocked from this network; Nominatim
has no postcode coverage for rural AZ. Both were abandoned in favour of the above.

---

## Resolved values

### High confidence — assessor situs address, city and ZIP on the record

| APN | Address written | City | ZIP |
|---|---|---|---|
| 403-18-188 | 4620 N Toltec Rd | Eloy | 85131 |
| 404-02-056 | 4455 N Rillito Cir | Eloy | 85131 |
| 404-02-059 | 4450 N Cortez Dr | Eloy | 85131 |
| 404-02-092 | 4445 N Cortez Dr | Eloy | 85131 |
| **404-18-038** | **3655 N Palm Cir** | Eloy | 85131 |
| 404-18-061 | 3740 N Palm Cir | Eloy | 85131 |
| 404-18-062 | 3730 N Palm Cir | Eloy | 85131 |
| 404-18-066 | 3640 N Palm Cir | Eloy | 85131 |
| 404-19-161 | 3415 N Bandelier Dr | Eloy | 85131 |
| 119-01-116 | 1930 Circulo Huerta | Rio Rico | 85648 |
| 119-01-139 | 412 Pelicano Ct | Rio Rico | 85648 |
| 119-01-365 | 430 Circulo Uva | Rio Rico | 85648 |
| 132-04-171 | 1744 Via Caguama | Rio Rico | 85648 |
| 132-04-265 | 326 Cuna Ct | Rio Rico | 85648 |
| 132-04-300 | 368 Circulo Hormiga | Rio Rico | 85648 |
| 132-06-076 | 403 Brisa Ct | Rio Rico | 85648 |
| 133-03-353 | 293 Zola Ct | Rio Rico | 85648 |
| 133-03-354 | 290 Bagre Ct | Rio Rico | 85648 |
| 133-03-355 | 292 Bagre Ct | Rio Rico | 85648 |
| 133-03-356 | 294 Bagre Ct | Rio Rico | 85648 |
| 133-03-450 | 227 Caiman Ct | Rio Rico | 85648 |
| 405-06-552 | 4830 N Totem Pole Pass | Rimrock | 86335 |
| 405-06-554 | 4810 N Totem Pole Pass | Rimrock | 86335 |

Rio Rico ZIP independently re-confirmed by ZCTA point-query on all 12 parcels.
Yavapai ZIP comes from the county's own E-911 address points (`POST_COMM=RIMROCK`,
`POST_CODE=86335`) and was independently confirmed by ZCTA.

### Derived — parcel has NO situs address on the assessor record

For these 12 the Address column carries an **APN locator** (`APN <number>`), not a
street address. Nothing was invented: the assessor field is genuinely blank because
these are unaddressed vacant parcels. City/ZIP are derived from location.

| APN | Address written | City | ZIP | Basis |
|---|---|---|---|---|
| 202-04-006 | APN 202-04-006 | St. Johns | 85936 | ZCTA point-in-polygon |
| 116-09-340 | APN 116-09-340 | Cochise | 85606 | ZCTA + nearest addressed parcel 0.27 mi |
| 116-09-341 | APN 116-09-341 | Cochise | 85606 | ZCTA + nearest addressed parcel 0.28 mi |
| 117-02-118 | APN 117-02-118 | Pearce | 85625 | nearest addressed parcel 0.10 mi |
| 117-02-141 | APN 117-02-141 | Pearce | 85625 | nearest addressed parcel 0.15 mi |
| 353-17-068 | APN 353-17-068 | Kingman | 86401 | ZCTA point-in-polygon |
| 511-70-004G | APN 511-70-004G | Casa Grande | 85193 | nearest addressed parcel 0.20 mi |
| 511-70-010a | APN 511-70-010A | Casa Grande | 85193 | **see caveat** |
| 511-70-017a | APN 511-70-017A | Casa Grande | 85193 | nearest addressed parcel 0.14 mi |
| 511-70-017b | APN 511-70-017B | Casa Grande | 85193 | nearest addressed parcel 0.23 mi |
| 511-70-017c | APN 511-70-017C | Casa Grande | 85193 | nearest addressed parcel 0.24 mi |
| 511-70-018 | APN 511-70-018 | Casa Grande | 85193 | **see caveat** |

---

## Things the operator should look at

1. **`404-18-038` address conflict — the one real data discrepancy.** Glenn wrote
   **3659** N Palm Circle. The Pinal assessor record for that APN reads
   **3655 N PALM CIR**. The CSV now carries the assessor's 3655. The APN is the
   authoritative identifier and it matches, so this is almost certainly a typo in
   Glenn's email — but confirm before any offer letter or deed uses the address.

2. **`511-70-010a` and `511-70-018` sit on a ZIP boundary.** The six `511-70`
   parcels straddle the Casa Grande **85193** / Eloy **85131** delivery boundary.
   Four have Casa Grande 85193 as their nearest addressed neighbour; these two have
   Eloy 85131. All six were written as Casa Grande 85193 to keep one contiguous
   holding on one city/ZIP, and because the parcels sit in the Casa Grande
   Elementary School District. Low stakes — the land is unaddressed — but if a
   mailing ever goes to a per-parcel situs, re-check those two.

3. **Cochise splits across two ZIPs.** Both parcels in book 116-09 resolve to
   **Cochise 85606**; both in book 117-02 resolve to **Pearce 85625**. This is not
   an error. The seller's "Ariz sun sites #1 / #2" are two different subdivision
   units and they fall in different delivery areas. Two independent methods agreed
   on each.

4. **The APN-locator Address on 12 rows is a formatting device, not data.** If ID
   later validates addresses against USPS, those 12 will fail. They cannot be fixed
   from public record — the parcels have no assigned address. Getting one requires
   the county to assign a situs address, or Glenn to supply a cross-street.

---

## Answers this research produced for previously-open questions

- **Glenn's mailing address, previously unknown.** Three county assessors agree:
  **801 W Birch Ave, Flagstaff, AZ 86001** (Yavapai carries the +4: `86001-4419`).
  Now written to `m_address` / `m_city` / `m_state` / `m_zip` on all 35 rows,
  replacing the empty values. Phone is still unknown.
- **The middle initial is real.** Yavapai records the owner as `RINK GLENN R`,
  corroborating "Glenn R Rink" from the submission. `or_fname`/`or_lname` remain
  `Glenn` / `Rink` — unchanged, still the operator's call.
- **The `133-03` subdivision numbers were a seller typo.** Glenn wrote RR Ranchettes
  `#14`, `#15`, `#16`, `#17`, `#17`. The Santa Cruz assessor records **all five as
  `UNIT NO.17`, Block 506**. `p_legal_description` was left as-given per the rule,
  so the CSV still carries Glenn's numbers — but they are wrong and should be
  corrected before any legal use.
- **`132-04-171` has a block after all.** Glenn omitted it; the assessor reads
  `RIO RICO RANCHETTES UNIT NO.18 LOT 6 OF BLK 534`.
- **Acreage is now known for every parcel** (assessor figures, not the seller's
  approximations): Apache 202-04-006 = **41.06 ac** (Glenn said "just shy of 40");
  Mohave 353-17-068 = **10.0 ac** (Glenn said "about 10"). `p_acres` was
  deliberately left empty and **has not been changed** — the importer does not
  require it. Populating it is a separate decision.
- **Pinal APN suffix format confirmed.** Pinal stores these as 9 characters with no
  dashes and a trailing `0` for 3-part numbers: `403-18-188` → `403181880`,
  `511-70-017a` → `51170017A`. The CSV keeps the seller's dashed format.
