# Glenn Rink 35-parcel upload — UI import wizard variants

# ⛔ STOP — DO NOT UPLOAD ANY OF THESE. ALL 35 PARCELS ARE ALREADY IN THE CRM.

**Verified live 2026-08-03 06:58 through `property_get.php` with `oid=6240`.**
All 35 APNs from the submission are present as property ids **8480–8514**, all
attached to owner **6240** (Glenn), all `Pending Preliminary Research`, all
`Land`. The set matches the source file **exactly** — 35 live, 35 wanted, zero
missing, zero extra. Spot-check of `133-03-450`: `227 Caiman Ct`, Rio Rico,
85648, `Santa Cruz`, AZ, owner 6240, `faroutbotany@gmail.com`.

The parallel API effort loaded them while these files were being built.
**Uploading any file in this directory now would create 35 duplicate property
records, and ID has no documented property delete endpoint.**

Before touching the import screen for any reason, re-run `property_get.php` with
`oid=6240` and confirm for yourself.

Two things came through the API load **better** than these CSVs would have
delivered, worth knowing:

- **County landed as `Santa Cruz` / `Pinal` / `Cochise`** — the CRM's own bare
  title-case convention — not the `SANTA CRUZ COUNTY` form every file here
  carries. See "County values" below; that was a real defect in the CSV and it
  is now moot.
- **All 35 attached to Glenn's existing owner 6240** with no `or_id` supplied
  anywhere, which is exactly what the root-cause analysis below predicted.

Everything past this point is retained as the diagnostic record: what the
`or_id` rejection actually was, and what would have fixed it. The files stay on
disk because the same wizard will be used for the next batch and the answer is
reusable — **but for this batch the job is done and the wizard is not needed.**

---

## The rest of this document is the record, not an instruction

Six candidate files, ordered cheapest-and-most-likely first. Every file is a
complete, verified build derived from `../2026-08-03-glenn-rink-id-import.csv`
with exactly one variable changed. Had the API path not landed first, the
instruction would have been: upload one at a time, stop as soon as one is
accepted.

---

## The ladder

| # | File | Rows × cols | The one variable | Upload when |
|---|---|---|---|---|
| **1** | `A-no-orid.csv` | 35 × 175 | `or_id` **column deleted** | First. Start here. |
| 1b | `A34-no-orid-minus-403-18-188.csv` | 34 × 175 | same, minus one APN | **Obsolete.** Built when 8480 (`403-18-188`) was the only one of the 35 live; all 35 are live now |
| **2** | `B-no-server-keys.csv` | 35 × 170 | all six ID-assigned keys deleted | If 1 fails naming a *different* field |
| **3** | `C-minimal-21col.csv` | 35 × 21 | only columns that carry real data | If 1 and 2 both fail, or to make the wizard list its own required headers |
| **4** | `E-no-orid-county-normalised.csv` | 35 × 175 | = file 1, but county reads `Pinal` not `PINAL COUNTY` | Optional swap for file 1 — see "County values" below |
| **5** | `D-orid-blank.csv` | 35 × 176 | `or_id` header kept, value blank | **Do not upload.** Already falsified — kept only for the audit trail |

---

## Decision tree — follow this at the keyboard

### Step 1 — upload `A-no-orid.csv`

This deletes the `or_id` column outright. **This is the fix that has never been
tested.** Attempt 2 blanked the value; attempt 3 set it to the correct `6240`;
neither removed the header. Both got the identical error, which is the whole
tell — see "Root cause" below.

**If it imports → done.** Skip to "After a successful import".

**If the error says `missing the following header(s)! …` and names something:**
The wizard is telling you which fields it *requires*, not which it can't read.
Whatever it names has to be present as a column. Write down the exact list and
report it — that list is the thing nobody has ever had. Do **not** guess a
rename; go to Step 4 and hand-map instead.

**If the error says `35 records: Validation error in field "<something other
than or_id>"`:** a second ID-assigned key is doing the same thing `or_id` did.
Go to Step 2.

**If the error still says `Validation error in field "or_id"` with no `or_id`
column in the file:** the wizard is caching the previous mapping, or `or_id` is
being auto-derived from the owner block. Reload the import screen from scratch
(don't reuse a saved mapping), retry once, and if it repeats go to Step 3.

### Step 2 — upload `B-no-server-keys.csv`

Deletes all six fields the API reference lists as server-assigned:
`p_id`, `u_id`, `c_id`, `p_status_create_time`, `p_status_last_updated`,
`or_id`. 170 columns.

Hypothesis: the importer rejects *any* column that maps to a key the database
assigns, and `or_id` was just the first one it reached.

- **Imports →** hypothesis confirmed; the class of field is the problem, not the
  value.
- **Still errors on one named field →** that field is special for some other
  reason. Go to Step 3.

### Step 3 — upload `C-minimal-21col.csv`

21 columns, zero empty ballast. Nothing in this file is blank anywhere.

Columns kept and why:

| Column | Why it is here |
|---|---|
| `p_type`, `p_status` | `p_status` is required per the API reference; `p_type` = `Land` |
| `Property State`, `Property County` | the wizard named both as required, by these display names, in the attempt-1 error |
| `p_apn` | the parcel identity — the whole point of the file |
| `p_address`, `p_city`, `p_zip` | the wizard named Address / City / Zip as required in the attempt-1 error |
| `p_comments`, `p_legal_description` | the only seller-supplied prose in the batch; losing it loses data |
| `p_property_type` | `LAND`, taken from the real template row (`id-import-sample-2.csv`) |
| `o_type`, `or_fname`, `or_lname`, `or_email` | `or_fname`/`or_lname` are required per the API reference; these four are how ID builds the owner **without** an `or_id` |
| `m_address`, `m_city`, `m_state`, `m_zip`, `m_recipient` | Glenn's mailing address — what ID matches against to attach these to his existing owner record rather than minting 35 new ones |
| `or_greeting` | mail-merge salutation, present in both templates |

Dropped versus file 1: the six server-assigned keys, `p_status_name` (it is just
the display twin of `p_status` = `6`), the duplicate `tag_ids` header, and 148
columns that were empty on all 35 rows.

**This file is also the cheapest diagnostic in the ladder.** If the wizard has
required headers nobody has enumerated yet, a 21-column file will make it name
every single one of them in a single error message. A failure here is worth more
than a pass anywhere else.

### Step 4 — hand-map, or leave a column unmapped

The attempt-1 error screen said, verbatim:

> You can try and match a header if the name is different when you continue

So the wizard has a manual mapping step after the failed auto-match. The exact
button labels are not recorded anywhere in this repo — I have the sentence
above and nothing else, so treat the following as the shape of it, not the
literal wording:

1. Click **Continue** on the error screen rather than backing out. The error is
   a warning gate, not a dead end.
2. The next screen lists **your CSV's headers on one side and ID's fields on the
   other**, with a dropdown per row.
3. **To hand-map a column:** find your header in the list and pick the matching
   ID field from its dropdown. This is the move for `Property County` /
   `Property State` if a future file ever loses the display-name rename.
4. **To leave a column unmapped:** set its dropdown to the blank / *"— do not
   import —"* / *"Ignore"* entry. That is the equivalent of deleting the column,
   which is exactly what file 1 does on disk.
5. Then confirm and run the import.

If Step 4 works where file 1 did not, the difference is that the wizard's
per-row validator runs before you reach the mapping screen — worth recording,
because it means the fix has to be on disk and can't be done in the UI.

---

## Root cause — best guess, with the evidence

**`or_id` is a server-assigned key that ID's importer surfaces as a mappable
column but validates unconditionally, so no cell value can satisfy it on a
create. The column has to be absent.**

Evidence, strongest first:

1. **Empty and correct produce the identical error.** Attempt 2 shipped `or_id`
   blank on all 35 rows; attempt 3 shipped `or_id` = `6240` on all 35. Both
   returned `35 records: Validation error in field "or_id"`. A validator that
   rejects the empty string *and* a verified-live foreign key with the same
   message is not reading the value at all — it is failing on the field.
2. **`6240` is not in doubt.** It resolves live: `property_get.php` with
   `oid=6240` returns Glenn's properties; owner address `801 W Birch Ave,
   Flagstaff, AZ 86001`, matching what three county assessors gave
   independently. If the value were the problem, this value would have passed.
3. **The API reference lists `or_id` as get-only.** `api_reference_investment_dominator.md:33`
   — *"Get-only fields returned in responses: `p_id`, `or_id`, `c_id`,
   `*_status_create_time`, `*_status_last_updated`, `u_id`."* And line 24:
   `property_post.php` **echoes** an `or_id` back rather than accepting one.
   `or_id` is an output of a write, never an input.
4. **The account already proves ID assigns and reuses owner ids by itself.**
   Properties 8470–8479 were created in one batch at 04:42:51 with owner ids
   `7184, 7185, 6911, 7151, 7186, 7187, 7188, 7189, 6930, 7190` — a mix of
   freshly minted ids and *reused existing* ones (6911, 6930). ID matched some
   owners to records that already existed and created the rest, with no caller
   supplying an id. That is precisely the behaviour we want for Glenn.
5. **`p_id` being empty passed while `or_id` being empty failed, in the same
   file.** Attempt 2 had both blank and only `or_id` was flagged. So blank is
   fine for the property key and not for the owner key — consistent with the
   importer treating `or_id` as a hard FK it will not accept from a file, and
   inconsistent with any "required value missing" reading.

**The prediction this makes:** with `or_id` gone, ID creates or matches the
owner from `or_fname` / `or_lname` / `or_email` / `m_address` / `m_city` /
`m_state` / `m_zip`. Because those carry Glenn's exact existing owner address,
the likeliest outcome is that all 35 attach to owner **6240** — the same
behaviour rows 8470–8479 show. Verify it after import: `property_get.php` with
`oid=6240` should return his pre-existing 7237, the probe 8480, and one row per
parcel you uploaded — 37 rows after a 35-row file, 36 after `A34-…`. Anything
less means some rows were attached to a newly minted owner instead.

**That prediction is now confirmed.** The API load supplied no `or_id` and all
35 records came back attached to owner **6240**, with `owner_email`
`faroutbotany@gmail.com` populated. ID matches owners from the name / email /
mailing-address block on its own. Deleting the column was the right fix.

**The residual risk if that prediction had been wrong:** 35 duplicate owner
records for Glenn. That risk is unavoidable — there is no owner-write endpoint, no
`owner_get.php`, and no way to pin the FK from a CSV. It is also cheap to fix by
hand in the UI and cheaper than a fifth rejection.

---

## County values — a one-way door, decide before you upload

The CRM stores county as a **bare title-case name**. Sampled live across the
account: `Weld`, `Pinal`, `Park`, `Washington`, `Klickitat`, `Crook`, `Hawaii`.
**Not one record in the account has `COUNTY` in that field.** Glenn's own two
existing parcels (7237, 8480) both read `Pinal`. The real import template
`../id-import-sample-2.csv` also carries `Pinal`.

Files 1, 2, 3 and 5 all carry `PINAL COUNTY`, `SANTA CRUZ COUNTY` etc., because
that is what the source file carries. **The importer does not normalise this.**
Proof: property 7979 — the record `../id-import-sample.csv` was exported from —
reads back `PINAL COUNTY` verbatim through the API today. Whatever you upload is
what gets stored.

So a successful upload of file 1 lands 35 records whose county doesn't match the
other 8,000, and county filters and county tags will miss them.

`E-no-orid-county-normalised.csv` is file 1 with only column 7's values changed
to `Apache` / `Cochise` / `Mohave` / `Pinal` / `Santa Cruz` / `Yavapai`. It is
byte-identical to file 1 everywhere else.

**This cannot change the `or_id` outcome** — attempts 2 and 3 both carried
`PINAL COUNTY`, cleared header matching *and* record validation, and died at
`or_id`. County values were never the blocker either way.

Upload `E` in place of `A` if you'd rather not hand-fix 35 county values later.
Upload `A` if you want the strictly-one-variable test. There is no acceptance
risk in either direction that I can see.

**Resolved by the API load.** All 35 live records read back `Apache`, `Cochise`,
`Mohave`, `Pinal`, `Santa Cruz`, `Yavapai` — the correct convention. Nothing to
fix. Keep this finding for the next batch: **write bare title-case county names,
never the `X COUNTY` form**, and treat `id-import-sample.csv` as the outlier it
is (record 7979 came in through the website form, unvalidated).

---

## File 5 — `D-orid-blank.csv`, and why it is dead

`or_id` header present, value blank on all 35 rows.

**It is not byte-identical to the rejected attempt 2**
(`workers/workspace/outputs/task-1785732001581-x85y56/parts/import.csv.with-orid`)
— 16,067 bytes vs 15,542. Keyed on APN, it differs in four columns:
`u_id` (`1` vs empty, 35 rows), `p_property_type` (`LAND` vs empty, 35 rows),
`m_recipient` (`Glenn Rink` vs empty, 35 rows), and `p_apn` letter-case on 4
rows (`511-70-010A` vs `010a`).

**But the variable under test is identical, and it is already falsified.**
Attempt 2 proved a blank `or_id` fails; those four columns are unrelated to
owner-key validation and two of them (`u_id`, `p_property_type`) were also
present in attempt 4, which never reached record validation. Uploading D spends
an attempt to re-learn a known result. It is on disk only so the ladder is
complete and auditable.

---

## Still to do in the UI — this part applies to the live records right now

The API load created the property and owner data. These three could never come
from a CSV either, and are still outstanding on ids **8480–8514**:

1. **Set the LPG Blind Offer deal flow.** There is no deal-flow column in any of
   the 176.
2. **Apply the four tags** — requestor `Glenn R Rink`, lead source
   `Website-Contact Us Page`, batch `rink-2026-08`, and a package tag on the five
   `511-70` parcels (`-010A`, `-017A`, `-017B`, `-017C`, `-018` — *not* `-004G`;
   see the open questions in the task README). All tag columns ship empty here on
   purpose.
3. **Record the seller's terms** on the submission/contact record — they are
   submission-level, not per-parcel. Text in
   `../2026-08-03-glenn-rink.md` §2.

And two things worth checking on the live records, because the CSV would have
carried them and the API load may not have:

- **`p_legal_description` and `p_comments`.** 16 rows have a seller-supplied
  legal description and 7 have a comment (the acreage estimates and the
  "these 5 to be sold in one sale" note). Confirm they made it across; the CSVs
  here are the authoritative copy if they did not.
- **`p_acres`.** Deliberately empty everywhere — the seller's figures were prose
  approximations. The assessor figures are known and recorded in
  `../../workers/workspace/outputs/task-1785732001581-x85y56/situs-research.md`
  (Apache `202-04-006` = 41.06 ac, Mohave `353-17-068` = 10.0 ac). Populating
  them is a separate decision.

Verification command for any of this: `property_get.php` with `oid=6240`.

---

## How these files were verified

Every file was re-parsed after writing and checked for:

- exact row count (35, or 34 for `A34-…`) and exact column count, on the header
  **and every data row**;
- all 35 source APNs present, unique, and **byte-identical to the source file** —
  including the mixed-case suffixes `004G` / `010A` / `017A` / `017B` / `017C`;
- `p_address`, `p_city`, `p_zip` non-blank on every row of every file;
- every cell compared back to the source file **keyed on APN, not row order**, so
  a reorder can't hide a swap. Only the deliberate change shows a diff:
  `or_id` in D, `Property County` in E, nothing at all in A / A34 / B / C;
- RFC-4180 quoting — every field containing a comma or a quote verified to appear
  quoted in the raw bytes (this matters: `p_legal_description` and `p_comments`
  contain commas on 16 and 7 rows);
- LF line endings, no BOM, UTF-8 — matching both templates.

Note that A, B, D, E and A34 still carry the source file's **duplicate `tag_ids`
header** (columns 75 and 172, both empty on all 35 rows). It is inherited, not
introduced, and harmless while both are empty — but it is a real hazard the day
anyone populates them, and `C-minimal-21col.csv` is the only file here without
it.

Build and verification scripts are throwaway; the checks above are reproducible
from the files themselves.
