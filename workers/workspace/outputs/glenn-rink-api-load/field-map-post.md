# CSV → `property_post.php` field map

Source CSV: `operator-input/seller-submissions/2026-08-03-glenn-rink-id-import.csv`
(35 rows × 176 columns; header = ID export names with `p_state`→`Property State`,
`p_county`→`Property County`).

**Only 24 of the 176 columns carry any data.** Everything else is empty in all 35
rows and is not sent.

## How "accepted" was determined (empirically, not assumed)

`property_post.php` echoes back a `properties{}` / `owners{}` object containing
**exactly the fields it recognised**. Fields it does not know are silently
dropped from the echo and never stored — they do **not** cause an error.
Verified live by posting a batch of export-only columns plus a deliberately
fake `zzz_totally_bogus_field` as an in-place update to property 8480:

```
sent extras   : m_recipient, or_greeting, p_all_comments, p_property_type,
                p_status_name, tags, u_id, zzz_totally_bogus_field
ECHOED extras : u_id
DROPPED extras: m_recipient, or_greeting, p_all_comments, p_property_type,
                p_status_name, tags, zzz_totally_bogus_field
```

So unknown fields are tolerated but useless. The map below sends only the
echoed/verified set.

## Sent fields (19)

| CSV column | POST field | GET field (read-back) | Transform |
|---|---|---|---|
| `p_type` | `p_type` | `property_type` | none — `Land` |
| `p_status` | `p_status` | `property_status` | **`6` → `3`** — see enum note |
| `p_apn` | `p_apn` | `property_apn` | none |
| `Property State` | `p_state` | `property_state` | header rename only |
| `Property County` | `p_county` | `property_county` | **`PINAL COUNTY` → `Pinal`** — see county note |
| `p_address` | `p_address` | `property_address` | none |
| `p_city` | `p_city` | `property_city` | none |
| `p_zip` | `p_zip` | `property_zip` | none |
| `p_legal_description` | `p_legal_description` | `property_legal_description` | none (16 rows) |
| `p_comments` | `p_comments` | `property_comment` | none (3 rows) |
| `or_id` | `or_id` | `owner_id` | none — attaches to existing owner |
| `or_fname` | `or_fname` | `caller_first_name` | required |
| `or_lname` | `or_lname` | `caller_last_name` | required |
| `o_type` | `o_type` | `owner_type` | none — `Individual` |
| `or_email` | `or_email` | `owner_email` | none |
| `m_address` | `m_address` | `owner_address` | none |
| `m_city` | `m_city` | `owner_city` | none |
| `m_state` | `m_state` | `owner_state` | none |
| `m_zip` | `m_zip` | `owner_zip` | none |

Required-on-create (verified — omitting them returns
`Failed - Property type OR property status OR caller first name OR caller last
name is missing and these are required to create a new record in the system.`):
`p_type`, `p_status`, `or_fname`, `or_lname`.

## Not sent (5 populated columns + empties)

| CSV column | Value | Why not sent |
|---|---|---|
| `u_id` | `1` | Server sets it itself; echo returns `u_id=1` regardless. Sending it is a no-op. |
| `p_property_type` | `LAND` | Dropped by the API. Redundant with `p_type`. |
| `p_status_name` | `Pending Preliminary Research` | Dropped. Display-only mirror of `p_status`; does **not** influence stored status. |
| `m_recipient` | `Glenn Rink` | Dropped. No get-side counterpart. |
| `or_greeting` | `Dear Glenn,` | Dropped. No get-side counterpart. |
| `p_id`, `c_id`, `tags`, `tag_ids`, `p_all_comments` | empty / dropped | `p_id` empty = create. `tags`/`tag_ids` dropped by post. |

## ⚠️ `p_status` is a DIFFERENT enum on post than in the export

This is the single biggest trap in the file. The CSV's `p_status=6` is ID's
**internal/export** id. `property_post.php` takes a **different, remapped**
numeric. Sending the CSV value `6` verbatim silently produces
**"Complete/ Ready To Sell"** — a live-listing status, badly wrong for
raw seller leads.

Mapping established live (by repeatedly updating property 8480 in place and
reading the name back — no throwaway records were created):

| POST `p_status` | stored/echoed internal id | `property_status` name |
|---|---|---|
| 1 | 1 | Prospect |
| 2 | 2 | Mailed Letter 1 |
| **3** | **6** | **Pending Preliminary Research** ← target |
| 4 | 7 | Offers Sent |
| 5 | 9 | Open Escrow - Detailed Research |
| 6 | 11 | Complete/ Ready To Sell |
| 7 | 12 | Found Buyer - Open Escrow |
| 11 | 20 | FILE CLOSED |

Cross-checked against ID's own exports: `id-import-sample.csv` (property 7979,
`p_status=6`, `p_status_name=Pending Preliminary Research`) and
`id-import-sample-2.csv` (property 7237, `p_status=2`, `Mailed Letter 1`).
The export column = the internal id; the post value is the left-hand column.

**So: post `p_status=3`, not `6`.**

The get-side `status=` filter parameter is unrelated and, in this account, is
**silently ignored** — `property_get.php` with `status=0..25` returned the same
newest records every time. Do not use it to verify status.

## County: ID stores the string verbatim, no normalisation

Proven: property 7979 literally stores `PINAL COUNTY`, while 7237 stores
`Pinal`. Both survive round-trip unchanged, so ID does **not** normalise.
The CSV carries the shouty `PINAL COUNTY` form.

Decision: send the **clean title-case county name** (`Pinal`, `Santa Cruz`,
`Cochise`, `Apache`, `Mohave`, `Yavapai`) to match the CRM's dominant
convention and Glenn's own pre-existing record 7237. Transform applied:
strip trailing ` COUNTY`, then title-case.

## Owner attachment

`or_id=6240` on create **attaches to the existing owner** — verified: new
property 8480 came back with `owner_id=6240`, and owner 6240 went from 1
property to 2, with no new owner record. The `owners{}` echo block reflects the
owner record the property hangs off.

Note the owner block is shared: sending `or_email` wrote
`faroutbotany@gmail.com` onto owner 6240, which is why pre-existing property
7237 now also shows that email. That is a real (and correct) data improvement,
but it is a write to a pre-existing record — recorded here for transparency.

## Bonus finding: `property_post.php` supports in-place UPDATE via `p_id`

Not in the API reference. Posting with `p_id=<existing id>` updates that record
rather than creating a duplicate (verified: owner 6240 stayed at 2 properties
across ~10 update posts to 8480). Like the task table, treat it as a **full
replace** — always re-send the complete field set. This is what made the status
enum discoverable without creating any junk records, and it is the repair tool
if any of the 35 need fixing.
