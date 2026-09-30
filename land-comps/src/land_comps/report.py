"""The result of a comp run and how it is shown: rich tables, JSON export, CSV export.

`RunReport` is everything a run produced (subject, header facts, counts, cost, and every
scored candidate in rank order). `comps find` builds one from a live run and `comps rescore`
will rebuild one from the stored run, so both print through `render_report`.

Sold and listing comps are shown in separate sections but share one global rank, so a
listing ranked 3rd is still visibly behind the sold comps ranked 1 and 2. `top` and
`include_rejects` choose which ranked comps are displayed *and* exported; the full set is
what `runs` / `run_results` keep.
"""

import csv
import json
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field
from rich.console import Console, Group, RenderableType
from rich.markup import escape
from rich.table import Table
from rich.text import Text

from land_comps.dedupe import provenance, source_urls
from land_comps.models import Candidate, CompResult, Parcel
from land_comps.scoring import Features
from land_comps.state import price_per_acre

STATUS_LABELS = {"sold": "SOLD", "active": "LIST", "pending": "PEND"}
CSV_COLUMNS = (
    "rank",
    "tier",
    "composite",
    "status",
    "apn",
    "address",
    "acreage",
    "price",
    "price_per_acre",
    "distance_mi",
    "date",
    "sources",
    "flags",
)
_TIER_STYLES = {"excellent": "bold green", "good": "green", "marginal": "yellow", "reject": "red"}


class ExportError(ValueError):
    """An `--out` path that cannot be exported (unknown extension)."""


class SourceErrorInfo(BaseModel):
    source: str
    reason: str


class WideningInfo(BaseModel):
    """One auto-widen step: its label (e.g. `radius:1.5mi`) and the candidates kept after it."""

    label: str
    kept: int


class RunCounts(BaseModel):
    gathered: int  # candidates the sources returned in the final pass, before dedupe
    deduped: int  # unique parcels after cross-source dedupe
    filtered: int  # dropped by the guardrails
    judged: int  # candidates Jev answered for
    unjudged: int = 0  # candidates Jev could not answer for (retries exhausted)


class RunCost(BaseModel):
    jev_input_tokens: int
    jev_usd: float
    apify_items: int
    regrid_records: int


class RunSummary(BaseModel):
    """Run-level facts: inputs, subject, header/footer content. Stored in `runs.params_json`."""

    run_id: str
    target: str
    created_at: datetime
    subject: Parcel
    requested_radius_mi: float | None = None
    resolve_apn: bool = False
    radius_mi: float  # the search radius of the final pass
    lookback_months: int
    counts: RunCounts
    cost: RunCost
    filter_reasons: dict[str, int] = Field(default_factory=dict)
    source_errors: list[SourceErrorInfo] = Field(default_factory=list)
    widening: list[WideningInfo] = Field(default_factory=list)
    unjudged: list[str] = Field(default_factory=list)  # one "candidate: why" line each


@dataclass(frozen=True)
class RankedComp:
    """One judged candidate at its position in the ranking.

    `state` is the exact Jev input, kept so a stored run is fully self-describing.
    """

    rank: int
    candidate: Candidate
    result: CompResult
    features: Features
    state: dict[str, Any] = field(default_factory=dict)

    @property
    def section(self) -> Literal["sold", "listing"]:
        return "sold" if self.candidate.status == "sold" else "listing"


@dataclass(frozen=True)
class RunReport:
    summary: RunSummary
    comps: list[RankedComp]  # every judged candidate, best first (rejects included)


def select_comps(
    comps: Sequence[RankedComp], top: int | None, include_rejects: bool
) -> list[RankedComp]:
    """The comps to display/export: rejects dropped unless asked for, then the first `top`."""
    chosen = [c for c in comps if include_rejects or c.result.tier != "reject"]
    return chosen if top is None else chosen[:top]


def export_format(path: Path) -> Literal["json", "csv"]:
    """The export format implied by `path`'s extension; raises `ExportError` for anything else."""
    suffix = path.suffix.lower()
    if suffix == ".json":
        return "json"
    if suffix == ".csv":
        return "csv"
    raise ExportError(f"--out must end in .json or .csv, got {str(path)!r}")


# --- shared cell values -------------------------------------------------------------------


def flags(comp: RankedComp) -> list[str]:
    """Gate/demotion markers, plus `widened:<step>` for candidates only a wider search found."""
    marks = list(comp.result.gates_triggered)
    if comp.candidate.widened:
        marks.append(f"widened:{comp.candidate.widen_step}")
    return marks


def _sources(candidate: Candidate) -> list[str]:
    return candidate.sources or [candidate.source]


def _money(value: float | None) -> str:
    return "n/a" if value is None else f"${value:,.0f}"


def _acres(value: float | None) -> str:
    return "n/a" if value is None else f"{value:.2f}"


def _distance(features: Features) -> str:
    return "n/a" if features.distance_miles is None else f"{features.distance_miles:.2f}"


def _date(value: date | None) -> str:
    return "n/a" if value is None else value.isoformat()


# --- rich output --------------------------------------------------------------------------


def _subject_line(subject: Parcel) -> str:
    parts = [f"APN {subject.apn}"]
    if subject.address:
        parts.append(subject.address)
    if subject.acreage is not None:
        parts.append(f"{subject.acreage:.2f} acres")
    if subject.zoning:
        parts.append(f"zoning {subject.zoning}")
    if subject.land_use:
        parts.append(subject.land_use)
    return " | ".join(parts)


def _header(summary: RunSummary) -> list[RenderableType]:
    lines: list[RenderableType] = [
        Text.from_markup(f"[bold]Subject:[/bold] {escape(_subject_line(summary.subject))}"),
        Text(
            f"Search: radius {summary.radius_mi:g} mi, lookback {summary.lookback_months} months"
            f" | run {summary.run_id}"
        ),
    ]
    if summary.widening:
        steps = ", ".join(f"{w.label} ({w.kept} kept)" for w in summary.widening)
        lines.append(Text.from_markup(f"[yellow]Widened:[/yellow] {escape(steps)}"))
    for error in summary.source_errors:
        lines.append(
            Text.from_markup(
                f"[red]Source error:[/red] {escape(error.source)}: {escape(error.reason)}"
            )
        )
    return lines


def _table(title: str, comps: Sequence[RankedComp]) -> Table:
    table = Table(title=title, title_justify="left")
    for name in ("Rank", "Tier", "Score", "Status", "APN", "Address"):
        table.add_column(name)
    for name in ("Acres", "Price", "$/acre", "Dist mi"):
        table.add_column(name, justify="right")
    for name in ("Date", "Sources", "Flags"):
        table.add_column(name)
    for comp in comps:
        candidate, result = comp.candidate, comp.result
        table.add_row(
            str(comp.rank),
            Text(result.tier, style=_TIER_STYLES[result.tier]),
            f"{result.composite:.3f}",
            STATUS_LABELS[candidate.status],
            escape(candidate.apn or "n/a"),
            escape(candidate.address or "n/a"),
            _acres(candidate.acreage),
            _money(candidate.price),
            _money(price_per_acre(candidate)),
            _distance(comp.features),
            _date(candidate.event_date),
            escape(", ".join(_sources(candidate))),
            escape(", ".join(flags(comp))),
        )
    return table


def _section(title: str, comps: Sequence[RankedComp]) -> RenderableType:
    if not comps:
        return Text.from_markup(f"[bold]{title}[/bold]\n  none")
    return _table(title, comps)


def _footer(summary: RunSummary, shown: int, hidden_rejects: int) -> list[RenderableType]:
    counts, cost = summary.counts, summary.cost
    filtered = f"filtered {counts.filtered}"
    if summary.filter_reasons:
        reasons = ", ".join(f"{code} {n}" for code, n in sorted(summary.filter_reasons.items()))
        filtered += f" ({reasons})"
    judged = f"judged {counts.judged}"
    if counts.unjudged:
        judged += f" (+{counts.unjudged} unjudged)"
    lines: list[RenderableType] = [
        Text(f"Gathered {counts.gathered} | deduped {counts.deduped} | {filtered} | {judged}"),
        Text(
            f"Cost: Jev {cost.jev_input_tokens:,} input tokens (${cost.jev_usd:.4f}) | "
            f"Apify {cost.apify_items} items | Regrid {cost.regrid_records} records"
        ),
        Text(f"Showing {shown} of {counts.judged} judged comps."),
    ]
    if hidden_rejects:
        lines.append(Text(f"{hidden_rejects} reject-tier comps hidden; use --include-rejects."))
    for note in summary.unjudged:
        lines.append(Text.from_markup(f"[yellow]Unjudged:[/yellow] {escape(note)}"))
    return lines


def render_report(
    console: Console, report: RunReport, top: int | None = None, include_rejects: bool = False
) -> None:
    """Print header, the Sold and Listing sections, and the counts/cost footer."""
    shown = select_comps(report.comps, top, include_rejects)
    hidden_rejects = 0
    if not include_rejects:
        hidden_rejects = sum(1 for c in report.comps if c.result.tier == "reject")
    sold = [c for c in shown if c.section == "sold"]
    listings = [c for c in shown if c.section == "listing"]
    console.print(Group(*_header(report.summary)))
    console.print(_section("Sold comps (recorded sales)", sold))
    console.print(_section("Listing comps (asking prices: active and pending)", listings))
    console.print(Group(*_footer(report.summary, len(shown), hidden_rejects)))


# --- exports ------------------------------------------------------------------------------


def _csv_row(comp: RankedComp) -> dict[str, Any]:
    candidate = comp.candidate
    per_acre = price_per_acre(candidate)
    return {
        "rank": comp.rank,
        "tier": comp.result.tier,
        "composite": round(comp.result.composite, 4),
        "status": STATUS_LABELS[candidate.status],
        "apn": candidate.apn or "",
        "address": candidate.address or "",
        "acreage": "" if candidate.acreage is None else candidate.acreage,
        "price": "" if candidate.price is None else candidate.price,
        "price_per_acre": "" if per_acre is None else round(per_acre, 2),
        "distance_mi": (
            "" if comp.features.distance_miles is None else round(comp.features.distance_miles, 3)
        ),
        "date": "" if candidate.event_date is None else candidate.event_date.isoformat(),
        "sources": ";".join(_sources(candidate)),
        "flags": ";".join(flags(comp)),
    }


def _json_comp(comp: RankedComp) -> dict[str, Any]:
    candidate = comp.candidate
    return {
        "rank": comp.rank,
        "section": comp.section,
        "candidate": candidate.model_dump(mode="json", exclude={"raw"}),
        "provenance": provenance(candidate),
        "urls": source_urls(candidate),
        "features": comp.features.model_dump(mode="json"),
        "result": comp.result.model_dump(mode="json"),
    }


def write_export(path: Path, report: RunReport, comps: Sequence[RankedComp]) -> None:
    """Write `comps` to `path` as JSON (full results) or CSV (the table columns)."""
    if export_format(path) == "csv":
        with path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=CSV_COLUMNS)
            writer.writeheader()
            writer.writerows(_csv_row(comp) for comp in comps)
        return
    document = {
        "run": report.summary.model_dump(mode="json"),
        "comps": [_json_comp(comp) for comp in comps],
    }
    path.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")
