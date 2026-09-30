"""Assemble the compact Jev state object for one (subject, candidate) pair (PRD section 5).

Exact facts and arithmetic (distance, acreage ratio, months since the event, price per
acre against the pool) are computed here and *given* to Jev; Jev only makes the semantic
judgments. Fields we do not know are omitted rather than sent as nulls.
"""

import re
import statistics
from collections.abc import Sequence
from datetime import date
from typing import Any

from land_comps.geo import acreage_ratio, haversine_miles
from land_comps.models import Candidate, Parcel

DESCRIPTION_MAX_CHARS = 1500
MIN_POOL_FOR_MEDIAN = 3

_ZIP_AT_END = re.compile(r"\b(\d{5})(?:-\d{4})?\s*$")


def _clean(fields: dict[str, Any]) -> dict[str, Any]:
    """Drop None values and empty lists/strings so the state carries only known facts."""
    return {key: value for key, value in fields.items() if value not in (None, "", [])}


def _truncate(text: str | None) -> str | None:
    if text is None:
        return None
    text = text.strip()
    if len(text) <= DESCRIPTION_MAX_CHARS:
        return text
    return text[:DESCRIPTION_MAX_CHARS]


def price_per_acre(candidate: Candidate) -> float | None:
    if candidate.price_per_acre is not None:
        return candidate.price_per_acre
    if candidate.price is not None and candidate.acreage:
        return candidate.price / candidate.acreage
    return None


def _candidate_zoning(candidate: Candidate) -> str | None:
    """Zoning if the source supplied one; `Candidate` has no zoning field, so check `raw`."""
    value = candidate.raw.get("zoning")
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _candidate_zip(candidate: Candidate) -> str | None:
    """The five-digit ZIP ending the address, when the address carries one."""
    if not candidate.address:
        return None
    match = _ZIP_AT_END.search(candidate.address.strip())
    return match.group(1) if match else None


def months_between(event: date, today: date) -> int:
    """Whole calendar months from `event` to `today`, floored at 0 for future dates."""
    months = (today.year - event.year) * 12 + (today.month - event.month)
    if today.day < event.day:
        months -= 1
    return max(months, 0)


def pool_median_price_per_acre(pool: Sequence[Candidate]) -> float | None:
    """Median price per acre over the sold candidates in `pool`; None if fewer than 3."""
    values = [
        value
        for candidate in pool
        if candidate.status == "sold" and (value := price_per_acre(candidate)) is not None
    ]
    if len(values) < MIN_POOL_FOR_MEDIAN:
        return None
    return statistics.median(values)


def build_state(
    subject: Parcel,
    candidate: Candidate,
    pool: Sequence[Candidate],
    *,
    today: date | None = None,
) -> dict[str, Any]:
    """The `subject` / `candidate` / `comparison` state Jev judges for one pair."""
    today = today or date.today()
    per_acre = price_per_acre(candidate)
    cand_zoning = _candidate_zoning(candidate)

    subject_state = _clean(
        {
            "apn": subject.apn,
            "address": subject.address,
            "acreage": subject.acreage,
            "zoning": subject.zoning,
            "land_use": subject.land_use,
        }
    )
    candidate_state = _clean(
        {
            "source": candidate.source,
            "status": candidate.status,
            "apn": candidate.apn,
            "address": candidate.address,
            "acreage": candidate.acreage,
            "zoning": cand_zoning,
            "price": candidate.price,
            "price_per_acre": None if per_acre is None else round(per_acre),
            "event_date": candidate.event_date.isoformat() if candidate.event_date else None,
            "deed_type": candidate.deed_type,
            "road_access": candidate.road_access,
            "utilities": candidate.utilities,
            "topography": candidate.topography,
            "description": _truncate(candidate.description),
        }
    )

    distance: float | None = None
    if candidate.lat is not None and candidate.lon is not None:
        distance = round(haversine_miles(subject.lat, subject.lon, candidate.lat, candidate.lon), 2)
    ratio = acreage_ratio(subject.acreage, candidate.acreage)
    median = pool_median_price_per_acre(pool)
    vs_median = per_acre / median if per_acre is not None and median else None
    cand_zip = _candidate_zip(candidate)

    comparison = _clean(
        {
            "distance_miles": distance,
            "acreage_ratio": None if ratio is None else round(ratio, 2),
            "months_since_event": (
                months_between(candidate.event_date, today) if candidate.event_date else None
            ),
            "same_zoning": (
                subject.zoning.strip().casefold() == cand_zoning.casefold()
                if subject.zoning and cand_zoning
                else None
            ),
            "same_zip": subject.zip == cand_zip if subject.zip and cand_zip else None,
            "price_per_acre_vs_pool_median": None if vs_median is None else round(vs_median, 2),
        }
    )
    return {"subject": subject_state, "candidate": candidate_state, "comparison": comparison}
