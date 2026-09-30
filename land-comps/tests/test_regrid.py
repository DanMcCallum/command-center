import json
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest

from land_comps.db import init_db
from land_comps.regrid import QuotaExceeded, RegridClient, RegridError

FIXTURES = Path(__file__).parent / "fixtures" / "regrid"
FIPS = "08093"


class FakeRegrid:
    """httpx transport that replays fixture JSON and records every request."""

    def __init__(self, fixture: str = "parcel_by_apn.json", status: int = 200) -> None:
        self.body = (FIXTURES / fixture).read_text()
        self.status = status
        self.requests: list[httpx.Request] = []

    def transport(self) -> httpx.MockTransport:
        def handler(request: httpx.Request) -> httpx.Response:
            self.requests.append(request)
            return httpx.Response(self.status, content=self.body)

        return httpx.MockTransport(handler)


def _client(
    tmp_path: Path, fake: FakeRegrid, cap: int = 100, month: int = 9
) -> tuple[RegridClient, FakeRegrid]:
    conn = init_db(tmp_path / "t.sqlite")
    client = RegridClient(
        "tok",
        conn,
        cap,
        transport=fake.transport(),
        clock=lambda: datetime(2026, month, 15, tzinfo=UTC),
    )
    return client, fake


def test_by_apn_parses_fixture(tmp_path: Path) -> None:
    client, fake = _client(tmp_path, FakeRegrid())

    parcel = client.by_apn("0034567890", FIPS)

    assert parcel is not None
    assert parcel.apn == "0034567890"
    assert parcel.address == "1234 County Road 18"
    assert parcel.acreage == pytest.approx(4.87)
    assert parcel.zoning == "A-1"
    assert parcel.land_use == "Vacant Land"
    assert parcel.lat == pytest.approx(39.222615)
    assert parcel.lon == pytest.approx(-105.991278)
    assert parcel.zip == "80440"
    assert parcel.county_fips == FIPS
    request = fake.requests[0]
    assert request.url.path == "/api/v2/parcels/apn"
    assert request.url.params["parcelnumb"] == "0034567890"
    assert request.url.params["token"] == "tok"


def test_second_identical_lookup_is_served_from_cache(tmp_path: Path) -> None:
    client, fake = _client(tmp_path, FakeRegrid())

    first = client.by_apn("0034567890", FIPS)
    second = client.by_apn("0034567890", FIPS)

    assert first == second
    assert len(fake.requests) == 1
    assert client.records_used() == 1


def test_cache_persists_across_client_instances(tmp_path: Path) -> None:
    client, fake = _client(tmp_path, FakeRegrid())
    client.by_address("1234 County Road 18")
    conn = init_db(tmp_path / "t.sqlite")
    other = RegridClient("tok", conn, 100, transport=fake.transport())

    assert other.by_address("1234 COUNTY ROAD 18.") is not None
    assert len(fake.requests) == 1


def test_by_address_and_by_point(tmp_path: Path) -> None:
    client, fake = _client(tmp_path, FakeRegrid())

    by_address = client.by_address("1234 County Rd")
    by_point = client.by_point(39.222615, -105.991278)

    assert by_address is not None and by_point is not None
    assert [r.url.path for r in fake.requests] == [
        "/api/v2/parcels/address",
        "/api/v2/parcels/point",
    ]
    assert fake.requests[0].url.params["query"] == "1234 County Rd"
    assert fake.requests[1].url.params["lat"] == "39.222615"


def test_no_match_returns_none_and_is_cached(tmp_path: Path) -> None:
    client, fake = _client(tmp_path, FakeRegrid("no_match.json"))

    assert client.by_apn("0000000000", FIPS) is None
    assert client.by_apn("0000000000", FIPS) is None
    assert len(fake.requests) == 1
    assert client.records_used() == 0


def test_by_apn_ignores_parcel_in_other_county(tmp_path: Path) -> None:
    client, _ = _client(tmp_path, FakeRegrid())

    assert client.by_apn("0034567890", "08001") is None


def test_exceeding_monthly_cap_raises_quota_exceeded(tmp_path: Path) -> None:
    client, fake = _client(tmp_path, FakeRegrid(), cap=2)

    client.by_apn("0000000001", FIPS)
    client.by_apn("0000000002", FIPS)
    with pytest.raises(QuotaExceeded):
        client.by_apn("0000000003", FIPS)

    assert len(fake.requests) == 2
    # Cached lookups stay free once the cap is hit.
    assert client.by_apn("0000000001", FIPS) is not None


def test_quota_resets_in_a_new_month(tmp_path: Path) -> None:
    client, fake = _client(tmp_path, FakeRegrid(), cap=1)
    client.by_apn("0000000001", FIPS)
    with pytest.raises(QuotaExceeded):
        client.by_apn("0000000002", FIPS)

    conn = init_db(tmp_path / "t.sqlite")
    october = RegridClient(
        "tok",
        conn,
        1,
        transport=fake.transport(),
        clock=lambda: datetime(2026, 10, 1, tzinfo=UTC),
    )
    assert october.by_apn("0000000002", FIPS) is not None


@pytest.mark.parametrize("status", [401, 403, 500])
def test_http_errors_raise_regrid_error(tmp_path: Path, status: int) -> None:
    client, _ = _client(tmp_path, FakeRegrid(status=status))

    with pytest.raises(RegridError):
        client.by_apn("0034567890", FIPS)
    assert client.records_used() == 0


def test_malformed_response_raises_regrid_error(tmp_path: Path) -> None:
    fake = FakeRegrid()
    fake.body = json.dumps({"unexpected": True})
    client, _ = _client(tmp_path, fake)

    with pytest.raises(RegridError):
        client.by_apn("0034567890", FIPS)
