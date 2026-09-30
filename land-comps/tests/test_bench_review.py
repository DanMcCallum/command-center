import csv
import sqlite3
from datetime import UTC, datetime
from pathlib import Path

import pytest
from rich.console import Console
from test_bench_run import FIXTURE, NOW, fake_pipeline
from typer.testing import CliRunner

from land_comps import cli
from land_comps.bench import import_benchmark
from land_comps.bench_review import ScoreReviewError, score_review
from land_comps.bench_run import BenchResult, run_benchmark
from land_comps.config import Settings, load_settings
from land_comps.db import init_db
from land_comps.report import RunReport

runner = CliRunner()
EXAMPLE_CONFIG = Path(__file__).parent.parent / "config.example.yaml"
SCORED_AT = datetime(2026, 10, 1, 9, 30, 0, tzinfo=UTC)


@pytest.fixture
def settings() -> Settings:
    return load_settings(EXAMPLE_CONFIG)


@pytest.fixture
def bench(settings: Settings, tmp_path: Path) -> BenchResult:
    conn: sqlite3.Connection = init_db(tmp_path / "x.sqlite")
    import_benchmark(conn, settings, FIXTURE)

    def pipeline(target: str) -> RunReport:
        return fake_pipeline(target)

    return run_benchmark(conn, settings, pipeline, tmp_path / "reports", NOW)


def _label(path: Path, labels: dict[str, list[str]]) -> None:
    """Fill `human_label` per category, in file order (missing entries stay blank)."""
    with path.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    seen: dict[str, int] = {}
    for row in rows:
        index = seen.get(row["category"], 0)
        seen[row["category"]] = index + 1
        given = labels.get(row["category"], [])
        row["human_label"] = given[index] if index < len(given) else ""
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


# Fixture benchmark: 4 top-5 comps are CRM comps (agreements), 3 are ours_only rows; 3 CRM
# comps are tiered excellent/good and 5 (4 crm_only, 1 tier_conflict) are review rows.
PARTIAL_LABELS = {
    "ours_only": ["good", "BAD", ""],
    "crm_only": ["bad", " bad ", "good", ""],
    "tier_conflict": ["bad"],
}


def test_partial_labels_give_expected_precision_bad_share_and_unlabeled(
    bench: BenchResult,
) -> None:
    _label(bench.review_path, PARTIAL_LABELS)
    original = bench.bench_path.read_text()

    result = score_review(bench.review_path, SCORED_AT)

    score = result.score
    assert result.bench_path == bench.bench_path
    assert (score.top5_agreements, score.crm_agreements) == (4, 3)
    assert (score.ours_good, score.ours_bad, score.ours_unlabeled) == (1, 1, 1)
    assert (score.crm_good, score.crm_bad, score.crm_unlabeled) == (1, 3, 1)
    assert score.precision == pytest.approx(5 / 6)
    assert score.bad_share == pytest.approx(3 / 7)
    assert (score.unlabeled, score.rows) == (2, 8)
    assert score.passes

    updated = bench.bench_path.read_text()
    assert updated.startswith(original.rstrip("\n"))
    assert "## Reviewed precision results (2026-10-01 09:30:00 UTC)" in updated
    assert "| Reviewed precision of our top 5 | 83% (5/6) | >= 70% | PASS (provisional)" in updated
    assert "| CRM comps labeled bad | 43% (3/7) | informational | |" in updated
    assert "8 review rows, 6 labeled, 2 unlabeled" in updated
    assert "2 (1 of our top-5 comps, 1 CRM comps)" in updated
    assert "provisional until every row has a `human_label`" in updated


def test_low_precision_fails_and_fully_labeled_is_not_provisional(bench: BenchResult) -> None:
    _label(
        bench.review_path,
        {
            "ours_only": ["bad", "bad", "bad"],
            "crm_only": ["good"] * 4,
            "tier_conflict": ["good"],
        },
    )

    score = score_review(bench.review_path, SCORED_AT).score

    assert score.precision == pytest.approx(4 / 7)
    assert score.bad_share == 0.0
    assert score.unlabeled == 0
    updated = bench.bench_path.read_text()
    assert "| Reviewed precision of our top 5 | 57% (4/7) | >= 70% | FAIL |" in updated
    assert "provisional" not in updated


def test_all_rows_unlabeled_is_counted_not_ignored(bench: BenchResult) -> None:
    score = score_review(bench.review_path, SCORED_AT).score

    assert (score.unlabeled, score.rows) == (8, 8)
    assert score.precision == 1.0
    assert "8 review rows, 0 labeled, 8 unlabeled" in bench.bench_path.read_text()


def test_rescoring_replaces_the_previous_section(bench: BenchResult) -> None:
    score_review(bench.review_path, SCORED_AT)
    _label(bench.review_path, PARTIAL_LABELS)

    score_review(bench.review_path, SCORED_AT)

    updated = bench.bench_path.read_text()
    assert updated.count("## Reviewed precision results") == 1
    assert "8 review rows, 6 labeled, 2 unlabeled" in updated
    assert updated.startswith("# Benchmark report 20260930-120005")


def test_invalid_label_is_rejected_with_line_numbers_and_report_untouched(
    bench: BenchResult,
) -> None:
    _label(bench.review_path, {"ours_only": ["maybe"], "crm_only": ["ok"]})
    before = bench.bench_path.read_text()

    with pytest.raises(ScoreReviewError, match="line 2: human_label 'maybe'.*'ok'"):
        score_review(bench.review_path, SCORED_AT)

    assert bench.bench_path.read_text() == before


def test_blank_padding_rows_are_skipped_and_undecodable_report_fails_clearly(
    bench: BenchResult,
) -> None:
    baseline = score_review(bench.review_path, SCORED_AT).score
    with bench.review_path.open("a", newline="", encoding="utf-8") as handle:
        handle.write(",," + "," * 10 + "\n")

    assert score_review(bench.review_path, SCORED_AT).score == baseline

    bench.bench_path.write_bytes(b"\xff\xfe")
    with pytest.raises(ScoreReviewError, match="Cannot read"):
        score_review(bench.review_path, SCORED_AT)


def test_review_without_matching_bench_report_fails_clearly(
    bench: BenchResult, tmp_path: Path
) -> None:
    orphan = tmp_path / "elsewhere" / "review_20250101-000000.csv"
    orphan.parent.mkdir()
    orphan.write_text(bench.review_path.read_text())

    with pytest.raises(ScoreReviewError, match="No bench report for review_20250101-000000.csv"):
        score_review(orphan, SCORED_AT)


def test_unrecognized_file_name_and_missing_file_fail_clearly(
    bench: BenchResult, tmp_path: Path
) -> None:
    renamed = bench.review_path.with_name("my_labels.csv")
    renamed.write_text(bench.review_path.read_text())
    with pytest.raises(ScoreReviewError, match="not a review file written by"):
        score_review(renamed, SCORED_AT)
    with pytest.raises(ScoreReviewError, match="not a file"):
        score_review(tmp_path / "review_20260930-120005.csv", SCORED_AT)


def test_missing_columns_and_old_bench_report_fail_clearly(bench: BenchResult) -> None:
    good_review = bench.review_path.read_text()
    bench.review_path.write_text("category,detail\nours_only,x\n")
    with pytest.raises(ScoreReviewError, match="missing review columns: subject_id"):
        score_review(bench.review_path, SCORED_AT)

    bench.review_path.write_text(good_review)
    old = bench.bench_path.read_text().replace("- Top-5 comps that are CRM comps:", "- Top 5:")
    bench.bench_path.write_text(old)
    with pytest.raises(ScoreReviewError, match="Re-run `comps bench run`"):
        score_review(bench.review_path, SCORED_AT)


def test_cli_score_review_prints_summary_and_appends(
    bench: BenchResult, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(cli, "console", Console(width=300))
    _label(bench.review_path, PARTIAL_LABELS)

    result = runner.invoke(cli.app, ["bench", "score-review", str(bench.review_path)])

    assert result.exit_code == 0, result.output
    assert "Reviewed precision of our top 5: 83% (5/6)" in result.output
    assert "PASS" in result.output
    assert "CRM comps labeled bad: 43% (3/7)" in result.output
    assert "2 of 8 review rows are unlabeled" in result.output
    assert "## Reviewed precision results" in bench.bench_path.read_text()


def test_cli_score_review_without_bench_report_exits_1(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(cli, "err_console", Console(width=300, stderr=True))
    review = tmp_path / "review_20260101-000000.csv"
    review.write_text("subject_id\n")

    result = runner.invoke(cli.app, ["bench", "score-review", str(review)])

    assert result.exit_code == 1
    assert "No bench report" in " ".join(result.output.split())
