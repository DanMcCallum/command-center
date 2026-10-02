# Existing records in Investment Dominator

**None of the 35 APNs already exist in the account. All 35 are new.**

No manual tagging of pre-existing records is required, and `import.csv`
therefore carries all 35 rows rather than a subset.

**Nothing was written to the CRM.** Only `property_get.php` was called.

## How this was established

One full read-only walk of the property table:

| | |
|---|---|
| Records walked | **8,472** |
| Id range covered | 1–8479 |
| Pagination | 85 pages × `range=100`, `sort=property_id&sortdir=ASC`, ~1s pacing |
| Matches against our 35 | **0** |
| Near-misses (edit distance ≤ 1) | **0** |
| Not found | **35 of 35** |

Accounting balances: 0 matched + 35 not found = 35.

Matching was case-insensitive and separator-insensitive, and the near-miss sweep
covered any single character substituted, inserted, or deleted.

## Coverage gaps — the one real blind spot

**Three corrupt records: ids 11, 2318, 7978.** These return an empty HTTP-200
body for both windowed *and* direct `id=` reads. The walk bisected around them
per `sync_job.py::_fetch_rows()`. **Their APNs are unknowable through the API**,
so in principle one of them could hold one of our parcels.

This is a pre-existing defect in the account, not something this job introduced,
and it is the only gap. Four other id gaps (12, 13, 1589, 7514) are genuine
deletions, each confirmed individually with a direct `id=` get returning "No
Record Found."

Practical risk: low. If a duplicate does surface after import, it will be one of
at most three records, and ID's own UI will show it.

## Two things to know before you load

### 1. The table was being written to during the walk

Property ids climbed 8414→8423 across three calls — roughly 5 records/sec being
appended, so something else was importing at the time. The walk used an
ascending sort by `property_id` so appends land past the cursor rather than
shifting offsets underneath it; a descending walk would have silently duplicated
and dropped rows. A post-walk delta pass found **0 records appended since** (max
id still 8479), so the snapshot is current.

**If another import is still running against this account, re-check before the
final load.**

### 2. A systematic APN format difference in the Pinal set

The CRM stores Pinal parcels with a **4-character final segment**
(`404-18-0330`, `404-02-180B`), while **30 of our 35** use a **3-character** one
(`404-18-038`).

The zero-padded readings of ours (`404-18-0380` and so on) were explicitly
covered by the edit-distance-1 sweep and are **also absent**, so this does not
change the "all 35 are new" conclusion. Our five letter-suffixed APNs (`004G`,
`010a`, `017a`, `017b`, `017c`) already follow the CRM's 4-character convention
and are equally absent.

It is worth deciding deliberately whether these 35 should be normalized to the
CRM's Pinal convention on import, or loaded exactly as the seller wrote them.
**They are currently loaded as the seller wrote them**, consistent with the
as-given-only rule. Normalizing would be a change to source data, so it is your
call, not the agent's.

## Book-map presence

Eight of our book-maps have **no CRM presence at all**: `116-09`, `117-02`,
`119-01`, `132-04`, `132-06`, `133-03`, `202-04`, `353-17`, `511-70`.

The remainder (`403-18`, `404-02`, `404-18`, `404-19`, `405-06`) each have 2–5
CRM rows. Those are **different parcels in the same book-map**, not duplicate
candidates — they are listed under `sameBookMapNeighbors` in
`parts/existing-apns.json` if you want to eyeball them.
