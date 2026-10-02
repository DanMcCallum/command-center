#!/usr/bin/env python3
"""One-shot probe: does property_post.php with p_id MERGE or REPLACE?

intake.py appends a comment and changes the status with a minimal post
(p_id, p_type, p_status, or_id, or_fname, or_lname, p_comments). If the API
treats an update as a full replace, that post would blank every other field
on the record (acres, tax, owner2, tags...). Nobody has verified this either
way, and there is no property delete endpoint, so this probe runs the exact
same shape of post against the labeled [API TEST] property (id 5693, created
2026-07-03 for the call-flow test batch) and diffs the record before/after.

It then restores the original comment and status with a second post and
writes the verdict to state/update-semantics.json. intake.py refuses live
property writes until that file says "merge".

Usage:  python3 probe_property_update.py            (writes only to 5693)
        python3 probe_property_update.py --dry-run  (reads only)
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
import time

import intake

TEST_PROPERTY_ID = "5693"
TEST_APN = "TEST-CALL-FLOW-001"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    key, url = intake.id_credentials()
    client = intake.IDClient(key, url)
    before = client.get_property(TEST_PROPERTY_ID)
    if not before or before.get("property_apn") != TEST_APN:
        print(f"refusing: property {TEST_PROPERTY_ID} is not the test record (apn={before and before.get('property_apn')!r})")
        return 2
    print("before (non-empty fields):")
    print(json.dumps({k: v for k, v in before.items() if v not in ("", [], None)}, indent=1))

    stamp = dt.datetime.now().strftime("%Y-%m-%d %H:%M")
    probe_block = f"[API TEST probe {stamp}] intake update-semantics probe; restored automatically."
    payload = intake.update_payload(before, intake.append_comment(before.get("property_comment", ""), probe_block), advance_status=False)
    print("\nprobe post payload:", json.dumps(payload, indent=1))
    if args.dry_run:
        print("dry-run: nothing posted")
        return 0

    client.post_property(payload)
    time.sleep(1.5)
    after = client.get_property(TEST_PROPERTY_ID) or {}
    bad = intake.unexpected_changes(before, after)
    comment_ok = probe_block in (after.get("property_comment") or "")
    print("\nunexpected changes:", json.dumps(bad, indent=1) if bad else "none")
    print("comment landed:", comment_ok)

    # Restore the original comment (status was re-sent unchanged).
    restore = intake.update_payload(before, before.get("property_comment", ""), advance_status=False)
    client.post_property(restore)
    time.sleep(1.5)
    restored = client.get_property(TEST_PROPERTY_ID) or {}
    leftover = {k: (before.get(k), restored.get(k)) for k in before
                if before.get(k) != restored.get(k) and k not in intake.EXPECTED_CHANGED_FIELDS}
    print("after restore, fields still differing from original:", leftover or "none")

    verdict = "merge" if (not bad and comment_ok) else "replace"
    intake.STATE_DIR.mkdir(parents=True, exist_ok=True)
    intake.SEMANTICS_FILE.write_text(json.dumps({
        "verdict": verdict, "probed_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "test_property_id": TEST_PROPERTY_ID, "unexpected_changes": bad,
        "comment_landed": comment_ok, "restore_leftover": leftover,
    }, indent=1))
    print(f"\nVERDICT: {verdict}  (written to {intake.SEMANTICS_FILE})")
    if verdict != "merge":
        print("Property writes stay locked. A replace-style API needs the full post field list "
              "(in-app Profile > API User Guide) before intake.py can update records safely.")
    return 0 if verdict == "merge" else 1


if __name__ == "__main__":
    sys.exit(main())
