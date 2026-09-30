"""LandWatch/Land.com listing source (sold and available undeveloped land).

Runs the `sian.agency/landwatch-property-scraper` Apify actor through
`ApifyRunner`, once for sold and once for available listings in the subject's
county, and normalizes its rows into `Candidate`s.

The actor's input is its documented `search` operation: `locations` such as
`"Park County, CO"`, `propertyType` `undeveloped-land`, and `availability`
(`sold` is LandWatch's comparables archive). Its documented output fields are
mapped in `_F`; the ones not shown in its README (`address`, dates, land
attributes) keep guessed names and are simply absent until confirmed against
real rows. When the actor cannot read LandWatch it still finishes with
`SUCCEEDED` and emits a single `status: "error"` row; `fetch` turns that into a
`SourceError` so the outage shows up in `source_errors` instead of as an empty
candidate pool. As of 2026-09-30 every probe returned that error row.
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
from land_comps.sources import SourceError

SOURCE_NAME = "landwatch"

Status = Literal["sold", "active", "pending"]
Availability = Literal["sold", "available"]

PROPERTY_TYPE = "undeveloped-land"
AVAILABILITIES: tuple[Availability, ...] = ("available", "sold")

_STATUS_MAP: dict[str, Status] = {
    "available": "active",
    "active": "active",
    "for sale": "active",
    "under contract": "pending",
    "pending": "pending",
    "sold": "sold",
}

# Actor output field names, isolated here so they are easy to change.
_F = {
    "id": "id",
    "url": "url",
    "row_status": "status",  # the actor's own row status: "error" marks a failed fetch
    "error": "errorMessage",
    "status": "listingStatus",
    "price": "price",
    "sold_price": "soldPrice",
    "acres": "acres",
    "price_per_acre": "pricePerAcre",
    "lat": "latitude",
    "lon": "longitude",
    "address": "address",
    "city": "city",
    "state": "state",
    "frontage": "roadFrontage",
    "access": "access",
    "utilities": "utilities",
    "topography": "topography",
    "description": "description",
    "list_date": "listDate",
    "sold_date": "soldDate",
}


def landwatch_location(county_name: str, state: str) -> str:
    """The actor's `locations` entry for a county: `Park County` + `CO` -> `Park County, CO`."""
    return f"{' '.join(county_name.split())}, {state.strip().upper()}"


class LandWatchSource:
    """LandWatch land listings, sold and on the market, in the subject's county."""

    def __init__(self, runner: ApifyRunner, actor_id: str, location: str | None) -> None:
        self._runner = runner
        self._actor_id = actor_id
        self._location = location

    def build_input(
        self, subject: Parcel, radius_mi: float, availability: Availability
    ) -> dict[str, Any]:
        """Actor input for one availability, searching the county for undeveloped land.

        `radius_mi` is not an actor filter; `fetch` applies it to the returned GPS.
        """
        if not self._location:
            raise SourceError(
                self._actor_id, "county.name and county.state are not set in config.yaml"
            )
        return {
            "operation": "search",
            "locations": [self._location],
            "propertyType": PROPERTY_TYPE,
            "availability": availability,
            "maxResults": self._runner.max_items,
            "includeDetails": False,
        }

    def fetch(self, subject: Parcel, radius_mi: float) -> list[Candidate]:
        """Candidates within `radius_mi` of `subject`; raises `SourceError` if the actor fails.

        Items with no usable price, an unrecognized status, or GPS outside the
        radius are dropped; items with no GPS are kept (the actor searched by
        county, so they are at least local).
        """
        candidates: list[Candidate] = []
        for availability in AVAILABILITIES:
            run_input = self.build_input(subject, radius_mi, availability)
            for item in self._runner.run(self._actor_id, run_input):
                if to_text(item.get(_F["row_status"])) == "error":
                    reason = to_text(item.get(_F["error"])) or "actor reported an error row"
                    raise SourceError(self._actor_id, reason)
                candidate = _to_candidate(item)
                if candidate is None:
                    continue
                if not within_radius(
                    subject.lat, subject.lon, candidate.lat, candidate.lon, radius_mi
                ):
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
        sold = sold or listed  # the sold archive puts the sale price in the plain price field
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
        address=_address(item),
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


def _address(item: dict[str, Any]) -> str | None:
    """The row's address, or its city and state when only those are present."""
    address = to_text(item.get(_F["address"]))
    if address:
        return address
    city = to_text(item.get(_F["city"]))
    state = to_text(item.get(_F["state"]))
    return ", ".join(part for part in (city, state) if part) or None


def _road_access(item: dict[str, Any]) -> str | None:
    frontage = to_text(item.get(_F["frontage"]))
    access = to_text(item.get(_F["access"]))
    parts = [f"Road frontage: {frontage}" if frontage else None, access]
    return "; ".join(p for p in parts if p) or None
