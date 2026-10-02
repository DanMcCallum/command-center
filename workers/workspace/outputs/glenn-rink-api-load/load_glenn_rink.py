#!/usr/bin/env python3
"""Load the 35 Glenn R Rink parcels into Investment Dominator via property_post.php.

Bypasses the broken UI import wizard entirely.

Key behaviours (all established empirically — see field-map-post.md):
  * `p_status` on POST is a DIFFERENT enum from the CSV/export value.
    CSV `6` (Pending Preliminary Research) must be sent as POST `3`.
  * County is stored verbatim; we normalise `PINAL COUNTY` -> `Pinal`.
  * Unknown/export-only columns are silently dropped by the API, so we send
    only the 19 verified fields.
  * `or_id=6240` attaches to Glenn's existing owner record (no duplicate owner).
  * Posting with `p_id=` UPDATES in place (full replace) — used for repairs.

Safety: this script SKIPS any APN that already exists under owner 6240, so it is
idempotent and re-running it will not create duplicates. ID has no property
delete endpoint, so that guard matters.

Usage:
    python3 load_glenn_rink.py --dry-run     # show payloads, post nothing
    python3 load_glenn_rink.py               # post missing records
"""

from __future__ import annotations

import argparse
import csv
import json
import pathlib
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ENV = "/home/mazer/claude/followupdominator/.credentials/investment_dominator.env"
CSV = ("/home/mazer/claude/command-center/operator-input/seller-submissions/"
       "2026-08-03-glenn-rink-id-import.csv")
OUT = pathlib.Path(__file__).resolve().parent
RAW = OUT / "raw"
OWNER_ID = "6240"
PACE = 1.2  # seconds between requests; production API, no documented limits

# CSV/export p_status -> POST p_status. Verified live against stored names.
STATUS_EXPORT_TO_POST = {
    "1": "1",   # Prospect
    "2": "2",   # Mailed Letter 1
    "6": "3",   # Pending Preliminary Research   <-- the one this load needs
    "7": "4",   # Offers Sent
    "9": "5",   # Open Escrow - Detailed Research
    "11": "6",  # Complete/ Ready To Sell
    "12": "7",  # Found Buyer - Open Escrow
    "20": "11", # FILE CLOSED
}

# CSV column -> POST field. Only fields the API actually echoes back.
FIELD_MAP = {
    "p_type": "p_type",
    "p_apn": "p_apn",
    "Property State": "p_state",
    "Property County": "p_county",
    "p_address": "p_address",
    "p_city": "p_city",
    "p_zip": "p_zip",
    "p_legal_description": "p_legal_description",
    "p_comments": "p_comments",
    "or_id": "or_id",
    "or_fname": "or_fname",
    "or_lname": "or_lname",
    "o_type": "o_type",
    "or_email": "or_email",
    "m_address": "m_address",
    "m_city": "m_city",
    "m_state": "m_state",
    "m_zip": "m_zip",
}


def creds() -> tuple[str, str]:
    cfg = {}
    for line in open(ENV):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            cfg[k.strip()] = v.strip().strip('"').strip("'")
    return cfg["ID_API_KEY"], cfg["ID_ACCOUNT_URL"].rstrip("/")


API_KEY, ACCOUNT_URL = creds()


def call(endpoint: str, **params) -> tuple[int, str]:
    body = dict(params)
    body["key"] = API_KEY
    data = urllib.parse.urlencode(body).encode()
    req = urllib.request.Request(
        f"{ACCOUNT_URL}/my/api/{endpoint}",
        data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


def normalise_county(raw: str) -> str:
    """`PINAL COUNTY` -> `Pinal`. ID stores verbatim, so we clean it here."""
    name = raw.strip()
    if name.upper().endswith(" COUNTY"):
        name = name[: -len(" COUNTY")]
    return name.title()


def build_payload(row: dict) -> dict:
    payload = {}
    for csv_col, post_field in FIELD_MAP.items():
        val = (row.get(csv_col) or "").strip()
        if not val:
            continue
        if post_field == "p_county":
            val = normalise_county(val)
        payload[post_field] = val

    export_status = (row.get("p_status") or "").strip()
    post_status = STATUS_EXPORT_TO_POST.get(export_status)
    if post_status is None:
        raise SystemExit(f"Unmapped p_status {export_status!r} for APN {row['p_apn']}")
    payload["p_status"] = post_status
    return payload


def existing_apns() -> dict[str, str]:
    """APN -> property_id for everything already hanging off owner 6240."""
    status, body = call("property_get.php", oid=OWNER_ID, range="100")
    if not body.strip():
        raise SystemExit("Empty body reading owner properties (corrupt record?)")
    data = json.loads(body)
    props = data.get("property")
    if not isinstance(props, list):
        return {}
    return {r["property_apn"]: r["property_id"] for r in props}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    rows = list(csv.DictReader(open(CSV)))
    print(f"CSV rows: {len(rows)}")

    already = existing_apns()
    print(f"Already under owner {OWNER_ID}: {len(already)} "
          f"({', '.join(sorted(already)) or 'none'})")

    RAW.mkdir(parents=True, exist_ok=True)
    log = []
    posted = skipped = failed = 0

    for i, row in enumerate(rows, 1):
        apn = row["p_apn"].strip()
        payload = build_payload(row)

        if apn in already:
            print(f"[{i:2}/35] SKIP  {apn} — exists as property {already[apn]}")
            skipped += 1
            log.append({"apn": apn, "action": "skip",
                        "property_id": already[apn]})
            continue

        if args.dry_run:
            print(f"[{i:2}/35] DRY   {apn} -> {payload}")
            continue

        status, body = call("property_post.php", **payload)
        (RAW / f"post-{apn.replace('/', '_')}.json").write_text(body)
        ok = '"status":"Success"' in body
        print(f"[{i:2}/35] {'POST ' if ok else 'FAIL '} {apn} HTTP {status} "
              f"{body[:110]}")
        log.append({"apn": apn, "action": "post", "http": status,
                    "ok": ok, "response": body, "payload_sent": payload})
        posted += ok
        failed += (not ok)
        time.sleep(PACE)

    if not args.dry_run:
        (OUT / "load-log.json").write_text(json.dumps(log, indent=2))
    print(f"\nposted={posted} skipped={skipped} failed={failed}")


if __name__ == "__main__":
    main()
