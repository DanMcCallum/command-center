"""Evaluate the pipeline against the CRM tool's comps (`comps bench run`).

For every benchmark subject in `benchmark_comps` the injected pipeline runs (`run_find` in
production, so provider caches apply), and each CRM comp is matched to the run's deduped pool
with the same predicate dedup uses (`dedupe.is_same_parcel`: APN, then coordinates, then
address). A CRM comp lands in exactly one bucket:

- not in the pool (a recall miss),
- in the pool but dropped by a guardrail (a filter loss, with the reason code),
- in the pool but unjudged (Jev gave no answer),
- judged, at a tier: excellent/good counts as agreement, marginal/reject as a tier conflict.

Metrics (PRD section 2), per subject and overall (overall pools the comps of every subject
whose run succeeded, so a subject with many CRM comps weighs more):

- candidate recall = CRM comps in the pool / CRM comps (target >= 70%). Filtered comps are in
  the pool: recall is measured before the guardrails and Jev.
- filter loss = CRM comps dropped by guardrails / CRM comps (informational).
- ranking agreement = CRM comps tiered excellent/good / CRM comps in the pool (target >= 60%).
  Filtered and unjudged comps are in the pool and can never agree.
- overlap@5 = our top-5 (best-ranked, reject tier excluded, like `comps find --top 5`) that are
  CRM comps / min(5, CRM comps for the subject), so the best possible score is always 100%
  (informational).

A subject whose run raises is reported as failed and left out of the metrics; it never aborts
the batch. Reviewed precision needs human labels on the review CSV and is scored by a later
step, so the report marks it pending.
"""

import csv
import logging
import sqlite3
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from land_comps.config import CountyConfig, Settings
from land_comps.dedupe import is_same_parcel
from land_comps.models import Candidate
from land_comps.report import RankedComp, RunReport, select_comps

logger = logging.getLogger(__name__)

RECALL_TARGET = 0.70
AGREEMENT_TARGET = 0.60
REVIEWED_PRECISION_TARGET = 0.70
TOP_K = 5
AGREEING_TIERS = ("excellent", "good")

REVIEW_COLUMNS = (
    "subject_id",
    "category",
    "detail",
    "apn",
    "address",
    "status",
    "price",
    "date",
    "our_rank",
    "our_tier",
    "composite",
    "crm_rating",
    "human_label",
)

# Runs the whole pipeline for one subject target (APN or normalized address).
PipelineFn = Callable[[str], RunReport]

Category = Literal["crm_only", "ours_only", "tier_conflict"]


class BenchRunError(Exception):
    """`comps bench run` cannot start (no imported benchmark comps) or write its reports."""


@dataclass(frozen=True)
class CrmComp:
    apn: str | None
    address: str | None
    price: float | None
    date: str | None
    status: str
    rating: str | None

    def as_candidate(self) -> Candidate:
        """The comp shaped as a candidate (identifiers only) so dedup's predicate applies."""
        return Candidate(
            source="crm",
            source_id=self.apn or self.address or "",
            status="sold" if self.status == "sold" else "active",
            apn=self.apn,
            address=self.address,
        )


@dataclass(frozen=True)
class CompMatch:
    """Where one CRM comp ended up in our run."""

    crm: CrmComp
    in_pool: bool
    filter_reasons: tuple[str, ...] = ()  # set when a guardrail dropped it
    unjudged: bool = False
    ranked: RankedComp | None = None

    @property
    def filtered(self) -> bool:
        return bool(self.filter_reasons)

    @property
    def agrees(self) -> bool:
        return self.ranked is not None and self.ranked.result.tier in AGREEING_TIERS

    @property
    def tier_conflict(self) -> bool:
        return self.ranked is not None and self.ranked.result.tier not in AGREEING_TIERS


@dataclass(frozen=True)
class ReviewRow:
    subject_id: str
    category: Category
    detail: str
    apn: str
    address: str
    status: str
    price: str
    date: str
    our_rank: str
    our_tier: str
    composite: str
    crm_rating: str


@dataclass(frozen=True)
class Metrics:
    """Counts behind one row of the metrics table; ratios are None when their base is zero."""

    crm_comps: int
    in_pool: int
    filtered: int
    agreeing: int
    top5_hits: int
    top5_possible: int

    @staticmethod
    def _ratio(part: int, whole: int) -> float | None:
        return part / whole if whole else None

    @property
    def recall(self) -> float | None:
        return self._ratio(self.in_pool, self.crm_comps)

    @property
    def filter_loss(self) -> float | None:
        return self._ratio(self.filtered, self.crm_comps)

    @property
    def agreement(self) -> float | None:
        return self._ratio(self.agreeing, self.in_pool)

    @property
    def overlap_at_5(self) -> float | None:
        return self._ratio(self.top5_hits, self.top5_possible)


@dataclass
class SubjectResult:
    subject_id: str
    crm_comps: list[CrmComp]
    run_id: str | None = None
    error: str | None = None
    matches: list[CompMatch] = field(default_factory=list)
    top5_hits: int = 0
    review_rows: list[ReviewRow] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return self.error is None

    @property
    def metrics(self) -> Metrics:
        return Metrics(
            crm_comps=len(self.matches),
            in_pool=sum(m.in_pool for m in self.matches),
            filtered=sum(m.filtered for m in self.matches),
            agreeing=sum(m.agrees for m in self.matches),
            top5_hits=self.top5_hits,
            top5_possible=min(TOP_K, len(self.matches)),
        )


@dataclass
class BenchResult:
    subjects: list[SubjectResult]
    bench_path: Path
    review_path: Path

    @property
    def succeeded(self) -> list[SubjectResult]:
        return [s for s in self.subjects if s.ok]

    @property
    def overall(self) -> Metrics:
        parts = [s.metrics for s in self.succeeded]
        return Metrics(
            crm_comps=sum(p.crm_comps for p in parts),
            in_pool=sum(p.in_pool for p in parts),
            filtered=sum(p.filtered for p in parts),
            agreeing=sum(p.agreeing for p in parts),
            top5_hits=sum(p.top5_hits for p in parts),
            top5_possible=sum(p.top5_possible for p in parts),
        )


def load_benchmark(conn: sqlite3.Connection) -> dict[str, list[CrmComp]]:
    """The imported CRM comps grouped by (normalized) subject id, in import order."""
    rows = conn.execute(
        "SELECT subject_id, comp_apn, comp_address, comp_price, comp_date, comp_status, "
        "crm_rating FROM benchmark_comps ORDER BY subject_id, id"
    ).fetchall()
    grouped: dict[str, list[CrmComp]] = {}
    for row in rows:
        grouped.setdefault(row["subject_id"], []).append(
            CrmComp(
                apn=row["comp_apn"],
                address=row["comp_address"],
                price=row["comp_price"],
                date=row["comp_date"],
                status=row["comp_status"],
                rating=row["crm_rating"],
            )
        )
    return grouped


@dataclass(frozen=True)
class _PoolEntry:
    candidate: Candidate
    ranked: RankedComp | None = None
    filter_reasons: tuple[str, ...] = ()
    unjudged: bool = False


def _pool(report: RunReport) -> list[_PoolEntry]:
    """Every deduped candidate of the run: judged (rank order), unjudged, then guardrail drops."""
    return [
        *(_PoolEntry(c.candidate, ranked=c) for c in report.comps),
        *(_PoolEntry(c, unjudged=True) for c in report.unjudged_candidates),
        *(_PoolEntry(r.candidate, filter_reasons=tuple(r.reasons)) for r in report.rejected),
    ]


def _match(crm: CrmComp, pool: Sequence[_PoolEntry], county: CountyConfig) -> CompMatch:
    crm_candidate = crm.as_candidate()
    for entry in pool:
        if is_same_parcel(entry.candidate, crm_candidate, county):
            return CompMatch(
                crm,
                in_pool=True,
                filter_reasons=entry.filter_reasons,
                unjudged=entry.unjudged,
                ranked=entry.ranked,
            )
    return CompMatch(crm, in_pool=False)


def _money(value: float | None) -> str:
    """A plain decimal (no exponent, no lost digits) so $1M+ prices survive the CSV."""
    return "" if value is None else f"{value:.2f}".removesuffix(".00")


def _crm_only_row(subject_id: str, match: CompMatch) -> ReviewRow:
    if not match.in_pool:
        detail = "not in our candidate pool"
    elif match.filtered:
        detail = f"dropped by guardrail: {';'.join(match.filter_reasons)}"
    else:
        detail = "in our pool but Jev gave no answer"
    crm = match.crm
    return ReviewRow(
        subject_id=subject_id,
        category="crm_only",
        detail=detail,
        apn=crm.apn or "",
        address=crm.address or "",
        status=crm.status,
        price=_money(crm.price),
        date=crm.date or "",
        our_rank="",
        our_tier="",
        composite="",
        crm_rating=crm.rating or "",
    )


def _our_row(
    subject_id: str, category: Category, comp: RankedComp, detail: str, crm_rating: str
) -> ReviewRow:
    candidate = comp.candidate
    return ReviewRow(
        subject_id=subject_id,
        category=category,
        detail=detail,
        apn=candidate.apn or "",
        address=candidate.address or "",
        status=candidate.status,
        price=_money(candidate.price),
        date=candidate.event_date.isoformat() if candidate.event_date else "",
        our_rank=str(comp.rank),
        our_tier=comp.result.tier,
        composite=f"{comp.result.composite:.4f}",
        crm_rating=crm_rating,
    )


def evaluate_subject(
    subject_id: str, crm_comps: list[CrmComp], settings: Settings, pipeline: PipelineFn
) -> SubjectResult:
    """Run the pipeline for one subject and compare its pool and ranking to the CRM comps.

    Any exception from the pipeline is recorded on the result (and logged with its traceback)
    so one bad subject cannot sink the batch.
    """
    result = SubjectResult(subject_id, crm_comps)
    try:
        report = pipeline(subject_id)
    except Exception as exc:  # any failure is recorded on the result, never dropped
        logger.exception("benchmark subject %s failed", subject_id)
        result.error = f"{type(exc).__name__}: {exc}"
        return result

    county = settings.county
    result.run_id = report.summary.run_id
    pool = _pool(report)
    result.matches = [_match(crm, pool, county) for crm in crm_comps]

    top5 = select_comps(report.comps, TOP_K, include_rejects=False)
    crm_candidates = [crm.as_candidate() for crm in crm_comps]
    for comp in top5:
        if any(is_same_parcel(comp.candidate, crm, county) for crm in crm_candidates):
            result.top5_hits += 1
        else:
            result.review_rows.append(
                _our_row(subject_id, "ours_only", comp, "in our top 5, not a CRM comp", "")
            )
    for match in result.matches:
        if match.tier_conflict and match.ranked is not None:
            detail = f"CRM comp we tier {match.ranked.result.tier}"
            result.review_rows.append(
                _our_row(subject_id, "tier_conflict", match.ranked, detail, match.crm.rating or "")
            )
        elif not match.agrees:
            result.review_rows.append(_crm_only_row(subject_id, match))
    return result


def _pct(value: float | None) -> str:
    return "n/a" if value is None else f"{value * 100:.0f}%"


def _verdict(value: float | None, target: float) -> str:
    return "PASS" if value is not None and value >= target else "FAIL"


def _cell(text: str) -> str:
    return text.replace("|", "\\|").replace("\n", " ")


def render_markdown(result: BenchResult, timestamp: str) -> str:
    """The bench report: metrics vs targets, per-subject table, filter losses, failures."""
    overall = result.overall
    lines = [
        f"# Benchmark report {timestamp}",
        "",
        f"Subjects: {len(result.subjects)} ({len(result.succeeded)} ran, "
        f"{len(result.subjects) - len(result.succeeded)} failed). "
        f"Metrics cover the {overall.crm_comps} CRM comps of the subjects that ran.",
        f"Review file: `{result.review_path.name}`",
        "",
        "## Overall vs targets",
        "",
        "| Metric | Result | Target | Verdict |",
        "|---|---|---|---|",
        f"| Candidate recall | {_pct(overall.recall)} ({overall.in_pool}/{overall.crm_comps}) "
        f"| >= {RECALL_TARGET * 100:.0f}% | {_verdict(overall.recall, RECALL_TARGET)} |",
        f"| Ranking agreement | {_pct(overall.agreement)} ({overall.agreeing}/{overall.in_pool}) "
        f"| >= {AGREEMENT_TARGET * 100:.0f}% | {_verdict(overall.agreement, AGREEMENT_TARGET)} |",
        f"| Reviewed precision | pending | >= {REVIEWED_PRECISION_TARGET * 100:.0f}% "
        "| PENDING (label the review CSV) |",
        "",
        "Informational:",
        "",
        f"- Filter loss: {_pct(overall.filter_loss)} ({overall.filtered}/{overall.crm_comps} "
        "CRM comps dropped by guardrails)",
        f"- Overlap@5: {_pct(overall.overlap_at_5)} ({overall.top5_hits}/{overall.top5_possible} "
        "of the CRM comps we could place in our top 5)",
        "",
        "Recall counts CRM comps in our deduped pool before guardrails and Jev. Agreement is "
        "the share of those in-pool comps we tier excellent or good (filtered and unjudged "
        "comps never agree).",
        "",
        "## Per subject",
        "",
        "| Subject | Run | CRM comps | Recall | Filter loss | Agreement | Overlap@5 |",
        "|---|---|---|---|---|---|---|",
    ]
    for subject in result.subjects:
        if not subject.ok:
            lines.append(
                f"| {_cell(subject.subject_id)} | FAILED | {len(subject.crm_comps)} | | | | |"
            )
            continue
        m = subject.metrics
        lines.append(
            f"| {_cell(subject.subject_id)} | {subject.run_id} | {m.crm_comps} "
            f"| {_pct(m.recall)} ({m.in_pool}/{m.crm_comps}) "
            f"| {_pct(m.filter_loss)} ({m.filtered}/{m.crm_comps}) "
            f"| {_pct(m.agreement)} ({m.agreeing}/{m.in_pool}) "
            f"| {_pct(m.overlap_at_5)} ({m.top5_hits}/{m.top5_possible}) |"
        )

    lines += ["", "## Filter loss (CRM comps dropped by guardrails)", ""]
    losses = [(s, m) for s in result.succeeded for m in s.matches if m.filtered]
    if losses:
        lines += ["| Subject | CRM comp | Reason |", "|---|---|---|"]
        for subject, match in losses:
            crm = match.crm
            lines.append(
                f"| {_cell(subject.subject_id)} | {_cell(crm.apn or crm.address or '')} "
                f"| {', '.join(match.filter_reasons)} |"
            )
    else:
        lines.append("None.")

    lines += ["", "## Failed subjects", ""]
    failures = [s for s in result.subjects if not s.ok]
    if failures:
        lines += [f"- {_cell(s.subject_id)}: {_cell(s.error or '')}" for s in failures]
    else:
        lines.append("None.")
    lines.append("")
    return "\n".join(lines)


def write_review_csv(path: Path, subjects: Sequence[SubjectResult]) -> int:
    """Write every disagreement with a blank `human_label` (good/bad); returns the row count."""
    count = 0
    with path.open("x", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(REVIEW_COLUMNS)
        for subject in subjects:
            for row in subject.review_rows:
                writer.writerow(
                    [
                        row.subject_id,
                        row.category,
                        row.detail,
                        row.apn,
                        row.address,
                        row.status,
                        row.price,
                        row.date,
                        row.our_rank,
                        row.our_tier,
                        row.composite,
                        row.crm_rating,
                        "",
                    ]
                )
                count += 1
    return count


def run_benchmark(
    conn: sqlite3.Connection,
    settings: Settings,
    pipeline: PipelineFn,
    reports_dir: Path,
    now: datetime | None = None,
) -> BenchResult:
    """Run every imported benchmark subject and write `bench_<ts>.md` and `review_<ts>.csv`.

    Raises `BenchRunError` when no benchmark comps are imported or a report file cannot be
    written (an existing file with the same timestamp is never overwritten).
    """
    benchmark = load_benchmark(conn)
    if not benchmark:
        raise BenchRunError("No benchmark comps imported. Run `comps bench import <csv>` first.")

    timestamp = (now or datetime.now(UTC)).strftime("%Y%m%d-%H%M%S")
    subjects = [
        evaluate_subject(subject_id, comps, settings, pipeline)
        for subject_id, comps in benchmark.items()
    ]
    result = BenchResult(
        subjects,
        bench_path=reports_dir / f"bench_{timestamp}.md",
        review_path=reports_dir / f"review_{timestamp}.csv",
    )
    try:
        reports_dir.mkdir(parents=True, exist_ok=True)
        write_review_csv(result.review_path, subjects)
        with result.bench_path.open("x", encoding="utf-8") as handle:
            handle.write(render_markdown(result, timestamp))
    except OSError as exc:
        raise BenchRunError(f"Cannot write benchmark reports to {reports_dir}: {exc}") from exc
    return result
