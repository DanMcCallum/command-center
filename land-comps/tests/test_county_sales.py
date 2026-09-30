import sqlite3
from datetime import date
from pathlib import Path

import pytest

from land_comps.config import CountyConfig
from land_comps.county_sales import CountySalesSource
from land_comps.db import init_db
from land_comps.models import Parcel

TODAY = date(2026, 9, 30)
COUNTY = CountyConfig(
    fips="08093",
    apn_length=10,
    sales_file="s",
    parcels_file="p",
    column_mapping={},
    vacant_land_codes=[],
    excluded_deed_types=[],
)
SUBJECT = Parcel(apn="0034567890", lat=39.0, lon=-105.5, acreage=5, county_fips="08093")
# One degree of latitude is ~69.09 miles, so these offsets put sales at known distances north.
MI = 1 / 69.0912


def _north(miles: float) -> tuple[float, float]:
    return SUBJECT.lat + miles * MI, SUBJECT.lon


@pytest.fixture
def conn(tmp_path: Path) -> sqlite3.Connection:
    conn = init_db(tmp_path / "t.sqlite")
    rows: list[tuple[object, ...]] = [
        # (apn, sale_date, price, vacant, acreage, lat, lon)
        ("1000000001", "2026-06-01", 40000, 1, 4.0, *_north(0.5)),
        ("1000000002", "2025-01-15", 30000, 1, 10.0, *_north(1.5)),  # outside 1 mi
        ("1000000003", "2026-03-01", 50000, 1, 5.0, *_north(4.9)),
        ("1000000004", "2026-03-01", 60000, 1, 5.0, *_north(5.5)),  # outside 5 mi
        ("1000000005", "2022-01-01", 20000, 1, 5.0, *_north(0.2)),  # too old
        ("1000000006", "2026-05-01", 90000, 0, 5.0, *_north(0.3)),  # not vacant
        ("0034567890", "2025-05-01", 70000, 1, 5.0, *_north(0.1)),  # the subject itself
        ("1000000008", "2026-05-01", 45000, 1, 5.0, None, None),  # not geocoded
        # Inside the lat/lon box but beyond the circle: ~0.99 mi N and E gives ~1.4 mi.
        ("1000000009", "2026-05-01", 55000, 1, 5.0, SUBJECT.lat + 0.99 * MI, SUBJECT.lon + 0.0180),
        ("1000000010", "2026-07-01", 35000, 1, None, *_north(0.9)),  # no acreage
    ]
    conn.executemany(
        "INSERT INTO county_sales (apn, sale_date, sale_price, is_vacant, acreage, lat, lon) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        rows,
    )
    conn.commit()
    return conn


def _apns(conn: sqlite3.Connection, radius: float, months: int) -> list[str]:
    found = CountySalesSource(conn, COUNTY).fetch(SUBJECT, radius, months, today=TODAY)
    return [c.apn or "" for c in found]


def test_one_mile_radius_returns_only_close_vacant_recent_sales(conn: sqlite3.Connection) -> None:
    assert _apns(conn, 1, 24) == ["1000000010", "1000000001"]


def test_larger_radius_adds_farther_sales_newest_first(conn: sqlite3.Connection) -> None:
    assert _apns(conn, 5, 24) == [
        "1000000010",
        "1000000001",
        "1000000009",
        "1000000003",
        "1000000002",
    ]


def test_lookback_window_limits_by_sale_date(conn: sqlite3.Connection) -> None:
    assert _apns(conn, 5, 6) == ["1000000010", "1000000001", "1000000009"]
    assert "1000000005" in _apns(conn, 1, 60)


def test_never_returns_subject_apn_even_with_unpadded_format(conn: sqlite3.Connection) -> None:
    subject = SUBJECT.model_copy(update={"apn": "34-567-890"})

    found = CountySalesSource(conn, COUNTY).fetch(subject, 5, 36, today=TODAY)

    assert "0034567890" not in [c.apn for c in found]


def test_candidate_fields(conn: sqlite3.Connection) -> None:
    found = CountySalesSource(conn, COUNTY).fetch(SUBJECT, 1, 24, today=TODAY)
    candidate = next(c for c in found if c.apn == "1000000001")

    assert candidate.source == "county_sales"
    assert candidate.sources == ["county_sales"]
    assert candidate.status == "sold"
    assert candidate.event_date == date(2026, 6, 1)
    assert candidate.price == candidate.sold_price == 40000
    assert candidate.list_price is None
    assert candidate.acreage == 4.0
    assert candidate.price_per_acre == 10000
    assert candidate.source_id == "1000000001:2026-06-01:40000"
    assert candidate.raw["distance_mi"] == pytest.approx(0.5, abs=0.01)
    no_acreage = next(c for c in found if c.apn == "1000000010")
    assert no_acreage.price_per_acre is None


def test_source_id_distinguishes_large_prices_on_the_same_apn_and_day(tmp_path: Path) -> None:
    conn = init_db(tmp_path / "big.sqlite")
    lat, lon = _north(0.5)
    conn.executemany(
        "INSERT INTO county_sales (apn, sale_date, sale_price, is_vacant, acreage, lat, lon) "
        "VALUES (?, ?, ?, 1, 5.0, ?, ?)",
        [("1000000001", "2026-06-01", price, lat, lon) for price in (1234567, 1234568)],
    )

    found = CountySalesSource(conn, COUNTY).fetch(SUBJECT, 1, 24, today=TODAY)

    assert sorted(c.source_id for c in found) == [
        "1000000001:2026-06-01:1234567",
        "1000000001:2026-06-01:1234568",
    ]


def test_empty_table_returns_nothing(tmp_path: Path) -> None:
    conn = init_db(tmp_path / "empty.sqlite")

    assert CountySalesSource(conn, COUNTY).fetch(SUBJECT, 5, 24, today=TODAY) == []
