# Field mapping — ID import CSV

Phase A output. Derived from `operator-input/seller-submissions/id-import-sample.csv`
(the operator's export from ID's import screen: 176 columns, header + one
populated record, property id 7979).

## Template facts

- **176 columns**, header and data row both 176 wide.
- `tag_ids` appears **twice** — at index 75 (property block) and index 172
  (owner/derived block, adjacent to `tags`). Both empty in the sample.
- The sample's populated record is an AZ / Pinal land parcel, so it is a good
  structural match for all 35 of ours.

## Resolved values

| Column | Value for all 35 rows | Evidence |
|---|---|---|
| `p_type` | `Land` | sample idx 3 |
| `p_status` | `6` | sample idx 4 |
| `p_status_name` | `Pending Preliminary Research` | sample idx 173 — **pairs with `p_status=6`** |
| `p_state` | `AZ` | sample idx 6 |
| `p_county` | `<COUNTY> COUNTY`, uppercase | sample idx 7 = `PINAL COUNTY` |
| `p_apn` | per parcel | sample idx 8 |
| `p_legal_description` | per parcel, as-given | idx 27 |
| `p_address` | per parcel situs, as-given | idx 34 |
| `p_city` | empty — no city given in submission | idx 35 |
| `p_comments` | parcel note only (acreage remark / package note) | idx 26 |

### The `p_status` question is settled

The plan flagged that no numeric `p_status` enum was known beyond
`1 = Prospect`, and proposed a best-effort live sweep of the `status=<n>` get
filter to infer "Pending Preliminary Research". **That sweep is unnecessary.**
The sample record carries `p_status = 6` and `p_status_name = "Pending
Preliminary Research"` on the same row, which pairs the code to the label
directly. Recorded here for the future API path.

### There is no deal-flow column

All 176 headers were checked for any deal / flow / pipeline / campaign concept.
The only status-like or type-like columns are:

`p_type`, `p_status`, `p_status_name`, `p_listing_status`,
`p_status_create_time`, `p_status_last_updated`, `p_closing_type`,
`p_closing_type_sale`, `p_property_type`, `o_type`

None of these is a deal flow. `p_type` holds `Land`; `p_listing_status` is empty
in the sample and governs public listing state, not pipeline.

**Consequence:** "LPG Blind Offer" **cannot be set via this CSV.** It is an
operator action in the ID UI after upload. This resolves the plan's central
unresolved conflict — the template decided, and the answer is "no such column."

## Owner / requestor block (constant across all 35 rows)

| Column | Value | Note |
|---|---|---|
| `o_type` | `Individual` | sample idx 142 |
| `or_fname` | `Glenn` | |
| `or_lname` | `Rink` | middle initial `R` from "Glenn R Rink" is **not** carried into the name columns — it is preserved in the requestor tag and the README |
| `or_email` | `faroutbotany@gmail.com` | |
| `or_greeting` | `Dear Glenn,` | sample pattern `Dear <first>,` |
| `or_phone`, `m_address`, `m_address2`, `m_city`, `m_state`, `m_zip` | empty | **no phone or mailing address anywhere in the submission** |

## Fields deliberately left empty

`p_acres`, `p_sqft` — the seller's "just shy of 40 acres" (Apache 202-04-006)
and "about 10 acres" (Mohave 353-17-068) are **approximations in prose**, not
assessor figures. Per the as-given-only decision they go to `p_comments` and
**no numeric acreage is written**. The sample writes `0.0` in these columns; we
leave them empty rather than assert a false zero. Flagged in the README.

`p_price`, `p_est_value`, `p_improvements`, `p_power`, `p_access`, `p_owned`,
`p_aquired`, `p_boundaries`, `p_latitude`/`p_longitude`, and every closing /
listing / loan / structure column — no source data. Left empty.

`p_id`, `or_id` — left empty; these are ID-assigned primary keys. Supplying the
sample's `7979` / `6901` would collide with existing records.

## Tags — RESOLVED: ship empty, apply in the UI

Researched against the API reference, `id_client.py`, and a read-only live
probe of real records. Findings:

- **Format CONFIRMED.** `tag_ids` is a **comma-delimited list of numeric ids,
  wrapped in a leading and trailing comma**. Verbatim from live records:
  `,22,12,` · `,22,` · `,16,17,` · `,17,16,12,`. Not JSON, not semicolon, not
  pipe. Order is not normalized. This matches the link-list convention the API
  already uses elsewhere — `~/claude/followupdominator/app/id_client.py:39-48`
  (`parse_link_list`) and `api_reference_investment_dominator.md:32`.
- **ids only.** The read side has **no tag-name field at all**: a property row
  returns 121 fields and exactly one contains "tag" — `tag_ids`. So the `tags`
  column has no read-side counterpart and its accepted format is undetermined.
- **No tag-listing endpoint.** `tag_get.php` and `tags_get.php` both 404. Tag
  names cannot be enumerated through the API; only the UI can show them.
- **The account uses only four tag ids** — `12`, `16`, `17`, `22` — and they map
  to acquisition batches (22 = Crook County OR; 16+17 = Hawaii County HI; 12
  spans all geographies and concentrates on `Mailed Letter 1` / `Blind Offers
  Sent`, reading as a mailing/campaign tag).

**Decision: all three tag columns ship empty.** All four tags we want are
**new**, the field is id-based, and there are no ids to write — the account
contains no tag matching any of them. There is no evidence the importer can
mint tags from names, no endpoint to create them, and the duplicate `tag_ids`
header makes it unknowable which column an importer would read. Guessing here
either writes garbage ids onto 35 production records or silently drops the tags.
Applying four tags in the UI is one bulk action.

### If tags must go through the CSV instead

A safe, reads-only path exists:

1. In the ID UI, create the four tags and apply all four to **one** existing or
   throwaway record.
2. Read that record back with `property_get.php?id=<that record>` and look at
   `tag_ids` — this is the only way to discover the new numeric ids without a
   listing endpoint.
3. Write those ids into **column 75 only**, formatted exactly like live data —
   leading and trailing commas, e.g. `,101,102,103,` for the 30 non-package rows
   and `,101,102,103,104,` for the five package rows.
4. Leave columns 171 (`tags`) and 172 (`tag_ids`) empty. Consider deleting
   columns 171–175 from the upload entirely — they are the derived/export block
   (`p_status_name`, `p_all_comments`, `or_greeting` are plainly not import
   inputs), and dropping 172 also removes the duplicate-header ambiguity.
5. Import one row, read it back, confirm `tag_ids` came through, then load the
   other 34.

**Note on the shipped file:** `import.csv` keeps all 176 columns so its header
matches the sample byte-for-byte. Because every tag column is empty, the
duplicate-`tag_ids` ambiguity is harmless as shipped — it only becomes a hazard
if you populate them.
