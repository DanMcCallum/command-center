"""Deterministic guardrails: drop obviously bad candidates in code before Jev sees them.

`filter_candidates` applies one pass of filters and gives every drop a reason
code. `run_guardrails` wraps it in the auto-widen loop: while fewer than
`search.min_candidates` survive, it widens the search one step (radius x1.5 up
to `max_radius_mi`, then a single step to the wider acreage band, then lookback
up to `max_lookback_months`), re-gathers through the injected callable, dedupes,
and filters again. The search never goes beyond those configured maximums.

A filter only fires on a fact the candidate actually carries. A candidate with
no coordinates, no acreage, or no event date cannot be shown to be too far, out
of band, or stale, so it is kept and left for Jev to weigh; a missing price has
its own reason code.
"""

import logging
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import date
from typing import Literal

from land_comps.config import CountyConfig, SearchConfig
from land_comps.county import lookback_cutoff
from land_comps.dedupe import dedupe, is_same_parcel, provenance
from land_comps.gather import GatherResult
from land_comps.geo import acreage_ratio
from land_comps.listing_fields import within_radius
from land_comps.models import Candidate, Parcel
from land_comps.regrid import ParcelLookup
from land_comps.sources import SourceError

logger = logging.getLogger(__name__)

# Bounds are inclusive; this slack keeps a candidate sitting exactly on one (3.3 acres
# against a 10-acre subject and a 0.33 floor) from being lost to float rounding.
_EPSILON = 1e-9

ReasonCode = Literal[
    "too_far",
    "acreage_out_of_band",
    "stale",
    "nominal_price",
    "excluded_deed_type",
    "missing_price",
    "is_subject",
]

# (radius_mi, lookback_months) -> gathered candidates, as `gather` returns them.
GatherFn = Callable[[float, int], GatherResult]


@dataclass(frozen=True)
class Criteria:
    """The search window one guardrail pass filters against."""

    radius_mi: float
    acreage_ratio_min: float
    acreage_ratio_max: float
    lookback_months: int

    @classmethod
    def initial(cls, search: SearchConfig) -> "Criteria":
        return cls(
            radius_mi=search.initial_radius_mi,
            acreage_ratio_min=search.acreage_ratio_min,
            acreage_ratio_max=search.acreage_ratio_max,
            lookback_months=search.lookback_months,
        )


@dataclass(frozen=True)
class RejectedCandidate:
    """A dropped candidate and every reason code that applied (most fundamental first)."""

    candidate: Candidate
    reasons: tuple[ReasonCode, ...]

    @property
    def reason(self) -> ReasonCode:
        return self.reasons[0]


@dataclass(frozen=True)
class WideningStep:
    """One auto-widen step: what was widened and the criteria in force afterwards."""

    kind: Literal["radius", "acreage", "lookback"]
    criteria: Criteria
    survivors: int  # candidates kept after this step's pass

    @property
    def label(self) -> str:
        """Compact description, also stored on candidates first admitted by this step."""
        if self.kind == "radius":
            return f"radius:{self.criteria.radius_mi:g}mi"
        if self.kind == "acreage":
            low, high = self.criteria.acreage_ratio_min, self.criteria.acreage_ratio_max
            return f"acreage:{low:g}-{high:g}x"
        return f"lookback:{self.criteria.lookback_months}mo"


@dataclass
class GuardrailResult:
    """Outcome of `run_guardrails`: the final pass's kept/rejected split and the steps taken."""

    kept: list[Candidate] = field(default_factory=list)
    rejected: list[RejectedCandidate] = field(default_factory=list)
    widening_steps: list[WideningStep] = field(default_factory=list)
    criteria: Criteria | None = None  # the window of the final pass
    source_errors: list[SourceError] = field(default_factory=list)


def _subject_as_candidate(subject: Parcel) -> Candidate:
    return Candidate(
        source="subject",
        source_id=subject.apn,
        status="active",
        apn=subject.apn,
        address=subject.address,
        lat=subject.lat,
        lon=subject.lon,
        acreage=subject.acreage,
    )


def _reasons(
    subject: Parcel,
    subject_candidate: Candidate,
    candidate: Candidate,
    criteria: Criteria,
    search: SearchConfig,
    county: CountyConfig,
    cutoff: date,
    excluded_deed_types: frozenset[str],
) -> tuple[ReasonCode, ...]:
    reasons: list[ReasonCode] = []
    if is_same_parcel(subject_candidate, candidate, county):
        reasons.append("is_subject")
    if candidate.price is None:
        reasons.append("missing_price")
    elif candidate.price < search.nominal_price_floor:
        reasons.append("nominal_price")
    if candidate.deed_type and candidate.deed_type.strip().lower() in excluded_deed_types:
        reasons.append("excluded_deed_type")
    if not within_radius(
        subject.lat, subject.lon, candidate.lat, candidate.lon, criteria.radius_mi + _EPSILON
    ):
        reasons.append("too_far")
    ratio = acreage_ratio(subject.acreage, candidate.acreage)
    if ratio is not None and not (
        criteria.acreage_ratio_min - _EPSILON <= ratio <= criteria.acreage_ratio_max + _EPSILON
    ):
        reasons.append("acreage_out_of_band")
    if candidate.event_date is not None and candidate.event_date < cutoff:
        reasons.append("stale")
    return tuple(reasons)


def filter_candidates(
    subject: Parcel,
    candidates: Sequence[Candidate],
    criteria: Criteria,
    search: SearchConfig,
    county: CountyConfig,
    today: date | None = None,
) -> tuple[list[Candidate], list[RejectedCandidate]]:
    """Split `candidates` into kept and rejected (with reason codes) for one search window."""
    cutoff = lookback_cutoff(today or date.today(), criteria.lookback_months)
    excluded = frozenset(t.strip().lower() for t in county.excluded_deed_types)
    subject_candidate = _subject_as_candidate(subject)

    kept: list[Candidate] = []
    rejected: list[RejectedCandidate] = []
    for candidate in candidates:
        reasons = _reasons(
            subject, subject_candidate, candidate, criteria, search, county, cutoff, excluded
        )
        if reasons:
            rejected.append(RejectedCandidate(candidate, reasons))
        else:
            kept.append(candidate)
    return kept, rejected


def widening_plan(
    search: SearchConfig,
) -> list[tuple[Literal["radius", "acreage", "lookback"], Criteria]]:
    """Every widening step in order, each with the cumulative criteria in force after it.

    Radius grows x1.5 per step and is capped at `max_radius_mi`, then the acreage
    band widens once, then lookback grows by `lookback_step_months` up to
    `max_lookback_months`. Nothing here can exceed a configured maximum.
    """
    current = Criteria.initial(search)
    plan: list[tuple[Literal["radius", "acreage", "lookback"], Criteria]] = []

    while current.radius_mi < search.max_radius_mi:
        radius = min(current.radius_mi * 1.5, search.max_radius_mi)
        current = Criteria(
            radius, current.acreage_ratio_min, current.acreage_ratio_max, current.lookback_months
        )
        plan.append(("radius", current))

    wide_min, wide_max = search.widened_ratio_min, search.widened_ratio_max
    if (wide_min, wide_max) != (current.acreage_ratio_min, current.acreage_ratio_max):
        current = Criteria(current.radius_mi, wide_min, wide_max, current.lookback_months)
        plan.append(("acreage", current))

    while current.lookback_months < search.max_lookback_months:
        months = min(
            current.lookback_months + search.lookback_step_months, search.max_lookback_months
        )
        current = Criteria(
            current.radius_mi, current.acreage_ratio_min, current.acreage_ratio_max, months
        )
        plan.append(("lookback", current))
    return plan


def _keys(candidate: Candidate) -> set[tuple[str, str]]:
    """Identity of a (possibly merged) candidate: every (source, source_id) it came from."""
    return {(p["source"], p["source_id"]) for p in provenance(candidate)}


def _add_errors(errors: list[SourceError], new: Sequence[SourceError]) -> None:
    seen = {(e.source, e.reason) for e in errors}
    for error in new:
        if (error.source, error.reason) not in seen:
            seen.add((error.source, error.reason))
            errors.append(error)


def run_guardrails(
    subject: Parcel,
    gather_fn: GatherFn,
    search: SearchConfig,
    county: CountyConfig,
    apn_resolver: ParcelLookup | None = None,
    today: date | None = None,
) -> GuardrailResult:
    """Gather, dedupe, and filter, widening the search until enough candidates survive.

    `gather_fn(radius_mi, lookback_months)` is called for the initial window and
    again (then deduped) after every widening step. Widening stops as soon as
    `min_candidates` survive or the plan is exhausted; the result lists every
    step taken. Kept candidates first admitted by a widened pass carry
    `widened=True` and that step's label in `widen_step`; ones already admitted
    by an earlier pass keep the earlier label.
    """
    today = today or date.today()
    result = GuardrailResult()
    admitted: dict[tuple[str, str], tuple[int, str | None]] = {}  # key -> (pass, step label)

    plan: list[tuple[Literal["radius", "acreage", "lookback"] | None, Criteria]] = [
        (None, Criteria.initial(search)),
        *widening_plan(search),
    ]
    for pass_index, (kind, criteria) in enumerate(plan):
        gathered = gather_fn(criteria.radius_mi, criteria.lookback_months)
        _add_errors(result.source_errors, gathered.source_errors)
        pool = dedupe(gathered.candidates, county, apn_resolver)
        kept, rejected = filter_candidates(subject, pool, criteria, search, county, today)

        step = WideningStep(kind, criteria, len(kept)) if kind is not None else None
        label = step.label if step is not None else None
        labelled: list[Candidate] = []
        for candidate in kept:
            keys = _keys(candidate)
            earlier = [admitted[k] for k in keys if k in admitted]
            first_pass, first_label = (
                min(earlier, key=lambda e: e[0]) if earlier else (pass_index, label)
            )
            for key in keys:
                admitted.setdefault(key, (first_pass, first_label))
            if first_label is None:
                labelled.append(candidate)
            else:
                labelled.append(
                    candidate.model_copy(update={"widened": True, "widen_step": first_label})
                )

        result.kept, result.rejected, result.criteria = labelled, rejected, criteria
        if step is not None:
            result.widening_steps.append(step)
            logger.info("widened search (%s): %d candidates kept", step.label, len(kept))
        if len(kept) >= search.min_candidates:
            break
    else:
        logger.warning(
            "only %d candidates after widening to the configured maximums (wanted %d)",
            len(result.kept),
            search.min_candidates,
        )
    return result
