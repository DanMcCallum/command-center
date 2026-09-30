"""Park County sales ingest and coordinate backfill.

`ingest_county` loads the county's sales, parcel, and (optional) centroid CSVs
into `county_sales`, mapping source column names through
`county.column_mapping`. `geocode_county` then fills coordinates for recent
vacant sales that still lack them, via the cached Regrid client.

Each canonical field is read from whichever file carries its mapped column:
the sales file wins, then the parcels file; lat/lon prefer the centroids file.
That keeps the loader working whether the county ships land-use codes and
acreage on the sales extract or only on the parcel extract.
"""

import csv
import math
import sqlite3
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path

from land_comps.config import CountyConfig, Settings
from land_comps.normalize import normalize_apn
from land_comps.regrid import ParcelLookup, QuotaExceeded

_DATE_FORMATS = ("%Y-%m-%d", "%m/%d/%Y", "%Y/%m/%d", "%m-%d-%Y")

_UPSERT_SALE = """
INSERT INTO county_sales
    (apn, sale_date, sale_price, deed_type, land_use_code, is_vacant, acreage, lat, lon)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (apn, sale_date, sale_price) DO UPDATE SET
    deed_type = excluded.deed_type,
    land_use_code = excluded.land_use_code,
    is_vacant = excluded.is_vacant,
    acreage = COALESCE(excluded.acreage, acreage),
    lat = COALESCE(excluded.lat, lat),
    lon = COALESCE(excluded.lon, lon)
"""

# Vacant sales inside the lookback window that still lack coordinates.
_MISSING_COORDS_WHERE = "is_vacant = 1 AND (lat IS NULL OR lon IS NULL) AND sale_date >= ?"


class IngestError(Exception):
    """An input file is missing or does not match `county.column_mapping`."""


@dataclass(frozen=True)
class IngestResult:
    rows_read: int
    rows_loaded: int
    rows_skipped: int
    rows_without_parcel: int
    total: int
    vacant: int
    vacant_missing_coords: int


@dataclass(frozen=True)
class GeocodeResult:
    attempted: int
    filled: int
    no_match: int
    remaining: int
    quota_exceeded: bool


Row = dict[str, str]


def _read_csv(path: Path, label: str, required: dict[str, str]) -> list[Row]:
    """Read `path`, requiring each mapped column in `required` (canonical -> header)."""
    if not path.is_file():
        raise IngestError(f"{label} file not found: {path}")
    with path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        headers = [h.strip() for h in reader.fieldnames or []]
        missing = [f"{field} -> {col!r}" for field, col in required.items() if col not in headers]
        if missing:
            raise IngestError(
                f"{label} file {path} is missing mapped columns ({', '.join(missing)}); "
                f"found columns: {', '.join(headers) or '(none)'}. "
                "Check county.column_mapping in config.yaml"
            )
        return [
            {k.strip(): (v or "").strip() for k, v in raw.items() if k is not None}
            for raw in reader
        ]


def _column(county: CountyConfig, field: str) -> str:
    try:
        return county.column_mapping[field]
    except KeyError:
        raise IngestError(f"county.column_mapping has no entry for {field!r}") from None


def _parse_date(text: str) -> str | None:
    if not text:
        return None
    # Drop any time-of-day suffix ("2024-03-05T00:00:00", "3/5/2024 12:00:00 AM").
    token = text.split("T")[0].split()[0]
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(token, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def _parse_price(text: str) -> float | None:
    cleaned = text.replace("$", "").replace(",", "").strip()
    try:
        price = float(cleaned)
    except ValueError:
        return None
    return price if math.isfinite(price) and price >= 0 else None


def _parse_acreage(text: str) -> float | None:
    try:
        acres = float(text.replace(",", ""))
    except ValueError:
        return None
    return acres if math.isfinite(acres) and acres > 0 else None


def _parse_coords(lat_text: str, lon_text: str) -> tuple[float, float] | None:
    try:
        lat, lon = float(lat_text), float(lon_text)
    except ValueError:
        return None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180) or (lat == 0 and lon == 0):
        return None  # (0, 0) is the usual "no centroid" placeholder in county extracts
    return lat, lon


def _index_by_apn(rows: list[Row], apn_col: str, county: CountyConfig) -> dict[str, Row]:
    """Index rows by normalized APN; the last row wins when an APN repeats."""
    indexed: dict[str, Row] = {}
    for row in rows:
        raw = row.get(apn_col, "")
        if raw:
            indexed[normalize_apn(raw, county.fips, county.apn_length)] = row
    return indexed


def ingest_county(
    conn: sqlite3.Connection,
    county: CountyConfig,
    sales_path: Path,
    parcels_path: Path,
    centroids_path: Path | None = None,
) -> IngestResult:
    """Load the county files into `county_sales`, upserting on (apn, sale_date, sale_price).

    Rows missing an APN, a parseable sale date, or a sale price cannot be keyed
    (SQLite treats NULLs in a UNIQUE key as distinct, so they would duplicate on
    every re-run) and are skipped and counted rather than stored.
    """
    apn_col = _column(county, "apn")
    date_col = _column(county, "sale_date")
    price_col = _column(county, "sale_price")
    mapping = county.column_mapping

    sales = _read_csv(
        sales_path, "Sales", {"apn": apn_col, "sale_date": date_col, "sale_price": price_col}
    )
    parcels = _read_csv(parcels_path, "Parcels", {"apn": apn_col})
    parcels_by_apn = _index_by_apn(parcels, apn_col, county)

    centroids_by_apn: dict[str, Row] = {}
    lat_col = mapping.get("lat")
    lon_col = mapping.get("lon")
    if centroids_path is not None:
        if lat_col is None or lon_col is None:
            raise IngestError(
                "county.column_mapping needs 'lat' and 'lon' to read a centroids file"
            )
        centroids = _read_csv(
            centroids_path, "Centroids", {"apn": apn_col, "lat": lat_col, "lon": lon_col}
        )
        centroids_by_apn = _index_by_apn(centroids, apn_col, county)

    land_use_col = mapping.get("land_use_code")
    if not any(land_use_col in rows[0] for rows in (sales, parcels) if rows and land_use_col):
        raise IngestError(
            f"land_use_code column {land_use_col!r} is not in the sales or parcels file, so no "
            "row could be classified as vacant. Check county.column_mapping in config.yaml"
        )
    vacant_codes = {code.strip() for code in county.vacant_land_codes if code.strip()}

    def pick(field: str, *sources: Row | None) -> str:
        column = mapping.get(field)
        if column is None:
            return ""
        for source in sources:
            if source is not None and source.get(column):
                return source[column]
        return ""

    params: list[tuple[object, ...]] = []
    skipped = 0
    without_parcel = 0
    for sale in sales:
        raw_apn = sale.get(apn_col, "")
        sale_date = _parse_date(sale.get(date_col, ""))
        sale_price = _parse_price(sale.get(price_col, ""))
        if not raw_apn or sale_date is None or sale_price is None:
            skipped += 1
            continue

        apn = normalize_apn(raw_apn, county.fips, county.apn_length)
        parcel = parcels_by_apn.get(apn)
        centroid = centroids_by_apn.get(apn)
        if parcel is None:
            without_parcel += 1

        land_use_code = pick("land_use_code", sale, parcel)
        coords = _parse_coords(
            pick("lat", centroid, sale, parcel), pick("lon", centroid, sale, parcel)
        )
        params.append(
            (
                apn,
                sale_date,
                sale_price,
                pick("deed_type", sale, parcel) or None,
                land_use_code or None,
                int(land_use_code in vacant_codes),
                _parse_acreage(pick("acreage", sale, parcel)),
                coords[0] if coords else None,
                coords[1] if coords else None,
            )
        )

    with conn:
        conn.executemany(_UPSERT_SALE, params)

    total, vacant, vacant_missing = conn.execute(
        "SELECT COUNT(*), COALESCE(SUM(is_vacant), 0), "
        "COALESCE(SUM(is_vacant = 1 AND (lat IS NULL OR lon IS NULL)), 0) FROM county_sales"
    ).fetchone()
    return IngestResult(
        rows_read=len(sales),
        rows_loaded=len(params),
        rows_skipped=skipped,
        rows_without_parcel=without_parcel,
        total=total,
        vacant=vacant,
        vacant_missing_coords=vacant_missing,
    )


def lookback_cutoff(today: date, months: int) -> date:
    """The date `months` calendar months before `today` (day clamped to month length)."""
    index = today.year * 12 + (today.month - 1) - months
    year, month = divmod(index, 12)
    month += 1
    for day in (today.day, 30, 29, 28):
        try:
            return date(year, month, day)
        except ValueError:
            continue
    raise AssertionError("unreachable: every month has at least 28 days")


def geocode_county(
    conn: sqlite3.Connection,
    settings: Settings,
    client: ParcelLookup,
    limit: int | None = None,
    today: date | None = None,
) -> GeocodeResult:
    """Fill lat/lon (and missing acreage) for recent vacant sales via `client.by_apn`.

    Only sales within `search.max_lookback_months` are processed, newest first.
    Progress is committed per row, and a `QuotaExceeded` stops the run cleanly
    with the un-geocoded rows counted in `remaining`. Other Regrid errors
    propagate to the caller after earlier rows are already saved.
    """
    cutoff = lookback_cutoff(today or date.today(), settings.search.max_lookback_months).isoformat()
    # One lookup per parcel (newest sale first): a repeat sale of the same APN shares
    # its coordinates, and --limit should count parcels, not repeat sales.
    query = (
        f"SELECT apn, MAX(sale_date) AS latest FROM county_sales WHERE {_MISSING_COORDS_WHERE} "
        "GROUP BY apn ORDER BY latest DESC, apn"
    )
    query_params: tuple[object, ...] = (cutoff,)
    if limit is not None:
        query += " LIMIT ?"
        query_params = (cutoff, limit)
    pending = conn.execute(query, query_params).fetchall()

    fips = settings.county.fips
    attempted = filled = no_match = 0
    quota_exceeded = False
    for row in pending:
        try:
            parcel = client.by_apn(row["apn"], fips)
        except QuotaExceeded:
            quota_exceeded = True
            break
        attempted += 1
        if parcel is None:
            no_match += 1
            continue
        with conn:
            # A sale of the same APN on another date shares the parcel, so fill them all.
            conn.execute(
                "UPDATE county_sales SET lat = ?, lon = ?, acreage = COALESCE(acreage, ?) "
                "WHERE apn = ? AND (lat IS NULL OR lon IS NULL)",
                (parcel.lat, parcel.lon, parcel.acreage, row["apn"]),
            )
        filled += 1

    remaining = conn.execute(
        f"SELECT COUNT(*) FROM county_sales WHERE {_MISSING_COORDS_WHERE}", (cutoff,)
    ).fetchone()[0]
    return GeocodeResult(
        attempted=attempted,
        filled=filled,
        no_match=no_match,
        remaining=remaining,
        quota_exceeded=quota_exceeded,
    )
