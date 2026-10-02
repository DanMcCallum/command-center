# PATLive intake

Turns a PATLive "New Lead Submission (Selling)" email into an Investment Dominator update: a private **Record Note** with the full Q&A on every property the caller owns (visible on the 2.0 COMMENTS tab), the same summary in the legacy Comments field, and a status move to **Pending Preliminary Research**. Design and acceptance criteria: [`specs/patlive-intake.md`](../../specs/patlive-intake.md).

## How it works

1. Every 5 minutes cron runs `intake.py`. It asks Fastmail over JMAP for messages to `leads@ownaloha.land` from `patlive.com` with subject `Your message from PATLive` that do not yet carry the `patlive-id-synced` keyword.
2. The receptionist form is parsed from the plain-text part (HTML fallback). The answer to "the little number on the bottom right hand side of the letter" is the CRM **owner id** (shown in the CRM as the Letter Ref).
3. `property_get.php?oid=<ref>` returns every property under that owner. For each one the script posts `property_post.php` with `p_id` plus the comment (existing comment + new block) and `p_status=3`. A property already at Pending Preliminary Research or later keeps its status and only gets the comment.
4. The record is read back and diffed. If anything besides status, comment, and timestamps changed, the run stops with an error and the log shows the diff.
5. A **Record Note** (Private, Admin Only) with every question and answer is posted through the 2.0 API (`api.investmentdominator.com/v1/<crm>/comments/`). The 2.0 interface shows these on the property's COMMENTS tab and never displays the legacy Comments field, so this is the part the operator actually sees. The note body is HTML (the COMMENTS tab renders it with its rich-text editor, so plain newlines collapse): a bold header paragraph, then one paragraph per question with the answer on the line below, like the PATLive email. If the 2.0 credentials are missing the run logs a warning and writes the legacy comment only.
6. The email gets the keyword and the message id lands in `state/state.json`. The comment block and the note both carry the PATLive message id, so a re-run adds only whatever is missing on each property, even if the state file is lost. Refs that match no owner go to `state.unmatched` for a human.

## One-time setup

1. **Fastmail API token.** Fastmail web → Settings → Privacy & Security → Integrations → API tokens → New token, scope **Mail (read and write)** (write is needed to set the processed keyword). Put it in the project-root `.env.local`:

   ```
   FASTMAIL_API_TOKEN=fmu1-...
   ```

2. **Verify the update semantics once.** The script refuses to write to the CRM until this has run:

   ```bash
   cd ~/claude/command-center/workers/patlive-intake
   python3 probe_property_update.py --dry-run   # shows what it would post
   python3 probe_property_update.py             # posts to test property 5693 only, restores it, writes state/update-semantics.json
   ```

   Verdict `merge` unlocks writes. Verdict `replace` means a partial post wipes other fields, and the intake needs the full post field list from the in-app API User Guide before it can go live.

3. **First real pass**, watching the output:

   ```bash
   python3 intake.py --dry-run            # lookups only, prints planned posts
   python3 intake.py                      # applies, marks emails, writes state
   ```

4. **Cron** (5-minute cadence, same log dir as the worker):

   ```
   */5 * * * * cd /home/mazer/claude/command-center/workers/patlive-intake && /usr/bin/python3 intake.py >> /home/mazer/claude/command-center/workers/logs/patlive-intake.log 2>&1 # PATLIVE-INTAKE
   ```

## Everyday commands

```bash
python3 intake.py --eml path/to/saved.eml --dry-run   # process a saved email (no Fastmail needed)
python3 intake.py --since 2026-09-01                  # widen the search window
python3 intake.py --reprocess --eml saved.eml         # ignore the processed ledger (the markers still dedupe)
python3 intake.py --reprocess --since 2026-09-20      # backfill: re-pull already-keyworded emails, add whatever is missing
python3 intake.py --skip-notes                        # legacy comment + status only, no 2.0 Record Note
python3 intake.py --reprocess --reformat-notes --since 2026-09-16   # rewrite old plain-text 2.0 notes in the HTML layout (hand-edited notes untouched)
python3 -m unittest discover -s . -v                  # offline tests
```

Exit code 1 means at least one email errored (still unprocessed, will be retried next run). Unmatched refs are logged with `UNMATCHED` and never retried automatically: fix the ref by hand in the CRM, then re-run with `--eml` on the saved message if you want the comment applied.

## Credentials

- Investment Dominator key: `ID_API_KEY` / `ID_ACCOUNT_URL` env vars, else `~/claude/followupdominator/.credentials/investment_dominator.env` (shared with followupdominator; override the path with `ID_CREDENTIALS_FILE`).
- Investment Dominator 2.0 (Record Notes): `ID_V2_USERNAME` / `ID_V2_PASSWORD` (the CRM login) and `ID_CRM_ID` (e.g. `crm-01444`, else derived from the account URL), same env-then-file lookup. The legacy API key does not work on the 2.0 API; it logs in for a 1-hour JWT on first use each run. Endpoint notes: `~/claude/followupdominator/api_reference_investment_dominator.md`, "Investment Dominator 2.0 API".
- Fastmail: `FASTMAIL_API_TOKEN` env var, else project-root `.env.local`.

Nothing here logs the key or token.
