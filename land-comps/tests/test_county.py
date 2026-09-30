import sqlite3
from datetime import date
from pathlib import Path

import pytest
from typer.testing import CliRunner

from land_comps import cli, county
from land_comps.config import Settings, load_settings
from land_comps.county import IngestError, geocode_county, ingest_county, lookback_cutoff
from land_comps.db import init_db
from land_comps.models import Parcel
from land_comps.regrid import QuotaExceeded

runner = CliRunner()
FIXTURES = Path(__file__).parent / "fixtures" / "county"
EXAMPLE_CONFIG = Path(__file__).parent.parent / "config.example.yaml"
TODAY = date(2026, 9, 30)  # 36-month cutoff: 2023-09-30


class _FrozenDate(date):
    @classmethod
    def today(cls) -> "_FrozenDate":
        return cls(TODAY.year, TODAY.month, TODAY.day)


# APNs of vacant sales that lack a centroid: 7 and 13 are older than the window.
IN_WINDOW_MISSING = {"0010000008", "0010000015", "0010000017", "0010000019"}
OUT_OF_WINDOW_MISSING = {"0010000007", "0010000013"}


@pytest.fixture
def config_path(tmp_path: Path) -> Path:
    text = EXAMPLE_CONFIG.read_text().replace(
        '"PLACEHOLDER_VACANT_LAND_CODE"', '"1112"\n    - "1120"'
    )
    path = tmp_path / "config.yaml"
    path.write_text(text)
    return path


@pytest.fixture
def settings(config_path: Path) -> Settings:
    return load_settings(config_path)


@pytest.fixture
def conn(tmp_path: Path) -> sqlite3.Connection:
    return init_db(tmp_path / "test.sqlite")


def _ingest(conn: sqlite3.Connection, settings: Settings) -> None:
    ingest_county(
        conn,
        settings.county,
        FIXTURES / "sales.csv",
        FIXTURES / "parcels.csv",
        FIXTURES / "centroids.csv",
    )


def _parcel(apn: str) -> Parcel:
    return Parcel(apn=apn, lat=39.5, lon=-105.5, acreage=9.99, county_fips="08093", address=None)


class FakeRegrid:
    def __init__(self, fail_after: int | None = None) -> None:
        self.calls: list[str] = []
        self.fail_after = fail_after

    def by_apn(self, apn: str, county_fips: str) -> Parcel | None:
        if self.fail_after is not None and len(self.calls) >= self.fail_after:
            raise QuotaExceeded("cap reached (2000/2000)")
        self.calls.append(apn)
        return None if apn == "0010000019" else _parcel(apn)

    def by_address(self, address: str) -> Parcel | None:
        raise AssertionError("geocode-county must use by_apn")

    def by_point(self, lat: float, lon: float) -> Parcel | None:
        raise AssertionError("geocode-county must use by_apn")


def test_ingest_stores_rows_and_reports_counts(
    conn: sqlite3.Connection, settings: Settings
) -> None:
    result = ingest_county(
        conn,
        settings.county,
        FIXTURES / "sales.csv",
        FIXTURES / "parcels.csv",
        FIXTURES / "centroids.csv",
    )

    assert (result.rows_read, result.rows_loaded, result.rows_skipped) == (20, 20, 0)
    assert (result.total, result.vacant, result.vacant_missing_coords) == (20, 12, 6)
    assert result.rows_without_parcel == 0


def test_ingest_twice_does_not_duplicate(conn: sqlite3.Connection, settings: Settings) -> None:
    _ingest(conn, settings)
    _ingest(conn, settings)

    assert conn.execute("SELECT COUNT(*) FROM county_sales").fetchone()[0] == 20


def test_non_vacant_rows_stored_with_is_vacant_zero(
    conn: sqlite3.Connection, settings: Settings
) -> None:
    _ingest(conn, settings)

    rows = conn.execute(
        "SELECT apn, land_use_code, is_vacant FROM county_sales WHERE land_use_code IN "
        "('1212', '2112')"
    ).fetchall()
    assert len(rows) == 8
    assert all(r["is_vacant"] == 0 for r in rows)
    assert conn.execute("SELECT COUNT(*) FROM county_sales WHERE is_vacant = 1").fetchone()[0] == 12


def test_ingest_maps_and_normalizes_fields(conn: sqlite3.Connection, settings: Settings) -> None:
    _ingest(conn, settings)

    dashed = conn.execute("SELECT * FROM county_sales WHERE apn = '0010000004'").fetchone()
    assert dashed["sale_date"] == "2025-05-05"
    assert dashed["deed_type"] == "WD"
    assert dashed["land_use_code"] == "1120"
    assert dashed["acreage"] == 4.0
    assert (dashed["lat"], dashed["lon"]) == (38.94, -105.84)

    unpadded = conn.execute("SELECT * FROM county_sales WHERE apn = '0010000006'").fetchone()
    assert unpadded["sale_date"] == "2025-07-07"  # M/D/YYYY in the source
    assert unpadded["sale_price"] == 55000.0

    priced = conn.execute("SELECT sale_price FROM county_sales WHERE apn = '0010000012'").fetchone()
    assert priced["sale_price"] == 45000.0  # "$45,000" in the source

    no_centroid = conn.execute("SELECT lat, lon FROM county_sales WHERE apn = '0010000008'")
    assert tuple(no_centroid.fetchone()) == (None, None)


def test_reingest_keeps_geocoded_coordinates(conn: sqlite3.Connection, settings: Settings) -> None:
    _ingest(conn, settings)
    geocode_county(conn, settings, FakeRegrid(), today=TODAY)
    _ingest(conn, settings)

    row = conn.execute("SELECT lat, lon FROM county_sales WHERE apn = '0010000008'").fetchone()
    assert (row["lat"], row["lon"]) == (39.5, -105.5)


def test_ingest_without_centroids_leaves_coordinates_empty(
    conn: sqlite3.Connection, settings: Settings
) -> None:
    result = ingest_county(conn, settings.county, FIXTURES / "sales.csv", FIXTURES / "parcels.csv")

    assert (result.total, result.vacant, result.vacant_missing_coords) == (20, 12, 12)


def test_unkeyable_rows_are_skipped_not_duplicated(
    conn: sqlite3.Connection, settings: Settings, tmp_path: Path
) -> None:
    sales = tmp_path / "sales.csv"
    sales.write_text(
        "SCHEDULE_NUMBER,SALE_DATE,SALE_PRICE,DEED_TYPE\n"
        "0010000001,2025-01-01,50000,WD\n"
        "0010000001,not-a-date,50000,WD\n"
        "0010000001,2025-02-01,,WD\n"
        ",2025-02-01,1000,WD\n"
        "0010000099,2025-03-01,20000,WD\n"
    )
    result = ingest_county(conn, settings.county, sales, FIXTURES / "parcels.csv")

    assert (result.rows_read, result.rows_loaded, result.rows_skipped) == (5, 2, 3)
    assert result.rows_without_parcel == 1
    assert result.total == 2


def test_missing_mapped_column_raises(
    conn: sqlite3.Connection, settings: Settings, tmp_path: Path
) -> None:
    sales = tmp_path / "sales.csv"
    sales.write_text("PARCEL,SALE_DATE\n1,2025-01-01\n")

    with pytest.raises(IngestError, match="SCHEDULE_NUMBER"):
        ingest_county(conn, settings.county, sales, FIXTURES / "parcels.csv")


def test_missing_file_raises(conn: sqlite3.Connection, settings: Settings, tmp_path: Path) -> None:
    with pytest.raises(IngestError, match="Sales file not found"):
        ingest_county(conn, settings.county, tmp_path / "nope.csv", FIXTURES / "parcels.csv")


def test_lookback_cutoff_clamps_day() -> None:
    assert lookback_cutoff(date(2026, 9, 30), 36) == date(2023, 9, 30)
    assert lookback_cutoff(date(2026, 3, 31), 1) == date(2026, 2, 28)
    assert lookback_cutoff(date(2026, 1, 15), 2) == date(2025, 11, 15)


def test_geocode_fills_only_in_window_vacant_rows(
    conn: sqlite3.Connection, settings: Settings
) -> None:
    _ingest(conn, settings)
    fake = FakeRegrid()

    result = geocode_county(conn, settings, fake, today=TODAY)

    assert set(fake.calls) == IN_WINDOW_MISSING
    assert (result.attempted, result.filled, result.no_match) == (4, 3, 1)
    assert result.remaining == 1  # 0010000019 has no Regrid match
    assert not result.quota_exceeded

    filled = conn.execute("SELECT lat, lon, acreage FROM county_sales WHERE apn = '0010000008'")
    assert tuple(filled.fetchone()) == (39.5, -105.5, 9.99)  # acreage was blank in the parcels file
    kept = conn.execute("SELECT acreage FROM county_sales WHERE apn = '0010000015'").fetchone()
    assert kept["acreage"] == 12.25  # county acreage is not overwritten
    for apn in OUT_OF_WINDOW_MISSING:
        row = conn.execute("SELECT lat, lon FROM county_sales WHERE apn = ?", (apn,)).fetchone()
        assert (row["lat"], row["lon"]) == (None, None)


def test_geocode_respects_limit(conn: sqlite3.Connection, settings: Settings) -> None:
    _ingest(conn, settings)
    fake = FakeRegrid()

    result = geocode_county(conn, settings, fake, limit=2, today=TODAY)

    # Newest first: 0010000008 fills, 0010000019 has no Regrid match.
    assert fake.calls == ["0010000008", "0010000019"]
    assert (result.attempted, result.filled, result.remaining) == (2, 1, 3)


def test_geocode_stops_cleanly_on_quota(conn: sqlite3.Connection, settings: Settings) -> None:
    _ingest(conn, settings)
    fake = FakeRegrid(fail_after=3)

    result = geocode_county(conn, settings, fake, today=TODAY)

    assert result.quota_exceeded
    assert (result.attempted, result.filled) == (3, 2)
    assert result.remaining == 2  # 0010000015 never tried; 0010000019 has no match
    placeholders = ", ".join("?" for _ in IN_WINDOW_MISSING)
    saved = conn.execute(
        f"SELECT COUNT(*) FROM county_sales WHERE apn IN ({placeholders}) AND lat IS NOT NULL",
        tuple(IN_WINDOW_MISSING),
    ).fetchone()[0]
    assert saved == 2  # progress before the cap was committed


def test_cli_ingest_county_prints_counts(config_path: Path, tmp_path: Path) -> None:
    args = [
        "ingest",
        "county",
        "--sales",
        str(FIXTURES / "sales.csv"),
        "--parcels",
        str(FIXTURES / "parcels.csv"),
        "--centroids",
        str(FIXTURES / "centroids.csv"),
        "--config",
        str(config_path),
        "--db",
        str(tmp_path / "x.sqlite"),
    ]
    first = runner.invoke(cli.app, args)
    second = runner.invoke(cli.app, args)

    for result in (first, second):
        assert result.exit_code == 0
        assert "Total rows: 20" in result.output
        assert "Vacant rows: 12" in result.output
        assert "Vacant rows missing coordinates: 6" in result.output


def test_cli_ingest_county_bad_file_exits_1(config_path: Path, tmp_path: Path) -> None:
    result = runner.invoke(
        cli.app,
        [
            "ingest",
            "county",
            "--sales",
            str(tmp_path / "missing.csv"),
            "--parcels",
            str(FIXTURES / "parcels.csv"),
            "--config",
            str(config_path),
            "--db",
            str(tmp_path / "x.sqlite"),
        ],
    )

    assert result.exit_code == 1
    assert "Sales file not found" in result.output


def test_cli_geocode_county_quota_exits_0_with_remaining(
    config_path: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    db = tmp_path / "x.sqlite"
    runner.invoke(
        cli.app,
        [
            "ingest",
            "county",
            "--sales",
            str(FIXTURES / "sales.csv"),
            "--parcels",
            str(FIXTURES / "parcels.csv"),
            "--centroids",
            str(FIXTURES / "centroids.csv"),
            "--config",
            str(config_path),
            "--db",
            str(db),
        ],
    )
    monkeypatch.setattr(cli, "regrid_client_factory", lambda s, c: FakeRegrid(fail_after=1))
    monkeypatch.setattr(county, "date", _FrozenDate)

    result = runner.invoke(
        cli.app, ["ingest", "geocode-county", "--config", str(config_path), "--db", str(db)]
    )

    assert result.exit_code == 0
    assert "cap reached" in result.output
    assert "filled 1" in result.output
    assert "Remaining vacant sales without coordinates: 3" in result.output


def test_ingest_rejects_unmapped_land_use_column(
    conn: sqlite3.Connection, settings: Settings
) -> None:
    settings.county.column_mapping["land_use_code"] = "NO_SUCH_COLUMN"

    with pytest.raises(IngestError, match="land_use_code"):
        _ingest(conn, settings)


def test_ingest_tolerates_rows_with_extra_fields(
    conn: sqlite3.Connection, settings: Settings, tmp_path: Path
) -> None:
    sales = tmp_path / "sales.csv"
    sales.write_text(
        "SCHEDULE_NUMBER,SALE_DATE,SALE_PRICE,DEED_TYPE\n0010000001,2024-02-02,30000,WD,extra\n"
    )

    result = ingest_county(conn, settings.county, sales, FIXTURES / "parcels.csv")

    assert result.rows_loaded == 1
