# What `or_id` actually is in Investment Dominator

Path C, read-only investigation, 2026-08-03. Every API call in here was
`*_get.php`. No writes were issued from this path.

## Short answer

`or_id` is the **primary key of ID's owner table** — a table that is *not* the
`contact` table, has *no* `*_get.php` endpoint, and is *not* one of the fields
ID's CSV import wizard can accept.

Owner 6240 is genuinely Glenn Rink. It is a perfectly valid value for the
**API** (`property_post.php` takes it and attaches to the existing owner —
proven live, see §6). It is an invalid value for the **import wizard** for a
structural reason: **"Owner ID" does not exist in the wizard's field list at
all.** ID publishes the exhaustive list — 11 required + 130 optional = 141
importable fields. `User ID` and `Contact ID` are both on it. `Owner ID` and
`Property ID` are not. Those two are the keys ID assigns itself.

That is why the wizard rejected `or_id` **both** when it was empty *and* when it
carried the valid value 6240: the column is not rejected for its contents, it is
rejected for existing.

## 1. The property↔owner model

Get-side property rows carry `owner_id` plus a flattened copy of the owner
record (`owner_type`, `owner_company`, `caller_first_name`/`caller_last_name`,
`owner_first_name`…`owner5_last_name`, `owner_address`, `owner_city`,
`owner_state`, `owner_zip`, `owner_email`, `owner_phone`). It is a genuine
one-owner-to-many-properties FK, confirmed by ID's own docs:

> "sometimes a property owner owns more than one property. And in this case, the
> Investment Dominator CRM creates one owner record and then attaches the
> property records to that owner record. This is why in the Investment Dominator
> we have both an Owner Id number and a Property Id number and they do not
> match."
> — <https://guides.investmentdominator.com/how-to-attach-multiple-property-records-to-one-owner-record/>

**No API read path for the owner table — CONFIRMED, not refuted.**
`owner_get.php`, `owners_get.php`, `seller_get.php`, `lead_get.php` all return
**HTTP 404** (an HTML error page, not JSON). The only way to read an owner record
is through the owner block on a property row, or by filtering
`property_get.php` with `oid=<owner_id>` — which does work and is the correct
enumeration tool.

## 2. Owner 6240 is Glenn Rink — and now holds 36 properties

`property_get.php` with `oid=6240` at the start of this session returned exactly
one row:

| p_id | APN | County | Caller name | Owner mailing |
|---|---|---|---|---|
| 7237 | `404-08-0130` | Pinal | Glenn Rink | 801 W Birch Ave, Flagstaff, AZ 86001 |

Same query re-run at the end of this session returns **36 rows**: 7237 plus
8480–8514, all 35 of the seller's APNs, all carrying
`801 W Birch Ave, Flagstaff, AZ 86001` and caller name Glenn / Rink. The sibling
write agent's API load landed while this walk was running.

APNs now on owner 6240: `404-08-0130` (pre-existing), plus `403-18-188`,
`202-04-006`, `116-09-340`, `116-09-341`, `117-02-118`, `117-02-141`,
`353-17-068`, `404-02-056`, `404-02-059`, `404-02-092`, `404-18-038`,
`404-18-061`, `404-18-062`, `404-18-066`, `404-19-161`, `511-70-004G`,
`511-70-010A`, `511-70-017A`, `511-70-017B`, `511-70-017C`, `511-70-018`,
`119-01-116`, `119-01-139`, `119-01-365`, `132-04-171`, `132-04-265`,
`132-04-300`, `132-06-076`, `133-03-353`, `133-03-354`, `133-03-355`,
`133-03-356`, `133-03-450`, `405-06-552`, `405-06-554`.

Note the owner block on the get side shows `owner_email` **empty** even now —
`owner_first_name`/`owner_last_name` are empty too and the name lives in
`caller_first_name`/`caller_last_name`. That matches every other record in the
account (see §4) and is normal, not a failed write.

## 3. Owner ids and contact ids are different namespaces — proven

The `contact` table in this account contains **three rows, ids 1, 2, 3**
(`contact_get.php`, `sort=id&sortdir=DESC`):

| id | type | name | email |
|---|---|---|---|
| 3 | Prospect | `Glenn R Rink` (all in `first_name`, `last_name` empty) | faroutbotany@gmail.com |
| 2 | Prospect | `James Brewer ` | jamesbrewerii6@gmail.com |
| 1 | Buyer | `[API TEST] safe to delete` | — |

`contact_get.php` with `id=6240` returns `{"status":"Success","contact":"No
Record Found"}`.

So Glenn is **contact 3 and owner 6240 simultaneously** — the same human, two
unrelated tables, two unrelated integer keys. Owner ids run 1–7190; contact ids
run 1–3. The overlap is coincidental smallness, nothing more.

This *does* mean 6240 would be an invalid **contact** id, so "the wizard is
resolving `or_id` against the contact table" is a coherent theory — but it is not
the right one, because the wizard has a separate, correctly-named `Contact ID`
field for that (it maps to the `c_id` column, empty in every one of our files),
and it rejected an empty `or_id` too. The simpler explanation in §5 covers both
observations.

Contact 3 also carries the original website-form note containing the seller's
raw parcel list — that is the provenance of the 35 APNs. `leadsource` is
`Website-Contact Us Page`.

Terminology warning: ID's *UI* calls the owner record a "Contact record" ("you
can add the additional properties to their Contact record"). ID's *API* `contact`
table is the buyer/prospect table. They are not the same thing. Prior work's
confusion on this point is understandable.

## 4. Owner-id distribution — full walk, 8,507 properties

Walked the whole property table ascending (`sort=property_id&sortdir=ASC`,
`range=100`, ~1 req/sec, bisecting to `range=1` on empty bodies). 86 paged
requests plus bisection.

- **Property ids 1–8514, 8,507 readable.** Gaps: 11, 12, 13, 1589, 2318, 7514,
  7978. Of those, **11 / 2318 / 7978 are the corrupt records** — a `range=1`
  request at their exact offsets (0-based 10, 2314, 7973) returns an empty
  HTTP-200 body, deterministically. 12, 13, 1589 and 7514 are simply deleted
  (`No Record Found`). Prior work's corrupt-id list is exactly right.
- **`owner_id` is never blank and never zero: 8,507 / 8,507 populated.**
- **Owner ids 1–7190, 7,187 distinct.** Only three ids in that range are
  unreferenced: 12, 1304, 6485 — and 1304 and 6485 sit precisely in the gaps
  left by deleted properties 1589 and 7514 (property 1588 → owner 1303, 1590 →
  1305; 7513 → 6484, 7515 → 6486). The owner table is effectively dense: one
  owner row per property row, minus dedupe.
- Properties per owner:

  | properties | owners |
  |---|---|
  | 1 | 6,650 |
  | 2 | 370 |
  | 3 | 81 |
  | 4 | 21 |
  | 5–14 | 60 |
  | 17–44 | 11 |
  | **101** | 1 (owner 5832) |

  Largest: 5832 = 101, 62 = 44, **6240 = 36**, 6928 = 27, 1279 = 24. Prior work's
  "max 101" claim is **confirmed**. Many-to-one is ordinary here; 36 on one owner
  is unremarkable.
- Owner records at the very beginning of the table are 1:1 with properties
  (property 1 → owner 1 … property 10 → owner 10). By property 8479 the owner id
  is only 7190 — the ~1,300-record deficit is exactly the dedupe.
- Name fields: `caller_first_name` populated on 660/910 sampled, `owner_first_name`
  on 167/910, `owner_email` on **1**/910. `owner_type` is `Individual` 649 /
  `Company` 261. So ID's import puts the imported first/last name into the
  *caller* fields — which its own docs state explicitly ("NOTE: This value will
  be inserted into the Caller's First Name field in the system").

### How the wizard groups owners

Grouping is on the owner block, and it includes the name, not just the address.
Three owner ids share `7251 W 20th St Unit L200, Greeley 80634` — Ucw Investments
LLC (6918), Village East Commercial Holdings LLC (6981), Village East Ii
Investments LLC (7079). Three more share `8800 N Gainey Center Dr Ste 345,
Scottsdale`. Conversely **no owner id in the whole table has two different
mailing addresses**.

Critically: of the 372 multi-property owners, **371 have zero spread in
`create_time`** — every one of their properties came from a single import batch.
The one exception is owner 6240, whose spread is 14.16 days, and that is only
because the sibling agent attached to it *through the API* today. Batches are
visible as tight `create_time` clusters (2026-03-30, 05-06, 06-22, 06-24, 07-05,
07-20, 08-03).

**Implication: the wizard's owner dedupe appears to be within-import only.** Re-
uploading Glenn's identical owner block would very likely have minted a *new*
owner id (~7191) rather than reusing 6240.

## 5. Why the import wizard refuses `or_id`

ID publishes the complete importable field list at
<https://guides.investmentdominator.com/how-to-import-your-list-for-land-investing/>:
"There are 11 required fields and 130 optional fields."

**Required (11), by the display name the wizard matches on:** `Type`
(`Individual`/`Company` only), `First Name`, `Last Name`, `Company`, `Address`,
`City`, `State`, `Zip` (these four are the *owner's mailing* address), `APN`,
**`Property County`**, **`Property State`**.

That single line resolves the header fight: `Property State` / `Property County`
are required *display* names, which is why attempt 4's revert to `p_state` /
`p_county` produced "missing the following header(s)! Property County, Property
State". The earlier rename was correct.

**The 130 optional fields include `User ID` and `Contact ID`. They do NOT include
an Owner ID or a Property ID.** The list also confirms `Property Address`,
`Property City`, `Property Zip`, `Mailing Street Name`, `Mailing Recipient`,
`Tags`, `Property Status` etc. as legitimate optional targets, so it is the real
list, not a summary.

Ranking the five candidate explanations from the task:

1. **The wizard only accepts import-createable fields and has no target for an
   ID-assigned owner PK — most likely, and documented.** `or_id` has nowhere to
   map. Whatever the wizard does with an unmappable column that it half-matched
   by name, the outcome is a validation failure regardless of the cell contents —
   which is exactly the observed behaviour (`""` and `6240` produced the same
   `35 records: Validation error in field "or_id"`).
2. It validates against a table the API cannot see — true that the API cannot see
   it, but this cannot explain the *empty* value also failing.
3. It requires a matching `o_fname`/`o_lname` pair — ruled out: the file supplies
   `or_fname`/`or_lname` = Glenn/Rink, which is what ID's own export of property
   7237 carries, and `o_fname`/`o_lname` are empty in ID's own export too.
4. It rejects any non-empty value in the column — ruled out: the empty value was
   rejected as well.
5. Contact-id namespace collision — coherent (6240 is not a contact id) but
   superseded by (1); the wizard has a separate `Contact ID` field.

Why did empty `p_id` pass while empty `or_id` failed? Because a blank primary-key
column is only benign if the wizard mapped it to nothing. Best reading: the
wizard's auto-matcher recognises `or_id` (it is a real internal field name — it
appears in ID's own export) and binds it to a slot that has a validator and no
legal import value, while `p_id` is simply discarded. Either way the fix is the
same and the prior work's untested lever was the right one: **leave `or_id`
unmapped, or delete the column.**

Also worth knowing for any future upload: our CSV is a 176-column **export**
layout (both "templates" on disk, `id-import-sample.csv` and
`id-import-sample-2.csv`, carry populated `p_id` — 7979 and 7237 — so they are
exports of live records, not blank import templates). 176 export columns vs 141
importable fields means ~35 columns in that file have no import target at all.
`or_id` is one of them. Anyone re-attempting the UI route should expect to hand-
map or discard those.

Field-by-field diff of `import.csv` row 1 against ID's own export of property
7237 found **only one** column where we supply data ID does not: `or_email`
(`faroutbotany@gmail.com`). Everything else we populate is a subset of what ID
itself exports. So the file's *content* was never the problem.

## 6. The decisive experiment already happened

`property_post.php` **does** accept `or_id` and **does** attach to the existing
owner. Proof, read-only: at the start of this session `oid=6240` returned 1
property (7237, max property id in the account 8479); at the end it returns 36,
the new ids being exactly 8480–8514, all with owner 6240 and Glenn's mailing
address. This is the sibling write agent's load, and it worked.

This contradicts one line in
`/home/mazer/claude/followupdominator/api_reference_investment_dominator.md`,
which lists `or_id` under "Get-only fields returned in responses". It is not
get-only: it is settable on `property_post.php` and is the supported way to
attach a new property to an existing owner. That reference file should be
corrected.

## Recommendation

**Attach to 6240. Done — and it was the right call.**

- 6240 is Glenn, corroborated four ways: the pre-existing property 7237 carries
  it; its mailing address `801 W Birch Ave, Flagstaff, AZ 86001` matches the
  address `situs-research.md` derived independently from three county assessors;
  the operator's own ID export of 7237 names Glenn on 6240; and the caller name
  on the record is literally `Glenn` / `Rink`.
- 36 properties on one owner is well inside normal for this account (one owner
  holds 101).
- Creating a fresh owner would have been strictly worse: Glenn would hold two
  owner records, and there is no documented owner-merge, no owner delete, and no
  owner endpoint in the API to fix it with.

**Do not retry the UI import for this batch.** It cannot target owner 6240 —
that is not a file-formatting problem, it is a missing feature. ID's own
documented UI path for this exact situation is *Look up the owner's record → Edit
→ "Add Additional Property"*, one parcel at a time, which the API load has now
made unnecessary.

**For future batches**, the decision rule is:

- New owner, bulk list → UI import wizard is fine. Use the 11 required *display*
  names, drop `p_id` and `or_id` from the file entirely.
- Existing owner → API `property_post.php` with `or_id`. The wizard's dedupe is
  within-batch only (371/372 multi-property owners have zero `create_time`
  spread), so re-uploading a matching owner block would have created a duplicate
  owner, not reused 6240.

## Contradictions with prior work

| Prior claim | Verdict |
|---|---|
| "The owner table has no API read path" | **Confirmed.** `owner_get.php` / `owners_get.php` / `seller_get.php` all 404. Owner data is reachable only via property rows and the `oid=` filter. |
| "Largest owner holds 101 properties" | **Confirmed** (owner 5832). Full-table walk. |
| "`owner_id` never empty" | **Confirmed** across all 8,507 readable rows, not just the 1,500 sampled before. |
| "Corrupt ids 11 / 2318 / 7978" | **Confirmed**, deterministic empty HTTP-200. Also: 12, 13, 1589, 7514 are plain deletions, not corruption. |
| "`or_id` is a required FK into ID's owner table" (the wizard's view) | **Refuted.** It is an owner FK, but it is not a wizard field at all — required or otherwise. That framing is what sent three rounds of debugging after the value instead of the column. |
| "The `Property State` / `Property County` rename was the bug" (2nd entry, later self-corrected) | Correctly self-corrected. ID's docs list both as required *display* names. |
| "`or_id` 6240 was rejected, so 6240 must be wrong" | **Refuted.** 6240 is right; the wizard is the wrong tool. |
| api_reference: "`or_id` … get-only field" | **Refuted.** Settable on `property_post.php`; that is how the 35 attached. |
| README: "8,175 readable property rows / 6,957 distinct owners" | Superseded — the account has grown; now 8,507 rows / 7,187 owners (217 properties created 2026-08-03 in an unrelated batch, plus our 35). |

## Method / audit trail

All calls `POST {ID_ACCOUNT_URL}/my/api/<table>_get.php`, form-encoded, key from
`/home/mazer/claude/followupdominator/.credentials/investment_dominator.env`
(never printed). Roughly 110 requests total, paced ~1/sec:

- `property_get.php` `id=7237`; `oid=6240` (twice, start and end); `oid=6928`;
  `oid=227`; `id=11` / `id=2318` / `id=7978`
- `contact_get.php` `id=6240`; full contact list `type=0 sort=id sortdir=DESC`
- `property_get.php` ascending full walk, `range=100`, 86 pages + bisection
- 404 probes: `owner_get.php`, `owners_get.php`, `seller_get.php`, `lead_get.php`
- Public docs: guides.investmentdominator.com import + owner-record pages
