# PRD: eBay as an opt-in long-form ad platform

**Status:** Implemented (2026-09-07). Durable facts summarized in [specs.md](specs.md); read this file only when changing the eBay template or the long-form branch of `generate-ad`.

## Introduction

Every platform in the Ad Builder rotation caps a description at 1,500 characters and a headline at 60 to 100. eBay is different: its Real Estate > Land category has an 80-character title and no practical description limit, and the listings that sell there are long, exhaustive, and structured like a buyer's guide. The coach pointed at a sold no-reserve listing (eBay item 206391295800, 1.5 acres near Lovelock NV, sold 2026-08-02 for $2,850) as the model. eBay's description endpoint had already purged that item's body, so its structure was recovered from two live listings by the same seller in Elko County (items 205086753982, cash no-reserve, and 366601359584, 0% land contract), which share the same template.

This feature adds `ebay` as an opt-in platform whose description is generated from a block-by-block template rather than a character window, with a reusable Montello-area fact sheet because most of our inventory is there.

## Goals

- eBay is a checkbox on the Ad Builder form, unchecked by default, that produces `outputs/<taskId>/ebay.md` alongside the other platforms
- The eBay description follows a fixed block structure captured from the reference listings (structure only, no copied sentences)
- Everything in the description traces to task metadata, an operator-curated area sheet, or operator-curated seller terms; the workflow cannot pad with invented facts, reputation numbers, or the reference seller's claims
- Montello-area listings reuse one fact sheet so area copy is consistent across many lots
- Nothing downstream breaks: the output parser, DREAMS audit, nickname tag, and posting agent all keep working, and eBay stays a manual-post platform

## User Stories

### US-001: Platform config and form
- [x] `config/ad-platforms.json` gains `ebay` with `headline_max: 80`, `description_max: 40000` (sanity ceiling), `format: "long-form"`, and pointers `template`, `seller_terms`, `areas_dir`; `_doc` explains the long-form opt-out of the 90-100% window
- [x] `config/posting-platforms.json` gains `ebay` with `enabled: false` (keys must match across the two files) and eBay sign-in / sell URLs as placeholders
- [x] `dashboard/app/ad-builder/page.tsx` adds `ebay` to `PLATFORMS` with `defaultChecked: false`; the initial checkbox state honors `defaultChecked ?? true`
- [x] `dashboard/components/SaveToKbModal.tsx` adds eBay to the "Sold on platform" list
- [x] Typecheck passes

### US-002: Knowledge-base template and inputs
- [x] `knowledge-base/ebay/listing-template.md`: blocks A through V in reference order, each REQUIRED or CONDITIONAL with its fact source; CASH vs FINANCED variants for the terms blocks; formatting rules (caps headers, `- ` bullets, no `#` headings inside the description); eBay title rules
- [x] `knowledge-base/ebay/seller-terms.md`: operator business terms seeded from the most recent ad task's `must_include`, every unconfirmed line marked `TODO`
- [x] `knowledge-base/ebay/areas/montello-nv.md`: `matches:` frontmatter (montello, 89830, elko county), a `## Usable now` section grounded in the sold-ad corpus (location, SLC drive time, Pilot Peak, BLM, a 20-entry comp list), and a `## Needs operator confirmation` section holding everything else
- [x] `knowledge-base/ebay/README.md` explains the folder and the posting caveats (insertion fee, non-binding bids)

### US-003: Workflow branch
- [x] `~/.claude/commands/generate-ad.md` (outside the repo; backup at `workers/workspace/notes/generate-ad.md.bak-2026-09-07`) gains Step 3L: extra inputs, closed fact sources, style, length rule, listing-format decision
- [x] Headline acronym rules name eBay as the mainstream platform that must say Public Land / Federal Land
- [x] Step 4b's 90% expansion floor and step 6's length-window precedence carve out long-form descriptions; a DREAMS fix may not drop a REQUIRED block
- [x] Output section documents the extra `## ITEM SPECIFICS` section in `ebay.md`

## Non-Goals

- No automated posting to eBay. The poster agent has no `ebay` entry in `POSTERS`; `enabled: false` keeps the Publish button hidden. Posting is copy-paste from `ebay.md` into eBay's listing editor.
- No new Ad Builder form fields. Facts flow through the existing metadata plus the two operator-maintained knowledge-base files.
- ~~No HTML listing design.~~ Superseded 2026-09-07 by [ebay-html-listing.md](ebay-html-listing.md): `ebay.md` stays plain text, and the dashboard renders it into the reference's HTML layout with photos on demand.
- No copying of the reference seller's copy, feedback, or reputation claims.

## Technical Considerations

- **Parser constraint:** `workers/posting/parse-ad-output.ts` ends a section at the next line starting with `#`. A long-form description therefore must not contain markdown headings. The template, the platform `buyer_profile`, and Step 3L all state this; it is the one invariant that would silently truncate a listing if broken.
- **Config is not importable by dashboard code** (AGENTS.md); the form keeps its own `PLATFORMS` list with keys matching `config/ad-platforms.json`.
- **Facts are gated by file section.** The area sheet's two-section layout is the mechanism that keeps unverified facts (drive distances, populations, growth statistics) out of listings until the operator confirms them. Moving an item up is the only way it enters copy.
- **Reference bodies:** the description frame for a live item is `https://itm.ebaydesc.com/itmdesc/<itemId>` (plain GET works; the older `vi.vipr.ebaydesc.com` endpoint returns `Gone`). Sold items lose their description a few weeks after the sale, so capture a reference listing's body while it is live.
