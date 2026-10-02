# PRD: PATLive lead intake into Investment Dominator

**Status:** Implemented (2026-09-30), extended 2026-10-02 with 2.0 Record Notes. Probe verdict `merge` recorded 2026-09-30; first live pass applied 3 leads (properties 9907, 10445, 10884) and recorded 1 unmatched; cron installed (`# PATLIVE-INTAKE`, every 5 min, log `workers/logs/patlive-intake.log`). Operator guide: `workers/patlive-intake/README.md`.

**2026-10-02 finding:** the operator uses the 2.0 interface (v2.investmentdominator.com), which never displays the legacy Comments field (`p_comments`). Its COMMENTS tab is the Record Notes table, reachable only through the separate 2.0 REST API (`api.investmentdominator.com/v1`, JWT login with the CRM user's email and password; the legacy key is rejected). The intake now also posts a Private, Admin Only Record Note with the full Q&A per property (US-006). Files are also writable there (`/files/`, multipart) but were not needed. Endpoint reference: `~/claude/followupdominator/api_reference_investment_dominator.md`.

## Introduction

Sellers who receive one of our mailers call the PATLive answering service. The receptionist walks them through the "New Lead Submission (Selling)" script and PATLive emails the transcript to `leads@ownaloha.land`. Today that email is read by a human who then finds the record in Investment Dominator (ID) and types the details in. The script asks for "the little number on the bottom right hand side of the letter", which is the ID owner id printed on every mailer (the CRM labels it the Letter Ref). That number is enough to find the seller's record without any fuzzy matching.

The 2026-09-29 sample: ref 9251 → owner 9251 → property 10884 (Wayne Wagner, APN R0008890, Park County CO, 5.1 acres, status Mailed Letter 1).

## Goals

- Every PATLive selling lead lands on the seller's ID property record within minutes, with no human copy-typing
- The transcript goes into the property's **Comments** field as an appended block; no other existing field on the record is edited
- The full Q&A also lands as a private **Record Note** on the property, which is what the 2.0 interface shows on the COMMENTS tab
- Every property under that owner moves to **Pending Preliminary Research**, because one call covers everything the seller owns with us; a property already at that stage or later is never moved back
- The same email can never be applied twice, even after a lost state file
- A ref that matches nothing is surfaced for a human instead of guessed

## Non-goals

- Creating owner or property records for unknown refs (a human decides)
- Writing ID Tasks (the operator asked for comments, not tasks)
- Attaching the Q&A as a file (possible via the 2.0 `/files/` endpoint; the Record Note already carries everything)
- Parsing other PATLive forms (buyer inquiries, general messages); they are ignored by the subject and form filters
- Real-time delivery: a 5-minute poll is enough

## User Stories

### US-001: Email pull
- [x] Poll Fastmail over JMAP for messages to `leads@ownaloha.land` from `patlive.com` with subject `Your message from PATLive` and without the `patlive-id-synced` keyword
- [x] Token from `FASTMAIL_API_TOKEN` (env, else project-root `.env.local`); no other secret needed for mail
- [x] `--eml <file>...` processes saved raw emails without Fastmail (tests, re-runs, forwarded messages)
- [x] First run looks back 7 days; later runs resume from the last processed `receivedAt` minus one day (the keyword and ledger dedupe the overlap); `--since` overrides

### US-002: Parse
- [x] Plain-text body parsed as `Label:` / value pairs; HTML `<h5>/<p>` pairs as fallback
- [x] Extracts letter ref (digits only, so "# 9251" still works), caller name, callback number (falls back to Caller ID), Caller ID, message date, receptionist, PATLive tracking number, and every Q&A pair
- [x] Extracts the `flex.patlive.com/receptionist/message/<uuid>` link from the HTML part and uses the uuid as the comment marker (Message-ID when absent)
- [x] Offline tests against the real 2026-09-29 email (`fixtures/patlive-sample.eml`, PII kept: private repo, matches existing operator data)

### US-003: Update every property under the owner
- [x] `property_get.php?oid=<ref>` (paged) lists the owner's properties; zero → `unmatched`
- [x] Per property: post `p_id`, `p_type`, `p_status`, `or_id`, `or_fname`, `or_lname`, `p_comments` = existing comment + blank line + new block
- [x] `p_status=3` (Pending Preliminary Research) unless the current status is in the later-or-equal set, in which case the current status's post value is re-sent unchanged
- [x] Read back after each post; any field other than status, comment, and timestamps changing halts the run with the diff in the log
- [x] Skip a property whose comment already contains the marker; if all are skipped the email is `already-applied`
- [x] Comment block: date, ref, caller, callback and caller id, all answers on one line, other info and offer consent, comments if any, an "owner has N properties" line when N > 1, receptionist and the PATLive message link

### US-004: Bookkeeping
- [x] `state/state.json` ledger (`processed`, `unmatched`, `last_received_at`), gitignored, written atomically
- [x] Processed and unmatched emails receive the JMAP keyword; errored emails do not and are retried next run
- [x] Exit code 1 when any email errored; `UNMATCHED` warning line lists refs needing a human
- [x] One bad email never blocks the others

### US-006: 2.0 Record Note (added 2026-10-02)
- [x] `IDv2Client`: `POST /login` with `ID_V2_USERNAME`/`ID_V2_PASSWORD` (env or the shared credentials file), access token sent verbatim as `Authorization`, user id taken from the login response
- [x] Per property: `GET /comments/?p_id=` and skip when any note already carries the marker; else `POST /comments/` with `n_status="0"` (Private), `n_type="0"` (Admin Only), `n_title="default"`, `n_uid`, and the note text; the response must echo the marker
- [x] `build_note`: HTML laid out like the email (2026-10-02: the COMMENTS tab renders notes as HTML, so the earlier plain-text newlines collapsed into one block): bold header paragraph with callback and caller id, one `<p><strong>question</strong><br>answer</p>` per question, "owner has N properties" when N > 1, receptionist and PATLive link; answers are HTML-escaped; whole paragraphs are dropped from the end to stay under the form's 4,136-character limit without losing the tail. Verified rendering on 5693 in the 2.0 UI (note created and deleted, no residue).
- [x] `--reformat-notes` (with `--reprocess`): a lead whose note already exists but is plain text gets it rewritten in place via `PUT /comments/<n_id>/` (full record; only `n_description` and `n_last_updated` change, probed on 5693). Notes that already start with a tag (hand-edited in the UI) are left alone. Run 2026-10-02 over emails since 2026-09-16: 8 notes reformatted (10065, 10099, 9971, 10147, 10345, 9907, 10445, 10201), 10884 skipped as hand-edited. Three older leads (refs 6510, 7220, 8713 → properties 7539, 8548, 10323, emails before 2026-09-16) had never been applied; the operator backfilled them the same day with `--since 2026-09-01` (legacy comment + HTML note each; 10323 moved Mailed Letter 1 → Pending Preliminary Research). 11 emails in that window carry no letter ref and sit in `state.unmatched` for a human.
- [x] Comment and note are independently idempotent, so a backfill on records that already have the legacy comment adds only the note and performs no second legacy write; `--reprocess` now also ignores the JMAP keyword so already-processed emails can be re-pulled
- [x] Missing 2.0 credentials: warning, legacy behaviour only; `--skip-notes` forces that
- [x] Verified live on `[API TEST]` property 5693: note create (201) / delete (204) and a txt upload / delete round-tripped with no residue

### US-005: Safety gate for the first live write
- [x] `probe_property_update.py` posts the intake's exact payload shape to the labeled `[API TEST]` property 5693, diffs before/after, restores the original comment, and writes `state/update-semantics.json` with verdict `merge` or `replace`
- [x] `intake.py` refuses live property writes until the verdict is `merge` (`PATLIVE_FORCE_WRITES=1` overrides, for the operator only)
- [x] Operator-approved probe run 2026-09-30: verdict `merge`, no unexpected field changes, record restored
- [x] Fastmail token created (JMAP, Email scope, read-write); dry run and live pass 2026-09-30; cron line installed

## Technical Considerations

- **Why the merge probe matters.** ID's `property_post.php` with `p_id` is the only update path, and nobody has verified whether a partial post merges or replaces. The Glenn Rink load notes say to treat it as a full replace as a precaution. A replace would blank acres, tax, assessed value, owner2, and more on a real seller record. The probe answers this on a throwaway record with no delete endpoint needed. If the verdict is `replace`, the fix is a complete get→post field map from the in-app API User Guide, re-sending every field verbatim.
- **Why the owner id is the key.** The CRM's Letter Ref on a mailer is the owner id (`or_id` / `owner_id`), not the property id, so one ref legitimately fans out to several properties. `property_get.php?oid=` is the documented way to enumerate them (the owner table has no read endpoint).
- **Status enum.** The post-side enum differs from the export enum; `3` is Pending Preliminary Research on post (verified 2026-08-03). The later-or-equal set is by status name from the get side.
- **Idempotency layers.** JMAP keyword (survives state loss), state ledger (survives keyword loss), comment marker (survives both).
- **Where it lives.** `workers/patlive-intake/`, stdlib Python, ID credentials shared with followupdominator via its `.credentials/investment_dominator.env`. Kept out of followupdominator's service so a poller bug cannot take down call pops.
- **Extending.** Another PATLive form is a subject/form filter plus a new `build_comment`; another CRM field write is a deliberate addition to `update_payload` and to `EXPECTED_CHANGED_FIELDS`.
