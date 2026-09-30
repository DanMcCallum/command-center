"""Combine Jev's answers and computed features into a composite, gates, tier, and ranking.

The formula and gates are PRD section 5. Every weight and threshold comes from
`Settings.scoring`, so `comps rescore` can re-rank stored answers with no other change.

Decisions worth knowing:
- The recency term uses `search.lookback_months` and the proximity term uses
  `search.max_radius_mi`; both terms are clamped to [0, 1], so a candidate admitted by an
  auto-widened lookback or radius simply earns 0 for that term.
- A feature we could not compute (no coordinates, no event date) contributes 0 to its term.
- Demotion is a single step even when both the floor and the confidence rule trigger (the
  conservative reading of "demoted one level if ... or ..."). Both reasons are still recorded.
- A `reject` choice has no floor and cannot be demoted further.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from typing import Literal

from pydantic import BaseModel

from land_comps.config import Settings
from land_comps.geo import haversine_miles
from land_comps.models import Candidate, CompResult, JevAnswers, Parcel
from land_comps.state import months_between

Tier = Literal["excellent", "good", "marginal", "reject"]

# Best to worst; the index is the sort key and a demotion moves one place right.
TIER_ORDER: tuple[Tier, ...] = ("excellent", "good", "marginal", "reject")

GATE_ARMS_LENGTH = "arms_length"
GATE_RED_FLAGS_REJECT = "red_flags_reject"
GATE_RED_FLAG = "red_flag"
GATE_BELOW_FLOOR = "below_tier_floor"
GATE_LOW_CONFIDENCE = "low_tier_confidence"

# Tie-break between equal composites is on values rounded to this many places, so float
# noise from summing weights does not decide the order.
_COMPOSITE_TIE_DIGITS = 9


class Features(BaseModel):
    """Computed comparison facts the composite needs; stored so rescoring needs no inputs."""

    distance_miles: float | None = None
    months_since_event: int | None = None


@dataclass(frozen=True)
class ScoredComp:
    """A candidate with its `CompResult`; ranking needs the candidate's status for tie-breaks."""

    candidate: Candidate
    result: CompResult


def compute_features(subject: Parcel, candidate: Candidate, today: date | None = None) -> Features:
    """Distance and months-since-event for one pair; None where the candidate lacks the input."""
    today = today or date.today()
    distance: float | None = None
    if candidate.lat is not None and candidate.lon is not None:
        distance = haversine_miles(subject.lat, subject.lon, candidate.lat, candidate.lon)
    months = months_between(candidate.event_date, today) if candidate.event_date else None
    return Features(distance_miles=distance, months_since_event=months)


def _clamp01(value: float) -> float:
    return min(max(value, 0.0), 1.0)


def _recency(features: Features, lookback_months: int) -> float:
    if features.months_since_event is None:
        return 0.0
    return _clamp01(1 - features.months_since_event / lookback_months)


def _proximity(features: Features, max_radius_mi: float) -> float:
    if features.distance_miles is None:
        return 0.0
    return _clamp01(1 - features.distance_miles / max_radius_mi)


def composite_score(
    candidate: Candidate, answers: JevAnswers, features: Features, config: Settings
) -> float:
    """The section 5 weighted sum."""
    w = config.scoring
    return (
        w.w1 * answers.is_good_comp.probability
        + w.w2 * answers.physical_similarity.score / 3
        + w.w3 * answers.access_utilities_similarity.score / 3
        + w.w4 * answers.market_similarity.score / 3
        + w.w5 * _recency(features, config.search.lookback_months)
        + w.w6 * _proximity(features, config.search.max_radius_mi)
        + w.w7 * (1.0 if candidate.status == "sold" else 0.0)
    )


def _demote(tier: Tier) -> Tier:
    return TIER_ORDER[min(TIER_ORDER.index(tier) + 1, len(TIER_ORDER) - 1)]


def score(
    candidate: Candidate, answers: JevAnswers, features: Features, config: Settings
) -> CompResult:
    """Composite, hard gates, and final tier for one candidate.

    `gates_triggered` lists, in order: `arms_length` (forces reject), `red_flags_reject`
    (policy `reject`) or `red_flag` (policy `warn`, a marker only), then the demotion
    reasons `below_tier_floor` / `low_tier_confidence` when the choice was demotable.
    """
    scoring = config.scoring
    composite = composite_score(candidate, answers, features, config)
    gates: list[str] = []
    forced_reject = False

    if answers.arms_length.probability < scoring.arms_length_min:
        gates.append(GATE_ARMS_LENGTH)
        forced_reject = True
    if answers.red_flags.probability > scoring.red_flags_max:
        if scoring.red_flag_policy == "reject":
            gates.append(GATE_RED_FLAGS_REJECT)
            forced_reject = True
        else:
            gates.append(GATE_RED_FLAG)

    tier: Tier = answers.quality_tier.choice
    if forced_reject:
        tier = "reject"
    elif tier != "reject":
        below_floor = composite < getattr(scoring.tier_floors, tier)
        low_confidence = answers.quality_tier.confidence < scoring.min_confidence
        if below_floor:
            gates.append(GATE_BELOW_FLOOR)
        if low_confidence:
            gates.append(GATE_LOW_CONFIDENCE)
        if below_floor or low_confidence:
            tier = _demote(tier)

    return CompResult(composite=composite, tier=tier, gates_triggered=gates, answers=answers)


def rank(results: Sequence[ScoredComp]) -> list[ScoredComp]:
    """Best first: tier, then composite descending, then sold above active/pending.

    The sort is stable, so anything still tied keeps its input order.
    """
    return sorted(
        results,
        key=lambda item: (
            TIER_ORDER.index(item.result.tier),
            -round(item.result.composite, _COMPOSITE_TIE_DIGITS),
            0 if item.candidate.status == "sold" else 1,
        ),
    )
