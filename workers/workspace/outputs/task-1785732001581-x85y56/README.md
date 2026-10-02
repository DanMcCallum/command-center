# Glenn R Rink — 35 AZ parcels → Investment Dominator import

**Status: 2026-08-03 — `Property State` / `Property County` headers restored per
the wizard's requirement, with county/state/city values taken from the old file.
`or_id` `6240` retained. Read "If it fails on `or_id` again" below before you
upload. Nothing has been written to the CRM.**

> **Read `situs-research.md` first.** The first upload attempt failed on two
> counts: two headers ID could not match, and empty values in the required
> Address / City / Zip columns. Both are fixed. The fix required abandoning the
> as-given-only rule for `p_address` / `p_city` / `p_zip` and researching real
> situs data per parcel against the six county assessors. Ownership was
> re-confirmed on all 35 parcels in the process (every one returns `RINK GLENN`).
> The acceptance criterion "header byte-for-byte identical to the sample" was
> **wrong to begin with** — `id-import-sample.csv` is an ID *export*, and the
> import wizard does not accept the raw column names for state and county. The
> header is now what the wizard asks for; see "Upload this way" below.

`import.csv` holds **35 new property records** for hand-upload via ID's import
screen. Every APN was transcribed from the seller's email by one agent and
independently re-checked by a second agent that could see only the raw email —
never the normalized table, never another agent's work. **All six verification
passes returned clean, with zero mismatches.**

| | |
|---|---|
| Parcels in submission | 35 |
| Already in ID | **0** |
| Rows in `import.csv` | **35** |
| Transcription mismatches found | **0** |
| CRM records walked to confirm no duplicates | 8,472 |
| Writes performed against the CRM | **none** |

## Per-county breakdown

| County | Parcels | Data present |
|---|---|---|
| Apache | 1 | APN only + acreage remark |
| Cochise | 4 | legal description only |
| Mohave | 1 | APN only + acreage remark |
| Pinal | 15 | 9 street addresses; 6 APN-only (the `511-70` series) |
| Santa Cruz | 12 | legal description **and** street address |
| Yavapai | 2 | street addresses |
| **Total** | **35** | |

## Do these three things in the ID UI after upload

The CSV cannot carry them. This is not an oversight — see `field-mapping.md`.

1. **Set the LPG Blind Offer deal flow.** All 176 columns of your sample export
   were checked and **there is no deal-flow / pipeline / campaign column**. The
   nearest fields are `p_type` (holds `Land`) and `p_listing_status` (governs
   public listing state, not pipeline). Deal flow has to be set in the UI.
2. **Apply the four tags** — requestor `Glenn R Rink`, lead source
   `Website-Contact Us Page`, batch `rink-2026-08`, and a package tag on the
   five `511-70` parcels listed below. Both tag columns ship empty on this
   upload. **This is now a choice, not a limitation** — the new import template
   has a name-based `tags` column that could carry all four; it is held back only
   to keep this upload free of untested variables. See "Two things this sample
   settled" below.
3. **Record the seller's terms** on the submission/contact record. They are
   submission-level, not per-parcel, so they are deliberately not in any row's
   `p_comments`. Full text in
   `operator-input/seller-submissions/2026-08-03-glenn-rink.md` §2.

## Upload this way — current state after four rejections

The wizard needs the **display names** `Property State` / `Property County`, not
the template's `p_state` / `p_county`. So the rename an earlier pass made was
right, and reverting it to match `id-import-sample-2.csv` was the wrong call —
that template is a valid *file layout* but the wizard's header matcher does not
accept those two names. `p_city` is matched fine under its raw name; only those
two are special, presumably because ID has more than one state/county field and
cannot disambiguate.

`import.csv` now carries, per the operator's instruction:

- headers **`Property State`** and **`Property County`** restored;
- `Property State`, `Property County` and `p_city` **values taken verbatim from
  the old file**, matched row-by-row on APN — so county reads `PINAL COUNTY`
  again, not `Pinal`.

Kept from the template rebuild, because they are the only untested difference
left and one of them may be what `or_id` actually needs:

| Column | Value | Source |
|---|---|---|
| `u_id` | `1` | template row — the CRM user the record belongs to |
| `p_property_type` | `LAND` | template row |
| `m_recipient` | `Glenn Rink` | template row |
| `or_id` | `6240` | Glenn's owner record |

### If it fails on `or_id` again, do this in the wizard

That would leave the third attempt's exact configuration plus those three
columns — i.e. it would prove `u_id` / `p_property_type` / `m_recipient` are not
the fix, and that the importer simply will not take an `or_id` on a new record.

The error screen says *"You can try and match a header if the name is different
when you continue"* — so the wizard lets you map columns by hand. **Leave `or_id`
unmapped** and continue. That is the same effect as deleting the column, which
was the one fix never actually tested, and it costs nothing to try in the UI. ID
will then create the owner from `or_fname` / `or_lname` / `or_email` and the
mailing columns. Tell me which way it goes and the file follows.

### `or_id` 6240 itself is not in doubt

- One property in the account carries it — 7237, APN `404-08-0130` — with owner
  address `801 W Birch Ave, Flagstaff, AZ 86001`, the address
  `situs-research.md` derived independently from three county assessors. Your
  own sample row names Glenn on 6240.
- Sharing one owner across many properties is routine here: all 8,175 readable
  property rows tally to 6,957 distinct owners, 347 of which hold 2 properties
  and the largest **101**. 35 rows on one owner id is an ordinary shape.

### Rejected files kept

| File | What it was |
|---|---|
| `parts/import.csv.with-orid` | attempt 2 — `or_id` empty |
| `parts/import.csv.rejected-orid6240` | attempt 3 — `or_id` `6240`, display-name headers |
| `parts/import.csv.rejected-tmpl-headers` | attempt 4 — template headers `p_state` / `p_county` |

Everything outside the columns named above is untouched throughout: all 35 APNs,
the researched addresses, legal descriptions and comments, `p_status` `6` /
`Pending Preliminary Research`, `p_id` empty for new records.
`import-probe-1row.csv` (APN `403-18-188`) and `import-rows-2-35.csv` are
regenerated from this build if you would rather spend one row confirming the
format before the other 34.

### Two things the template settled

**Tags can go in the CSV after all** — it has a `tags` column holding tag *names*
(`REI Print, Pinal County`) beside `tag_ids` (`23, 5`). The earlier "tags are
id-only, so apply them in the UI" conclusion was right about `tag_ids` and wrong
about the ceiling. All four of your tags could ship in that column. **Left empty
here on purpose** — this file has been rejected four times and adding an untested
column now would only muddy the next result. Worth doing for the next batch.

**Glenn already owns a 36th parcel here** — property 7237, APN `404-08-0130`,
absent from his email list. "All 35 are new" in `existing-records.md` is
unaffected and still exact. But this is not a new seller relationship, and he may
have left that parcel off by accident. Worth raising with him.

## Open questions — confirm with Glenn before making offers

These are seller-side data issues, not transcription errors. All were flagged
independently by more than one agent.

1. **Is `511-70-004G` part of the package?** Glenn wrote "these 5 to be sold in
   one sale" against exactly five APNs — `511-70-010a`, `-017a`, `-017b`,
   `-017c`, `-018`. `-004G` is a sixth parcel in the same series with **no
   annotation**. The annotation string appears exactly 5 times, and 5 matches
   his own stated count, so the email is internally consistent and `-004G` is
   treated as **standalone**. But it sits in the same series, so he may simply
   have missed it. **This changes whether the package is five parcels or six.**
2. **The `133-03` subdivision numbers look wrong.** All five parcels share
   `Blk 506` yet carry four different subdivision units — `#14` (‑353), `#15`
   (‑354), `#16` (‑355), `#17` (‑356), `#17` again (‑450). A single block
   normally belongs to one recorded unit, and every other Rio Rico Ranchettes
   entry in the email is `#18`. Transcribed exactly as written, not corrected.
   **Worth a title/county check before any legal description is relied on.**
3. **Apache and Mohave have no legal or situs data** — only "just shy of 40
   acres" and "about 10 acres." Those are hedged prose estimates, so **no
   numeric acreage was written** to `p_acres` or any other field; the wording
   sits verbatim in `p_comments`. Asserting a number he did not give would be
   inventing data.
4. **No phone or mailing address anywhere in the submission** — only the email
   address. `or_phone`, `m_address`, `m_city`, `m_state`, `m_zip` are empty.

## Seller quirks preserved deliberately — do not "fix" these

A cleanup pass would introduce errors here, not remove them.

- **Yavapai house numbers run descending (4830, 4810) while the APNs run
  ascending (552, 554).** This looks like a transposition at a glance. It is
  not — it is what Glenn wrote, confirmed independently by two agents.
- **Palm Circle house numbers are non-monotonic** with APN: `404-18-061` = 3740
  but `404-18-062` = 3730.
- **`N.` vs `N`** — the period appears only on `4620 N. Toltec` and
  `3415 N. Bandelier`; the other seven Pinal addresses have none.
- **Mixed-case APN suffixes** — `004G` uppercase, `010a`/`017a`/`017b`/`017c`
  lowercase.
- **Santa Cruz casing is inconsistent** — `Blk` vs `blk`, `Villas` vs `villas`,
  plural `Ranchettes` vs singular `Ranchette`; `132-04-171` has no block number
  at all; `133-03-450` omits the comma after the block where the other four
  include it.
- **`Ariz sun sites`** is lowercase and abbreviated, and Cochise uses the full
  word `Block` where Santa Cruz uses `Blk`/`blk`.

Full list in `source-parcels.md`.

## Known blind spot in the duplicate check

Three CRM records — **ids 11, 2318, 7978** — are corrupt and return an empty
HTTP-200 body for both windowed and direct reads. Their APNs are unknowable
through the API, so in principle one could hold one of our parcels. This is a
pre-existing defect in the account, and it is the only gap in an otherwise
complete 8,472-record walk. Risk is low and any duplicate will be visible in the
UI. Details, plus a note that the property table was being actively written to
during the walk, are in `existing-records.md`.

## Files

| File | What it is |
|---|---|
| `import.csv` | **The deliverable.** 35 rows, 176 columns. Address/City/Zip now populated on all 35; `p_county`/`p_state` headers renamed to `Property County`/`Property State`. |
| `situs-research.md` | **Read this.** Why the first upload failed, the assessor sources used, per-parcel city/ZIP with confidence, and the open items it surfaced. |
| `parts/import.csv.orig-headers` | Copy of `import.csv` before the header rename and situs fill. |
| `parts/apply-situs.py` | The script that wrote the researched address/city/ZIP and Glenn's mailing address. |
| `existing-records.md` | Duplicate check: the full walk, the zero matches, coverage gaps, and the Pinal APN-format finding. |
| `field-mapping.md` | Which column got what and why; the deal-flow and tag findings with evidence. |
| `source-parcels.md` | All 35 rows in email order, with the per-agent attribution and the full quirk list. |
| `parts/agent-*.json` | Raw per-agent transcription output — audit trail. |
| `parts/verify-*.json` | The six independent verification verdicts. |
| `parts/existing-apns.json` | Raw dedupe-walk output. |
| `parts/raw-email-only.txt` | The email with no parse attached — what the verifiers were given. |
| `parts/import.csv.crlf-backup` | Pre-fix copy of `import.csv` with the original CRLF terminators. |

Source of truth for the whole job:
`operator-input/seller-submissions/2026-08-03-glenn-rink.md`.

## How this was verified

- Six transcription agents split the 35 parcels by workload. Six verification
  agents re-derived each slice from the raw email alone and diffed against the
  emitted rows. **All six returned clean.**
- Each verifier independently reproduced the risky judgment calls rather than
  accepting them: which `511-70` parcels carry the package annotation (5, not
  6), the five `133-03` subdivision numbers read one at a time, and the
  Yavapai house-number pairing.
- The 35 `source_fragment` values were asserted to occur **exactly once** each
  in the raw email, and together they **tile the email's parcel list exactly** —
  nothing swallowed, dropped, or duplicated.
- The six agents' output, the task metadata, and the normalized table were
  cross-checked against each other: **zero field-level differences.**
- `import.csv` was re-parsed after writing: 35 rows, all 176 columns wide, all
  APNs unique, header byte-for-byte identical to the sample.

**Superseded 2026-08-03 — the last clause is no longer true and was the wrong
test.** Matching the sample export byte-for-byte is what *caused* the first
upload to fail: the sample is an export carrying database column names, and ID's
import wizard matches on display names. `p_county` and `p_state` are now
`Property County` and `Property State`. The file still re-parses to 35 rows ×
176 columns with 35 unique APNs, and Address / City / Zip are now non-empty on
all 35 rows. See `situs-research.md`.

**Correction, made during the final review pass.** The bullet above was
originally recorded as passing when it did not. `import.csv` had been written
with CRLF (`\r\n`) line terminators while the sample export uses bare LF, so the
header differed from the sample by one byte per line and was *not* byte-for-byte
identical. The file has been rewritten with LF terminators and the header now
compares equal byte-for-byte. Nothing else changed: the two versions are
identical once line endings are normalized, and the post-fix re-check reproduced
35 rows × 176 columns, 35 unique APNs, and zero field-level differences against
the source table. The original CRLF file is kept at
`parts/import.csv.crlf-backup` for audit.

## Deviation from the plan, for the record

The plan had the cron worker run this task and fan out subagents inside its own
session. It was instead executed by subagents **in the operator's session**, at
the operator's request. This avoided the plan's top-listed risk — the 30-minute
worker timeout — and the repo's lack of prior art for worker-spawned subagents.

The task was created through `POST /api/tasks` as specified and set to
`in_progress` immediately, because the worker runs on a `*/5 * * * *` cron and
selects on `status == "pending"`; leaving it pending would have let the worker
pick it up and race the subagents. Every deliverable, path, and the
`needs_review` end state are unchanged.
