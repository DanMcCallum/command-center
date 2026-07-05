# Headlines corpus

Standalone headline examples used for headline-craft pattern matching. Distinct from `../ads/`, which holds full sold-ad bodies (headline + description + frontmatter).

Use this folder when you have a strong headline you want to remember even if the full ad body isn't available, or when backfilling style reference from historical campaigns.

## Files

- `sold-titles.md` — 25 proven headlines from sold listings (imported from `Ad Titles.docx`, gold status).

## How the Ad Builder uses this folder

At generation time, every file in `headlines/` is loaded alongside `ads/`. The headlines corpus informs **headline drafting only** (step 3 of `generate-ad`): cadence, clause ordering, anchor density, offer phrasing. The `ads/` corpus remains the source for selling angles and description voice.

When borrowing structure, always re-check the result against `skills/anti-slop.md`. The older sold titles use em dashes and stacked exclamation marks that the current writing rules forbid.

## Adding entries

Drop a markdown file in this folder. Frontmatter is optional but useful:

```yaml
---
source: "where these came from"
status: gold | draft
type: headline-corpus
note: "any caveats about how to weight these"
---
```

Body can be a numbered list of headlines, or organized by sub-section (by state, by acreage tier, by buyer type) if you have enough volume to warrant it.
