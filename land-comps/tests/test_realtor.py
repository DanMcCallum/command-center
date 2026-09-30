import json
import sqlite3
from datetime import date
from pathlib import Path
from typing import Any

import pytest

from land_comps.apify_runner import ActorRun, ApifyRunner
from land_comps.config import ApifyConfig
from land_comps.db import init_db
from land_comps.models import Parcel
from land_comps.realtor import RealtorSource, realtor_location, search_url
from land_comps.sources import SourceError

FIXTURE = Path(__file__).parent / "fixtures" / "apify" / "realtor_for_sale.json"
SUBJECT = Parcel(apn="1", lat=39.0, lon=-105.5, acreage=5, county_fips="08093", zip="80440")
LOCATION = "Park-County_CO"


class FakeClient:
    def __init__(self, error: Exception | None = None) -> None:
        self.error = error
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def run_actor(
        self, actor_id: str, run_input: dict[str, Any], *, timeout_secs: int, max_items: int
    ) -> ActorRun:
        self.calls.append((actor_id, run_input))
        if self.error is not None:
            raise self.error
        return ActorRun("run1", "SUCCEEDED", json.loads(FIXTURE.read_text()))


@pytest.fixture
def conn(tmp_path: Path) -> sqlite3.Connection:
    return init_db(tmp_path / "t.sqlite")


def _source(
    conn: sqlite3.Connection, client: FakeClient, location: str | None = LOCATION
) -> RealtorSource:
    config = ApifyConfig(landwatch_actor_id="lw", realtor_actor_id="rt")
    return RealtorSource(ApifyRunner(client, conn, config), "rt", location)


def test_location_and_search_url_follow_realtor_com_county_format() -> None:
    assert realtor_location("Park County", "co") == "Park-County_CO"
    assert realtor_location("  Rio  Blanco County ", "CO") == "Rio-Blanco-County_CO"
    assert (
        search_url("Park-County_CO")
        == "https://www.realtor.com/realestateandhomes-search/Park-County_CO/type-land"
    )


def test_runs_the_county_for_sale_land_search_once(conn: sqlite3.Connection) -> None:
    client = FakeClient()
    _source(conn, client).fetch(SUBJECT, 5)

    assert [(c[0], c[1]["startUrls"]) for c in client.calls] == [
        ("rt", [{"url": search_url(LOCATION)}])
    ]
    run_input = client.calls[0][1]
    assert run_input["maxItems"] == 500  # ApifyConfig.max_items default
    assert run_input["csvFriendly"] is True
    assert run_input["getDetails"] is False
    assert run_input["fullScrape"] is False


def test_non_land_and_improved_records_are_filtered(conn: sqlite3.Connection) -> None:
    ids = [c.source_id for c in _source(conn, FakeClient()).fetch(SUBJECT, 5)]

    assert "RT-3004" not in ids  # single family
    assert "RT-3006" not in ids  # farm with a house
    assert "RT-3005" in ids  # vacant farm/ranch is kept


def test_priceless_and_out_of_radius_dropped_no_gps_kept_in_zip(conn: sqlite3.Connection) -> None:
    ids = [c.source_id for c in _source(conn, FakeClient()).fetch(SUBJECT, 5)]

    # 3003 too far, 3007 no price, 3008 no GPS in another ZIP; 3002 no GPS in the subject's ZIP
    assert ids == ["RT-3001", "RT-3002", "RT-3005"]


def test_no_gps_items_are_kept_when_subject_has_no_zip(conn: sqlite3.Connection) -> None:
    subject = SUBJECT.model_copy(update={"zip": None})
    ids = [c.source_id for c in _source(conn, FakeClient()).fetch(subject, 5)]

    assert "RT-3008" in ids


def test_active_candidate_mapping(conn: sqlite3.Connection) -> None:
    active = _source(conn, FakeClient()).fetch(SUBJECT, 5)[0]

    assert active.source == "realtor"
    assert active.status == "active"
    assert active.price == 65000
    assert active.list_price == 65000
    assert active.sold_price is None  # last_sold_* is the parcel's prior sale, raw only
    assert active.raw["last_sold_price"] == 20000
    assert active.event_date == date(2026, 8, 20)  # from the actor's ISO timestamp
    assert active.acreage == pytest.approx(2.5)  # 108,900 sqft
    assert active.price_per_acre == pytest.approx(26000)
    assert (active.lat, active.lon) == (39.006, -105.49)
    assert active.address == "TBD Aspen Way, Fairplay, CO 80440"
    assert active.description is None  # description_text needs getDetails
    assert active.url is not None and active.url.endswith("/3001")


def test_pending_comes_from_is_pending_flag_or_status(conn: sqlite3.Connection) -> None:
    by_id = {c.source_id: c for c in _source(conn, FakeClient()).fetch(SUBJECT, 5)}

    assert by_id["RT-3002"].status == "pending"  # status "for_sale" but is_pending true
    assert by_id["RT-3002"].lat is None
    assert by_id["RT-3005"].status == "pending"  # status "pending", no is_pending flag


def test_missing_county_location_raises_source_error(conn: sqlite3.Connection) -> None:
    with pytest.raises(SourceError, match="county.name"):
        _source(conn, FakeClient(), location=None).fetch(SUBJECT, 5)


def test_actor_failure_raises_source_error(conn: sqlite3.Connection) -> None:
    with pytest.raises(SourceError, match="rt"):
        _source(conn, FakeClient(error=RuntimeError("boom"))).fetch(SUBJECT, 5)
