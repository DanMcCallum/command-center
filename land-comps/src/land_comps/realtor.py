"""Realtor.com land listing source (sold and for-sale lots, land, and vacant farm/ranch).

Runs the configured Realtor.com Apify actor twice, in sold and for-sale modes,
through `ApifyRunner` and normalizes the items into `Candidate`s. The actor is
not chosen yet, so every field name it emits is listed in `_F`; adjust that
table and `build_input` when the real actor is confirmed.
"""

import re
from typing import Any, Literal

from land_comps.apify_runner import ApifyRunner
from land_comps.listing_fields import (
    fallback_source_id,
    positive,
    to_date,
    to_float,
    to_text,
    within_radius,
)
from land_comps.models import Candidate, Parcel
from land_comps.sources import SourceError

SOURCE_NAME = "realtor"

SQFT_PER_ACRE = 43_560

Mode = Literal["sold", "for_sale"]

# Normalized property types (lowercase, non-alphanumerics collapsed to `_`).
_LAND_TYPES = {"land", "lot", "lots", "land_lot", "lot_land", "lots_land", "vacant_land"}
_FARM_TYPES = {"farm", "ranch", "farm_ranch", "farm_and_ranch", "farm_ranch_land"}

_PENDING_STATUSES = {"pending", "contingent", "under_contract"}

# Placeholder actor output field names, isolated here so they are easy to change.
_F = {
    "id": "property_id",
    "url": "href",
    "type": "propertyType",
    "status": "status",
    "list_price": "listPrice",
    "sold_price": "soldPrice",
    "list_date": "listDate",
    "sold_date": "soldDate",
    "lot_sqft": "lotSqft",
    "lat": "latitude",
    "lon": "longitude",
    "address": "address",
    "description": "description",
}

# Presence of any of these marks a farm/ranch as improved, not vacant.
_STRUCTURE_FIELDS = ("beds", "baths", "buildingSqft")


class RealtorSource:
    """Nearby Realtor.com land listings, sold and for sale."""

    def __init__(self, runner: ApifyRunner, actor_id: str) -> None:
        self._runner = runner
        self._actor_id = actor_id

    def build_input(self, subject: Parcel, radius_mi: float, mode: Mode) -> dict[str, Any]:
        """Actor input for one mode, searching the subject's ZIP for land/lot properties."""
        if not subject.zip:
            raise SourceError(self._actor_id, "subject parcel has no ZIP code to search")
        return {
            "postalCode": subject.zip,
            "mode": mode,
            "propertyType": "land/lot",
            "latitude": subject.lat,
            "longitude": subject.lon,
            "radiusMiles": radius_mi,
        }

    def fetch(self, subject: Parcel, radius_mi: float) -> list[Candidate]:
        """Land candidates within `radius_mi` of `subject`; raises `SourceError` on actor failure.

        Non-land records, items with no usable price, and items whose GPS is
        outside the radius are dropped; items with no GPS are kept.
        """
        candidates: list[Candidate] = []
        for mode in ("sold", "for_sale"):
            items = self._runner.run(self._actor_id, self.build_input(subject, radius_mi, mode))
            for item in items:
                if not _is_vacant_land(item):
                    continue
                candidate = _to_candidate(item, mode)
                if candidate is None:
                    continue
                if not within_radius(
                    subject.lat, subject.lon, candidate.lat, candidate.lon, radius_mi
                ):
                    continue
                candidates.append(candidate)
        return candidates


def _property_type(item: dict[str, Any]) -> str:
    text = to_text(item.get(_F["type"])) or ""
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")


def _is_vacant_land(item: dict[str, Any]) -> bool:
    kind = _property_type(item)
    if kind in _LAND_TYPES:
        return True
    if kind in _FARM_TYPES:
        return not any(to_float(item.get(key)) for key in _STRUCTURE_FIELDS)
    return False


def _to_candidate(item: dict[str, Any], mode: Mode) -> Candidate | None:
    listed = positive(to_float(item.get(_F["list_price"])))
    if mode == "sold":
        status: Literal["sold", "active", "pending"] = "sold"
        sold = positive(to_float(item.get(_F["sold_price"])))
        price = sold
    else:
        raw_status = re.sub(r"[^a-z]+", "_", (to_text(item.get(_F["status"])) or "").lower())
        status = "pending" if raw_status.strip("_") in _PENDING_STATUSES else "active"
        sold = None
        price = listed
    if price is None:
        return None

    lot_sqft = positive(to_float(item.get(_F["lot_sqft"])))
    acreage = lot_sqft / SQFT_PER_ACRE if lot_sqft else None
    url = to_text(item.get(_F["url"]))
    source_id = to_text(item.get(_F["id"])) or url

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
        price_per_acre=price / acreage if acreage else None,
        event_date=(
            to_date(item.get(_F["sold_date"]))
            if status == "sold"
            else to_date(item.get(_F["list_date"]))
        ),
        description=to_text(item.get(_F["description"])),
        url=url,
        raw=item,
    )
