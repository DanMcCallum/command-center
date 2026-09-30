import json
from datetime import date
from pathlib import Path

from land_comps.models import Candidate, Parcel
from land_comps.state import (
    DESCRIPTION_MAX_CHARS,
    build_state,
    months_between,
    pool_median_price_per_acre,
)

FIXTURES = Path(__file__).parent / "fixtures" / "state"
TODAY = date(2026, 9, 30)
SUBJECT = Parcel(
    apn="0000100000",
    address="1 Subject Rd, Fairplay, CO 80440",
    lat=39.0,
    lon=-105.5,
    acreage=5.1,
    zoning="RR-5",
    land_use="Vacant Residential",
    county_fips="08093",
    zip="80440",
)


def _sold(source_id: str, price: float, acres: float = 5.0, **fields: object) -> Candidate:
    base: dict[str, object] = {
        "source": "county_sales",
        "source_id": source_id,
        "status": "sold",
        "acreage": acres,
        "price": price,
        "price_per_acre": price / acres,
        "event_date": date(2026, 3, 14),
    }
    return Candidate.model_validate({**base, **fields})


def test_state_matches_committed_snapshot() -> None:
    candidate = Candidate(
        source="landwatch",
        sources=["landwatch"],
        source_id="lw-1",
        status="sold",
        apn="0000200000",
        address="Lot 4 County Road 12, Fairplay, CO 80440",
        lat=39.0 + 1.8 / 69.0912,
        lon=-105.5,
        acreage=4.6,
        price=85000,
        price_per_acre=85000 / 4.6,
        event_date=date(2026, 3, 14),
        deed_type="WD",
        road_access="county road",
        utilities=["electric at street"],
        topography="gentle slope",
        description="Level building site with mountain views.",
        url="https://example.com/listing/1",
        raw={"zoning": "rr-5", "internal": "not sent"},
    )
    pool = [
        _sold("a", 90000),
        _sold("b", 100000),
        _sold("c", 110000),
        _sold("d", 500000, status="active"),  # active listings are not part of the median
    ]

    state = build_state(SUBJECT, candidate, pool, today=TODAY)

    expected = json.loads((FIXTURES / "pair_expected.json").read_text())
    assert state == expected
    # Exclusions are visible: no url, no raw, no source_id, nothing null.
    assert "url" not in state["candidate"]
    assert "None" not in json.dumps(state)


def test_pool_with_fewer_than_three_sold_omits_price_vs_median() -> None:
    candidate = _sold("x", 100000)
    pool = [_sold("a", 90000), _sold("b", 110000), _sold("c", 200000, status="active")]

    state = build_state(SUBJECT, candidate, pool, today=TODAY)

    assert "price_per_acre_vs_pool_median" not in state["comparison"]
    assert pool_median_price_per_acre(pool) is None


def test_three_sold_pool_gives_ratio_to_median() -> None:
    candidate = _sold("x", 110000)  # 22,000 per acre
    pool = [_sold("a", 90000), _sold("b", 100000), _sold("c", 120000)]  # median 20,000

    state = build_state(SUBJECT, candidate, pool, today=TODAY)

    assert state["comparison"]["price_per_acre_vs_pool_median"] == 1.1


def test_price_per_acre_falls_back_to_price_over_acreage() -> None:
    candidate = _sold("x", 100000, price_per_acre=None)

    state = build_state(SUBJECT, candidate, [], today=TODAY)

    assert state["candidate"]["price_per_acre"] == 20000


def test_description_truncated_and_unknown_fields_omitted() -> None:
    candidate = Candidate(
        source="realtor",
        source_id="r-1",
        status="active",
        description="x" * 5000,
    )

    state = build_state(SUBJECT, candidate, [], today=TODAY)

    assert len(state["candidate"]["description"]) == DESCRIPTION_MAX_CHARS
    assert state["candidate"] == {
        "source": "realtor",
        "status": "active",
        "description": "x" * DESCRIPTION_MAX_CHARS,
    }
    assert state["comparison"] == {}


def test_false_booleans_are_kept() -> None:
    candidate = _sold("x", 100000, address="9 Other Rd, Alma, CO 80420", raw={"zoning": "A-1"})

    comparison = build_state(SUBJECT, candidate, [], today=TODAY)["comparison"]

    assert comparison["same_zoning"] is False
    assert comparison["same_zip"] is False


def test_months_between_counts_whole_months_and_floors_future_dates() -> None:
    assert months_between(date(2026, 3, 14), date(2026, 9, 30)) == 6
    assert months_between(date(2026, 3, 31), date(2026, 9, 30)) == 5
    assert months_between(date(2026, 10, 5), date(2026, 9, 30)) == 0
