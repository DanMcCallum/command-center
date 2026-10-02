# eBay long-form listings

eBay is the one platform in the rotation with no practical description length. The listings that sell land there look nothing like a 1,500-character Land.com ad: they are long, repetitive on purpose, and answer every question a nervous first-time buyer has before they ask it. The reference is a sold no-reserve listing the coach pointed at (eBay item 206391295800, 1.5 acres near Lovelock, NV, sold 2026-08-02 for $2,850) plus two live listings from the same seller in Elko County, one cash and one 0% land contract. Their structure is captured in `listing-template.md`; nothing in this folder copies their wording.

## Files

- `listing-template.md`: the block-by-block skeleton the `generate-ad` workflow follows for any platform whose `config/ad-platforms.json` entry has `format: "long-form"`. Read this first if the eBay output looks wrong.
- `seller-terms.md`: our own business terms (fee, payment methods, deed, guarantee, contact). Operator-maintained. The workflow uses only filled-in lines and skips anything marked `TODO`.
- `areas/<slug>.md`: one reusable area sheet per selling area. The workflow picks the sheet whose `matches:` list contains the property's town, ZIP, or county. Each sheet has two sections: `## Usable now` (the workflow may write from it) and `## Needs operator confirmation` (off-limits until you move an item up). `montello-nv.md` is the first sheet because most of our inventory is there.

## How it plugs in

- Ad Builder form: eBay is an opt-in checkbox (off by default). Tick it to get an `ebay.md` in the task's output folder alongside the other platforms.
- Generation: `~/.claude/commands/generate-ad.md`, Step 3L. Headline craft is unchanged (80-character eBay title). The description skips the 90 to 100% length window and is instead judged on template completeness.
- Output file: `outputs/<taskId>/ebay.md` keeps the usual `## HEADLINE` and `## DESCRIPTION` sections so the existing parser reads it, and adds `## ITEM SPECIFICS` with the eBay form fields (acreage, state, city, ZIP, zoning, type, APN).
- Posting: manual for now. `config/posting-platforms.json` lists `ebay` with `enabled: false`, so there is no Publish button. On the task card, the **Listing HTML** button next to `ebay.md` opens a modal that renders the description into the reference listing's HTML layout (pale panel, caps headers, the task's photos placed between blocks) and copies it. In eBay's description editor click the `</>` HTML toggle, paste, switch back to Standard. The title and item specifics are in the same modal. Details and the image-host setup: `specs/ebay-html-listing.md`.
- Area photos: put area-wide images (town, landmarks, public land, maps you have rights to) in a folder named after the area sheet, for example `areas/montello-nv/`. The renderer inserts them under the LOCATED IN block of every listing that matches that sheet. Lot-specific photos stay in the task's `photos/` folder.

## Things to know before the first listing

- eBay charges an insertion fee for Real Estate listings regardless of outcome. Check the current fee schedule before posting.
- Bids on eBay real estate listings are expressions of interest, not binding contracts, which is why the reference seller makes buyers message first and then ends the listing with them as the winner. Decide in `seller-terms.md` whether to copy that pre-screen step.
- The description is built only from task metadata, the area sheet's usable section, and filled-in seller terms. If the output is thin, the fix is to add facts to those three places, not to loosen the rule. `notes.md` for each task lists the facts that would have helped.
- Copyright: the reference listings are another seller's work. The template borrows their structure and section order, which is not protected; it does not reuse their sentences, and the workflow is told the same.
