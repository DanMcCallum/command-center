import sqlite3
from pathlib import Path
from typing import Any

import pytest

from land_comps.config import Settings, load_settings
from land_comps.db import init_db
from land_comps.gather import NamedSource
from land_comps.jev import JevUnavailableError, JudgedAnswers
from land_comps.models import Candidate, JevAnswers, Parcel
from land_comps.pipeline import (
    FindClients,
    InvalidRadiusError,
    SubjectNotFoundError,
    effective_search,
    run_find,
)

EXAMPLE_CONFIG = Path(__file__).parent.parent / "config.example.yaml"
SUBJECT = Parcel(apn="0034567890", lat=39.0, lon=-105.5, acreage=5.0, county_fips="08093")
ANSWERS = JevAnswers.model_validate(
    {
        "is_good_comp": {"probability": 0.9, "confidence": 0.8},
        "arms_length": {"probability": 0.9, "confidence": 0.8},
        "physical_similarity": {"score": 2.0, "confidence": 0.8},
        "access_utilities_similarity": {"score": 2.0, "confidence": 0.8},
        "market_similarity": {"score": 2.0, "confidence": 0.8},
        "red_flags": {"probability": 0.1, "confidence": 0.8},
        "quality_tier": {"choice": "good", "probability": 0.7, "confidence": 0.8},
    }
)


@pytest.fixture
def settings() -> Settings:
    return load_settings(EXAMPLE_CONFIG)


@pytest.fixture
def conn(tmp_path: Path) -> sqlite3.Connection:
    return init_db(tmp_path / "t.sqlite")


class MeteredRegrid:
    """A lookup that reports monthly usage, like `RegridClient`; each subject lookup bills 1."""

    def __init__(self, used: int) -> None:
        self.used = used

    def records_used(self) -> int:
        return self.used

    def by_apn(self, apn: str, county_fips: str) -> Parcel | None:
        self.used += 1
        return SUBJECT

    def by_address(self, address: str) -> Parcel | None:
        return None

    def by_point(self, lat: float, lon: float) -> Parcel | None:
        return None


class Judge:
    def __init__(self, cached: bool, tokens: int | None) -> None:
        self.cached, self.tokens = cached, tokens

    def judge_many(
        self, states: list[dict[str, Any]], concurrency: int = 8
    ) -> list[JudgedAnswers | JevUnavailableError]:
        return [JudgedAnswers(ANSWERS, self.tokens, self.cached) for _ in states]


def _candidate(i: int) -> Candidate:
    return Candidate(
        source="county_sales",
        sources=["county_sales"],
        source_id=str(i),
        status="sold",
        apn=f"00345678{i:02d}",
        lat=39.001,
        lon=-105.5,
        acreage=5.0,
        price=40000.0,
    )


def _clients(regrid: MeteredRegrid, judge: Judge, items: list[int]) -> FindClients:
    def fetch(subject: Parcel, radius: float, months: int) -> list[Candidate]:
        items[0] += 7  # pretend the source pulled 7 Apify items on this pass
        return [_candidate(i) for i in range(3)]

    return FindClients(
        regrid=regrid,
        sources=[NamedSource("county_sales", fetch)],
        judge=judge,
        apify_items_fetched=lambda: items[0],
    )


def test_cost_reports_jev_tokens_apify_items_and_regrid_delta(
    settings: Settings, conn: sqlite3.Connection
) -> None:
    settings.search.min_candidates = 3
    clients = _clients(MeteredRegrid(used=120), Judge(cached=False, tokens=2000), [50])

    report = run_find("34567890", settings, conn, clients)

    cost = report.summary.cost
    assert cost.jev_input_tokens == 6000  # 3 candidates x 2,000
    assert cost.jev_usd == pytest.approx(6000 * 0.042 / 1_000_000)
    assert cost.apify_items == 7  # only this run's items, not the 50 already counted
    assert cost.regrid_records == 1  # the delta of the monthly counter, not 121


def test_cached_jev_answers_cost_nothing(settings: Settings, conn: sqlite3.Connection) -> None:
    settings.search.min_candidates = 3
    clients = _clients(MeteredRegrid(0), Judge(cached=True, tokens=2000), [0])

    report = run_find("34567890", settings, conn, clients)

    assert report.summary.cost.jev_input_tokens == 0
    assert report.summary.counts.judged == 3


def test_unknown_subject_raises_and_saves_no_run(
    settings: Settings, conn: sqlite3.Connection
) -> None:
    clients = _clients(MeteredRegrid(0), Judge(False, 1), [0])

    with pytest.raises(SubjectNotFoundError):
        run_find("12 Nowhere Ln", settings, conn, clients)

    assert conn.execute("SELECT COUNT(*) FROM runs").fetchone()[0] == 0


def test_effective_search_applies_radius_as_initial_radius(settings: Settings) -> None:
    narrowed = effective_search(settings, 2.5)

    assert narrowed.search.initial_radius_mi == 2.5
    assert narrowed.search.max_radius_mi == 5  # the ceiling is untouched
    assert settings.search.initial_radius_mi == 1  # the caller's settings are not mutated
    assert effective_search(settings, None) is settings


@pytest.mark.parametrize("radius", [5.01, 6.0, 100.0, 0.0, -1.0, float("nan"), float("inf")])
def test_effective_search_rejects_bad_radius(settings: Settings, radius: float) -> None:
    with pytest.raises(InvalidRadiusError):
        effective_search(settings, radius)


def test_radius_ceiling_follows_a_lower_configured_maximum(settings: Settings) -> None:
    settings.search.max_radius_mi = 3

    with pytest.raises(InvalidRadiusError, match="3 mi"):
        effective_search(settings, 4)
