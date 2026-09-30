"""County recorded-sales candidate source.

Reads vacant-land sales already loaded into `county_sales` (see `county.py`)
and turns the ones near a subject into sold `Candidate`s. A lat/lon bounding
box narrows the rows in SQL (using the `(lat, lon)` index), then an exact
haversine check trims the box's corners to a true circle.
"""

import math
import sqlite3
from datetime import date

from land_comps.config import CountyConfig
from land_comps.county import lookback_cutoff
from land_comps.geo import EARTH_RADIUS_MILES, haversine_miles
from land_comps.models import Candidate, Parcel
from land_comps.normalize import normalize_apn

SOURCE_NAME = "county_sales"

_MILES_PER_DEGREE_LAT = EARTH_RADIUS_MILES * math.pi / 180


class CountySalesSource:
    """Vacant recorded sales within a radius and lookback window of a subject parcel."""

    def __init__(self, conn: sqlite3.Connection, county: CountyConfig) -> None:
        self._conn = conn
        self._county = county

    def fetch(
        self,
        subject: Parcel,
        radius_mi: float,
        lookback_months: int,
        today: date | None = None,
    ) -> list[Candidate]:
        """Sold candidates within `radius_mi` of `subject`, newest first.

        Only vacant sales with coordinates and a sale date on or after the
        lookback cutoff qualify, and the subject's own APN is never returned
        (a prior sale of the subject is not a comp for itself).
        """
        cutoff = lookback_cutoff(today or date.today(), lookback_months).isoformat()
        subject_apn = normalize_apn(subject.apn, self._county.fips, self._county.apn_length)

        lat_delta = radius_mi / _MILES_PER_DEGREE_LAT
        lat_min, lat_max = subject.lat - lat_delta, subject.lat + lat_delta
        lon_clause = ""
        params: list[object] = [cutoff, lat_min, lat_max]
        cos_lat = math.cos(math.radians(subject.lat))
        # Near the poles a degree of longitude shrinks toward zero miles, so the box
        # would span the globe; skip the longitude bound and let haversine decide.
        if cos_lat > 1e-6:
            lon_delta = lat_delta / cos_lat
            lon_clause = "AND lon BETWEEN ? AND ?"
            params += [subject.lon - lon_delta, subject.lon + lon_delta]

        rows = self._conn.execute(
            f"""
            SELECT id, apn, sale_date, sale_price, deed_type, land_use_code, acreage, lat, lon
            FROM county_sales
            WHERE is_vacant = 1
              AND sale_price IS NOT NULL
              AND sale_date >= ?
              AND lat BETWEEN ? AND ?
              {lon_clause}
            ORDER BY sale_date DESC, id
            """,
            params,
        ).fetchall()

        candidates: list[Candidate] = []
        for row in rows:
            if row["apn"] == subject_apn:
                continue
            distance = haversine_miles(subject.lat, subject.lon, row["lat"], row["lon"])
            if distance > radius_mi:
                continue
            candidates.append(_to_candidate(row, distance))
        return candidates


def _to_candidate(row: sqlite3.Row, distance_mi: float) -> Candidate:
    price: float = row["sale_price"]
    acreage: float | None = row["acreage"]
    return Candidate(
        source=SOURCE_NAME,
        sources=[SOURCE_NAME],
        source_id=f"{row['apn']}:{row['sale_date']}:{f'{price:.2f}'.removesuffix('.00')}",
        status="sold",
        apn=row["apn"],
        lat=row["lat"],
        lon=row["lon"],
        acreage=acreage,
        price=price,
        sold_price=price,
        price_per_acre=price / acreage if acreage else None,
        event_date=date.fromisoformat(row["sale_date"]),
        deed_type=row["deed_type"],
        raw={
            "county_sales_id": row["id"],
            "land_use_code": row["land_use_code"],
            "distance_mi": round(distance_mi, 4),
        },
    )
