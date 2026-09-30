"""Regrid parcel lookups: APN, address, or point -> `Parcel`.

Reads Regrid's v2 parcels API. Every response is cached in `source_cache`
(including empty results, so a known miss is not paid for twice), and a
monthly record counter, also kept in `source_cache`, enforces
`regrid.monthly_record_cap` since Regrid bills per record returned.
"""

import json
import sqlite3
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any, Protocol

import httpx

from land_comps.models import Parcel
from land_comps.normalize import normalize_address

DEFAULT_BASE_URL = "https://app.regrid.com/api/v2"


class RegridError(Exception):
    """A Regrid request failed or returned a response we cannot use."""


class QuotaExceeded(RegridError):
    """The monthly Regrid record cap has been reached; no more live calls are made."""


class ParcelLookup(Protocol):
    """The lookup surface commands depend on; `RegridClient` and test fakes satisfy it."""

    def by_apn(self, apn: str, county_fips: str) -> Parcel | None: ...

    def by_address(self, address: str) -> Parcel | None: ...

    def by_point(self, lat: float, lon: float) -> Parcel | None: ...


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _to_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _to_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def parse_parcel(feature: dict[str, Any], default_county_fips: str | None = None) -> Parcel:
    """Build a `Parcel` from one GeoJSON feature of a Regrid v2 response.

    Regrid nests the attributes under `properties.fields`. Acreage prefers the
    geometry-derived `ll_gisacre` (the PRD says to trust Regrid geometry over
    listing acreage). Raises `RegridError` if the APN, centroid, or county is missing.
    """
    properties = feature.get("properties")
    fields = properties.get("fields") if isinstance(properties, dict) else None
    if not isinstance(fields, dict):
        raise RegridError("Regrid feature has no properties.fields object")

    apn = _to_text(fields.get("parcelnumb"))
    lat = _to_float(fields.get("lat"))
    lon = _to_float(fields.get("lon"))
    if apn is None:
        raise RegridError("Regrid feature is missing parcelnumb")
    if lat is None or lon is None:
        raise RegridError(f"Regrid parcel {apn} is missing its lat/lon centroid")

    county_fips = _to_text(fields.get("geoid")) or default_county_fips
    if county_fips is None:
        raise RegridError(f"Regrid parcel {apn} does not report a county (geoid)")

    acreage = None
    for key in ("ll_gisacre", "gisacre", "deeded_acres"):
        acreage = _to_float(fields.get(key))
        if acreage is not None:
            break

    zip_code = _to_text(fields.get("szip5"))
    if zip_code is None:
        szip = _to_text(fields.get("szip"))
        zip_code = szip[:5] if szip else None

    return Parcel(
        apn=apn,
        address=_to_text(fields.get("address")),
        lat=lat,
        lon=lon,
        acreage=acreage,
        zoning=_to_text(fields.get("zoning")) or _to_text(fields.get("zoning_description")),
        land_use=_to_text(fields.get("usedesc")) or _to_text(fields.get("usecode")),
        county_fips=county_fips,
        zip=zip_code,
    )


class RegridClient:
    """Cached, quota-limited Regrid client backed by the pipeline's SQLite connection."""

    def __init__(
        self,
        token: str,
        conn: sqlite3.Connection,
        monthly_record_cap: int,
        *,
        transport: httpx.BaseTransport | None = None,
        base_url: str = DEFAULT_BASE_URL,
        clock: Callable[[], datetime] = _utc_now,
    ) -> None:
        self._token = token
        self._conn = conn
        self._cap = monthly_record_cap
        self._clock = clock
        self._http = httpx.Client(base_url=base_url, transport=transport, timeout=30.0)

    def close(self) -> None:
        self._http.close()

    def by_apn(self, apn: str, county_fips: str) -> Parcel | None:
        """Look up a parcel by APN, keeping only a match inside `county_fips`."""
        apn = apn.strip().upper()
        key = f"regrid:apn:{county_fips}:{apn}"
        features = self._features(key, "/parcels/apn", {"parcelnumb": apn})
        for feature in features:
            parcel = parse_parcel(feature, default_county_fips=county_fips)
            if parcel.county_fips == county_fips:
                return parcel
        return None

    def by_address(self, address: str) -> Parcel | None:
        """Look up a parcel by street address."""
        key = f"regrid:address:{normalize_address(address)}"
        features = self._features(key, "/parcels/address", {"query": address.strip()})
        return parse_parcel(features[0]) if features else None

    def by_point(self, lat: float, lon: float) -> Parcel | None:
        """Look up the parcel containing a lat/lon point."""
        key = f"regrid:point:{lat:.6f},{lon:.6f}"
        features = self._features(key, "/parcels/point", {"lat": lat, "lon": lon})
        return parse_parcel(features[0]) if features else None

    def records_used(self) -> int:
        """Records billed so far in the current UTC month."""
        row = self._conn.execute(
            "SELECT payload FROM source_cache WHERE key = ?", (self._usage_key(),)
        ).fetchone()
        return int(row["payload"]) if row else 0

    def _usage_key(self) -> str:
        return f"regrid:usage:{self._clock():%Y-%m}"

    def _features(
        self, key: str, path: str, params: dict[str, str | float]
    ) -> list[dict[str, Any]]:
        row = self._conn.execute(
            "SELECT payload FROM source_cache WHERE key = ?", (key,)
        ).fetchone()
        if row is not None:
            return self._extract_features(json.loads(row["payload"]))

        used = self.records_used()
        if used >= self._cap:
            raise QuotaExceeded(
                f"Regrid monthly record cap reached ({used}/{self._cap}); "
                "raise regrid.monthly_record_cap in config.yaml or wait for next month"
            )

        payload = self._fetch(path, {**params, "limit": 1})
        features = self._extract_features(payload)
        self._store(key, payload, len(features))
        return features

    def _fetch(self, path: str, params: dict[str, str | float | int]) -> Any:
        try:
            response = self._http.get(path, params={**params, "token": self._token})
        except httpx.HTTPError as exc:
            raise RegridError(f"Regrid request to {path} failed: {type(exc).__name__}") from exc

        if response.status_code == 404:
            return {"parcels": {"type": "FeatureCollection", "features": []}}
        if response.status_code in (401, 403):
            raise RegridError(
                f"Regrid rejected the token (HTTP {response.status_code}); check REGRID_TOKEN"
            )
        if response.is_error:
            raise RegridError(f"Regrid request to {path} failed with HTTP {response.status_code}")
        try:
            return response.json()
        except ValueError as exc:
            raise RegridError(f"Regrid returned invalid JSON for {path}") from exc

    @staticmethod
    def _extract_features(payload: Any) -> list[dict[str, Any]]:
        parcels = payload.get("parcels") if isinstance(payload, dict) else None
        features = parcels.get("features") if isinstance(parcels, dict) else None
        if not isinstance(features, list):
            raise RegridError("Regrid response has no parcels.features list")
        return [f for f in features if isinstance(f, dict)]

    def _store(self, key: str, payload: Any, records: int) -> None:
        now = self._clock().isoformat()
        with self._conn:
            self._conn.execute(
                "INSERT OR REPLACE INTO source_cache (key, payload, fetched_at) VALUES (?, ?, ?)",
                (key, json.dumps(payload), now),
            )
            self._conn.execute(
                "INSERT INTO source_cache (key, payload, fetched_at) VALUES (?, ?, ?) "
                "ON CONFLICT (key) DO UPDATE SET "
                "payload = CAST(CAST(payload AS INTEGER) + ? AS TEXT), "
                "fetched_at = excluded.fetched_at",
                (self._usage_key(), str(records), now, records),
            )
