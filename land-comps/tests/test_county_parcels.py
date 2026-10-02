import csv
import json
import sqlite3
from pathlib import Path
from typing import Any

import httpx
import pytest
from typer.testing import CliRunner

from land_comps import cli
from land_comps.config import CountyConfig, load_settings
from land_comps.county_parcels import (
    CountyParcelLookup,
    CountyParcelsEmpty,
    ingest_parcels,
    point_in_rings,
    polygon_centroid,
    street_key,
)
from land_comps.db import init_db
from land_comps.regrid import RegridClient

runner = CliRunner()
EXAMPLE_CONFIG = Path(__file__).parent.parent / "config.example.yaml"
PARCELS_URL = "https://gis.example.test/server/rest/services/ParcelsPublic/MapServer/0"
ZONING_URL = "https://gis.example.test/server/rest/services/Zoning/MapServer/0"

COUNTY = CountyConfig(
    fips="08093",
    name="Park County",
    state="CO",
    apn_length=8,
    sales_file="data/county/park/sales.csv",
    parcels_file="data/county/park/parcels.csv",
    column_mapping={
        "apn": "SCHEDULE_NUMBER",
        "sale_date": "SALE_DATE",
        "sale_price": "SALE_PRICE",
        "land_use_code": "LAND_USE_CODE",
        "acreage": "ACRES",
        "lat": "LAT",
        "lon": "LON",
    },
    vacant_land_codes=["Vacant Land"],
    excluded_deed_types=[],
)


def _square(lon: float, lat: float, size: float = 0.01) -> list[list[float]]:
    """Clockwise square with its lower-left corner at (lon, lat), closed like ArcGIS rings."""
    return [
        [lon, lat], [lon, lat + size], [lon + size, lat + size], [lon + size, lat], [lon, lat]
    ]  # fmt: skip


def _parcel(
    schedule: str | None, rings: list[list[list[float]]] | None, **attrs: Any
) -> dict[str, Any]:
    attributes: dict[str, Any] = {
        "ScheduleNu": schedule,
        "ACCOUNT_NO": f"R{int(schedule):07d}" if schedule and schedule.strip() else None,
        "LOCAL_ADDR": None,
        "STREETNO": None,
        "PREDIRECTION": None,
        "STREETNAME": None,
        "P_CITY": None,
        "P_ZIPCODE": None,
        "LAND_TY": "Vacant Land",
        "ACRES": 5.0,
        "LAND_V": 12000.0,
        "IMPROVE_V": None,
        "BLDGCOUNT": 0.0,
        "SUBNAME": "ESTATES OF COLORADO",
        "OwnershipT": "Private",
    }
    attributes.update(attrs)
    feature: dict[str, Any] = {"attributes": attributes}
    if rings is not None:
        feature["geometry"] = {"rings": rings}
    return feature


# Parcel 46657 is split into two features (multi-part), one of them attribute-less.
PAGE_ONE = [
    _parcel(
        "46657",
        [_square(-105.90, 38.90)],
        LOCAL_ADDR="124 BRETON CT COMO CO 80432",
        STREETNO=124.0,
        STREETNAME="BRETON CT",
        P_CITY="COMO",
        P_ZIPCODE=80432.0,
        ACRES=10.0,
    ),
    _parcel("46657", [_square(-105.89, 38.90)], LAND_TY=None, ACRES=None, SUBNAME=None),
]
PAGE_TWO = [
    _parcel(
        "314",
        [_square(-105.80, 39.10)],
        LOCAL_ADDR="124 BRETON CT JEFFERSON CO 80456",
        STREETNO=124.0,
        STREETNAME="BRETON CT",
        P_CITY="JEFFERSON",
        P_ZIPCODE=80456.0,
        LAND_TY="Residential",
        ACRES=0.5,
        IMPROVE_V=250000.0,
        BLDGCOUNT=1.0,
    ),
    _parcel(
        "10053",
        [_square(-105.70, 39.20)],
        LOCAL_ADDR="CO RD 32 COMO CO 80432",
        STREETNAME="CO RD 32",
        P_CITY="COMO",
        P_ZIPCODE=0.0,
        LAND_TY="Agricultural",
        ACRES=300.0,
    ),
    _parcel(" ", [_square(-105.60, 39.30)]),  # blank schedule number
    _parcel("777", None),  # no geometry
]
ZONES = [
    {"attributes": {"Zone_Code": "A"}, "geometry": {"rings": [_square(-105.95, 38.85, 0.2)]}},
    {"attributes": {"Zone_Code": " "}, "geometry": {"rings": [_square(-105.85, 39.05, 0.2)]}},
]


class FakeArcGis:
    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []

    def transport(self) -> httpx.MockTransport:
        def handler(request: httpx.Request) -> httpx.Response:
            self.requests.append(request)
            if request.url.path.startswith("/server/rest/services/Zoning/"):
                return httpx.Response(200, json={"features": ZONES})
            if request.url.params["resultOffset"] == "0":
                return httpx.Response(
                    200, json={"features": PAGE_ONE, "exceededTransferLimit": True}
                )
            return httpx.Response(200, json={"features": PAGE_TWO})

        return httpx.MockTransport(handler)


@pytest.fixture
def conn(tmp_path: Path) -> sqlite3.Connection:
    return init_db(tmp_path / "test.sqlite")


@pytest.fixture
def loaded(conn: sqlite3.Connection, tmp_path: Path) -> CountyParcelLookup:
    ingest_parcels(
        conn,
        COUNTY,
        PARCELS_URL,
        tmp_path / "park",
        zoning_url=ZONING_URL,
        transport=FakeArcGis().transport(),
    )
    return CountyParcelLookup(conn, COUNTY)


# --- geometry -----------------------------------------------------------------


def test_polygon_centroid_of_square_is_its_center() -> None:
    lat, lon = polygon_centroid([_square(-105.0, 39.0, 0.2)])
    assert (round(lat, 6), round(lon, 6)) == (39.1, -104.9)


def test_polygon_centroid_accounts_for_a_hole() -> None:
    outer = _square(0.0, 0.0, 1.0)
    hole = list(reversed(_square(0.6, 0.6, 0.3)))  # opposite winding, upper-right quadrant
    lat, lon = polygon_centroid([outer, hole])
    assert lat < 0.5 and lon < 0.5  # mass shifts away from the hole


def test_polygon_centroid_is_stable_for_a_tiny_lot_at_real_coordinates() -> None:
    # A 0.05-acre Alma town lot: naive shoelace on raw lon/lat put its centroid outside it.
    ring = [
        [-106.06431, 39.283786], [-106.064054, 39.283864], [-106.064022, 39.283802],
        [-106.064265, 39.283728], [-106.064278, 39.283724], [-106.06431, 39.283786],
    ]  # fmt: skip
    lat, lon = polygon_centroid([ring])
    assert point_in_rings(lat, lon, [ring])


def test_polygon_centroid_degenerate_falls_back_to_bbox_center() -> None:
    assert polygon_centroid([[[0.0, 0.0], [1.0, 1.0], [2.0, 2.0]]]) == (1.0, 1.0)


def test_point_in_rings_handles_holes_and_multiparts() -> None:
    outer = _square(0.0, 0.0, 1.0)
    hole = list(reversed(_square(0.4, 0.4, 0.2)))
    other = _square(5.0, 5.0, 1.0)
    rings = [outer, hole, other]
    assert point_in_rings(0.1, 0.1, rings)
    assert not point_in_rings(0.5, 0.5, rings)  # inside the hole
    assert point_in_rings(5.5, 5.5, rings)
    assert not point_in_rings(2.0, 2.0, rings)


def test_street_key_applies_county_spellings() -> None:
    assert street_key("1234 County Road 18, Fairplay CO") == "1234 CO RD 18 FAIRPLAY CO"
    assert street_key("45 Batak Lane") == "45 BATAK LN"


# --- ingest -------------------------------------------------------------------


def test_ingest_merges_multipart_parcels_and_skips_bad_features(
    conn: sqlite3.Connection, tmp_path: Path
) -> None:
    fake = FakeArcGis()
    result = ingest_parcels(
        conn, COUNTY, PARCELS_URL, tmp_path / "park", zoning_url=ZONING_URL,
        transport=fake.transport(),
    )  # fmt: skip

    assert result.features == 6
    assert result.parcels == 3
    assert result.skipped_no_apn == 1
    assert result.skipped_no_geometry == 1
    assert result.with_address == 2
    assert result.with_zoning == 1
    assert result.zones == 1  # the blank zone code is dropped
    assert [r.url.params["outSR"] for r in fake.requests] == ["4326"] * 3

    rows = {r["apn"]: r for r in conn.execute("SELECT * FROM county_parcels")}
    assert set(rows) == {"00046657", "00000314", "00010053"}
    merged = rows["00046657"]
    assert merged["account"] == "R0046657"
    assert merged["acreage"] == 10.0
    assert merged["land_type"] == "Vacant Land"
    assert merged["zip"] == "80432"
    assert merged["zoning"] == "A"
    assert merged["address_norm"] == "124 BRETON CT COMO CO 80432"
    assert merged["street_norm"] == "124 BRETON CT"
    assert len(json.loads(merged["rings"])) == 2
    assert merged["min_lon"] == -105.90 and merged["max_lon"] == pytest.approx(-105.88)
    assert (merged["lat"], merged["lon"]) == (pytest.approx(38.905), pytest.approx(-105.89))

    ag = rows["00010053"]
    assert ag["address"] is None and ag["street_norm"] is None  # no house number
    assert ag["zip"] is None  # 0 is not a ZIP
    assert ag["zoning"] is None

    parcels_csv = list(csv.DictReader((tmp_path / "park" / "parcels.csv").open()))
    assert {r["SCHEDULE_NUMBER"] for r in parcels_csv} == set(rows)
    by_apn = {r["SCHEDULE_NUMBER"]: r for r in parcels_csv}
    assert by_apn["00046657"]["LAND_USE_CODE"] == "Vacant Land"
    assert by_apn["00046657"]["ACRES"] == "10"
    assert by_apn["00046657"]["ZONING"] == "A"
    assert by_apn["00000314"]["IMPROVEMENT_VALUE"] == "250000"
    centroids_csv = list(csv.DictReader((tmp_path / "park" / "centroids.csv").open()))
    assert list(centroids_csv[0].keys()) == ["SCHEDULE_NUMBER", "LAT", "LON"]
    assert by_apn["00046657"]["LAT"] == "38.905000"


def test_ingest_replaces_previous_rows(conn: sqlite3.Connection, tmp_path: Path) -> None:
    ingest_parcels(conn, COUNTY, PARCELS_URL, tmp_path, transport=FakeArcGis().transport())
    with conn:
        conn.execute("UPDATE county_parcels SET acreage = 999 WHERE apn = '00046657'")
    ingest_parcels(conn, COUNTY, PARCELS_URL, tmp_path, transport=FakeArcGis().transport())

    row = conn.execute("SELECT acreage, zoning FROM county_parcels WHERE apn = '00046657'")
    assert tuple(row.fetchone()) == (10.0, None)  # no zoning URL this time
    assert conn.execute("SELECT COUNT(*) FROM county_parcels").fetchone()[0] == 3


# --- lookup -------------------------------------------------------------------


def test_by_apn_normalizes_and_accepts_account_number(loaded: CountyParcelLookup) -> None:
    parcel = loaded.by_apn("46657", "08093")
    assert parcel is not None
    assert parcel.apn == "00046657"
    assert parcel.address == "124 BRETON CT COMO CO 80432"
    assert parcel.acreage == 10.0
    assert parcel.zoning == "A"
    assert parcel.land_use == "Vacant Land"
    assert parcel.zip == "80432"
    assert parcel.county_fips == "08093"

    assert loaded.by_apn("r0046657", "08093") == parcel
    assert loaded.by_apn("00R0046657", "08093") == parcel  # as `resolve_subject` pads it
    assert loaded.by_apn("46657", "08059") is None
    assert loaded.by_apn("99999", "08093") is None


def test_by_address_prefers_exact_then_city_match(loaded: CountyParcelLookup) -> None:
    exact = loaded.by_address("124 Breton Ct, Jefferson CO 80456")
    assert exact is not None and exact.apn == "00000314"

    by_city = loaded.by_address("124 Breton Court, Como")
    assert by_city is not None and by_city.apn == "00046657"

    ambiguous = loaded.by_address("124 BRETON CT")
    assert ambiguous is not None and ambiguous.apn == "00000314"  # first by schedule number

    assert loaded.by_address("9 Nowhere Ln") is None
    assert loaded.by_address("CO RD 32 COMO") is None  # no house number, no street key


def test_by_point_uses_polygon_containment(loaded: CountyParcelLookup) -> None:
    inside_second_part = loaded.by_point(38.905, -105.885)
    assert inside_second_part is not None and inside_second_part.apn == "00046657"
    farm = loaded.by_point(39.205, -105.695)
    assert farm is not None and farm.apn == "00010053"
    assert loaded.by_point(39.205, -105.705) is None  # just west of the farm's edge
    assert loaded.by_point(0.0, 0.0) is None


def test_empty_table_raises_lookup_error(conn: sqlite3.Connection) -> None:
    lookup = CountyParcelLookup(conn, COUNTY)
    with pytest.raises(CountyParcelsEmpty, match="ingest parcels"):
        lookup.by_apn("46657", "08093")
    with pytest.raises(CountyParcelsEmpty):
        lookup.by_point(1.0, 1.0)


# --- cli ----------------------------------------------------------------------


def test_factory_dispatches_on_parcels_lookup(tmp_path: Path, conn: sqlite3.Connection) -> None:
    settings = load_settings(EXAMPLE_CONFIG)
    assert settings.parcels.lookup == "county"
    assert isinstance(cli.default_parcel_lookup_factory(settings, conn), CountyParcelLookup)

    regrid_settings = settings.model_copy(
        update={
            "parcels": settings.parcels.model_copy(update={"lookup": "regrid"}),
            "secrets": settings.secrets.model_copy(update={"regrid_token": "tok"}),
        }
    )
    client = cli.default_parcel_lookup_factory(regrid_settings, conn)
    assert isinstance(client, RegridClient)
    client.close()


def test_ingest_parcels_command(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cli, "arcgis_transport", FakeArcGis().transport())
    out_dir = tmp_path / "park"
    db = tmp_path / "x.sqlite"

    result = runner.invoke(
        cli.app,
        [
            "ingest",
            "parcels",
            "--config",
            str(EXAMPLE_CONFIG),
            "--db",
            str(db),
            "--out",
            str(out_dir),
            "--parcels-url",
            PARCELS_URL,
            "--zoning-url",
            ZONING_URL,
        ],  # fmt: skip
    )

    assert result.exit_code == 0, result.output
    assert "Fetched 6 features: loaded 3 parcels" in result.output
    assert "Parcels with a zone code: 1 (1 zones)" in result.output
    assert (out_dir / "parcels.csv").exists() and (out_dir / "centroids.csv").exists()

    subject = runner.invoke(
        cli.app, ["subject", "46657", "--config", str(EXAMPLE_CONFIG), "--db", str(db)]
    )
    assert subject.exit_code == 0, subject.output
    assert "0000046657" in subject.output and "124 BRETON CT" in subject.output


def test_subject_without_ingest_reports_lookup_error(tmp_path: Path) -> None:
    result = runner.invoke(
        cli.app,
        ["subject", "46657", "--config", str(EXAMPLE_CONFIG), "--db", str(tmp_path / "x.sqlite")],
    )
    assert result.exit_code == 1
    assert "Parcel lookup error" in result.output and "ingest parcels" in result.output


def test_ingest_parcels_command_without_url_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    text = EXAMPLE_CONFIG.read_text().replace(
        'arcgis_parcels_url: "https://maps.parkcountyco.gov/server/rest/services/ParcelsPublic/MapServer/0"',
        "arcgis_parcels_url: null",
    )
    config = tmp_path / "config.yaml"
    config.write_text(text)
    result = runner.invoke(
        cli.app, ["ingest", "parcels", "--config", str(config), "--db", str(tmp_path / "x.sqlite")]
    )
    assert result.exit_code == 1
    assert "no parcel layer" in result.output
