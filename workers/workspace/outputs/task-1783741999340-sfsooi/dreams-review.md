# DREAMS review

Cycles used: 3/3

Three 2026-09-08 revisions (zoning corrected to NZ, the measured lot dimensions 101' x 52', then
the $17.47 annual property taxes) each changed all six variants, so all six were audited over a
fresh 3-cycle loop after each. The five land variants are all-Pass and were left untouched once
they got there. `ebay` ran all three cycles each time and holds the same single unresolved
category, though the taxes narrowed it.

| Platform | D | R | E | A | M | S |
|---|---|---|---|---|---|---|
| landmodo | Pass | Pass | Pass | Pass | Pass | Pass |
| land_century | Pass | Pass | Pass | Pass | Pass | Pass |
| landflip | Pass | Pass | Pass | Pass | Pass | Pass |
| land_com | Pass | Pass | Pass | Pass | Pass | Pass |
| landhub | Pass | Pass | Pass | Pass | Pass | Pass |
| ebay | Pass | Pass | Weak | Pass | Pass | Pass |

## Unresolved weaknesses

- **ebay, E (Eliminate Objections)**: six of the seven objections the rubric names are now
  answered. The $17.47 annual tax figure closed the affordability-of-ownership gap, which the
  rubric lists among its strongest reassurances, and the warranty deed covers title. Two remain
  and neither can be written around: the metadata carries no legal-access status, so "what if
  it's landlocked" goes unanswered, and it carries no GPS coordinates or APN, so "how do I find
  it" has no answer and the rubric's strongest reassurance for this category, coordinates the
  buyer can go stand on, cannot be offered.

  Note the tax **amount** arrived but the tax **status** did not. Whether the taxes are paid
  current and lien-free is a separate per-property fact that `seller-terms.md` expects in
  `must_include`, and it is what would unlock the `TAXES ARE PAID CURRENT` line in block F.
  Adding those facts to the task fixes this; rewriting the copy cannot.

  Note that the new no-phone-number rule narrows this category further: a buyer who wants to
  talk to a person now has eBay messages only. That is eBay policy and not a defect, but it
  makes the missing coordinates and access facts carry more weight than they did before.
