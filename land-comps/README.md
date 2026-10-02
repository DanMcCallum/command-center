# land-comps

Jev-ranked vacant-land comp finder. MVP scope: Park County, CO (FIPS 08093). See `PRD.md`.

## Setup

```
cp .env.example .env   # fill in TYPESAFE_API_KEY, APIFY_TOKEN (REGRID_TOKEN only if parcels.lookup is regrid)
cp config.example.yaml config.yaml   # fill in actor IDs and county-specific values
uv sync
uv run comps ingest parcels   # pull the county parcel + zoning layers into the local parcel spine (~20s)
```

## Gates

Run from the repo root:

```
uv --directory land-comps run ruff check .
uv --directory land-comps run mypy --strict src
uv --directory land-comps run pytest -q
```

## Operator prerequisites

- `config.yaml` (copy of `config.example.yaml`): county name/state and file paths, Apify actor IDs, scoring weights and gates.
- `.env`: `TYPESAFE_API_KEY` (Jev), `APIFY_TOKEN` (LandWatch and Realtor.com sources), and `REGRID_TOKEN` only when `parcels.lookup` is `regrid`.
- Parcel spine (`parcels.lookup`): `county` (default) resolves subjects, addresses, and points from `county_parcels`, filled by `comps ingest parcels` from the county's ArcGIS parcel and zoning layers (free, offline, one county). `regrid` uses the Regrid API instead (any county, capped by the monthly record limit).
- Park County sales CSV from the assessor, loaded with `comps ingest county`. `ingest parcels` writes the parcels and centroids CSVs it needs into `data/county/park/`.
- A CRM comps CSV for benchmarking (see PRD US-021 for columns), loaded with `comps bench import`.
- The SQLite database defaults to `data/land_comps.sqlite`; bench reports default to `reports/` (both gitignored).

## CLI

```
uv --directory land-comps run comps --help
uv --directory land-comps run comps version
uv --directory land-comps run comps ingest parcels [--parcels-url URL] [--zoning-url URL] [--out DIR]   # county parcel spine
uv --directory land-comps run comps subject <APN|account number|address>   # needs config.yaml and the parcel spine
uv --directory land-comps run comps ingest county --sales <csv> --parcels <csv> [--centroids <csv>]
uv --directory land-comps run comps ingest geocode-county [--limit N]   # free with the county spine; spends Regrid records otherwise
uv --directory land-comps run comps find <APN|address> [--radius R] [--top N] [--include-rejects] [--out results.json|results.csv] [--resolve-apn]
uv --directory land-comps run comps rescore <run_id> [--top N] [--include-rejects] [--out results.json|results.csv]
uv --directory land-comps run comps bench import <crm_comps.csv>
uv --directory land-comps run comps bench run [--reports-dir reports]
uv --directory land-comps run comps bench score-review reports/review_<ts>.csv
```

`comps find` needs `TYPESAFE_API_KEY`, `REGRID_TOKEN`, and (for the LandWatch/Realtor.com sources) `APIFY_TOKEN`. `--radius` sets the initial search radius and is rejected above `search.max_radius_mi` (never more than 5 mi). Every run is saved to the `runs` / `run_results` tables.

`comps rescore` re-scores a saved run with the current `scoring` config. It calls no provider and saves nothing.

## Benchmark workflow

1. `comps bench import <csv>` loads the CRM's comps per subject (re-importing replaces a subject's comps).
2. `comps bench run` runs `find` for every subject (same paid clients as `comps find`) and writes `bench_<ts>.md` (candidate recall, ranking agreement, filter loss, overlap@5 vs the PRD targets) and `review_<ts>.csv` (every disagreement, with a blank `human_label`).
3. Fill `human_label` with `good` or `bad` on the rows you can judge, keeping the file in the same directory as its bench report.
4. `comps bench score-review reports/review_<ts>.csv` appends reviewed precision of our top 5 (target >= 70%) and the share of CRM comps labeled bad to `bench_<ts>.md`. Top-5 comps that are CRM comps and CRM comps we tier excellent/good count as good; unlabeled rows are counted, left out of both ratios, and mark the result provisional. Re-run it after adding labels: the appended section is replaced.
