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
```
