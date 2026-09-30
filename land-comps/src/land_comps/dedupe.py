"""Cross-source dedup: collapse the same parcel seen by several sources into one record.

Matching runs in the PRD's order, one pass per rule over the survivors of the
previous pass: (1) equal normalized APN, (2) within `COORD_MATCH_MILES` and
acreage within `ACREAGE_TOLERANCE`, (3) equal normalized street address.
`match_reason` / `is_same_parcel` expose the pairwise predicate so benchmark
matching (US-020) applies exactly the same logic.

Two records that both carry an APN and disagree are different parcels no
matter how close they sit, so rules 2 and 3 never merge them; that is what
keeps adjacent lots apart.
"""

import logging
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

from land_comps.config import CountyConfig
from land_comps.county_sales import SOURCE_NAME as COUNTY_SOURCE
from land_comps.geo import haversine_miles
from land_comps.models import Candidate
from land_comps.normalize import normalize_address, normalize_apn
from land_comps.regrid import ParcelLookup, RegridError

logger = logging.getLogger(__name__)

COORD_MATCH_MILES = 0.05
ACREAGE_TOLERANCE = 0.10

MatchReason = Literal["apn", "coordinate", "address"]


def _apn(candidate: Candidate, county: CountyConfig) -> str | None:
    if not candidate.apn or not candidate.apn.strip():
        return None
    return normalize_apn(candidate.apn, county.fips, county.apn_length)


def _address(candidate: Candidate) -> str | None:
    if not candidate.address:
        return None
    normalized = normalize_address(candidate.address)
    # Without a street number ("Elk Ridge Rd", "Fairplay CO") an address names a road or
    # town, and distinct lots on it would merge. So does the "0 Elk Ridge Rd" placeholder
    # vacant-land listings use for an unnumbered lot.
    number = normalized.split(" ", 1)[0]
    return normalized if number[:1].isdigit() and number.strip("0") else None


def _same_coordinates(a: Candidate, b: Candidate) -> bool:
    if None in (a.lat, a.lon, b.lat, b.lon) or not a.acreage or not b.acreage:
        return False
    assert a.lat is not None and a.lon is not None  # narrowed for the type checker
    assert b.lat is not None and b.lon is not None
    if haversine_miles(a.lat, a.lon, b.lat, b.lon) > COORD_MATCH_MILES:
        return False
    return abs(a.acreage - b.acreage) <= ACREAGE_TOLERANCE * max(a.acreage, b.acreage)


def match_reason(a: Candidate, b: Candidate, county: CountyConfig) -> MatchReason | None:
    """Which rule says `a` and `b` are the same parcel, or None if none does."""
    apn_a, apn_b = _apn(a, county), _apn(b, county)
    if apn_a is not None and apn_a == apn_b:
        return "apn"
    if apn_a is not None and apn_b is not None:
        return None  # two different parcels, however close or similarly described
    if _same_coordinates(a, b):
        return "coordinate"
    address = _address(a)
    if address is not None and address == _address(b):
        return "address"
    return None


def is_same_parcel(a: Candidate, b: Candidate, county: CountyConfig) -> bool:
    """True when `a` and `b` describe the same parcel under any dedup rule."""
    return match_reason(a, b, county) is not None


def _richness(candidate: Candidate) -> int:
    """How many attributes a candidate carries; the tiebreak for which record leads a merge."""
    scalars = (
        candidate.apn,
        candidate.address,
        candidate.lat,
        candidate.acreage,
        candidate.price,
        candidate.event_date,
        candidate.deed_type,
        candidate.road_access,
        candidate.topography,
        candidate.description,
        candidate.url,
    )
    return sum(value is not None for value in scalars) + len(candidate.utilities)


def _lead_key(candidate: Candidate) -> tuple[bool, bool, int, int]:
    is_county = COUNTY_SOURCE in (candidate.source, *candidate.sources)
    # The event date is the last tiebreak, so two sales of one APN merge the same way
    # whatever the input order (the more recent sale leads).
    recency = candidate.event_date.toordinal() if candidate.event_date else 0
    return (is_county, candidate.sold_price is not None, _richness(candidate), recency)


def _longest(a: str | None, b: str | None) -> str | None:
    return max((t for t in (a, b) if t), key=len, default=None)


def _union(a: Sequence[str], b: Sequence[str]) -> list[str]:
    return list(dict.fromkeys([*a, *b]))


def provenance(candidate: Candidate) -> list[dict[str, str]]:
    """The (source, source_id) records a candidate was merged from (itself if never merged)."""
    merged = candidate.raw.get("merged_from")
    if isinstance(merged, list):
        return [m for m in merged if isinstance(m, dict)]
    return [{"source": candidate.source, "source_id": candidate.source_id}]


def merge_candidates(a: Candidate, b: Candidate) -> Candidate:
    """Combine two records of one parcel into a single record with the richest attributes.

    The leading record (county sale, then one with a sold price, then the richer
    one) supplies every field it has; the other fills the gaps. Prices follow
    the PRD: the sold price is kept alongside the list price when a listing
    later sold, and `price` is the sold price whenever there is one, with the
    county's figure winning over a listing site's.
    """
    lead, other = (a, b) if _lead_key(a) >= _lead_key(b) else (b, a)

    sold_price = lead.sold_price if lead.sold_price is not None else other.sold_price
    list_price = lead.list_price if lead.list_price is not None else other.list_price
    price = sold_price if sold_price is not None else lead.price
    if price is None:
        price = other.price
    acreage = lead.acreage if lead.acreage is not None else other.acreage
    per_acre = price / acreage if price is not None and acreage else lead.price_per_acre
    if per_acre is None:
        per_acre = other.price_per_acre

    statuses = {lead.status, other.status}
    status: Literal["sold", "active", "pending"] = (
        "sold" if sold_price is not None or "sold" in statuses else lead.status
    )
    if status != "sold" and "pending" in statuses:
        status = "pending"

    # A listing that later sold keeps its listing date only if the county record has no date.
    event_date = lead.event_date if lead.event_date is not None else other.event_date

    return Candidate(
        source=lead.source,
        sources=_union(lead.sources or [lead.source], other.sources or [other.source]),
        source_id=lead.source_id,
        status=status,
        apn=lead.apn or other.apn,
        address=lead.address or other.address,
        lat=lead.lat if lead.lat is not None else other.lat,
        lon=lead.lon if lead.lon is not None else other.lon,
        acreage=acreage,
        price=price,
        list_price=list_price,
        sold_price=sold_price,
        price_per_acre=per_acre,
        event_date=event_date,
        deed_type=lead.deed_type or other.deed_type,
        road_access=_longest(lead.road_access, other.road_access),
        utilities=_union(lead.utilities, other.utilities),
        topography=lead.topography or other.topography,
        description=_longest(lead.description, other.description),
        url=lead.url or other.url,
        raw={**lead.raw, "merged_from": provenance(lead) + provenance(other)},
    )


@dataclass(frozen=True)
class ApnResolution:
    """What `resolve_apns` did: the updated candidates plus counts for logging and reporting."""

    candidates: list[Candidate]
    attempted: int
    resolved: int
    stopped_early: str | None


def resolve_apns(
    candidates: Sequence[Candidate], client: ParcelLookup, county: CountyConfig
) -> ApnResolution:
    """Attach an APN to candidates that lack one, via `client.by_point` (cached, quota-limited).

    Only candidates with coordinates are looked up, and a parcel outside
    `county` is ignored. Resolution stops at the first `RegridError`
    (`QuotaExceeded` included): the rest keep no APN and the reason is
    reported in `stopped_early`.
    """
    resolved_candidates: list[Candidate] = []
    attempted = resolved = 0
    stopped: str | None = None
    for candidate in candidates:
        if stopped is not None or candidate.apn or candidate.lat is None or candidate.lon is None:
            resolved_candidates.append(candidate)
            continue
        attempted += 1
        try:
            parcel = client.by_point(candidate.lat, candidate.lon)
        except RegridError as exc:
            stopped = f"{type(exc).__name__}: {exc}"
            logger.warning("APN resolution stopped after %d lookups: %s", attempted - 1, stopped)
            resolved_candidates.append(candidate)
            continue
        if parcel is None or parcel.county_fips != county.fips:
            resolved_candidates.append(candidate)
            continue
        resolved += 1
        resolved_candidates.append(
            candidate.model_copy(
                update={"apn": normalize_apn(parcel.apn, county.fips, county.apn_length)}
            )
        )
    logger.info("APN resolution: %d attempted, %d resolved", attempted, resolved)
    return ApnResolution(resolved_candidates, attempted, resolved, stopped)


def _collapse(records: list[Candidate], county: CountyConfig, rule: MatchReason) -> list[Candidate]:
    """One dedup pass: merge every pair that `rule` matches, transitively, keeping input order."""
    merged: list[Candidate] = []
    for record in records:
        current = record
        slot: int | None = None
        survivors: list[Candidate | None] = []
        for existing in merged:
            if match_reason(current, existing, county) == rule:
                current = merge_candidates(existing, current)
                if slot is None:
                    slot = len(survivors)
                    survivors.append(None)  # placeholder for the merged record
            else:
                survivors.append(existing)
        if slot is None:
            merged = [c for c in survivors if c is not None] + [current]
        else:
            survivors[slot] = current
            merged = [c for c in survivors if c is not None]
    return merged


def dedupe(
    candidates: Sequence[Candidate],
    county: CountyConfig,
    apn_resolver: ParcelLookup | None = None,
) -> list[Candidate]:
    """Collapse candidates that are the same parcel into single merged records.

    With `apn_resolver` (the `--resolve-apn` option) listings lacking an APN
    are first resolved through it, which lets rule 1 catch more duplicates.
    """
    records = [c.model_copy(update={"apn": _apn(c, county)}) if c.apn else c for c in candidates]
    if apn_resolver is not None:
        records = resolve_apns(records, apn_resolver, county).candidates

    before = len(records)
    for rule in ("apn", "coordinate", "address"):
        records = _collapse(records, county, rule)
    logger.info("dedupe: %d candidates -> %d unique parcels", before, len(records))
    return records
