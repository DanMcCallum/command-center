# Knowledge base

Corpus of real-estate ads grounded in property facts and outcomes. The Ad Builder reads from here at generation time to find patterns that closed deals on similar properties.

## `ads/`

Full sold-ad corpus (headline + description + frontmatter), one file per sold listing. Filename = a stable slug (e.g. `apache-county-40ac-blm.md`).

### Format

```markdown
---
location: "Apache County, AZ"           # county + state
acreage: 40
price_usd: 18500
sold_on: "2026-04-12"                   # YYYY-MM-DD
days_to_sale: 23
platform_sold_on: "LandWatch"           # which site produced the buyer
features:                               # tags Claude uses for similarity matching
  - "off-grid"
  - "year-round-access"
  - "borders-blm"
buyer_type: "out-of-state-retiree"      # optional but useful
access: "dirt-year-round"               # paved | dirt-year-round | dirt-seasonal | none
utilities: ["none"]                     # subset of: power, water, septic, none
zoning: "rural-residential"
notes: "Repeat buyer referral closed in cash."
---

# HEADLINE
40 Off-Grid Acres Bordering BLM — Year-Round Road Access, $18,500

# DESCRIPTION
The full description body, exactly as posted on the platform that sold.
```

Two sections under the frontmatter: `# HEADLINE` and `# DESCRIPTION`. Anything between them is the headline; anything after `# DESCRIPTION` is the body. Plain markdown is fine.

## How to add an entry

Two ways, both end up in this folder:

1. **One-click from the Ad Builder task page**: when an ad sells, open the task in the dashboard and hit **Save to knowledge base**. The modal pre-fills property facts from the original form submission; you fill in `sold_on`, `days_to_sale`, `platform_sold_on`, and paste the as-posted body (in case you edited the generated draft before posting).
2. **By hand**: drop a markdown file matching the format above into `ads/`. Useful for backfilling historical sold listings.

## Backfilled entries

Some entries were backfilled from public listing data where the actual selling headline was not recoverable. For those entries the `# HEADLINE` field contains only the property's address/label and should **not** be treated as gold-standard headline copy by the generator — use the description and frontmatter facts, but learn headline craft only from entries where the headline is a real marketing line.

## `headlines/`

Standalone headline corpus for headline-craft pattern matching only. Distinct from `ads/`, which carries full bodies and frontmatter. See `headlines/README.md` for format and current contents.

Use `headlines/` when you have a strong headline worth remembering without a full ad body, or when backfilling historical campaign titles.

## `property-nicknames.md`

Registry of the short call-attribution nickname assigned to each property (e.g. "Whispering Pines"). Generated once per property by the Ad Builder (`generate-ad.md` step 2b) and appended to every ad description as a `(Property: Nickname)` tag. Not sales copy — see the file itself and `~/claude/followupdominator/design_patterns.md` section 5b for why this exists.

## How the corpus is used

At generation time, Claude reads every file in `ads/`, ranks them by similarity to the new property (location, acreage, price tier, feature overlap), and uses the top 5 as primary patterns for angle selection, voice, and concrete detail. Higher-success entries (shorter `days_to_sale`) get slightly more weight.

Claude also reads every file in `headlines/` and uses it to pattern-match headline craft (cadence, clause order, anchor density, offer phrasing) when drafting the per-platform headlines.

The more entries you accumulate, the sharper future generations get. There is no minimum; even 3-5 strong entries already raises the floor on output quality.
