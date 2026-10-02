# land-comps handoff

As of 2026-09-30 (evening). Everything below is on `feat/ad-posting`; the parcel-spine work after commit `984032b` is uncommitted in the working tree.

The tool lives in `land-comps/` and runs with `uv --directory land-comps run comps ...` from the repo root. Gates are ruff, mypy strict, and pytest (328 tests), all green.

## Where things stand

| Piece | Status |
|---|---|
| Pipeline code (US-001 to US-023) | Complete, fixture-tested |
| Parcel spine | **County layer, loaded.** `comps ingest parcels` pulled 42,441 Park County parcels (polygons, centroids, acreage, land type, situs address, zoning) from the county's ArcGIS server into `county_parcels`. `parcels.lookup: county` in config; Regrid is no longer needed for Park County |
| Regrid token | Still the sandbox token (cannot resolve Park County). Only needed if `parcels.lookup` is switched back to `regrid`, e.g. for a second county |
| TypeSafe key (Jev) | Verified live |
| Apify token | Verified live, free plan |
| Realtor.com actor | Verified live, for-sale and pending listings only |
| LandWatch actor | Wired to its schema, but the actor is broken upstream (see below) |
| Park County assessor files | Parcels and centroids CSVs written by `ingest parcels` to `data/county/park/`. **Sales file still missing** (no public bulk download; request from County.GIS@parkcountyco.gov) |
| County config values | `column_mapping` and `vacant_land_codes` set for the parcel layer; `excluded_deed_types` unconfirmed until the sales file arrives |
| CRM benchmark export | Not created |

## Remaining work, in order

1. **Park County sales file.** The county publishes no bulk download; email County.GIS@parkcountyco.gov for a sales extract (schedule number, sale date, sale price, deed type, ideally 36 months). When it arrives, rename its header to the `column_mapping` names in `config.yaml` (`SCHEDULE_NUMBER`, `SALE_DATE`, `SALE_PRICE`, `DEED_TYPE`) or change the mapping, confirm `excluded_deed_types`, and load:

   ```
   uv --directory land-comps run comps ingest county --sales data/county/park/sales.csv --parcels data/county/park/parcels.csv --centroids data/county/park/centroids.csv
   uv --directory land-comps run comps ingest geocode-county
   ```

   Both files after `--sales` are already on disk from `ingest parcels`, and `geocode-county` now fills coordinates from the local table at no cost.

2. **Parcel spine upkeep.** `uv --directory land-comps run comps ingest parcels` re-pulls the county layers (about 20 seconds) and replaces `county_parcels`; run it when the county updates its data. `comps subject` accepts a schedule number, an assessor account number (`R0031409`), or a situs address. About 2% of parcels have a centroid outside their own polygon (L-shaped lots, multi-part parcels); `by_point` still resolves any listing coordinate that falls inside a parcel.

3. **First real run.**

   ```
   uv --directory land-comps run comps find "<Park County APN or address>"
   ```

   Expect the LandWatch source to appear in `source_errors` on every run until the actor is resolved. The run still completes on county sales plus Realtor.

4. **Benchmark.** Export 10 to 20 Park County subjects with their CRM comps to `data/benchmark/crm_comps.csv` in the US-021 column format from `PRD.md`. Then:

   ```
   uv --directory land-comps run comps bench import data/benchmark/crm_comps.csv
   uv --directory land-comps run comps bench run
   # hand-label the disagreement rows in the review CSV, then
   uv --directory land-comps run comps bench score-review reports/review_<ts>.csv
   ```

   Targets: candidate recall >= 70%, ranking agreement >= 60%, reviewed precision >= 70%.

5. **LandWatch.** See the next section.

6. **Realtor description text.** The actor only emits listing descriptions with `getDetails` on, which fetches every detail page and costs more. It is off, so Jev gets no Realtor description. Flip it in `build_input` in `src/land_comps/realtor.py` if the benchmark shows Realtor comps scoring poorly.

## The LandWatch actor problem

The configured actor is `sian.agency/landwatch-property-scraper` (Apify ID `aGkwEeF4X60qQWB7v`), last updated by its author on 2026-09-21.

Every search sent on 2026-09-30 finished with Apify status `SUCCEEDED` but produced a single row instead of listings:

```
status: "error"
errorMessage: "LandWatch returned a page without its data payload. This usually means the URL is not a search or property page."
```

Inputs tried, all with the same result:

- `locations: ["Park County, CO"]`
- `locations: ["Park County, Colorado"]`
- `locations: ["Colorado"]` (the README's own state-only pattern)
- `searchUrls` with a direct LandWatch URL for Park County undeveloped land, with and without `?status=sold`
- the county location with `proxyConfiguration: {useApifyProxy: true}`

Run IDs for reference: `iFAxglPDJUOII6tqO`, `oZ6EWEuezbapxZ1PQ`, `qgf4VegbonbeQzsea`, `QgZkCOEAfIuGyZ8VA`, `o9rUOrByxtJ859TPo`, `l9AWy2hupMYB1EUwR`, `YlKSVBv4YHJrv3rTd`.

The run log shows two pages fetched and zero rows saved. LandWatch also returned HTTP 403 to a plain fetch from this box, so the likely cause is LandWatch blocking the actor's requests or a site change the author has not caught up with. The actor's store stats show 35 "succeeded" runs in the last 30 days, which is consistent with other users getting the same empty-but-successful result.

**What the code does about it.** `src/land_comps/landwatch.py` now uses the actor's documented input (county location, `undeveloped-land`, one run for `available` and one for `sold`, `maxResults` from config) and its documented output fields. An error row raises a `SourceError`, so each run records the outage in `source_errors` rather than silently shrinking the candidate pool. The output field mapping for address, dates, and land attributes is unconfirmed because no real row has ever come back. When the actor starts working, inspect one raw item and adjust the `_F` field table at the top of the module.

**Options, in rough order of effort:**

1. File an issue at https://apify.com/sian.agency/landwatch-property-scraper/issues and wait. Cheapest, no control over timing.
2. Pick a different LandWatch or Land.com actor from the Apify store, run it once with a 5-item cap, and remap the field table. The source class is written so only `build_input` and `_F` change.
3. Drop LandWatch for the POC. County sales already cover recorded sold comps and Realtor covers active listings. The main loss is LandWatch's land attributes (road frontage, utilities, topography), which feed Jev's access and utilities question.

## Realtor.com actor facts

`scrapemind/realtor-com-scraper` (Apify ID `WkFWtZ7XTE8ej4G8Q`):

- Only accepts search URLs with a `City_ST` or `County-Name_ST` location segment. A bare ZIP crashes its URL parser. The source searches `Park-County_CO/type-land` and enforces the radius by GPS afterwards.
- Ignores Realtor.com's `show-recently-sold` filter and returns the same for-sale items, so it never yields sold comps. Recorded sales come only from the county sales file.
- Some items arrive without coordinates. Those are kept only when their `postal_code` matches the subject's ZIP.
- Output is flat snake_case (`csvFriendly`), with `property_type: "land"` for lots. `last_sold_price` and `last_sold_date` on a for-sale item are that parcel's prior sale and are kept in `raw` only.
- Verified end to end: a 3-acre Hartsel subject at a 5-mile radius returned 11 candidates through the real runner, and a second call hit the cache.

## Housekeeping

- `.foreman/` still holds the original build run's evidence and PRDs. The run worktree and branch are already removed.
- `land-comps/.env` and `land-comps/config.yaml` are gitignored and hold real values. Never commit them. `data/` (the 40 MB SQLite file with the parcel spine, plus the CSVs) is gitignored too; rebuild it with `ingest parcels`.
- `config.yaml` needs `county.name` and `county.state` (already set to `Park County` / `CO`). Without both, the two listing sources report a `SourceError` naming those keys.
