"""Score an evaluator's labels on the review CSV (`comps bench score-review`).

`comps bench run` writes `review_<ts>.csv` (every disagreement, blank `human_label`) next to
`bench_<ts>.md`. The evaluator fills `human_label` with `good` or `bad`; this module folds the
labels back into two numbers and appends them to the matching bench report:

- reviewed precision of our top 5 = good / labeled, where the top-5 comps that are CRM comps
  (agreements, not in the review file) count as good and each `ours_only` row (top-5 comp the
  CRM lacks) counts by its label. Target >= 70%.
- share of CRM comps labeled bad = bad / labeled, where CRM comps we tier excellent/good count
  as good and each `crm_only` / `tier_conflict` row counts by its label.

Unlabeled rows are left out of both ratios and reported by count, so a partly labeled file
gives a provisional result that says so. The agreement counts come from the bench report
itself (its "Review inputs" section). Scoring again replaces the previously appended section,
so labels can be added and the file re-scored.
"""

import csv
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from land_comps.bench_run import (
    CRM_AGREEMENTS_LABEL,
    REVIEW_COLUMNS,
    REVIEWED_PRECISION_TARGET,
    TOP5_AGREEMENTS_LABEL,
)

REVIEW_FILE_PATTERN = re.compile(r"^review_(\d{8}-\d{6})\.csv$")
SECTION_HEADING = "## Reviewed precision results"
OURS_CATEGORY = "ours_only"
CRM_CATEGORIES = ("crm_only", "tier_conflict")
LABELS = ("good", "bad")


class ScoreReviewError(Exception):
    """The review CSV or its bench report cannot be read, is malformed, or cannot be updated."""


@dataclass(frozen=True)
class ReviewScore:
    top5_agreements: int
    crm_agreements: int
    ours_good: int = 0
    ours_bad: int = 0
    ours_unlabeled: int = 0
    crm_good: int = 0
    crm_bad: int = 0
    crm_unlabeled: int = 0

    @property
    def top5_labeled(self) -> int:
        return self.top5_agreements + self.ours_good + self.ours_bad

    @property
    def top5_good(self) -> int:
        return self.top5_agreements + self.ours_good

    @property
    def precision(self) -> float | None:
        return self.top5_good / self.top5_labeled if self.top5_labeled else None

    @property
    def crm_labeled(self) -> int:
        return self.crm_agreements + self.crm_good + self.crm_bad

    @property
    def bad_share(self) -> float | None:
        return self.crm_bad / self.crm_labeled if self.crm_labeled else None

    @property
    def unlabeled(self) -> int:
        return self.ours_unlabeled + self.crm_unlabeled

    @property
    def rows(self) -> int:
        return (
            self.ours_good
            + self.ours_bad
            + self.ours_unlabeled
            + self.crm_good
            + self.crm_bad
            + self.crm_unlabeled
        )

    @property
    def passes(self) -> bool:
        return self.precision is not None and self.precision >= REVIEWED_PRECISION_TARGET


@dataclass(frozen=True)
class ReviewScoreResult:
    score: ReviewScore
    review_path: Path
    bench_path: Path


def bench_path_for(review_path: Path) -> Path:
    """The bench report with the same timestamp, in the review file's directory."""
    match = REVIEW_FILE_PATTERN.match(review_path.name)
    if match is None:
        raise ScoreReviewError(
            f"{review_path.name} is not a review file written by `comps bench run` "
            "(expected the name review_<YYYYMMDD-HHMMSS>.csv), so its bench report cannot "
            "be found."
        )
    return review_path.with_name(f"bench_{match.group(1)}.md")


def _agreement_count(report: str, label: str, bench_path: Path) -> int:
    match = re.search(rf"^- {re.escape(label)}: (\d+)$", report, re.MULTILINE)
    if match is None:
        raise ScoreReviewError(
            f"{bench_path} has no '{label}' line under 'Review inputs' (written by an older "
            "`comps bench run`?). Re-run `comps bench run` and label the new review file."
        )
    return int(match.group(1))


def _tally(review_path: Path, top5_agreements: int, crm_agreements: int) -> ReviewScore:
    """Count the labels in the review CSV, rejecting anything that is not good/bad/blank."""
    try:
        handle = review_path.open(newline="", encoding="utf-8-sig")
    except OSError as exc:
        raise ScoreReviewError(f"Cannot read {review_path}: {exc}") from exc
    counts = {(group, label): 0 for group in ("ours", "crm") for label in (*LABELS, "unlabeled")}
    problems: list[str] = []
    with handle:
        reader = csv.DictReader(handle)
        try:
            fieldnames = reader.fieldnames or []
        except (csv.Error, UnicodeDecodeError) as exc:
            raise ScoreReviewError(f"Cannot parse {review_path}: {exc}") from exc
        missing = [c for c in REVIEW_COLUMNS if c not in fieldnames]
        if missing:
            raise ScoreReviewError(
                f"{review_path} is missing review columns: {', '.join(missing)}."
            )
        try:
            for row in reader:
                if not any((v or "").strip() for k, v in row.items() if k is not None):
                    continue  # spreadsheet apps leave all-comma padding rows
                category = (row["category"] or "").strip()
                label = (row["human_label"] or "").strip().lower()
                if category == OURS_CATEGORY:
                    group = "ours"
                elif category in CRM_CATEGORIES:
                    group = "crm"
                else:
                    problems.append(f"line {reader.line_num}: unknown category '{category}'")
                    continue
                if label == "":
                    counts[(group, "unlabeled")] += 1
                elif label in LABELS:
                    counts[(group, label)] += 1
                else:
                    problems.append(
                        f"line {reader.line_num}: human_label '{row['human_label'].strip()}' "
                        "is not good or bad"
                    )
        except (csv.Error, UnicodeDecodeError) as exc:
            raise ScoreReviewError(f"Cannot parse {review_path}: {exc}") from exc
    if problems:
        raise ScoreReviewError(f"{review_path} has invalid rows: " + "; ".join(problems))
    return ReviewScore(
        top5_agreements=top5_agreements,
        crm_agreements=crm_agreements,
        ours_good=counts[("ours", "good")],
        ours_bad=counts[("ours", "bad")],
        ours_unlabeled=counts[("ours", "unlabeled")],
        crm_good=counts[("crm", "good")],
        crm_bad=counts[("crm", "bad")],
        crm_unlabeled=counts[("crm", "unlabeled")],
    )


def _pct(value: float | None) -> str:
    return "n/a" if value is None else f"{value * 100:.0f}%"


def render_section(score: ReviewScore, review_name: str, scored_at: datetime) -> str:
    """The results section appended to the bench report."""
    if score.precision is None:
        verdict = "N/A (no labeled top-5 comps)"
    else:
        verdict = "PASS" if score.passes else "FAIL"
    if score.unlabeled:
        verdict += " (provisional)"
    target = f">= {REVIEWED_PRECISION_TARGET * 100:.0f}%"
    lines = [
        f"{SECTION_HEADING} ({scored_at.strftime('%Y-%m-%d %H:%M:%S')} UTC)",
        "",
        f"Scored from `{review_name}`: {score.rows} review rows, "
        f"{score.rows - score.unlabeled} labeled, {score.unlabeled} unlabeled.",
        "",
        "| Metric | Result | Target | Verdict |",
        "|---|---|---|---|",
        f"| Reviewed precision of our top 5 | {_pct(score.precision)} "
        f"({score.top5_good}/{score.top5_labeled}) | {target} | {verdict} |",
        f"| CRM comps labeled bad | {_pct(score.bad_share)} "
        f"({score.crm_bad}/{score.crm_labeled}) | informational | |",
        "",
        f"- Top 5 counted good: {score.top5_agreements} agreements with the CRM + "
        f"{score.ours_good} labeled good; counted bad: {score.ours_bad}.",
        f"- CRM comps counted good: {score.crm_agreements} we tier excellent or good + "
        f"{score.crm_good} labeled good; labeled bad: {score.crm_bad}.",
        f"- Unlabeled and left out of both ratios: {score.unlabeled} "
        f"({score.ours_unlabeled} of our top-5 comps, {score.crm_unlabeled} CRM comps).",
    ]
    if score.unlabeled:
        lines.append("- The result is provisional until every row has a `human_label`.")
    return "\n".join(lines) + "\n"


def score_review(review_path: Path, now: datetime | None = None) -> ReviewScoreResult:
    """Score `review_path` and append (or replace) the results section in its bench report."""
    if not review_path.is_file():
        raise ScoreReviewError(f"Cannot read {review_path}: not a file.")
    bench_path = bench_path_for(review_path)
    if not bench_path.is_file():
        raise ScoreReviewError(
            f"No bench report for {review_path.name}: expected {bench_path}. Keep the review "
            "file in the directory `comps bench run` wrote it to."
        )
    try:
        report = bench_path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise ScoreReviewError(f"Cannot read {bench_path}: {exc}") from exc

    score = _tally(
        review_path,
        _agreement_count(report, TOP5_AGREEMENTS_LABEL, bench_path),
        _agreement_count(report, CRM_AGREEMENTS_LABEL, bench_path),
    )
    previous = report.find(f"\n{SECTION_HEADING}")
    if previous != -1:
        report = report[: previous + 1]
    section = render_section(score, review_path.name, now or datetime.now(UTC))
    try:
        bench_path.write_text(report.rstrip("\n") + "\n\n" + section, encoding="utf-8")
    except OSError as exc:
        raise ScoreReviewError(f"Cannot update {bench_path}: {exc}") from exc
    return ReviewScoreResult(score, review_path, bench_path)
