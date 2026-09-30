"""LandWatch/Land.com listing source (sold, under contract, and available land).

Runs the configured LandWatch Apify actor through `ApifyRunner` and normalizes
its items into `Candidate`s. The actor is not chosen yet, so every field name
the actor emits is listed in `_F` and read in `_to_candidate`; adjust those two
places (and the input built in `build_input`) when the real actor is confirmed.
"""

from typing import Any, Literal

from land_comps.apify_runner import ApifyRunner
from land_comps.listing_fields import (
    fallback_source_id,
    positive,
    to_date,
    to_float,
    to_text,
    to_text_list,
    within_radius,
)
from land_comps.models import Candidate, Parcel

SOURCE_NAME = "landwatch"

Status = Literal["sold", "active", "pending"]

_STATUS_MAP: dict[str, Status] = {
    "available": "active",
    "active": "active",
    "for sale": "active",
    "under contract": "pending",
    "pending": "pending",
    "sold": "sold",
}

# Placeholder actor output field names, isolated here so they are easy to change.
_F = {
    "id": "id",
    "url": "url",
    "status": "status",
    "price": "price",
    "sold_price": "soldPrice",
    "acres": "acres",
    "price_per_acre": "pricePerAcre",
    "lat": "latitude",
    "lon": "longitude",
    "address": "address",
    "frontage": "roadFrontage",
    "access": "access",
    "utilities": "utilities",
    "topography": "topography",
    "description": "description",
    "list_date": "listDate",
    "sold_date": "soldDate",
}


class LandWatchSource:
    """Nearby LandWatch land listings, sold and on the market."""

    def __init__(self, runner: ApifyRunner, actor_id: str) -> None:
        self._runner = runner
        self._actor_id = actor_id

    def build_input(self, subject: Parcel, radius_mi: float) -> dict[str, Any]:
        """Actor input covering the subject's county and ZIP, sold plus available."""
        run_input: dict[str, Any] = {
            "countyFips": subject.county_fips,
            "statuses": ["available", "under contract", "sold"],
            "propertyTypes": ["land"],
            "latitude": subject.lat,
            "longitude": subject.lon,
            "radiusMiles": radius_mi,
        }
        if subject.zip:
            run_input["zip"] = subject.zip
        return run_input

    def fetch(self, subject: Parcel, radius_mi: float) -> list[Candidate]:
        """Candidates within `radius_mi` of `subject`; raises `SourceError` if the actor fails.

        Items with no usable price, an unrecognized status, or GPS outside the
        radius are dropped; items with no GPS are kept (the actor searched by
        county/ZIP, so they are at least local).
        """
        items = self._runner.run(self._actor_id, self.build_input(subject, radius_mi))
        candidates: list[Candidate] = []
        for item in items:
            candidate = _to_candidate(item)
            if candidate is None:
                continue
            if not within_radius(subject.lat, subject.lon, candidate.lat, candidate.lon, radius_mi):
                continue
            candidates.append(candidate)
        return candidates


def _to_candidate(item: dict[str, Any]) -> Candidate | None:
    raw_status = to_text(item.get(_F["status"]))
    status = _STATUS_MAP.get(raw_status.lower()) if raw_status else None
    if status is None:
        return None

    listed = positive(to_float(item.get(_F["price"])))
    sold = positive(to_float(item.get(_F["sold_price"])))
    if status == "sold":
        sold = sold or listed  # some actors put the sale price in the plain price field
        price = sold
    else:
        sold = None
        price = listed
    if price is None:
        return None

    acreage = positive(to_float(item.get(_F["acres"])))
    per_acre = price / acreage if acreage else positive(to_float(item.get(_F["price_per_acre"])))
    list_date = to_date(item.get(_F["list_date"]))
    sold_date = to_date(item.get(_F["sold_date"]))
    source_id = to_text(item.get(_F["id"])) or to_text(item.get(_F["url"]))

    return Candidate(
        source=SOURCE_NAME,
        sources=[SOURCE_NAME],
        source_id=source_id or fallback_source_id(item),
        status=status,
        address=to_text(item.get(_F["address"])),
        lat=to_float(item.get(_F["lat"])),
        lon=to_float(item.get(_F["lon"])),
        acreage=acreage,
        price=price,
        list_price=listed,
        sold_price=sold,
        price_per_acre=per_acre,
        event_date=sold_date if status == "sold" else list_date,
        road_access=_road_access(item),
        utilities=to_text_list(item.get(_F["utilities"])),
        topography=to_text(item.get(_F["topography"])),
        description=to_text(item.get(_F["description"])),
        url=to_text(item.get(_F["url"])),
        raw=item,
    )


def _road_access(item: dict[str, Any]) -> str | None:
    frontage = to_text(item.get(_F["frontage"]))
    access = to_text(item.get(_F["access"]))
    parts = [f"Road frontage: {frontage}" if frontage else None, access]
    return "; ".join(p for p in parts if p) or None
