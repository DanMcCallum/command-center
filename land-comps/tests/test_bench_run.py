import csv
import sqlite3
from datetime import UTC, datetime
from pathlib import Path

import pytest
import yaml
from rich.console import Console
from typer.testing import CliRunner

from land_comps import cli
from land_comps.bench import import_benchmark
from land_comps.bench_run import (
    REVIEW_COLUMNS,
    BenchRunError,
    run_benchmark,
)
from land_comps.config import Settings, load_settings
from land_comps.db import init_db
from land_comps.guardrails import RejectedCandidate
from land_comps.models import Candidate, CompResult, JevAnswers, Parcel
from land_comps.report import (
    RankedComp,
    RunCost,
    RunCounts,
    RunReport,
    RunSummary,
)
from land_comps.scoring import Features

runner = CliRunner()
FIXTURE = Path(__file__).parent / "fixtures" / "benchmark" / "crm_comps.csv"
EXAMPLE_CONFIG = Path(__file__).parent.parent / "config.example.yaml"
SUBJECT_A = "0034567890"
SUBJECT_B = "1500 COUNTY RD 18"
NOW = datetime(2026, 9, 30, 12, 0, 5, tzinfo=UTC)

ANSWERS = JevAnswers.model_validate(
    {
        "is_good_comp": {"probability": 0.9, "confidence": 0.8},
        "arms_length": {"probability": 0.9, "confidence": 0.8},
        "physical_similarity": {"score": 2.0, "confidence": 0.8},
        "access_utilities_similarity": {"score": 2.0, "confidence": 0.8},
        "market_similarity": {"score": 2.0, "confidence": 0.8},
        "red_flags": {"probability": 0.1, "confidence": 0.8},
        "quality_tier": {"choice": "good", "probability": 0.7, "confidence": 0.8},
    }
)


def _cand(source_id: str, **fields: object) -> Candidate:
    return Candidate.model_validate(
        {"source": "county_sales", "source_id": source_id, "status": "sold", "price": 50000.0}
        | fields
    )


def _ranked(rank: int, tier: str, candidate: Candidate) -> RankedComp:
    result = CompResult.model_validate(
        {"composite": 1.0 - rank / 10, "tier": tier, "answers": ANSWERS.model_dump()}
    )
    return RankedComp(rank, candidate, result, Features(distance_miles=0.5, months_since_event=3))


def _summary(target: str, run_id: str) -> RunSummary:
    return RunSummary(
        run_id=run_id,
        target=target,
        created_at=NOW,
        subject=Parcel(apn="0034567890", lat=39.0, lon=-105.5, acreage=5.0, county_fips="08093"),
        radius_mi=1.0,
        lookback_months=12,
        counts=RunCounts(gathered=0, deduped=0, filtered=0, judged=0),
        cost=RunCost(jev_input_tokens=0, jev_usd=0.0, apify_items=0, regrid_records=0),
    )


def _report_a() -> RunReport:
    comps = [
        _ranked(1, "excellent", _cand("1", apn="0034567001")),
        _ranked(2, "good", _cand("2", address="7 Pine Lane, Fairplay")),  # matches by address
        _ranked(3, "marginal", _cand("3", apn="34-567-002")),  # CRM comp we tier marginal
        _ranked(4, "good", _cand("4", apn="0034567099")),  # ours only, in top 5
        _ranked(5, "good", _cand("5", apn="0034567098")),  # ours only, in top 5
        _ranked(6, "good", _cand("6", apn="0034567097")),  # ours only, but past the top 5
    ]
    rejected = [RejectedCandidate(_cand("7", apn="0034567004"), ("too_far", "stale"))]
    return RunReport(_summary(SUBJECT_A, "run-a"), comps, rejected)


def _report_b() -> RunReport:
    comps = [
        _ranked(1, "good", _cand("8", apn="0099887001")),
        _ranked(2, "good", _cand("9", apn="0099887050")),  # ours only
    ]
    unjudged = [_cand("10", apn="0099887004")]
    return RunReport(_summary(SUBJECT_B, "run-b"), comps, [], unjudged)


def fake_pipeline(target: str) -> RunReport:
    return {SUBJECT_A: _report_a, SUBJECT_B: _report_b}[target]()


@pytest.fixture
def settings() -> Settings:
    return load_settings(EXAMPLE_CONFIG)


@pytest.fixture
def conn(tmp_path: Path, settings: Settings) -> sqlite3.Connection:
    connection = init_db(tmp_path / "x.sqlite")
    import_benchmark(connection, settings, FIXTURE)
    return connection


def _review_rows(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def test_metrics_and_reports_for_fixture_benchmark(
    conn: sqlite3.Connection, settings: Settings, tmp_path: Path
) -> None:
    reports = tmp_path / "reports"

    result = run_benchmark(conn, settings, fake_pipeline, reports, NOW)

    assert result.bench_path == reports / "bench_20260930-120005.md"
    assert result.review_path == reports / "review_20260930-120005.csv"
    a, b = result.subjects
    ma, mb = a.metrics, b.metrics
    assert (ma.crm_comps, ma.in_pool, ma.filtered, ma.agreeing) == (4, 4, 1, 2)
    assert (ma.recall, ma.filter_loss, ma.agreement) == (1.0, 0.25, 0.5)
    assert (ma.top5_hits, ma.top5_possible, ma.overlap_at_5) == (3, 4, 0.75)
    assert (mb.crm_comps, mb.in_pool, mb.filtered, mb.agreeing) == (4, 2, 0, 1)
    assert (mb.recall, mb.agreement) == (0.5, 0.5)
    assert (mb.top5_hits, mb.top5_possible, mb.overlap_at_5) == (1, 4, 0.25)
    overall = result.overall
    assert (overall.crm_comps, overall.in_pool, overall.filtered, overall.agreeing) == (8, 6, 1, 3)
    assert (overall.recall, overall.filter_loss, overall.agreement) == (0.75, 0.125, 0.5)
    assert overall.overlap_at_5 == 0.5

    markdown = result.bench_path.read_text()
    assert "| Candidate recall | 75% (6/8) | >= 70% | PASS |" in markdown
    assert "| Ranking agreement | 50% (3/6) | >= 60% | FAIL |" in markdown
    assert "Reviewed precision | pending" in markdown
    assert "| 0034567890 | run-a | 4 | 100% (4/4) | 25% (1/4) | 50% (2/4) | 75% (3/4) |" in markdown
    assert "| 0034567890 | 0034567004 | too_far, stale |" in markdown
    assert "review_20260930-120005.csv" in markdown

    with result.review_path.open(newline="", encoding="utf-8") as handle:
        assert tuple(next(csv.reader(handle))) == REVIEW_COLUMNS
    rows = _review_rows(result.review_path)
    assert all(row["human_label"] == "" for row in rows)
    by_category: dict[str, list[dict[str, str]]] = {}
    for row in rows:
        by_category.setdefault(row["category"], []).append(row)
    assert {k: len(v) for k, v in by_category.items()} == {
        "crm_only": 4,
        "ours_only": 3,
        "tier_conflict": 1,
    }
    assert [r["apn"] for r in by_category["ours_only"]] == [
        "0034567099",
        "0034567098",
        "0099887050",
    ]
    conflict = by_category["tier_conflict"][0]
    assert (conflict["apn"], conflict["our_tier"], conflict["our_rank"]) == (
        "34-567-002",
        "marginal",
        "3",
    )
    assert conflict["crm_rating"] == "4"
    details = {
        (r["subject_id"], r["apn"] or r["address"]): r["detail"] for r in by_category["crm_only"]
    }
    assert "too_far;stale" in details[(SUBJECT_A, "0034567004")]
    assert "not in our candidate pool" in details[(SUBJECT_B, "88 SPRUCE AVE")]
    assert "not in our candidate pool" in details[(SUBJECT_B, "0099887003")]
    assert "no answer" in details[(SUBJECT_B, "0099887004")]


def test_failed_subject_is_reported_and_excluded_from_metrics(
    conn: sqlite3.Connection, settings: Settings, tmp_path: Path
) -> None:
    def pipeline(target: str) -> RunReport:
        if target == SUBJECT_B:
            raise RuntimeError("regrid exploded")
        return fake_pipeline(target)

    result = run_benchmark(conn, settings, pipeline, tmp_path / "r", NOW)

    assert [s.ok for s in result.subjects] == [True, False]
    assert result.overall.crm_comps == 4
    markdown = result.bench_path.read_text()
    assert "1 failed" in markdown
    assert "- 1500 COUNTY RD 18: RuntimeError: regrid exploded" in markdown
    assert {r["subject_id"] for r in _review_rows(result.review_path)} == {SUBJECT_A}


def test_every_subject_failing_still_writes_reports_with_failing_verdicts(
    conn: sqlite3.Connection, settings: Settings, tmp_path: Path
) -> None:
    def pipeline(target: str) -> RunReport:
        raise ValueError("boom")

    result = run_benchmark(conn, settings, pipeline, tmp_path / "r", NOW)

    markdown = result.bench_path.read_text()
    assert "| Candidate recall | n/a (0/0) | >= 70% | FAIL |" in markdown
    assert _review_rows(result.review_path) == []


def test_no_imported_benchmark_is_an_error(settings: Settings, tmp_path: Path) -> None:
    empty = init_db(tmp_path / "empty.sqlite")

    with pytest.raises(BenchRunError, match="bench import"):
        run_benchmark(empty, settings, fake_pipeline, tmp_path / "r", NOW)


def test_reports_are_never_overwritten(
    conn: sqlite3.Connection, settings: Settings, tmp_path: Path
) -> None:
    run_benchmark(conn, settings, fake_pipeline, tmp_path / "r", NOW)

    with pytest.raises(BenchRunError, match="Cannot write"):
        run_benchmark(conn, settings, fake_pipeline, tmp_path / "r", NOW)


def _cli_args(tmp_path: Path) -> list[str]:
    config = tmp_path / "config.yaml"
    config.write_text(yaml.safe_dump(yaml.safe_load(EXAMPLE_CONFIG.read_text())))
    return [
        "bench",
        "run",
        "--config",
        str(config),
        "--db",
        str(tmp_path / "x.sqlite"),
        "--reports-dir",
        str(tmp_path / "reports"),
    ]


def test_cli_bench_run_wires_the_pipeline_and_writes_reports(
    conn: sqlite3.Connection, settings: Settings, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(cli, "console", Console(width=300))
    monkeypatch.setattr(cli, "find_clients_factory", lambda s, c: object())
    targets: list[str] = []

    def fake_run_find(target: str, *args: object, **kwargs: object) -> RunReport:
        targets.append(target)
        return fake_pipeline(target)

    monkeypatch.setattr(cli, "run_find", fake_run_find)

    result = runner.invoke(cli.app, _cli_args(tmp_path))

    assert result.exit_code == 0, result.output
    assert targets == [SUBJECT_A, SUBJECT_B]
    assert "recall 75%" in result.output and "ranking agreement 50%" in result.output
    assert len(list((tmp_path / "reports").glob("bench_*.md"))) == 1
    assert len(list((tmp_path / "reports").glob("review_*.csv"))) == 1


def test_cli_bench_run_exits_1_when_no_subject_runs(
    conn: sqlite3.Connection, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(cli, "console", Console(width=300))
    monkeypatch.setattr(cli, "find_clients_factory", lambda s, c: object())

    def failing(*args: object, **kwargs: object) -> RunReport:
        raise RuntimeError("no network")

    monkeypatch.setattr(cli, "run_find", failing)

    result = runner.invoke(cli.app, _cli_args(tmp_path))

    assert result.exit_code == 1
    assert "failed" in result.output and "no network" in result.output


def test_cli_bench_run_without_imported_comps_or_db_exits_1(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(cli, "find_clients_factory", lambda s, c: object())
    args = _cli_args(tmp_path)

    missing = runner.invoke(cli.app, args)
    assert missing.exit_code == 1 and "does not exist" in " ".join(missing.output.split())

    init_db(tmp_path / "x.sqlite").close()
    empty = runner.invoke(cli.app, args)
    assert empty.exit_code == 1 and "bench import" in empty.output
