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
from land_comps.realtor import RealtorSource
from land_comps.sources import SourceError

FIXTURES = Path(__file__).parent / "fixtures" / "apify"
SUBJECT = Parcel(apn="1", lat=39.0, lon=-105.5, acreage=5, county_fips="08093", zip="80440")


class FakeClient:
    """Serves the sold fixture for `mode == "sold"` and the for-sale fixture otherwise."""

    def __init__(self, error: Exception | None = None) -> None:
        self.error = error
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def run_actor(
        self, actor_id: str, run_input: dict[str, Any], *, timeout_secs: int, max_items: int
    ) -> ActorRun:
        self.calls.append((actor_id, run_input))
        if self.error is not None:
            raise self.error
        name = "realtor_sold.json" if run_input["mode"] == "sold" else "realtor_for_sale.json"
        return ActorRun("run1", "SUCCEEDED", json.loads((FIXTURES / name).read_text()))


@pytest.fixture
def conn(tmp_path: Path) -> sqlite3.Connection:
    return init_db(tmp_path / "t.sqlite")


def _source(conn: sqlite3.Connection, client: FakeClient) -> RealtorSource:
    config = ApifyConfig(landwatch_actor_id="lw", realtor_actor_id="rt")
    return RealtorSource(ApifyRunner(client, conn, config), "rt")


def test_runs_sold_and_for_sale_modes_for_subject_zip(conn: sqlite3.Connection) -> None:
    client = FakeClient()
    _source(conn, client).fetch(SUBJECT, 5)

    assert [(c[0], c[1]["mode"], c[1]["postalCode"]) for c in client.calls] == [
        ("rt", "sold", "80440"),
        ("rt", "for_sale", "80440"),
    ]
    assert all(c[1]["propertyType"] == "land/lot" for c in client.calls)


def test_non_land_and_improved_records_are_filtered(conn: sqlite3.Connection) -> None:
    ids = [c.source_id for c in _source(conn, FakeClient()).fetch(SUBJECT, 5)]

    assert "RT-2002" not in ids  # single family
    assert "RT-2004" not in ids  # farm with a house
    assert "RT-2003" in ids  # vacant farm/ranch is kept


def test_priceless_and_out_of_radius_dropped_no_gps_kept(conn: sqlite3.Connection) -> None:
    ids = [c.source_id for c in _source(conn, FakeClient()).fetch(SUBJECT, 5)]

    assert ids == ["RT-2001", "RT-2003", "RT-3001", "RT-3002"]  # 2005 no price, 3003 too far


def test_sold_candidate_mapping(conn: sqlite3.Connection) -> None:
    sold = _source(conn, FakeClient()).fetch(SUBJECT, 5)[0]

    assert sold.source == "realtor"
    assert sold.status == "sold"
    assert sold.price == 90000
    assert sold.sold_price == 90000
    assert sold.list_price == 95000
    assert sold.event_date == date(2026, 3, 15)
    assert sold.acreage == pytest.approx(5.0)  # 217,800 sqft
    assert sold.price_per_acre == pytest.approx(18000)
    assert (sold.lat, sold.lon) == (39.005, -105.5)
    assert sold.address == "TBD County Road 59, Fairplay, CO 80440"
    assert sold.description == "Five acres, sold."
    assert sold.url is not None and sold.url.endswith("/2001")


def test_for_sale_candidates_are_active_or_pending(conn: sqlite3.Connection) -> None:
    by_id = {c.source_id: c for c in _source(conn, FakeClient()).fetch(SUBJECT, 5)}

    active, pending = by_id["RT-3001"], by_id["RT-3002"]
    assert (active.status, pending.status) == ("active", "pending")
    assert active.price == 65000 and active.sold_price is None
    assert active.event_date == date(2026, 8, 20)
    assert active.acreage == pytest.approx(2.5)  # 108,900 sqft
    assert pending.lat is None


def test_missing_zip_raises_source_error(conn: sqlite3.Connection) -> None:
    subject = SUBJECT.model_copy(update={"zip": None})

    with pytest.raises(SourceError, match="rt"):
        _source(conn, FakeClient()).fetch(subject, 5)


def test_actor_failure_raises_source_error(conn: sqlite3.Connection) -> None:
    with pytest.raises(SourceError, match="rt"):
        _source(conn, FakeClient(error=RuntimeError("boom"))).fetch(SUBJECT, 5)
