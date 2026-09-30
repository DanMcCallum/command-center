# land-comps

Jev-ranked vacant-land comp finder. MVP scope: Park County, CO (FIPS 08093). See `PRD.md`.

## Setup

```
cp .env.example .env   # fill in TYPESAFE_API_KEY, APIFY_TOKEN, REGRID_TOKEN
cp config.example.yaml config.yaml   # fill in actor IDs and county-specific values
uv sync
```

## Gates

Run from the repo root:

```
uv --directory land-comps run ruff check .
uv --directory land-comps run mypy --strict src
uv --directory land-comps run pytest -q
```

## CLI

```
uv --directory land-comps run comps --help
uv --directory land-comps run comps version
uv --directory land-comps run comps subject <APN|address>   # needs config.yaml and REGRID_TOKEN
uv --directory land-comps run comps ingest county --sales <csv> --parcels <csv> [--centroids <csv>]
uv --directory land-comps run comps ingest geocode-county [--limit N]   # needs REGRID_TOKEN
uv --directory land-comps run comps find <APN|address> [--radius R] [--top N] [--include-rejects] [--out results.json|results.csv] [--resolve-apn]
```

`comps find` needs `TYPESAFE_API_KEY`, `REGRID_TOKEN`, and (for the LandWatch/Realtor.com sources) `APIFY_TOKEN`. `--radius` sets the initial search radius and is rejected above `search.max_radius_mi` (never more than 5 mi). Every run is saved to the `runs` / `run_results` tables.
