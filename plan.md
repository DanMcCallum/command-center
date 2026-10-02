# Plan: Land Comps MVP (Park County, CO)

Build the Python `comps` CLI specified in **`land-comps/PRD.md`**. That PRD is the source of truth: read it in full (architecture, Jev question design, user stories US-001 to US-023, non-goals, technical considerations). This file only adds run constraints.

## Scope walls (hard rules)

- All code, tests, fixtures, config, and docs live under `land-comps/`. Do not create, edit, or delete anything outside `land-comps/`. This repo also holds a production Next.js dashboard (`dashboard/`), workers, and dashboard specs (`specs/`); none of it is part of this project and none of it may be touched.
- Project-level notes and learnings go in `land-comps/progress.txt` (append-only) and `land-comps/README.md`, not in the root `specs/` directory.

## Constraints

- **County is Park County, Colorado (FIPS 08093).** Nothing is hardcoded to a county; county specifics live in `config.yaml`.
- **Fixtures only.** No API keys, county files, or CRM exports exist yet. Every story builds and tests against hand-built fixtures in `land-comps/tests/fixtures/` and fakes. No network calls in tests or gates. Real data gets wired later by the operator.
- Park County APN/schedule-number format is unconfirmed: `normalize_apn` pads to `county.apn_length` from config, and fixtures use a placeholder format.
- Stack per the PRD: Python 3.12+, `uv`, typer, pydantic v2, httpx, sqlite3, typesafe-sdk, apify-client, rich, pytest, mypy --strict, ruff.

## Gates (run from repo root after every step)

```
uv --directory land-comps run ruff check .
uv --directory land-comps run mypy --strict src
uv --directory land-comps run pytest -q
```

Step 1 must leave all three passing (the US-001 scaffold). Every later step must keep them green.

## Step shaping

Group the 23 user stories into dependency-ordered steps that keep the PRD's story order. Keep US-IDs in each step's title or body so progress can be traced back to the PRD.
