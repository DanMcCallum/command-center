"""The end-to-end comp pipeline behind `comps find` (and later `comps bench run`).

resolve subject -> gather -> dedupe -> guardrails (auto-widen) -> Jev -> score -> rank -> persist.

`run_find` is the single entry point. Every outside dependency arrives through `FindClients`
(Regrid lookup, candidate sources, Jev judge, Apify usage meter), so tests and the benchmark
harness inject fakes and never touch the network.
"""

import logging
import math
import sqlite3
from collections import Counter
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from typing import Any, Protocol, runtime_checkable

from land_comps.config import Settings
from land_comps.gather import GatherResult, NamedSource, gather
from land_comps.guardrails import run_guardrails
from land_comps.jev import JEV_INPUT_USD_PER_MTOK, JevUnavailableError, JudgedAnswers
from land_comps.models import Candidate, Parcel
from land_comps.normalize import looks_like_apn, normalize_apn
from land_comps.regrid import ParcelLookup
from land_comps.report import (
    RankedComp,
    RunCost,
    RunCounts,
    RunReport,
    RunSummary,
    SourceErrorInfo,
    WideningInfo,
)
from land_comps.runs import new_run_id, save_run
from land_comps.scoring import Features, ScoredComp, compute_features, rank, score
from land_comps.state import build_state

logger = logging.getLogger(__name__)

# `search.max_radius_mi` is validated <= 5 in config; this is the PRD's absolute ceiling.
ABSOLUTE_MAX_RADIUS_MI = 5.0


class FindError(Exception):
    """A `find` run that cannot proceed for a reason the operator can fix."""


class SubjectNotFoundError(FindError):
    """Regrid has no parcel for the subject APN or address."""


class InvalidRadiusError(FindError):
    """`--radius` is not positive or exceeds the configured maximum radius."""


class BatchJudge(Protocol):
    """What the pipeline needs from Jev; `JevJudge` satisfies it."""

    def judge_many(
        self, states: Sequence[dict[str, Any]], concurrency: int = ...
    ) -> list[JudgedAnswers | JevUnavailableError]: ...


@runtime_checkable
class MeteredLookup(Protocol):
    """A Regrid client that reports billed records this month (`RegridClient` does)."""

    def records_used(self) -> int: ...


def _no_apify_items() -> int:
    return 0


@dataclass(frozen=True)
class FindClients:
    """Every external dependency of one run, injectable for tests.

    `apify_items_fetched` reads the cumulative Apify items the sources have pulled so far
    (the run reports the delta); a regrid client implementing `MeteredLookup` is metered the
    same way. Clients without a meter report zero.
    """

    regrid: ParcelLookup
    sources: Sequence[NamedSource]
    judge: BatchJudge
    apify_items_fetched: Callable[[], int] = field(default=_no_apify_items)


def effective_search(settings: Settings, radius_mi: float | None) -> Settings:
    """`settings` with `--radius` applied as the initial radius; rejects values beyond the maximum.

    The radius is a starting point: auto-widening may still grow it, but never past
    `search.max_radius_mi` (itself capped at 5 miles by config validation).
    """
    if radius_mi is None:
        return settings
    ceiling = min(settings.search.max_radius_mi, ABSOLUTE_MAX_RADIUS_MI)
    if not math.isfinite(radius_mi) or radius_mi <= 0:
        raise InvalidRadiusError(f"--radius must be positive, got {radius_mi:g}")
    if radius_mi > ceiling:
        raise InvalidRadiusError(
            f"--radius {radius_mi:g} mi exceeds the maximum search radius of {ceiling:g} mi"
        )
    search = settings.search.model_copy(update={"initial_radius_mi": radius_mi})
    return settings.model_copy(update={"search": search})


def resolve_subject(client: ParcelLookup, settings: Settings, target: str) -> Parcel | None:
    """The Regrid parcel for an APN or street address, or None when there is no match."""
    if looks_like_apn(target):
        apn = normalize_apn(target, settings.county.fips, settings.county.apn_length)
        return client.by_apn(apn, settings.county.fips)
    return client.by_address(target)


def _describe(candidate: Candidate) -> str:
    return candidate.apn or candidate.address or f"{candidate.source}:{candidate.source_id}"


def _records_used(client: ParcelLookup) -> int:
    return client.records_used() if isinstance(client, MeteredLookup) else 0


def run_find(
    target: str,
    settings: Settings,
    conn: sqlite3.Connection,
    clients: FindClients,
    *,
    radius_mi: float | None = None,
    resolve_apn: bool = False,
    today: date | None = None,
    now: datetime | None = None,
) -> RunReport:
    """Run the whole pipeline for one subject, persist it, and return the ranked report.

    Raises `InvalidRadiusError` / `SubjectNotFoundError` for bad input, and lets `RegridError`
    (subject lookup) and `JevError` (bad key, invalid request) propagate. A failing candidate
    source or a candidate Jev cannot answer for degrades the result instead: it is reported
    in the run summary.
    """
    today = today or date.today()
    now = now or datetime.now(UTC)
    settings = effective_search(settings, radius_mi)
    search = settings.search

    regrid_before = _records_used(clients.regrid)
    apify_before = clients.apify_items_fetched()

    subject = resolve_subject(clients.regrid, settings, target)
    if subject is None:
        raise SubjectNotFoundError(f"No parcel found for {target!r}. Check the APN or address.")

    gathered_last = 0

    def gather_fn(radius: float, lookback_months: int) -> GatherResult:
        nonlocal gathered_last
        result = gather(subject, radius, lookback_months, clients.sources)
        gathered_last = len(result.candidates)  # each pass re-gathers a superset; keep the last
        return result

    guarded = run_guardrails(
        subject,
        gather_fn,
        search,
        settings.county,
        apn_resolver=clients.regrid if resolve_apn else None,
        today=today,
    )
    pool = guarded.kept
    features = [compute_features(subject, c, today) for c in pool]
    states = [build_state(subject, c, pool, today=today) for c in pool]
    outcomes = clients.judge.judge_many(states) if states else []

    scored: list[ScoredComp] = []
    detail: dict[int, tuple[Features, dict[str, Any]]] = {}
    unjudged: list[str] = []
    input_tokens = 0
    for candidate, feats, state, outcome in zip(pool, features, states, outcomes, strict=True):
        if isinstance(outcome, JevUnavailableError):
            unjudged.append(f"{_describe(candidate)}: {outcome}")
            continue
        if not outcome.cached:
            input_tokens += outcome.input_tokens or 0
        item = ScoredComp(candidate, score(candidate, outcome.answers, feats, settings))
        scored.append(item)
        detail[id(item)] = (feats, state)

    comps = [
        RankedComp(position, item.candidate, item.result, *detail[id(item)])
        for position, item in enumerate(rank(scored), start=1)
    ]

    criteria = guarded.criteria
    summary = RunSummary(
        run_id=new_run_id(now),
        target=target,
        created_at=now,
        subject=subject,
        requested_radius_mi=radius_mi,
        resolve_apn=resolve_apn,
        radius_mi=criteria.radius_mi if criteria else search.initial_radius_mi,
        lookback_months=criteria.lookback_months if criteria else search.lookback_months,
        counts=RunCounts(
            gathered=gathered_last,
            deduped=len(guarded.kept) + len(guarded.rejected),
            filtered=len(guarded.rejected),
            judged=len(comps),
            unjudged=len(unjudged),
        ),
        cost=RunCost(
            jev_input_tokens=input_tokens,
            jev_usd=input_tokens * JEV_INPUT_USD_PER_MTOK / 1_000_000,
            apify_items=clients.apify_items_fetched() - apify_before,
            regrid_records=_records_used(clients.regrid) - regrid_before,
        ),
        filter_reasons=dict(Counter(r.reason for r in guarded.rejected)),
        source_errors=[
            SourceErrorInfo(source=e.source, reason=e.reason) for e in guarded.source_errors
        ],
        widening=[WideningInfo(label=s.label, kept=s.survivors) for s in guarded.widening_steps],
        unjudged=unjudged,
    )
    save_run(conn, summary, comps)
    logger.info("run %s saved: %d comps ranked", summary.run_id, len(comps))
    return RunReport(summary, comps)
