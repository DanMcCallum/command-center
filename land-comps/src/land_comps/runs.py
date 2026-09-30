"""Persist a `comps find` run to the `runs` / `run_results` tables.

Stored so `comps rescore` can rebuild the whole report offline, with no schema change:
- `runs.params_json` holds the full `RunSummary` (inputs, subject, counts, cost, source
  errors, widening steps), i.e. everything the report header and footer show.
- each `run_results` row holds the composite/tier/gates, the raw Jev answers (`answers_json`),
  and `features_json` = `{"features", "state", "candidate"}`: the computed `Features`, the
  exact Jev input state, and a snapshot of the merged candidate. The candidate snapshot is
  what rescoring reads: the shared `candidates` row is keyed by (source, source_id) and is
  refreshed by later runs, so it can drift from what this run actually judged.
"""

import json
import sqlite3
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from pydantic import ValidationError

from land_comps.models import Candidate, JevAnswers
from land_comps.report import RankedComp, RunSummary
from land_comps.scoring import Features

_CANDIDATE_UPSERT = """
INSERT INTO candidates (
    source, source_id, sources, status, apn, address, lat, lon, acreage, price,
    list_price, sold_price, price_per_acre, event_date, deed_type, road_access,
    utilities, topography, description, url, raw
) VALUES (
    :source, :source_id, :sources, :status, :apn, :address, :lat, :lon, :acreage, :price,
    :list_price, :sold_price, :price_per_acre, :event_date, :deed_type, :road_access,
    :utilities, :topography, :description, :url, :raw
)
ON CONFLICT (source, source_id) DO UPDATE SET
    sources = excluded.sources, status = excluded.status, apn = excluded.apn,
    address = excluded.address, lat = excluded.lat, lon = excluded.lon,
    acreage = excluded.acreage, price = excluded.price, list_price = excluded.list_price,
    sold_price = excluded.sold_price, price_per_acre = excluded.price_per_acre,
    event_date = excluded.event_date, deed_type = excluded.deed_type,
    road_access = excluded.road_access, utilities = excluded.utilities,
    topography = excluded.topography, description = excluded.description,
    url = excluded.url, raw = excluded.raw
"""


def new_run_id(now: datetime) -> str:
    """A sortable, human-readable run ID: UTC timestamp plus a short random suffix."""
    return f"{now:%Y%m%d-%H%M%S}-{uuid.uuid4().hex[:6]}"


def _upsert_candidate(conn: sqlite3.Connection, candidate: Candidate) -> int:
    conn.execute(
        _CANDIDATE_UPSERT,
        {
            **candidate.model_dump(exclude={"sources", "utilities", "raw", "event_date"}),
            "sources": json.dumps(candidate.sources or [candidate.source]),
            "utilities": json.dumps(candidate.utilities),
            "event_date": candidate.event_date.isoformat() if candidate.event_date else None,
            "raw": json.dumps(candidate.raw, default=str),
        },
    )
    row = conn.execute(
        "SELECT id FROM candidates WHERE source = ? AND source_id = ?",
        (candidate.source, candidate.source_id),
    ).fetchone()
    return int(row["id"])


def save_run(conn: sqlite3.Connection, summary: RunSummary, comps: Sequence[RankedComp]) -> None:
    """Write the run and its ranked results in one transaction (all or nothing)."""
    with conn:
        conn.execute(
            "INSERT INTO runs (id, subject_input, subject_apn, created_at, params_json) "
            "VALUES (?, ?, ?, ?, ?)",
            (
                summary.run_id,
                summary.target,
                summary.subject.apn,
                summary.created_at.isoformat(),
                summary.model_dump_json(),
            ),
        )
        for comp in comps:
            candidate_id = _upsert_candidate(conn, comp.candidate)
            features_json = json.dumps(
                {
                    "features": comp.features.model_dump(mode="json"),
                    "state": comp.state,
                    "candidate": comp.candidate.model_dump(mode="json"),
                },
                default=str,
            )
            conn.execute(
                "INSERT INTO run_results (run_id, candidate_id, composite, tier, "
                "gates_triggered, answers_json, features_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    summary.run_id,
                    candidate_id,
                    comp.result.composite,
                    comp.result.tier,
                    json.dumps(comp.result.gates_triggered),
                    comp.result.answers.model_dump_json(),
                    features_json,
                ),
            )


class RunNotFoundError(Exception):
    """No stored run has the requested ID."""


class StoredRunError(Exception):
    """A stored run is missing data `comps rescore` needs (e.g. saved by an older version)."""


@dataclass(frozen=True)
class StoredResult:
    """One saved `run_results` row, decoded: everything needed to score it again offline."""

    candidate: Candidate
    answers: JevAnswers
    features: Features
    state: dict[str, Any]


def load_run(conn: sqlite3.Connection, run_id: str) -> tuple[RunSummary, list[StoredResult]]:
    """The saved summary and results of one run, results in their original rank order.

    Raises `RunNotFoundError` for an unknown ID and `StoredRunError` for unreadable rows.
    """
    row = conn.execute("SELECT params_json FROM runs WHERE id = ?", (run_id,)).fetchone()
    if row is None:
        raise RunNotFoundError(f"No run with id {run_id!r}.")
    try:
        summary = RunSummary.model_validate_json(row["params_json"])
    except ValidationError as exc:
        raise StoredRunError(f"Run {run_id} has an unreadable summary: {exc}") from exc

    rows = conn.execute(
        "SELECT id, answers_json, features_json FROM run_results WHERE run_id = ? ORDER BY id",
        (run_id,),
    ).fetchall()
    results: list[StoredResult] = []
    for result_row in rows:
        try:
            detail = json.loads(result_row["features_json"])
            results.append(
                StoredResult(
                    candidate=Candidate.model_validate(detail["candidate"]),
                    answers=JevAnswers.model_validate_json(result_row["answers_json"]),
                    features=Features.model_validate(detail["features"]),
                    state=detail.get("state", {}),
                )
            )
        except (ValueError, KeyError, TypeError) as exc:  # ValidationError is a ValueError
            raise StoredRunError(
                f"Run {run_id} result row {result_row['id']} cannot be rescored "
                f"(stored without candidate/features detail): {exc}"
            ) from exc
    return summary, results
