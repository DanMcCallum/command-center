"""Realtor.com land listing source (for-sale and pending lots, land, and vacant farm/ranch).

Runs the `scrapemind/realtor-com-scraper` Apify actor once per subject on the
county's for-sale land search, through `ApifyRunner`, and normalizes the items
into `Candidate`s.

The actor takes Realtor.com search URLs (`startUrls`), not structured filters.
Probing it (2026-09-30) showed three things this module is built around:

- A bare-ZIP URL (`/realestateandhomes-search/80449/...`) crashes its URL
  parser; a `County-Name_ST` location segment works and covers the whole
  county, so the search is county-wide and `radius_mi` is enforced here by GPS.
- The `show-recently-sold` URL segment is ignored: it returns the same
  for-sale items. Sold comps therefore come only from the county sales file.
- `csvFriendly` output is flat snake_case fields; the ones read are in `_F`.
  `last_sold_price` / `last_sold_date` on a for-sale item are that parcel's
  prior sale and are kept in `raw` only.
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

SEARCH_URL_BASE = "https://www.realtor.com/realestateandhomes-search"
# Realtor.com URL path segment that limits results to land/lots.
_LAND_SEGMENT = "type-land"

# Normalized property types (lowercase, non-alphanumerics collapsed to `_`).
_LAND_TYPES = {"land", "lot", "lots", "land_lot", "lot_land", "lots_land", "vacant_land"}
_FARM_TYPES = {"farm", "farms", "ranch", "farm_ranch", "farm_and_ranch", "farm_ranch_land"}

_PENDING_STATUSES = {"pending", "contingent", "under_contract"}

# Actor output field names (csvFriendly mode), isolated here so they are easy to change.
_F = {
    "id": "property_id",
    "url": "url",
    "type": "property_type",
    "status": "status",
    "is_pending": "is_pending",
    "list_price": "list_price",
    "list_date": "list_date",
    "lot_sqft": "lot_sqft",
    "lat": "latitude",
    "lon": "longitude",
    "address": "address",
    "city": "city",
    "state": "state_code",
    "zip": "postal_code",
    "description": "description_text",
}

# Presence of any of these marks a farm/ranch as improved, not vacant.
_STRUCTURE_FIELDS = ("beds", "baths", "sqft")


def realtor_location(county_name: str, state: str) -> str:
    """Realtor.com's URL location segment for a county: `Park County` + `CO` -> `Park-County_CO`."""
    return f"{'-'.join(county_name.split())}_{state.strip().upper()}"


def search_url(location: str) -> str:
    """The Realtor.com for-sale land search URL for a location segment (see `realtor_location`)."""
    return "/".join((SEARCH_URL_BASE, location, _LAND_SEGMENT))


class RealtorSource:
    """Realtor.com land listings for sale in the subject's county, within a radius."""

    def __init__(self, runner: ApifyRunner, actor_id: str, location: str | None) -> None:
        self._runner = runner
        self._actor_id = actor_id
        self._location = location

    def build_input(self, subject: Parcel, radius_mi: float) -> dict[str, Any]:
        """Actor input: the county's for-sale land search URL.

        `radius_mi` is not expressible in a Realtor.com search URL; `fetch`
        applies it to the returned GPS instead. `subject` is accepted for
        symmetry with the other sources (the county comes from config).
        """
        if not self._location:
            raise SourceError(
                self._actor_id, "county.name and county.state are not set in config.yaml"
            )
        return {
            "startUrls": [{"url": search_url(self._location)}],
            "maxItems": self._runner.max_items,
            "fullScrape": False,
            "getDetails": False,
            "csvFriendly": True,
        }

    def fetch(self, subject: Parcel, radius_mi: float) -> list[Candidate]:
        """Land candidates within `radius_mi` of `subject`; raises `SourceError` on actor failure.

        Non-land records, items with no usable price, and items whose GPS is
        outside the radius are dropped. The search is county-wide, so an item
        with no GPS is kept only when its ZIP matches the subject's (or the
        subject has no ZIP to compare).
        """
        items = self._runner.run(self._actor_id, self.build_input(subject, radius_mi))
        candidates: list[Candidate] = []
        for item in items:
            if not _is_vacant_land(item):
                continue
            candidate = _to_candidate(item)
            if candidate is None:
                continue
            if candidate.lat is None or candidate.lon is None:
                if subject.zip and to_text(item.get(_F["zip"])) != subject.zip:
                    continue
            elif not within_radius(
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


def _address(item: dict[str, Any]) -> str | None:
    """One-line address from the actor's flat street/city/state/ZIP fields."""
    street = to_text(item.get(_F["address"]))
    if street is None:
        return None
    city = to_text(item.get(_F["city"]))
    state = to_text(item.get(_F["state"]))
    zip_code = to_text(item.get(_F["zip"]))
    region = " ".join(part for part in (state, zip_code) if part)
    return ", ".join(part for part in (street, city, region) if part)


def _status(item: dict[str, Any]) -> Literal["active", "pending"]:
    if item.get(_F["is_pending"]) is True:
        return "pending"
    raw = re.sub(r"[^a-z]+", "_", (to_text(item.get(_F["status"])) or "").lower()).strip("_")
    return "pending" if raw in _PENDING_STATUSES else "active"


def _to_candidate(item: dict[str, Any]) -> Candidate | None:
    price = positive(to_float(item.get(_F["list_price"])))
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
        status=_status(item),
        address=_address(item),
        lat=to_float(item.get(_F["lat"])),
        lon=to_float(item.get(_F["lon"])),
        acreage=acreage,
        price=price,
        list_price=price,
        sold_price=None,
        price_per_acre=price / acreage if acreage else None,
        event_date=to_date(item.get(_F["list_date"])),
        description=to_text(item.get(_F["description"])),
        url=url,
        raw=item,
    )
