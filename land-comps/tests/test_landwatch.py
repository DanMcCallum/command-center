import json
import sqlite3
from datetime import date
from pathlib import Path
from typing import Any

import pytest

from land_comps.apify_runner import ActorRun, ApifyRunner
from land_comps.config import ApifyConfig
from land_comps.db import init_db
from land_comps.landwatch import LandWatchSource
from land_comps.models import Parcel
from land_comps.sources import SourceError

FIXTURE = Path(__file__).parent / "fixtures" / "apify" / "landwatch.json"
SUBJECT = Parcel(apn="1", lat=39.0, lon=-105.5, acreage=5, county_fips="08093", zip="80440")


class FakeClient:
    def __init__(self, items: list[dict[str, Any]], error: Exception | None = None) -> None:
        self.items = items
        self.error = error
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def run_actor(
        self, actor_id: str, run_input: dict[str, Any], *, timeout_secs: int, max_items: int
    ) -> ActorRun:
        self.calls.append((actor_id, run_input))
        if self.error is not None:
            raise self.error
        return ActorRun(run_id="run1", status="SUCCEEDED", items=self.items)


@pytest.fixture
def conn(tmp_path: Path) -> sqlite3.Connection:
    return init_db(tmp_path / "t.sqlite")


def _source(conn: sqlite3.Connection, client: FakeClient) -> LandWatchSource:
    config = ApifyConfig(landwatch_actor_id="lw", realtor_actor_id="rt")
    return LandWatchSource(ApifyRunner(client, conn, config), "lw")


def _fixture_client() -> FakeClient:
    return FakeClient(json.loads(FIXTURE.read_text()))


def test_fixture_yields_expected_candidates(conn: sqlite3.Connection) -> None:
    candidates = _source(conn, _fixture_client()).fetch(SUBJECT, 5)

    assert [(c.source_id, c.status) for c in candidates] == [
        ("LW-1001", "active"),
        ("LW-1002", "pending"),
        ("LW-1003", "sold"),
        ("LW-1004", "sold"),
    ]


def test_drops_priceless_out_of_radius_and_unknown_status(conn: sqlite3.Connection) -> None:
    ids = {c.source_id for c in _source(conn, _fixture_client()).fetch(SUBJECT, 5)}

    assert "LW-1005" not in ids  # no price
    assert "LW-1006" not in ids  # ~20 miles out
    assert "LW-1007" not in ids  # unrecognized status


def test_smaller_radius_drops_more_but_keeps_items_without_gps(conn: sqlite3.Connection) -> None:
    ids = [c.source_id for c in _source(conn, _fixture_client()).fetch(SUBJECT, 1)]

    assert ids == ["LW-1001", "LW-1003", "LW-1004"]  # LW-1002 is ~1.4 mi out


def test_active_candidate_fields(conn: sqlite3.Connection) -> None:
    active = _source(conn, _fixture_client()).fetch(SUBJECT, 5)[0]

    assert active.source == "landwatch"
    assert active.sources == ["landwatch"]
    assert active.price == 85000
    assert active.list_price == 85000
    assert active.sold_price is None
    assert active.acreage == 5
    assert active.price_per_acre == 17000
    assert (active.lat, active.lon) == (39.004, -105.5)
    assert active.event_date == date(2026, 7, 15)
    assert active.road_access == "Road frontage: 660 ft; Year-round county road"
    assert active.utilities == ["Electric", "Well permit"]
    assert active.topography == "Gently rolling"
    assert active.description == "Five acres of open meadow with mountain views."
    assert active.url is not None and active.url.endswith("/pid/1001")
    assert active.raw["id"] == "LW-1001"


def test_sold_candidate_uses_sold_price_and_sold_date(conn: sqlite3.Connection) -> None:
    sold = _source(conn, _fixture_client()).fetch(SUBJECT, 5)[2]

    assert sold.price == 57500
    assert sold.sold_price == 57500
    assert sold.list_price == 60000
    assert sold.price_per_acre == 23000
    assert sold.event_date == date(2026, 4, 2)


def test_sold_item_with_only_plain_price_treats_it_as_sale_price(conn: sqlite3.Connection) -> None:
    sold = _source(conn, _fixture_client()).fetch(SUBJECT, 5)[3]

    assert sold.sold_price == 40000
    assert sold.price_per_acre == 10000
    assert (sold.lat, sold.lon) == (None, None)


def test_string_utilities_and_us_date_format(conn: sqlite3.Connection) -> None:
    pending = _source(conn, _fixture_client()).fetch(SUBJECT, 5)[1]

    assert pending.utilities == ["Electric", "Phone"]
    assert pending.event_date == date(2026, 6, 1)


def test_actor_input_targets_subject_county_and_zip(conn: sqlite3.Connection) -> None:
    client = _fixture_client()
    _source(conn, client).fetch(SUBJECT, 3)

    assert len(client.calls) == 1
    actor_id, run_input = client.calls[0]
    assert actor_id == "lw"
    assert run_input["countyFips"] == "08093"
    assert run_input["zip"] == "80440"
    assert run_input["radiusMiles"] == 3
    assert set(run_input["statuses"]) == {"available", "under contract", "sold"}


def test_item_without_id_or_url_gets_stable_source_id(conn: sqlite3.Connection) -> None:
    item = {"status": "Available", "price": 1000, "acres": 1}
    first = _source(conn, FakeClient([item])).fetch(SUBJECT, 5)
    second = _source(init_db(Path(":memory:")), FakeClient([item])).fetch(SUBJECT, 5)

    assert first[0].source_id == second[0].source_id


def test_actor_failure_raises_source_error(conn: sqlite3.Connection) -> None:
    client = FakeClient([], error=RuntimeError("boom"))

    with pytest.raises(SourceError, match="lw"):
        _source(conn, client).fetch(SUBJECT, 5)
