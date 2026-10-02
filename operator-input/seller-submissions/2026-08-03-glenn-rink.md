# Seller submission — Glenn R Rink — 2026-08-03

**Source:** website contact-form submission, https://www.aloha-seller.com
**From:** Glenn R Rink (faroutbotany@gmail.com)
**Message Type:** contact
**Leadsource:** Website-Contact Us Page
**Parcels:** 35 across 6 Arizona counties

This file is the single source of truth for the import. Every subagent reads it
verbatim. Do not paraphrase, normalize, or "correct" anything below — the
verification pass diffs against it.

---

## 1. Raw submission (verbatim)

> Hi Daniel McCallum
>
> You have a new contact message from your domain https://www.aloha-seller.com
>
> From: Glenn R Rink (faroutbotany@gmail.com)
>
> Comment: Here are my properties for sale. I'd like to turn all of these properties into cash, so I can turn that cash into income producing property or other investments. County APN address/legal address Apache 202-04-006 just shy of 40 acres Cochise 116-09-340 Ariz sun sites #1, Lot 4 Block 151 Cochise 116-09-341 Ariz sun sites #1, Lot 5 Block 151 Cochise 117-02-118 Ariz sun sites #2, Lot 10 Block 200 Cochise 117-02-141 Ariz sun sites #2, Lot 1 Block 202 Mohave 353-17-068 about 10 acres Pinal 403-18-188 4620 N. Toltec Pinal 404-02-056 4455 N Rillito Pinal 404-02-059 4450 N Cortez Pinal 404-02-092 4445 N Cortez Pinal 404-18-038 3659 N Palm Circle Pinal 404-18-061 3740 N Palm Circle Pinal 404-18-062 3730 N Palm Circle Pinal 404-18-066 3640 N Palm Circle Pinal 404-19-161 3415 N. Bandelier Pinal 511-70-004G Pinal 511-70-010a these 5 to be sold in one sale Pinal 511-70-017a these 5 to be sold in one sale Pinal 511-70-017b these 5 to be sold in one sale Pinal 511-70-017c these 5 to be sold in one sale Pinal 511-70-018 these 5 to be sold in one sale Santa Cruz 119-01-116 Lot 46, Blk 312 RR Villas #10 1930 Circulo Huerta Santa Cruz 119-01-139 Lot 69, blk 312 RR villas #10 412 Pelicano Ct Santa Cruz 119-01-365 Lot 20, Blk 333, RR Villas #10 430 Circulo Uva Santa Cruz 132-04-171 Lot 6, RR Ranchette #18 1744 Via Caguama Santa Cruz 132-04-265 Lot 20, Blk 536, RR Ranchettes #18 326 Cuna Ct Santa Cruz 132-04-300 Lot 10, Blk 537 RR Ranchettes #18 368 Circulo Hormiga Santa Cruz 132-06-076 Lot 8, blk 544 RR Ranchettes #18 403 Brisa Ct Santa Cruz 133-03-353 Lot 71, Blk 506, RR Ranchettes #14 293 Zola Ct Santa Cruz 133-03-354 Lot 72, Blk 506, RR Ranchettes #15 290 Bagre Ct Santa Cruz 133-03-355 Lot 73, Blk 506, RR Ranchettes #16 292 Bagre Ct Santa Cruz 133-03-356 Lot 74, Blk 506, RR Ranchettes #17 294 Bagre Ct Santa Cruz 133-03-450 Lot 168, Blk 506 RR Ranchettes #17 227 Caiman Ct Yavapai 405-06-552 4830 N Totem Pole Pass Yavapai 405-06-554 4810 N Totem Pole Pass I'll entertain any offers that are signed and dated. When making your offer, consider that your offer will be my net (ie, you will pay closing costs; taxes prorated), you will receive a Special Warranty Deed or equivalent, you will deposit a 10% (or more) non-refundable EMD at escrow opening (refundable if I am unable to provide marketable title), and closing will happen within 2-3 weeks after escrow opening. Please do your due diligence prior to making your offer. Let me know if you have any questions. Thanks again for your interest. I hope we can do business that we both benefit from. Best wishes,
>
> Message Type: contact
>
> Leadsource: Website-Contact Us Page

---

## 2. Seller terms (submission-level, NOT per parcel)

Captured once. Per the plan these do **not** go into each parcel's
`p_comments` — they belong to the submission record.

- Offers must be **signed and dated**.
- Offer price is **net to seller** — buyer pays closing costs; taxes prorated.
- Buyer receives a **Special Warranty Deed or equivalent**.
- **10% (or more) non-refundable EMD** at escrow opening — refundable only if
  seller cannot provide marketable title.
- Closing within **2–3 weeks** after escrow opening.
- Buyer to do due diligence prior to offering.
- Seller's stated motivation: convert all properties to cash, to redeploy into
  income-producing property or other investments.

---

## 3. Normalized parcel table (35 rows)

Column split rule applied below: the email's single `address/legal address`
column mixes two things. Where the text describes a **subdivision/lot/block**,
it is a legal description. Where it is a **street address**, it is a situs
address. Santa Cruz rows carry **both**, concatenated in the email with no
delimiter — the split point is the start of the street number that follows the
subdivision number.

Acreage remarks (Apache, Mohave) are seller commentary, **not** a legal
description — they go to `p_comments`, and no acreage is written to `p_acres`
(as-given only; no assessor lookups, no inference).

Transcription is **verbatim**, including the seller's inconsistent casing
(`blk` vs `Blk`, `villas` vs `Villas`), the singular `Ranchette` on 132-04-171,
the mixed-case APN suffixes (`004G` uppercase, `010a`/`017a`/`017b`/`017c`
lowercase), and the `#14/#15/#16/#17` sequence on the 133-03 block. None of
these are corrected here. See §4.

| # | County | APN | Legal description (as given) | Situs address (as given) | Parcel note | Package |
|---|---|---|---|---|---|---|
| 1 | Apache | 202-04-006 | | | just shy of 40 acres | |
| 2 | Cochise | 116-09-340 | Ariz sun sites #1, Lot 4 Block 151 | | | |
| 3 | Cochise | 116-09-341 | Ariz sun sites #1, Lot 5 Block 151 | | | |
| 4 | Cochise | 117-02-118 | Ariz sun sites #2, Lot 10 Block 200 | | | |
| 5 | Cochise | 117-02-141 | Ariz sun sites #2, Lot 1 Block 202 | | | |
| 6 | Mohave | 353-17-068 | | | about 10 acres | |
| 7 | Pinal | 403-18-188 | | 4620 N. Toltec | | |
| 8 | Pinal | 404-02-056 | | 4455 N Rillito | | |
| 9 | Pinal | 404-02-059 | | 4450 N Cortez | | |
| 10 | Pinal | 404-02-092 | | 4445 N Cortez | | |
| 11 | Pinal | 404-18-038 | | 3659 N Palm Circle | | |
| 12 | Pinal | 404-18-061 | | 3740 N Palm Circle | | |
| 13 | Pinal | 404-18-062 | | 3730 N Palm Circle | | |
| 14 | Pinal | 404-18-066 | | 3640 N Palm Circle | | |
| 15 | Pinal | 404-19-161 | | 3415 N. Bandelier | | |
| 16 | Pinal | 511-70-004G | | | *(no annotation in email)* | **NO** |
| 17 | Pinal | 511-70-010a | | | these 5 to be sold in one sale | YES |
| 18 | Pinal | 511-70-017a | | | these 5 to be sold in one sale | YES |
| 19 | Pinal | 511-70-017b | | | these 5 to be sold in one sale | YES |
| 20 | Pinal | 511-70-017c | | | these 5 to be sold in one sale | YES |
| 21 | Pinal | 511-70-018 | | | these 5 to be sold in one sale | YES |
| 22 | Santa Cruz | 119-01-116 | Lot 46, Blk 312 RR Villas #10 | 1930 Circulo Huerta | | |
| 23 | Santa Cruz | 119-01-139 | Lot 69, blk 312 RR villas #10 | 412 Pelicano Ct | | |
| 24 | Santa Cruz | 119-01-365 | Lot 20, Blk 333, RR Villas #10 | 430 Circulo Uva | | |
| 25 | Santa Cruz | 132-04-171 | Lot 6, RR Ranchette #18 | 1744 Via Caguama | | |
| 26 | Santa Cruz | 132-04-265 | Lot 20, Blk 536, RR Ranchettes #18 | 326 Cuna Ct | | |
| 27 | Santa Cruz | 132-04-300 | Lot 10, Blk 537 RR Ranchettes #18 | 368 Circulo Hormiga | | |
| 28 | Santa Cruz | 132-06-076 | Lot 8, blk 544 RR Ranchettes #18 | 403 Brisa Ct | | |
| 29 | Santa Cruz | 133-03-353 | Lot 71, Blk 506, RR Ranchettes #14 | 293 Zola Ct | | |
| 30 | Santa Cruz | 133-03-354 | Lot 72, Blk 506, RR Ranchettes #15 | 290 Bagre Ct | | |
| 31 | Santa Cruz | 133-03-355 | Lot 73, Blk 506, RR Ranchettes #16 | 292 Bagre Ct | | |
| 32 | Santa Cruz | 133-03-356 | Lot 74, Blk 506, RR Ranchettes #17 | 294 Bagre Ct | | |
| 33 | Santa Cruz | 133-03-450 | Lot 168, Blk 506 RR Ranchettes #17 | 227 Caiman Ct | | |
| 34 | Yavapai | 405-06-552 | | 4830 N Totem Pole Pass | | |
| 35 | Yavapai | 405-06-554 | | 4810 N Totem Pole Pass | | |

Counts: Apache 1, Cochise 4, Mohave 1, Pinal 15, Santa Cruz 12, Yavapai 2 = **35**.

---

## 4. Open questions for the operator (do NOT silently resolve)

1. **`511-70-004G` is unpackaged.** The seller wrote "these 5 to be sold in one
   sale" against exactly five APNs (`-010a`, `-017a`, `-017b`, `-017c`, `-018`).
   `-004G` is a sixth parcel in the same `511-70` series but carries no
   annotation. Per operator decision it stays standalone and un-packaged.
   **Confirm with Glenn.**
2. **`133-03` subdivision numbers look inconsistent.** Within the same
   `Blk 506`, the seller wrote RR Ranchettes `#14` (‑353), `#15` (‑354), `#16`
   (‑355), `#17` (‑356), and `#17` again (‑450). A single block spanning four
   different subdivision unit numbers is unusual and may be a seller typo.
   Transcribed **as given**; not corrected. Confirm before any offer letter uses
   these legals.
3. **`132-04-171` says "Ranchette" (singular)** and omits a block, unlike every
   other 132-xx row. As given.
4. **No mailing address or phone** for Glenn anywhere in the submission — only
   the email address. `or_phone`, `m_address`, `m_city`, `m_state`, `m_zip` will
   be empty.
5. **Apache and Mohave have no legal or situs data at all** — only the seller's
   approximate acreage. Both rows will be APN-only.
