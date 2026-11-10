#!/usr/bin/env python3
"""Build the listing.json one poster session works from.

Usage: build-listing.py <project_root> <workspace_dir> <platform> <dry 0|1>  < task.json

Reads <workspace>/<platform>.md (the sections the generate-item-ad command
writes) and the task metadata on stdin, prints the listing as JSON. Exits 1
with a one-line reason on stderr when something the form needs is missing.
"""
import json
import os
import re
import sys


def sections(text):
    """Map '## NAME (…)' headings to their body text."""
    out, name, buf = {}, None, []
    for line in text.splitlines():
        m = re.match(r"^##\s+(.+?)\s*$", line)
        if m:
            if name is not None:
                out[name] = "\n".join(buf).strip()
            name = re.sub(r"\s*\(.*\)\s*$", "", m.group(1)).strip().upper()
            buf = []
        elif name is not None:
            buf.append(line)
    if name is not None:
        out[name] = "\n".join(buf).strip()
    return out


def main():
    root, workspace, platform, dry = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
    task = json.load(sys.stdin)
    meta = task.get("metadata") or {}

    ad_path = os.path.join(workspace, platform + ".md")
    if not os.path.isfile(ad_path):
        sys.exit("no ad file at %s" % os.path.relpath(ad_path, root))
    sec = sections(open(ad_path, encoding="utf-8").read())
    title = " ".join(sec.get("HEADLINE", "").split())
    description = sec.get("DESCRIPTION", "")
    if not title or not description:
        sys.exit("%s.md has no HEADLINE or DESCRIPTION section" % platform)

    price = meta.get("price_usd")
    if not isinstance(price, (int, float)) or price <= 0:
        sys.exit("metadata.price_usd is missing")

    cfg = json.load(open(os.path.join(root, "config", "item-ad-platforms.json"), encoding="utf-8"))
    pcfg = (cfg.get("platforms") or cfg).get(platform) or {}
    post_cfg = json.load(open(os.path.join(root, "config", "posting-platforms.json"), encoding="utf-8"))
    ppost = (post_cfg.get("platforms") or post_cfg).get(platform) or {}
    cap = pcfg.get("headline_max")
    if isinstance(cap, int) and len(title) > cap:
        sys.exit("headline is %d chars, over the %d cap" % (len(title), cap))

    photo_dir = os.path.join(workspace, "photos")
    photos = []
    if os.path.isdir(photo_dir):
        photos = sorted(
            os.path.join(photo_dir, f)
            for f in os.listdir(photo_dir)
            if re.search(r"\.(jpe?g|png|webp)$", f, re.I)
        )
    photo_cap = ppost.get("manual_photo_cap") or 10
    if not photos:
        sys.exit("no photos in %s" % os.path.relpath(photo_dir, root))

    json.dump(
        {
            "task_id": task.get("id"),
            "platform": platform,
            "dry_run": dry == "1",
            "title": title,
            "price": int(price) if float(price).is_integer() else price,
            "description": description,
            "category": " ".join(sec.get("CATEGORY", "").split()) or None,
            "item_category": meta.get("category"),
            "condition": " ".join(sec.get("CONDITION", "").split()) or None,
            "photos": photos[:photo_cap],
            "photos_left_out": [os.path.basename(p) for p in photos[photo_cap:]],
            "accept_offers": bool(meta.get("accept_offers")),
            "payment_types": ["Cash", "Venmo", "Zelle"],
            "groups": ppost.get("groups") or [],
        },
        sys.stdout,
        indent=1,
    )


if __name__ == "__main__":
    main()
