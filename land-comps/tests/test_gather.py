import logging
import sqlite3
import threading
from pathlib import Path

import pytest

from land_comps.config import Settings, load_settings
from land_comps.db import init_db
from land_comps.gather import NamedSource, build_sources, gather
from land_comps.models import Candidate, Parcel
from land_comps.sources import SourceError

SUBJECT = Parcel(apn="1", lat=39.0, lon=-105.5, acreage=5, county_fips="08093")
EXAMPLE_CONFIG = Path(__file__).parent.parent / "config.example.yaml"


def _candidate(source: str, source_id: str) -> Candidate:
    return Candidate(
        source=source, sources=[source], source_id=source_id, status="active", price=1000.0
    )


def _good(name: str, count: int) -> NamedSource:
    return NamedSource(
        name,
        lambda subject, radius, months: [_candidate(name, str(i)) for i in range(count)],
    )


def _failing(name: str, exc: Exception) -> NamedSource:
    def fetch(subject: Parcel, radius: float, months: int) -> list[Candidate]:
        raise exc

    return NamedSource(name, fetch)


def test_failing_source_is_recorded_and_good_source_still_returns() -> None:
    result = gather(
        SUBJECT,
        1,
        24,
        [_failing("landwatch", SourceError("actor/lw", "timed out")), _good("county_sales", 2)],
    )

    assert [c.source for c in result.candidates] == ["county_sales", "county_sales"]
    assert len(result.source_errors) == 1
    assert result.source_errors[0].source == "actor/lw"
    assert result.source_errors[0].reason == "timed out"
    assert result.counts == {"county_sales": 2}


def test_unexpected_exception_is_isolated_as_a_source_error() -> None:
    result = gather(SUBJECT, 1, 24, [_failing("realtor", KeyError("boom")), _good("landwatch", 1)])

    assert len(result.candidates) == 1
    assert [e.source for e in result.source_errors] == ["realtor"]
    assert "KeyError" in result.source_errors[0].reason


def test_candidates_keep_source_order_and_receive_the_search_arguments() -> None:
    seen: list[tuple[float, int]] = []

    def slow_first(subject: Parcel, radius: float, months: int) -> list[Candidate]:
        seen.append((radius, months))
        return [_candidate("a", "1")]

    result = gather(SUBJECT, 2.5, 36, [NamedSource("a", slow_first), _good("b", 1)])

    assert [c.source for c in result.candidates] == ["a", "b"]
    assert seen == [(2.5, 36)]


def test_sources_run_concurrently() -> None:
    barrier = threading.Barrier(2, timeout=5)

    def fetch(subject: Parcel, radius: float, months: int) -> list[Candidate]:
        try:
            barrier.wait()  # only passes if both sources are in flight at once
        except threading.BrokenBarrierError as exc:
            raise SourceError("x", "sources ran sequentially") from exc
        return [_candidate("x", "1")]

    result = gather(SUBJECT, 1, 24, [NamedSource("a", fetch), NamedSource("b", fetch)])

    assert result.source_errors == []
    assert len(result.candidates) == 2


def test_per_source_counts_are_logged(caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.INFO, logger="land_comps.gather"):
        gather(SUBJECT, 1, 24, [_good("county_sales", 3), _good("landwatch", 0)])

    messages = [r.getMessage() for r in caplog.records]
    assert "source county_sales returned 3 candidates" in messages
    assert "source landwatch returned 0 candidates" in messages


def test_no_sources_gives_empty_result() -> None:
    result = gather(SUBJECT, 1, 24, [])
    assert result.candidates == []
    assert result.source_errors == []


@pytest.fixture
def settings(monkeypatch: pytest.MonkeyPatch) -> Settings:
    monkeypatch.delenv("APIFY_TOKEN", raising=False)
    return load_settings(EXAMPLE_CONFIG)


def test_build_sources_without_apify_token_reports_listing_sources_as_errors(
    tmp_path: Path, settings: Settings
) -> None:
    conn: sqlite3.Connection = init_db(tmp_path / "t.sqlite")
    settings.secrets.apify_token = None

    result = gather(SUBJECT, 1, 24, build_sources(settings, conn))

    assert result.counts == {"county_sales": 0}
    assert sorted(e.source for e in result.source_errors) == ["landwatch", "realtor"]


def test_build_sources_with_token_returns_all_three_sources(
    tmp_path: Path, settings: Settings
) -> None:
    conn = init_db(tmp_path / "t.sqlite")
    settings.secrets.apify_token = "token"

    names = [s.name for s in build_sources(settings, conn)]

    assert names == ["county_sales", "landwatch", "realtor"]
