from pathlib import Path

import pytest
from typer.testing import CliRunner, Result

from land_comps import cli
from land_comps.models import Parcel
from land_comps.regrid import QuotaExceeded

runner = CliRunner()
EXAMPLE_CONFIG = Path(__file__).parent.parent / "config.example.yaml"

PARCEL = Parcel(
    apn="0034567890",
    address="1234 County Road 18",
    lat=39.222615,
    lon=-105.991278,
    acreage=4.87,
    zoning="A-1",
    land_use="Vacant Land",
    county_fips="08093",
    zip="80440",
)


class FakeLookup:
    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[object, ...]]] = []

    def by_apn(self, apn: str, county_fips: str) -> Parcel | None:
        self.calls.append(("apn", (apn, county_fips)))
        return PARCEL if apn == PARCEL.apn else None

    def by_address(self, address: str) -> Parcel | None:
        self.calls.append(("address", (address,)))
        return PARCEL if "county road 18" in address.lower() else None

    def by_point(self, lat: float, lon: float) -> Parcel | None:
        raise AssertionError("subject must not use by_point")


@pytest.fixture
def fake(monkeypatch: pytest.MonkeyPatch) -> FakeLookup:
    lookup = FakeLookup()
    monkeypatch.setattr(cli, "regrid_client_factory", lambda s, c: lookup)
    return lookup


def _invoke(tmp_path: Path, target: str) -> Result:
    return runner.invoke(
        cli.app,
        ["subject", target, "--config", str(EXAMPLE_CONFIG), "--db", str(tmp_path / "x.sqlite")],
    )


def test_apn_input_prints_parcel_table(tmp_path: Path, fake: FakeLookup) -> None:
    result = _invoke(tmp_path, "34567890")

    assert result.exit_code == 0
    out = result.output
    for expected in ("0034567890", "1234 County Road 18", "4.87", "A-1", "Vacant Land", "80440"):
        assert expected in out
    assert "39.222615" in out and "-105.991278" in out
    assert fake.calls == [("apn", ("0034567890", "08093"))]


def test_address_input_uses_address_lookup(tmp_path: Path, fake: FakeLookup) -> None:
    result = _invoke(tmp_path, "1234 County Road 18, Fairplay CO")

    assert result.exit_code == 0
    assert "0034567890" in result.output
    assert fake.calls == [("address", ("1234 County Road 18, Fairplay CO",))]


def test_unknown_input_exits_2_with_message(tmp_path: Path, fake: FakeLookup) -> None:
    result = _invoke(tmp_path, "99999999")

    assert result.exit_code == 2
    assert "No parcel found" in result.output


def test_quota_exceeded_exits_1_with_message(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    class Exhausted(FakeLookup):
        def by_apn(self, apn: str, county_fips: str) -> Parcel | None:
            raise QuotaExceeded("cap reached (2000/2000)")

    monkeypatch.setattr(cli, "regrid_client_factory", lambda s, c: Exhausted())
    result = _invoke(tmp_path, "34567890")

    assert result.exit_code == 1
    assert "cap reached" in result.output


def test_missing_config_exits_1(tmp_path: Path) -> None:
    result = runner.invoke(
        cli.app,
        [
            "subject",
            "34567890",
            "--config",
            str(tmp_path / "nope.yaml"),
            "--db",
            str(tmp_path / "x"),
        ],
    )

    assert result.exit_code == 1
    assert "Config error" in result.output


def test_default_factory_requires_token(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("REGRID_TOKEN", raising=False)
    monkeypatch.chdir(tmp_path)  # no .env here
    result = _invoke(tmp_path, "34567890")

    assert result.exit_code == 1
    assert "REGRID_TOKEN" in result.output
