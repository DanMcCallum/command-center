# Glenn R Rink — 35 parcels loaded into Investment Dominator via the API

**Status: DONE.** All 35 property records exist in Daniel's ID account and read
back cleanly through `property_get.php`. The broken UI import wizard was
bypassed entirely.

| | |
|---|---|
| Records created | **35** |
| `property_id` range | **8480 – 8514** (contiguous, no gaps) |
| Owner they hang off | **6240** (Glenn Rink) — existing owner, **no duplicate created** |
| Status | Pending Preliminary Research (internal id 6) |
| Type | Land |
| Duplicates | none — every APN appears exactly once |
| Failed posts | 0 |
| Date | 2026-08-03 |

Source: `operator-input/seller-submissions/2026-08-03-glenn-rink-id-import.csv`
(35 rows × 176 cols; only 24 columns carried data).

## Files here

| File | What it is |
|---|---|
| `load_glenn_rink.py` | The loader. Idempotent — skips APNs already under owner 6240, so re-running creates nothing. Has `--dry-run`. |
| `field-map-post.md` | CSV → `property_post.php` field map, the status-enum table, and how each fact was established. |
| `reconciliation.md` | APN → property_id → owner_id → county/city/zip → status, all 35 rows, read back live. |
| `load-log.json` | Per-record payload sent + raw response. |
| `raw/post-<APN>.json` | Raw success echo for each of the 34 bulk posts. |
| `raw/before-oid6240.json` | Owner 6240's properties **before** the load (1 record: 7237). |
| `raw/before-newest.json` | Newest account ids before the load (max was 8479). |
| `raw/probe-403-18-188-post.json` | The single probe post. |
| `raw/probe-readback-oid6240.json` | Probe read-back that cleared the decision gate. |
| `raw/after-oid6240.json` | Owner 6240's properties **after** the load (36 records). |

## The two traps that would have corrupted this load

### 1. `p_status` uses a different enum on POST than in the export ⚠️

The CSV says `p_status=6` / `p_status_name=Pending Preliminary Research`, taken
straight from an ID export. **Posting `6` does not produce that status.** The
probe proved it: sending `6` stored internal id 11 =
**"Complete/ Ready To Sell"** — a live-listing status that would have shoved 35
raw seller leads into the ready-to-market bucket.

The correct POST value is **`3`**. Full mapping is in `field-map-post.md`; it
was derived by repeatedly updating the one probe record in place and reading
the name back, so no throwaway records were created.

Anyone reusing an ID export as an import payload needs to know this.

### 2. County is stored verbatim — ID does not normalise it

Property 7979 in this account literally stores `PINAL COUNTY` while 7237 stores
`Pinal`. Whatever you send is what you get. The CSV carries the shouty
`PINAL COUNTY` form, so the loader strips ` COUNTY` and title-cases, giving
`Pinal`, `Santa Cruz`, `Cochise`, `Apache`, `Mohave`, `Yavapai` — matching the
CRM's dominant convention and Glenn's own pre-existing record 7237.

## What was verified (not assumed)

Every one of these was checked against a live read-back:

- All 35 APNs present, each **exactly once** (no duplicates).
- All 35 have `owner_id=6240` — the probe's whole purpose was to prove
  `or_id` **attaches** rather than creating a 36th Glenn. Owner 6240 went
  1 property → 36; no new owner appeared.
- County / state / city / ZIP / address match the CSV on all 35.
- `property_type` = Land and `property_status` = Pending Preliminary Research
  on all 35.
- Legal description round-trips on the 16 rows that have one; comments on the
  3 rows that have one.
- Owner block (type, email, mailing address/city/state/ZIP) correct on all 35.
- **0 field mismatches** across 17 fields × 35 records.
- County split matches the brief exactly: Apache 1, Cochise 4, Mohave 1,
  Pinal 15, Santa Cruz 12, Yavapai 2.
- Nothing else in the account was touched: max property id was 8479 before and
  8514 after, and 8480–8514 are contiguous and all owner 6240 — so exactly 35
  records were created and nothing else was disturbed.
- The known corrupt ids (11, 2318, 7978) still return empty HTTP-200 bodies.
  They never interfered: all reads used the `oid=6240` filter, which never
  spans them, so no bisecting was needed.

## One side effect worth knowing about

The property and owner records share one owner row. Sending `or_email`
wrote `faroutbotany@gmail.com` onto **owner 6240**, which previously had no
email. Pre-existing property **7237** therefore now also shows that email.

This is a correct data improvement (it is Glenn's real address from the CSV),
and property 7237 itself was **not** modified — its `update_time`, status
(`Mailed Letter 1`), tags (`,23,5,`) and address are all unchanged. Flagging it
only because it is a write that touched a pre-existing record.

## Undocumented API behaviour discovered

- **`property_post.php` supports in-place UPDATE via `p_id`.** Not in the API
  reference. Posting with `p_id=<existing id>` updates that record instead of
  creating a duplicate (confirmed: owner 6240 stayed at 2 properties across
  ~10 update posts). Treat it as a **full replace** like the task table —
  always re-send the complete field set. This is the repair tool if any of the
  35 need correcting; there is still no delete endpoint.
- **Unknown fields are silently dropped, not rejected.** The post response
  echoes back only the fields it recognised. A deliberately fake
  `zzz_totally_bogus_field` was accepted and ignored. So the echo is a reliable
  way to test whether a field name is real.
- **The get-side `status=` filter is silently ignored** in this account —
  `status=0` through `25` all returned the same newest records. Do not use it
  to verify a status landed; read the record and check `property_status`.
- Required on create: `p_type`, `p_status`, `or_fname`, `or_lname`. Omitting
  any returns `Failed - Property type OR property status OR caller first name
  OR caller last name is missing and these are required to create a new record
  in the system.`

## Still to do in the UI (cannot be done through this API)

1. **Tags** — `tags` / `tag_ids` are **dropped** by `property_post.php`
   (verified). The 35 records currently have empty `tag_ids`. For reference,
   Glenn's existing property 7237 carries `,23,5,`. Tags must be applied in the
   UI, or via bulk-select on the property list.
2. **Deal flow** — the records sit at "Pending Preliminary Research" as
   intended. Moving them along the pipeline is a UI/workflow step.
3. **The 5-parcel Casa Grande package** — APNs `511-70-010A`, `511-70-017A`,
   `511-70-017B`, `511-70-017C`, `511-70-018` all carry the comment
   "these 5 to be sold in one sale". They are separate records; if they should
   be linked or grouped, that is a UI action.
4. **`p_property_type=LAND`, `m_recipient`, `or_greeting`** from the CSV were
   dropped by the API. `p_property_type` is redundant with `p_type=Land`;
   the other two have no get-side counterpart and appear to be
   export/mail-merge-only fields. If Daniel needs the greeting/recipient set,
   that is a UI edit on the owner record.
5. **Nothing needs re-importing.** The CSV and the UI import wizard can be
   retired for this batch.

## Re-running safely

`load_glenn_rink.py` reads the current APNs under owner 6240 first and skips
any that already exist, so re-running it is a no-op. That guard exists because
**ID has no property delete endpoint** — anything created is permanent.
