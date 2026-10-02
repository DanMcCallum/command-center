"""Local parcel spine for one county, built from its ArcGIS parcel layer.

`ingest_parcels` pulls every parcel polygon (and, when configured, the zoning
polygons) from the county's ArcGIS REST layers, merges parcels that the layer
splits into several features, computes a centroid per parcel, assigns a zone
code by point-in-polygon, and loads the result into `county_parcels`. It also
writes `parcels.csv` and `centroids.csv` in the layout `ingest county` reads,
so the sales ingest picks up acreage, land use, and coordinates without Regrid.

`CountyParcelLookup` then serves the `ParcelLookup` protocol (APN, address,
and point lookups) from that table, so `comps find`, `comps subject`, and
`ingest geocode-county` run with no Regrid token and no per-record cost.

The `_F` and `_Z` tables at the top map the layer's field names; they match
Park County's `ParcelsPublic` and `Zoning` layers and are the only thing to
change for a county whose layers use other names.
"""

import csv
import json
import sqlite3
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from land_comps.arcgis import Feature, fetch_features
from land_comps.config import CountyConfig
from land_comps.models import Parcel
from land_comps.normalize import normalize_address, normalize_apn
from land_comps.regrid import ParcelLookupError

# Parcel layer fields (Park County `ParcelsPublic/MapServer/0`).
_F = {
    "apn": "ScheduleNu",
    "account": "ACCOUNT_NO",
    "address": "LOCAL_ADDR",
    "street_no": "STREETNO",
    "pre_dir": "PREDIRECTION",
    "street": "STREETNAME",
    "city": "P_CITY",
    "zip": "P_ZIPCODE",
    "land_type": "LAND_TY",
    "acreage": "ACRES",
    "land_value": "LAND_V",
    "improvement_value": "IMPROVE_V",
    "building_count": "BLDGCOUNT",
    "subdivision": "SUBNAME",
    "ownership": "OwnershipT",
}
# Zoning layer fields (Park County `Zoning/MapServer/0`).
_Z = {"code": "Zone_Code"}

# Street-name spellings the county layer uses, applied after `normalize_address`
# so a typed "County Road 18" finds the layer's "CO RD 18".
_STREET_ALIASES = {
    "COUNTY ROAD": "CO RD",
    "COUNTY RD": "CO RD",
    "HIGHWAY": "HWY",
    "CIRCLE": "CIR",
    "PLACE": "PL",
    "TRAIL": "TRL",
    "BOULEVARD": "BLVD",
    "TERRACE": "TER",
    "PARKWAY": "PKWY",
}

Ring = list[list[float]]

_INSERT_PARCEL = """
INSERT OR REPLACE INTO county_parcels (
    apn, county_fips, account, address, address_norm, street_norm, city, zip, land_type,
    acreage, land_value, improvement_value, building_count, subdivision, ownership, zoning,
    lat, lon, min_lat, min_lon, max_lat, max_lon, rings
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
"""

_PARCEL_COLUMNS = (
    "apn, county_fips, account, address, city, zip, land_type, acreage, zoning, lat, lon"
)


class CountyParcelsEmpty(ParcelLookupError):
    """`county_parcels` has no rows for the configured county; run `comps ingest parcels`."""


@dataclass(frozen=True)
class ParcelIngestResult:
    features: int
    parcels: int
    skipped_no_apn: int
    skipped_no_geometry: int
    with_address: int
    with_zoning: int
    zones: int
    parcels_csv: Path
    centroids_csv: Path


# --- geometry -----------------------------------------------------------------


def ring_bbox(rings: Iterable[Ring]) -> tuple[float, float, float, float]:
    """(min_lat, min_lon, max_lat, max_lon) over every vertex of `rings`."""
    lons = [pt[0] for ring in rings for pt in ring]
    lats = [pt[1] for ring in rings for pt in ring]
    return min(lats), min(lons), max(lats), max(lons)


def polygon_centroid(rings: list[Ring]) -> tuple[float, float]:
    """Area-weighted centroid (lat, lon) of a polygon given as ArcGIS rings.

    ArcGIS winds outer rings clockwise and holes counter-clockwise, so summing
    the signed shoelace terms over every ring nets holes out. Degenerate
    polygons (zero area) fall back to the bounding-box center.
    """
    # Work relative to the first vertex: a town lot spans ~1e-4 degrees at longitude
    # -106, and the raw shoelace cross terms cancel to nothing at double precision.
    x0, y0 = rings[0][0]
    area = cx = cy = 0.0
    for ring in rings:
        shifted = [(x - x0, y - y0) for x, y in ring]
        for (x1, y1), (x2, y2) in zip(shifted, shifted[1:] + shifted[:1], strict=True):
            cross = x1 * y2 - x2 * y1
            area += cross
            cx += (x1 + x2) * cross
            cy += (y1 + y2) * cross
    if abs(area) < 1e-18:
        min_lat, min_lon, max_lat, max_lon = ring_bbox(rings)
        return (min_lat + max_lat) / 2, (min_lon + max_lon) / 2
    return y0 + cy / (3 * area), x0 + cx / (3 * area)


def point_in_rings(lat: float, lon: float, rings: Iterable[Ring]) -> bool:
    """Even-odd ray cast over every ring, so holes and multi-part parcels both work."""
    inside = False
    for ring in rings:
        for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1], strict=True):
            if (y1 > lat) != (y2 > lat):
                x_at = x1 + (lat - y1) * (x2 - x1) / (y2 - y1)
                if lon < x_at:
                    inside = not inside
    return inside


def _rings(feature: Feature) -> list[Ring]:
    geometry = feature.get("geometry")
    rings = geometry.get("rings") if isinstance(geometry, dict) else None
    if not isinstance(rings, list):
        return []
    return [ring for ring in rings if isinstance(ring, list) and len(ring) >= 3]


# --- attribute parsing --------------------------------------------------------


def _text(value: Any) -> str | None:
    text = str(value).strip() if value is not None else ""
    return text or None


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _zip(value: Any) -> str | None:
    number = _number(value)
    if number is None or not 1000 <= number <= 99999:
        return None
    return f"{int(number):05d}"


def street_key(text: str) -> str:
    """`normalize_address` plus the county layer's street spellings."""
    normalized = f" {normalize_address(text)} "
    for long_form, short_form in _STREET_ALIASES.items():
        normalized = normalized.replace(f" {long_form} ", f" {short_form} ")
    return normalized.strip()


@dataclass
class _ParcelRow:
    apn: str
    account: str | None
    address: str | None
    street: str | None
    city: str | None
    zip: str | None
    land_type: str | None
    acreage: float | None
    land_value: float | None
    improvement_value: float | None
    building_count: int | None
    subdivision: str | None
    ownership: str | None
    rings: list[Ring]
    zoning: str | None = None

    def merge(self, other: "_ParcelRow") -> None:
        """Absorb another feature of the same parcel: union the rings, fill blank attributes."""
        self.rings.extend(other.rings)
        for name in (
            "account", "address", "street", "city", "zip", "land_type", "acreage",
            "land_value", "improvement_value", "building_count", "subdivision", "ownership",
        ):  # fmt: skip
            if getattr(self, name) is None and getattr(other, name) is not None:
                setattr(self, name, getattr(other, name))


def _parse_feature(feature: Feature, county: CountyConfig) -> _ParcelRow | None:
    attrs = feature.get("attributes")
    if not isinstance(attrs, dict):
        return None
    raw_apn = _text(attrs.get(_F["apn"]))
    if raw_apn is None:
        return None

    street_no = _number(attrs.get(_F["street_no"]))
    street_name = _text(attrs.get(_F["street"]))
    street: str | None = None
    address: str | None = None
    if street_no is not None and street_name is not None:
        pre_dir = _text(attrs.get(_F["pre_dir"]))
        street = " ".join(p for p in (f"{street_no:g}", pre_dir, street_name) if p)
        address = _text(attrs.get(_F["address"])) or street

    building_count = _number(attrs.get(_F["building_count"]))
    return _ParcelRow(
        apn=normalize_apn(raw_apn, county.fips, county.apn_length),
        account=_text(attrs.get(_F["account"])),
        address=address,
        street=street,
        city=_text(attrs.get(_F["city"])),
        zip=_zip(attrs.get(_F["zip"])),
        land_type=_text(attrs.get(_F["land_type"])),
        acreage=_number(attrs.get(_F["acreage"])),
        land_value=_number(attrs.get(_F["land_value"])),
        improvement_value=_number(attrs.get(_F["improvement_value"])),
        building_count=int(building_count) if building_count is not None else None,
        subdivision=_text(attrs.get(_F["subdivision"])),
        ownership=_text(attrs.get(_F["ownership"])),
        rings=_rings(feature),
    )


# --- ingest -------------------------------------------------------------------


Zone = tuple[str, list[Ring], tuple[float, float, float, float]]


def _zone_for(lat: float, lon: float, zones: list[Zone]) -> str | None:
    for code, rings, (min_lat, min_lon, max_lat, max_lon) in zones:
        if not (min_lat <= lat <= max_lat and min_lon <= lon <= max_lon):
            continue
        if point_in_rings(lat, lon, rings):
            return code
    return None


def _load_zones(zoning_url: str, transport: httpx.BaseTransport | None) -> list[Zone]:
    zones: list[Zone] = []
    for feature in fetch_features(zoning_url, [_Z["code"]], transport=transport):
        attrs = feature.get("attributes")
        code = _text(attrs.get(_Z["code"])) if isinstance(attrs, dict) else None
        rings = _rings(feature)
        if code and rings:
            zones.append((code, rings, ring_bbox(rings)))
    return zones


def ingest_parcels(
    conn: sqlite3.Connection,
    county: CountyConfig,
    parcels_url: str,
    out_dir: Path,
    *,
    zoning_url: str | None = None,
    transport: httpx.BaseTransport | None = None,
) -> ParcelIngestResult:
    """Replace the county's rows in `county_parcels` from its ArcGIS layers and write the CSVs.

    Features sharing a schedule number (multi-part parcels, condominium plats)
    collapse to one parcel whose rings are the union and whose attributes come
    from the first feature that has them. Features without a schedule number
    or without geometry are skipped and counted.
    """
    features = fetch_features(parcels_url, list(_F.values()), transport=transport)
    zones = _load_zones(zoning_url, transport) if zoning_url else []

    parcels: dict[str, _ParcelRow] = {}
    skipped_no_apn = 0
    for feature in features:
        row = _parse_feature(feature, county)
        if row is None:
            skipped_no_apn += 1
        elif row.apn in parcels:
            parcels[row.apn].merge(row)
        else:
            parcels[row.apn] = row

    params: list[tuple[object, ...]] = []
    csv_rows: list[dict[str, object]] = []
    skipped_no_geometry = with_address = with_zoning = 0
    mapping = county.column_mapping
    col = {
        "apn": mapping.get("apn", "SCHEDULE_NUMBER"),
        "land_use_code": mapping.get("land_use_code", "LAND_USE_CODE"),
        "acreage": mapping.get("acreage", "ACRES"),
        "lat": mapping.get("lat", "LAT"),
        "lon": mapping.get("lon", "LON"),
    }
    for row in parcels.values():
        if not row.rings:
            skipped_no_geometry += 1
            continue
        lat, lon = polygon_centroid(row.rings)
        min_lat, min_lon, max_lat, max_lon = ring_bbox(row.rings)
        row.zoning = _zone_for(lat, lon, zones) if zones else None
        with_address += row.address is not None
        with_zoning += row.zoning is not None
        params.append(
            (
                row.apn,
                county.fips,
                row.account,
                row.address,
                street_key(row.address) if row.address else None,
                street_key(row.street) if row.street else None,
                row.city,
                row.zip,
                row.land_type,
                row.acreage,
                row.land_value,
                row.improvement_value,
                row.building_count,
                row.subdivision,
                row.ownership,
                row.zoning,
                lat,
                lon,
                min_lat,
                min_lon,
                max_lat,
                max_lon,
                json.dumps(row.rings),
            )  # fmt: skip
        )
        csv_rows.append(
            {
                col["apn"]: row.apn,
                "ACCOUNT_NO": row.account or "",
                "ADDRESS": row.address or "",
                "CITY": row.city or "",
                "ZIP": row.zip or "",
                col["land_use_code"]: row.land_type or "",
                col["acreage"]: "" if row.acreage is None else f"{row.acreage:g}",
                "LAND_VALUE": "" if row.land_value is None else f"{row.land_value:g}",
                "IMPROVEMENT_VALUE": (
                    "" if row.improvement_value is None else f"{row.improvement_value:g}"
                ),
                "BUILDING_COUNT": "" if row.building_count is None else row.building_count,
                "SUBDIVISION": row.subdivision or "",
                "OWNERSHIP": row.ownership or "",
                "ZONING": row.zoning or "",
                col["lat"]: f"{lat:.6f}",
                col["lon"]: f"{lon:.6f}",
            }
        )

    with conn:
        conn.execute("DELETE FROM county_parcels WHERE county_fips = ?", (county.fips,))
        conn.executemany(_INSERT_PARCEL, params)

    out_dir.mkdir(parents=True, exist_ok=True)
    parcels_csv = out_dir / "parcels.csv"
    centroids_csv = out_dir / "centroids.csv"
    _write_csv(parcels_csv, csv_rows)
    _write_csv(
        centroids_csv,
        [{k: r[k] for k in (col["apn"], col["lat"], col["lon"])} for r in csv_rows],
    )
    return ParcelIngestResult(
        features=len(features),
        parcels=len(params),
        skipped_no_apn=skipped_no_apn,
        skipped_no_geometry=skipped_no_geometry,
        with_address=with_address,
        with_zoning=with_zoning,
        zones=len(zones),
        parcels_csv=parcels_csv,
        centroids_csv=centroids_csv,
    )


def _write_csv(path: Path, rows: list[dict[str, object]]) -> None:
    fieldnames = list(rows[0].keys()) if rows else ["SCHEDULE_NUMBER"]
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


# --- lookup -------------------------------------------------------------------


class CountyParcelLookup:
    """`ParcelLookup` over `county_parcels`: free, offline, and limited to one county."""

    def __init__(self, conn: sqlite3.Connection, county: CountyConfig) -> None:
        self._conn = conn
        self._county = county
        self._checked = False

    def _ensure_loaded(self) -> None:
        if self._checked:
            return
        row = self._conn.execute(
            "SELECT COUNT(*) FROM county_parcels WHERE county_fips = ?", (self._county.fips,)
        ).fetchone()
        if not row or row[0] == 0:
            raise CountyParcelsEmpty(
                f"county_parcels has no rows for FIPS {self._county.fips}; "
                "run `comps ingest parcels` first (or set parcels.lookup to regrid)"
            )
        self._checked = True

    def by_apn(self, apn: str, county_fips: str) -> Parcel | None:
        """Match a schedule number (normalized) or the assessor account number."""
        if county_fips != self._county.fips:
            return None
        self._ensure_loaded()
        normalized = normalize_apn(apn, county_fips, self._county.apn_length)
        # `resolve_subject` has already zero-padded an account number ("R0031409" arrives
        # as "00R0031409"), so compare accounts with the padding stripped.
        account = normalized.lstrip("0")
        row = self._conn.execute(
            f"SELECT {_PARCEL_COLUMNS} FROM county_parcels "
            "WHERE county_fips = ? AND (apn = ? OR account = ?) ORDER BY apn = ? DESC LIMIT 1",
            (county_fips, normalized, account, normalized),
        ).fetchone()
        return _to_parcel(row) if row else None

    def by_address(self, address: str) -> Parcel | None:
        """Match the full situs address, else its house number and street.

        A street-only match that fits several parcels (the same road runs
        through more than one town) prefers the parcel whose city appears in
        the query, then the first by schedule number.
        """
        self._ensure_loaded()
        key = street_key(address)
        rows = self._conn.execute(
            f"SELECT {_PARCEL_COLUMNS} FROM county_parcels WHERE county_fips = ? AND "
            "(address_norm = ? OR (street_norm IS NOT NULL AND "
            "(street_norm = ? OR ? LIKE street_norm || ' %'))) ORDER BY apn",
            (self._county.fips, key, key, key),
        ).fetchall()
        if not rows:
            return None
        padded = f" {key} "

        def rank(row: sqlite3.Row) -> tuple[bool, bool]:
            exact = bool(row["address"]) and street_key(row["address"]) == key
            city = f" {row['city'].upper()} " if row["city"] else None
            return exact, bool(city and city in padded)

        return _to_parcel(max(rows, key=rank))

    def by_point(self, lat: float, lon: float) -> Parcel | None:
        """The parcel whose polygon contains the point (bounding boxes narrow the scan)."""
        self._ensure_loaded()
        rows = self._conn.execute(
            f"SELECT {_PARCEL_COLUMNS}, rings FROM county_parcels WHERE county_fips = ? "
            "AND min_lat <= ? AND max_lat >= ? AND min_lon <= ? AND max_lon >= ?",
            (self._county.fips, lat, lat, lon, lon),
        ).fetchall()
        for row in rows:
            if point_in_rings(lat, lon, json.loads(row["rings"])):
                return _to_parcel(row)
        return None


def _to_parcel(row: sqlite3.Row) -> Parcel:
    return Parcel(
        apn=row["apn"],
        address=row["address"],
        lat=row["lat"],
        lon=row["lon"],
        acreage=row["acreage"],
        zoning=row["zoning"],
        land_use=row["land_type"],
        county_fips=row["county_fips"],
        zip=row["zip"],
    )
