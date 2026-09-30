# PRD: Land Comps MVP (Jev-Ranked Vacant-Land Comp Finder)

## 1. Introduction

We comp vacant land manually or through the Investment Dominator CRM's AI comp tool, which broke when Zillow cut off its scraping. We need our own pipeline that takes a **target property (APN or address)** and returns **which nearby parcels (APN or address) are good comp candidates**, ranked, with the reasoning signals exposed.

This MVP is a proof of concept scoped to **one Colorado county (Park County, FIPS 08093)**, a disclosure state with downloadable assessor sales files. It blends two candidate sources:

1. **Park County assessor sales file:** authoritative recorded sold prices (the ground truth for "sold").
2. **Apify land scrapers** (LandWatch/Land.com and Realtor.com actors): active, pending, and sold land listings with rich land attributes (acreage, road frontage, utilities, topography, description text).

Candidates are resolved against the **Regrid parcel spine**, filtered by deterministic guardrails in code, and then judged by **Jev** (TypeSafe System One) with typed questions (Noul / Choice / Score). Code combines Jev's calibrated answers into a composite score and tier. The deliverable is a **Python CLI** (`comps`) and an **evaluation harness** that compares our output against the CRM tool's comps for the same subjects.

Source research: `../compass_artifact_wf-853397bd-1d6d-54ce-b999-e9761c29ce5a_text_markdown.md`.

## 2. Goals

- Given a Park County APN or street address, return a ranked list of comp candidates, each tagged `excellent | good | marginal | reject`, with APN and/or address, status (sold/active/pending), price, price/acre, distance, acreage, and source provenance.
- Clearly separate **recorded sold** comps from **listing (asking)** comps in all output.
- End-to-end run for one subject in **< 2 minutes** (cold cache) at **< $0.25 variable cost** per subject (Apify + Regrid overage + Jev).
- Survive the failure of any single data source (a broken scraper must degrade results, not crash the run).
- Produce an evaluation report against CRM comps for **10-20 benchmark subjects**, with these POC success targets:
  - **Candidate recall >= 70%:** of the CRM's comps, at least 70% appear in our candidate pool (before Jev).
  - **Ranking agreement >= 60%:** of CRM comps present in our pool, at least 60% land in our `excellent`/`good` tiers.
  - **Reviewed precision >= 70%:** of our top-5 per subject, at least 70% are judged acceptable after human review of disagreements.
- Keep every threshold, weight, and radius in a config file so tuning never requires code changes or re-running Jev (raw Jev answers are stored).

## 3. Prerequisites (human, before the Ralph loop starts)

These cannot be done by the agent and must exist before the stories that need them:

- [ ] API keys in `.env`: `TYPESAFE_API_KEY`, `APIFY_TOKEN`, `REGRID_TOKEN`.
- [ ] Choose Apify actor IDs (candidates from research: sian.agency LandWatch actor with "Sold Land Comparables"; one Realtor.com actor supporting sold mode + land/lot property type). Record them in `config.yaml`.
- [ ] Download Park County assessor **sales** and **parcel** files (plus a parcel centroid export from the county GIS portal if available) into `data/county/park/`.
- [ ] Identify Park County vacant-land use/class codes, deed-type codes, and the APN/schedule-number format; record them in `config.yaml` (`county.vacant_land_codes`, `county.excluded_deed_types`, `county.apn_length`).
- [ ] Export CRM comps for 10-20 Park County subjects to `data/benchmark/crm_comps.csv` (format in US-021).

Until prerequisites exist, stories use **hand-built fixtures** in `tests/fixtures/` so the loop is never blocked on network access.

## 4. Architecture Overview

```
comps find <APN|address>
  |
  |- 1. Resolve subject ...... Regrid (APN/address -> parcel: APN, centroid, acreage, zoning, land use)
  |
  |- 2. Gather candidates .... County sales (SQLite, radius query)      \
  |                            Apify LandWatch (sold + active)           |- fan-out; per-source failures logged
  |                            Apify Realtor.com (sold + active land)   /
  |
  |- 3. Normalize + dedupe ... APN match -> coord proximity + acreage -> normalized address
  |
  |- 4. Guardrails (code) .... distance, acreage band, recency, nominal price, deed type; auto-widen if thin
  |
  |- 5. Feature assembly ..... computed comparison facts + subject/candidate attributes -> Jev state
  |
  |- 6. Jev judgments ........ one request per candidate, 7 parallel typed questions, cached
  |
  |- 7. Composite + tier ..... weights + hard gates from config
  |
  |- 8. Output ............... rich table + JSON/CSV (with provenance and raw Jev answers)

comps bench run   -> metrics vs CRM comps + disagreement review CSV
```

**Principle (from TypeSafe guidance):** exact facts and arithmetic (distance, acreage ratio, months since sale, price/acre) are computed in code and *given* to Jev as state. Jev only answers the semantic judgments code can't make well (is this land meaningfully similar, is this sale arm's-length, are there red flags in the description).

## 5. Jev Question Design

One `system_one` request per (subject, candidate) pair, model `jev-latest`. State is a JSON object:

```json
{
  "subject":   { "apn": "...", "address": "...", "acreage": 5.1, "zoning": "RR-5", "land_use": "Vacant Residential",
                 "road_access": "county road", "utilities": ["electric at street"], "description": "..." },
  "candidate": { "source": "county_sales|landwatch|realtor", "status": "sold|active|pending",
                 "apn": "...", "address": "...", "acreage": 4.6, "zoning": "RR-5", "price": 85000,
                 "price_per_acre": 18478, "event_date": "2026-03-14", "deed_type": "WD",
                 "road_access": "...", "utilities": ["..."], "topography": "...", "description": "..." },
  "comparison": { "distance_miles": 1.8, "acreage_ratio": 0.90, "months_since_event": 6,
                  "same_zoning": true, "same_zip": true, "price_per_acre_vs_pool_median": 1.07 }
}
```

Questions (IDs are for code only and are not sent to the model; full meaning lives in the instructions):

| ID | Type | Instructions (abridged) | Criteria |
|---|---|---|---|
| `is_good_comp` | Noul | Would an experienced vacant-land investor use `candidate` as a comparable sale/listing to value `subject`? | true: similar land, market, and use; false: materially different in size, use, access, or market |
| `arms_length` | Noul | Does `candidate` look like an arm's-length, open-market transaction or listing? | false covers nominal prices, family/quitclaim/tax/foreclosure transfers, bundled multi-parcel sales |
| `physical_similarity` | Score | How similar is the candidate's land (terrain, buildability, vegetation, water, improvements) to the subject's? | 4 concrete levels, from "different land type (e.g., improved lot vs raw acreage)" to "essentially the same land type and buildability" |
| `access_utilities_similarity` | Score | How similar are legal/physical access and utility availability? | 4 levels, from "one is landlocked or off-grid while the other is road-front with utilities" to "same access type and utilities" |
| `market_similarity` | Score | How similar is the local market (neighborhood character, zoning/use, rural vs suburban), given `comparison.distance_miles` and zoning? | 4 levels |
| `red_flags` | Noul | Does the candidate's data or description reveal issues that distort price (landlocked, flood zone, HOA restrictions, severed mineral rights, owner-financed terms pricing, auction, partial interest)? | true/false |
| `quality_tier` | Choice | Overall comp quality for valuing `subject`. | `excellent`, `good`, `marginal`, `reject` (each with a one-line definition) |

Composite (computed in code, weights in `config.yaml`):

```
composite = w1*is_good_comp + w2*(physical/3) + w3*(access/3) + w4*(market/3)
            + w5*(1 - months_since_event/lookback) + w6*(1 - distance/max_radius)
            + w7*(status == "sold")

hard gates:  arms_length < 0.5          -> tier = reject
             red_flags   > 0.7          -> reject, or warn marker (per scoring.red_flag_policy)
final tier:  quality_tier.choice, demoted one level if composite < that tier's floor
             or quality_tier.confidence < min_confidence
```

All raw answers (probabilities, confidence, score legend) are persisted so weights can be re-tuned via `comps rescore` without re-calling Jev.

## 6. User Stories

Stack: Python 3.12, `uv`, `typer` CLI, `pydantic` v2 + `pydantic-settings`, `httpx`, `sqlite3` (stdlib), `typesafe-sdk`, `apify-client`, `rich`, `pytest`, `mypy --strict`, `ruff`. No network calls in tests (use fixtures and fakes).

### US-001: Project scaffold
**Description:** As a developer, I need a working Python project skeleton so every later story has a place to land.

**Acceptance Criteria:**
- [ ] `pyproject.toml` managed by `uv`, package `land_comps` under `src/`, console script `comps` -> `land_comps.cli:app`
- [ ] Dev deps: pytest, mypy, ruff; `mypy --strict src` configured in `pyproject.toml`
- [ ] `comps --help` runs and lists a `version` command
- [ ] `.env.example` with `TYPESAFE_API_KEY`, `APIFY_TOKEN`, `REGRID_TOKEN`; `.gitignore` excludes `.env`, `data/`, `*.sqlite`, `reports/`
- [ ] `ruff check` and `pytest` (one smoke test) pass
- [ ] Typecheck passes

### US-002: Config loading
**Description:** As an operator, I want all thresholds, weights, actor IDs, and county settings in one YAML file so I can tune without code changes.

**Acceptance Criteria:**
- [ ] `config.yaml` (committed as `config.example.yaml`) loads into a pydantic `Settings` model; secrets come from env
- [ ] Sections: `search` (initial_radius_mi=1, max_radius_mi=5 (hard ceiling: config validation rejects max_radius_mi > 5), acreage_ratio_min=0.33, acreage_ratio_max=3.0, lookback_months=24, max_lookback_months=36, min_candidates=8, nominal_price_floor=1000), `scoring` (weights w1-w7, tier floors, min_confidence, red_flag_policy=warn), `apify` (actor IDs, max_items, cache_ttl_days=7), `county` (fips=08093, apn_length, file paths, column_mapping, vacant_land_codes, excluded_deed_types), `regrid` (monthly_record_cap)
- [ ] Invalid config (e.g., acreage_ratio_min > acreage_ratio_max) raises a clear validation error; covered by a test
- [ ] Typecheck passes

### US-003: Domain models and SQLite schema
**Description:** As a developer, I need typed models and a local database so all stages share one data contract and results are cached.

**Acceptance Criteria:**
- [ ] Pydantic models: `Parcel` (apn, address, lat, lon, acreage, zoning, land_use, county_fips, zip), `Candidate` (source, sources[], source_id, status in {sold, active, pending}, apn?, address?, lat?, lon?, acreage?, price?, list_price?, sold_price?, price_per_acre?, event_date?, deed_type?, road_access?, utilities[], topography?, description?, url?, raw), `JevAnswers`, `CompResult`
- [ ] `db.py` creates tables: `parcels`, `county_sales`, `candidates`, `source_cache` (key, payload, fetched_at), `jev_cache` (key, response_json, input_tokens), `runs`, `run_results`
- [ ] `init_db()` is idempotent; a test creates the DB in a tmp dir twice without error
- [ ] Typecheck passes

### US-004: Geo and normalization utilities
**Description:** As a developer, I need deterministic helpers for distance, acreage comparison, and ID normalization so matching and guardrails are consistent.

**Acceptance Criteria:**
- [ ] `haversine_miles(lat1, lon1, lat2, lon2)`; test: known coordinate pair within 0.5% of expected distance
- [ ] `acreage_ratio(subject_acres, candidate_acres)` returns candidate/subject; None or zero input returns None
- [ ] `normalize_apn(raw, county_fips)` strips punctuation/whitespace and zero-pads to `county.apn_length` from config (real Park County format is unconfirmed; fixtures use a placeholder); tests for dashed and undashed inputs
- [ ] `normalize_address(raw)` uppercases, collapses whitespace, standardizes suffixes (ST, RD, DR, LN, AVE, CT) and unit markers; tests for 5 variants
- [ ] `looks_like_apn(text)` distinguishes APN input from street-address input; tests
- [ ] Typecheck passes

### US-005: Regrid client (parcel lookup)
**Description:** As the pipeline, I need to resolve an APN or address into a parcel with centroid and attributes.

**Acceptance Criteria:**
- [ ] `RegridClient.by_apn(apn, county_fips)`, `.by_address(address)`, `.by_point(lat, lon)` each return `Parcel | None`
- [ ] Responses cached in `source_cache` keyed by request; a cache hit makes no HTTP call (test with a fake httpx transport)
- [ ] A monthly record counter enforces `regrid.monthly_record_cap`; exceeding it raises `QuotaExceeded`
- [ ] Parses acreage, zoning, land use, and centroid from a fixture JSON in `tests/fixtures/regrid/`
- [ ] Typecheck passes

### US-006: `comps subject` command
**Description:** As a user, I want to resolve a target property and see its parcel attributes so I can confirm the subject is correct before comping.

**Acceptance Criteria:**
- [ ] `comps subject <APN|address>` prints APN, address, acreage, zoning, land use, lat/lon, ZIP in a rich table
- [ ] No match prints a clear message and exits with code 2
- [ ] Test via `typer.testing.CliRunner` with a fake Regrid client
- [ ] Typecheck passes

### US-007: County sales ingest (Park County)
**Description:** As an operator, I want to load the county's sales and parcel files into SQLite so recorded sold prices are queryable.

**Acceptance Criteria:**
- [ ] `comps ingest county --sales <path> --parcels <path> [--centroids <path>]` loads CSV files using `county.column_mapping`
- [ ] Rows stored in `county_sales` with apn, sale_date, sale_price, deed_type, land_use_code, acreage, lat/lon (from the centroid file when provided)
- [ ] Rows with `land_use_code` in `vacant_land_codes` get `is_vacant=1`; others are kept but excluded from candidate queries
- [ ] Re-running ingest upserts (no duplicate rows); test with a 20-row fixture
- [ ] Prints counts: total rows, vacant rows, vacant rows missing coordinates
- [ ] Typecheck passes

### US-008: Backfill missing county-sale coordinates
**Description:** As the pipeline, I need coordinates on county sales so they can be radius-searched.

**Acceptance Criteria:**
- [ ] `comps ingest geocode-county [--limit N]` fills lat/lon/acreage for vacant sales lacking coordinates via `RegridClient.by_apn` (cached)
- [ ] Stops cleanly on `QuotaExceeded`, reporting how many rows remain
- [ ] Only processes sales within `max_lookback_months`
- [ ] Test with a fake Regrid client
- [ ] Typecheck passes

### US-009: County sales candidate source
**Description:** As the pipeline, I need recorded vacant-land sales near the subject as candidates.

**Acceptance Criteria:**
- [ ] `CountySalesSource.fetch(subject, radius_mi, lookback_months) -> list[Candidate]` with `status="sold"`, `source="county_sales"`
- [ ] Uses a lat/lon bounding-box SQL prefilter, then an exact haversine filter
- [ ] Excludes the subject's own APN
- [ ] Test with a fixture DB returns exactly the expected rows for a given radius
- [ ] Typecheck passes

### US-010: Apify runner with caching
**Description:** As the pipeline, I need a thin wrapper to run Apify actors and cache results so repeat runs are free and scraper outages are visible.

**Acceptance Criteria:**
- [ ] `ApifyRunner.run(actor_id, input: dict) -> list[dict]` runs the actor, returns dataset items, caps at `apify.max_items`
- [ ] Results cached in `source_cache` keyed by `(actor_id, sorted input JSON)` with TTL `apify.cache_ttl_days`
- [ ] Timeouts and actor failures raise `SourceError(actor_id, reason)`
- [ ] Test with a fake Apify client (no network)
- [ ] Typecheck passes

### US-011: LandWatch source normalizer
**Description:** As the pipeline, I need LandWatch sold and active listings converted to `Candidate`s.

**Acceptance Criteria:**
- [ ] `LandWatchSource.fetch(subject, radius_mi)` builds actor input for the subject's county/ZIP (sold + available), runs it via `ApifyRunner`, and normalizes results
- [ ] Maps price, acreage, price/acre, GPS, status (Available -> active, Under Contract -> pending, Sold -> sold), road frontage, utilities, topography, description, URL, list/sold date
- [ ] Drops records outside the radius (when GPS is present) and records with no price
- [ ] Test with a fixture of at least 5 items covering each status
- [ ] Typecheck passes

### US-012: Realtor.com source normalizer
**Description:** As the pipeline, I need Realtor.com land/lot listings (sold + active) as candidates for source redundancy.

**Acceptance Criteria:**
- [ ] `RealtorSource.fetch(subject, radius_mi)` runs the configured actor for the subject's ZIP(s) in sold and for-sale modes with property type land/lot
- [ ] Filters out any record whose property type is not land, lot, or farm/ranch vacant
- [ ] Maps sold price/date, list price/date, lot size (sqft -> acres), coordinates, address, description, URL
- [ ] Test with a fixture that includes one non-land record, which is filtered out
- [ ] Typecheck passes

### US-013: Candidate gathering orchestrator
**Description:** As the pipeline, I want all sources queried together so one broken source doesn't sink the run.

**Acceptance Criteria:**
- [ ] `gather(subject, radius_mi, lookback_months) -> GatherResult(candidates, source_errors)` runs enabled sources concurrently
- [ ] A `SourceError` in one source is recorded in `source_errors` while other sources' results are still returned (test with a fake failing source)
- [ ] Per-source candidate counts are logged
- [ ] Typecheck passes

### US-014: Dedup and parcel resolution
**Description:** As the pipeline, I need the same parcel seen in multiple sources collapsed into one record so comps aren't double-counted.

**Acceptance Criteria:**
- [ ] Merge order: (1) equal normalized APN; (2) within 0.05 mi AND acreage within +/-10%; (3) equal normalized address
- [ ] The merged record keeps the richest attribute set, lists all `sources`, prefers the county sold price over a listing price, and keeps both `list_price` and `sold_price` when a listing later sold
- [ ] Optional `--resolve-apn` uses `RegridClient.by_point` to attach an APN to listings lacking one (cached, quota-limited)
- [ ] Tests: 3 fixtures (APN dup, coordinate dup, address dup) each collapse to 1 record; two distinct adjacent parcels stay 2 records
- [ ] Typecheck passes

### US-015: Guardrails and auto-widen
**Description:** As the pipeline, I need deterministic filters applied before Jev so obviously bad candidates never cost money or pollute rankings.

**Acceptance Criteria:**
- [ ] Filters with reason codes: `too_far`, `acreage_out_of_band`, `stale`, `nominal_price` (< `nominal_price_floor`), `excluded_deed_type`, `missing_price`, `is_subject`
- [ ] If survivors < `min_candidates`, widen in steps (radius x1.5 up to max, then acreage band, then lookback up to max) and re-gather; each widened candidate records `widened=true` and the step
- [ ] Returns kept and rejected candidates (with reasons) so output can explain drops
- [ ] Tests for each reason code and for widening stopping at the configured maximums
- [ ] Typecheck passes

### US-016: Feature assembly (Jev state)
**Description:** As the pipeline, I need a compact, consistent state object per candidate so Jev sees the facts code already knows.

**Acceptance Criteria:**
- [ ] `build_state(subject, candidate, pool) -> dict` produces the `subject` / `candidate` / `comparison` shape in section 5
- [ ] `comparison` includes distance_miles, acreage_ratio, months_since_event, same_zoning, same_zip, price_per_acre_vs_pool_median (median over sold candidates in the pool; omitted if fewer than 3)
- [ ] Descriptions truncated to 1,500 chars; None fields omitted
- [ ] Snapshot test of the state JSON for a fixture pair
- [ ] Typecheck passes

### US-017: Jev question set and client
**Description:** As the pipeline, I need the comp questions sent to Jev with retries and caching so judgments are cheap, repeatable, and resilient.

**Acceptance Criteria:**
- [ ] `questions.py` defines the 7 questions in section 5 with full instructions and criteria (Noul true/false descriptions, 4 concrete Score levels, 4 Choice options with definitions)
- [ ] `JevJudge.judge(state) -> JevAnswers` calls `system_one` (model `jev-latest`) via `typesafe-sdk` with all 7 questions in one request
- [ ] Cache key = sha256(model + state JSON + questions JSON); a cache hit skips the API (test with a fake client)
- [ ] Exponential backoff on 429/529 (max 5 tries); 401/422 fail fast with a clear message
- [ ] `judge_many(states, concurrency=8)` runs requests concurrently and records input token usage per call
- [ ] Typecheck passes

### US-018: Composite scoring and tiering
**Description:** As a user, I want Jev's answers combined into a ranking I can tune through config.

**Acceptance Criteria:**
- [ ] `score(candidate, answers, features, config) -> CompResult(composite, tier, gates_triggered, answers)` implements the section 5 formula
- [ ] `arms_length < 0.5` forces `reject`; `red_flags > 0.7` either rejects or adds a `red_flag` marker per `scoring.red_flag_policy`
- [ ] Tier is demoted one level when composite is below that tier's floor or `quality_tier.confidence < min_confidence`
- [ ] Results sort by tier, then composite desc; sold ranks above active on ties
- [ ] Unit tests cover each gate and demotion rule
- [ ] Typecheck passes

### US-019: `comps find` end-to-end command
**Description:** As a user, I want one command that takes a target APN or address and shows me the good comps.

**Acceptance Criteria:**
- [ ] `comps find <APN|address> [--radius R (rejected if > max_radius_mi)] [--top N] [--include-rejects] [--out results.json|results.csv]`
- [ ] Runs resolve -> gather -> dedupe -> guardrails -> Jev -> score and persists to `runs` / `run_results`
- [ ] Table columns: rank, tier, composite, status (SOLD/LIST/PEND), APN, address, acreage, price, $/acre, distance, date, sources, flags
- [ ] Sold and listing comps display in separate sections; the header shows the subject summary, source errors, and widening steps
- [ ] JSON export includes the full `CompResult` with raw Jev probabilities/confidence and provenance URLs; CSV export has the table columns
- [ ] Footer shows counts (gathered / deduped / filtered / judged) and cost (Jev tokens x price, Apify items, Regrid records)
- [ ] CLI test with all clients faked produces the expected ranking for a fixture subject
- [ ] Typecheck passes

### US-020: `comps rescore` command
**Description:** As an operator, I want to re-rank a past run after changing weights without re-calling Jev or scrapers.

**Acceptance Criteria:**
- [ ] `comps rescore <run_id>` reloads stored answers and features, applies the current `scoring` config, and prints the same table as `find`
- [ ] Makes zero network calls (test asserts fakes are never called)
- [ ] Typecheck passes

### US-021: Benchmark import (CRM comps)
**Description:** As an evaluator, I want to load the CRM tool's comps for benchmark subjects so we can compare.

**Acceptance Criteria:**
- [ ] `comps bench import <csv>` with columns: `subject_id` (APN or address), `comp_apn`, `comp_address`, `comp_price`, `comp_date`, `comp_status` (sold/active), `crm_rating` (optional)
- [ ] Each comp's APN/address is normalized; rows lacking both are reported and skipped
- [ ] Stored in a `benchmark_comps` table (added by this story)
- [ ] Test with a fixture CSV of 2 subjects x 4 comps
- [ ] Typecheck passes

### US-022: Evaluation report
**Description:** As an evaluator, I want metrics comparing our comps with the CRM's so we can decide whether the POC works.

**Acceptance Criteria:**
- [ ] `comps bench run` executes `find` for each benchmark subject (reusing caches), then computes per-subject and overall: candidate recall (CRM comps found in gathered pool), filter loss (CRM comps dropped by guardrails, with reason), ranking agreement (CRM comps in pool that we tier excellent/good), overlap@5
- [ ] CRM comp to candidate matching reuses the APN / coordinate / address logic from US-014
- [ ] Writes `reports/bench_<timestamp>.md` (metrics vs. the section 2 targets, pass/fail per target) and `reports/review_<timestamp>.csv` listing disagreements (CRM-only comps, ours-only top-5 comps, tier conflicts), each with a blank `human_label` column (good/bad)
- [ ] Test with a fixture benchmark and a fake pipeline produces the expected metrics
- [ ] Typecheck passes

### US-023: Reviewed-precision scoring
**Description:** As an evaluator, I want to feed my labels on disagreements back in to compute reviewed precision.

**Acceptance Criteria:**
- [ ] `comps bench score-review <review.csv>` reads `human_label` values and computes reviewed precision of our top-5 (agreements with the CRM count as good; labeled rows use the label) and the share of CRM comps labeled bad
- [ ] Appends results to the matching bench report
- [ ] Unlabeled rows are counted and reported, not silently ignored
- [ ] Typecheck passes

## 7. Non-Goals

- **No valuation or offer price.** The MVP identifies and ranks comps; it does not estimate value or produce an offer.
- **No markets beyond Park County, CO.** No Utah non-disclosure handling, no WA/NV/HI pullers. County specifics live in config so adding one later is cheap.
- **No Zillow scraping** (the most fragile source; LandWatch + Realtor.com + county provide redundancy).
- **No paid data APIs or MLS feeds** (ATTOM, REAPI, Land Portal, PropStream, MLS Grid). These are Stage 2 decisions informed by POC results.
- **No web UI, API server, CRM integration, or scheduled jobs.**
- **No redistribution of scraped data;** outputs are for internal analysis only.
- **No learned weights or model training;** weights are hand-tuned via config and `rescore`.

## 8. Technical Considerations

- **Jev cost:** roughly 1-2K input tokens per candidate request at $0.042/M input tokens, about $0.0001 per candidate. At ~50 candidates per subject that is well under a cent; data acquisition dominates cost. Jev is early access, so pin the `typesafe-sdk` version and keep all questions in one module.
- **Jev usage rules:** don't ask Jev for arithmetic or thresholds; supply computed facts in `comparison`. Validate calibration on the benchmark before trusting the default `0.5` / `0.7` gates.
- **Apify:** ToS risk accepted for internal use only. Cache aggressively and record actor ID + run ID in provenance so breakage is diagnosable.
- **Regrid:** the included plan covers ~2,000 records/month with $0.10-0.15/record overage. Prefer county GIS centroids for bulk county sales; use Regrid for subjects and for listings without APNs. When listing acreage conflicts with Regrid geometry, trust Regrid and flag the discrepancy.
- **County data quality:** sales files include unconfirmed and non-arm's-length transfers. Code filters deed types and nominal prices first; Jev's `arms_length` is a second line of defense, not the only one.
- **Thin markets:** Park County is large and sparse (South Park, Hartsel, Guffey, Tarryall); many subjects will widen toward the 5 mi ceiling and 36 months; the radius never exceeds 5 mi; widening is recorded and shown in output.
- **CRM benchmark caveat:** the CRM tool is itself imperfect (and partly broken), so disagreement isn't automatically our error. That's why US-022/US-023 route disagreements to human review.

## 9. Open Questions

1. Exact Park County file formats, APN/schedule-number format, and vacant-land/deed-type codes (confirm when files are downloaded).
2. Which Apify actors have reliable sold data for Park County land, and do they accept coordinate/radius input or only ZIP/county? (Affects US-011/US-012 input builders.)
3. Can the CRM export comps with APNs, or only addresses? (Affects benchmark match rate.)
4. Should `red_flags` reject or only warn by default? (Starting default: warn.)

## 10. After the POC (out of scope)

- If section 2 targets are met: add a second disclosure county via config, then evaluate a Land Portal / Land Insights API to reduce scraper maintenance.
- If candidate recall is the bottleneck: add a paid source (ATTOM trial `/sale/snapshot`) before tuning Jev further.
- If ranking agreement is the bottleneck: iterate question wording and weights with `rescore` against the reviewed benchmark.
