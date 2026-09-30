from datetime import date

import pytest
from pydantic import ValidationError

from land_comps.config import CountyConfig, SearchConfig
from land_comps.gather import GatherResult
from land_comps.guardrails import (
    Criteria,
    ReasonCode,
    filter_candidates,
    run_guardrails,
    widening_plan,
)
from land_comps.models import Candidate, Parcel
from land_comps.sources import SourceError

TODAY = date(2026, 9, 30)
LAT, LON = 39.0, -105.5
MI = 1 / 69.0912  # degrees of latitude per mile
SUBJECT = Parcel(
    apn="0000100000", address="1 Subject Rd", lat=LAT, lon=LON, acreage=10, county_fips="08093"
)
COUNTY = CountyConfig(
    fips="08093",
    apn_length=10,
    sales_file="s",
    parcels_file="p",
    column_mapping={},
    vacant_land_codes=[],
    excluded_deed_types=["QC", "TD"],
)
SEARCH = SearchConfig()


def _cand(source_id: str, **fields: object) -> Candidate:
    base: dict[str, object] = {
        "source": "county_sales",
        "sources": ["county_sales"],
        "source_id": source_id,
        "status": "sold",
        "apn": f"00002{source_id:0>5}",
        "lat": LAT + 0.5 * MI,
        "lon": LON,
        "acreage": 10.0,
        "price": 50000.0,
        "event_date": date(2026, 3, 1),
        "deed_type": "WD",
    }
    return Candidate.model_validate({**base, **fields})


def _filter(candidate: Candidate) -> tuple[list[Candidate], list[ReasonCode]]:
    kept, rejected = filter_candidates(
        SUBJECT, [candidate], Criteria.initial(SEARCH), SEARCH, COUNTY, TODAY
    )
    assert len(kept) + len(rejected) == 1
    return kept, [r for entry in rejected for r in entry.reasons]


def test_good_candidate_is_kept() -> None:
    kept, reasons = _filter(_cand("1"))

    assert len(kept) == 1
    assert reasons == []


@pytest.mark.parametrize(
    ("code", "fields"),
    [
        ("too_far", {"lat": LAT + 1.5 * MI}),
        ("acreage_out_of_band", {"acreage": 40.0}),
        ("acreage_out_of_band", {"acreage": 3.0}),
        ("stale", {"event_date": date(2024, 6, 1)}),
        ("nominal_price", {"price": 500.0}),
        ("excluded_deed_type", {"deed_type": "qc"}),
        ("missing_price", {"price": None}),
        ("is_subject", {"apn": "00-001-00000"}),
    ],
)
def test_each_reason_code_lands_in_rejected(code: ReasonCode, fields: dict[str, object]) -> None:
    kept, reasons = _filter(_cand("1", **fields))

    assert kept == []
    assert reasons == [code]


def test_reason_property_and_multiple_reasons() -> None:
    _, rejected = filter_candidates(
        SUBJECT,
        [_cand("1", price=None, deed_type="TD")],
        Criteria.initial(SEARCH),
        SEARCH,
        COUNTY,
        TODAY,
    )

    assert rejected[0].reasons == ("missing_price", "excluded_deed_type")
    assert rejected[0].reason == "missing_price"


def test_boundaries_are_inclusive() -> None:
    at_radius = _cand("1", lat=LAT + 0.99 * MI)
    at_band = _cand("2", acreage=3.3)
    at_floor = _cand("3", price=1000.0)

    for candidate in (at_radius, at_band, at_floor):
        kept, _ = _filter(candidate)
        assert len(kept) == 1


def test_facts_a_candidate_lacks_do_not_trigger_filters() -> None:
    kept, reasons = _filter(_cand("1", lat=None, lon=None, acreage=None, event_date=None))

    assert len(kept) == 1
    assert reasons == []


def test_subject_without_acreage_skips_acreage_band() -> None:
    subject = SUBJECT.model_copy(update={"acreage": None})
    kept, rejected = filter_candidates(
        subject, [_cand("1", acreage=500.0)], Criteria.initial(SEARCH), SEARCH, COUNTY, TODAY
    )

    assert len(kept) == 1
    assert rejected == []


def test_widening_plan_follows_configured_steps() -> None:
    plan = widening_plan(SEARCH)

    assert [(kind, c.radius_mi) for kind, c in plan if kind == "radius"] == [
        ("radius", 1.5),
        ("radius", 2.25),
        ("radius", 3.375),
        ("radius", 5),
    ]
    kinds = [kind for kind, _ in plan]
    assert kinds == ["radius"] * 4 + ["acreage", "lookback"]
    acreage = plan[4][1]
    assert (acreage.acreage_ratio_min, acreage.acreage_ratio_max) == (0.165, 6.0)
    assert plan[5][1].lookback_months == 36
    assert plan[5][1].radius_mi == 5


def test_widening_plan_steps_lookback_and_skips_finished_dimensions() -> None:
    search = SearchConfig(
        initial_radius_mi=5, lookback_months=12, max_lookback_months=30, lookback_step_months=10
    )

    plan = widening_plan(search)

    assert [(kind, c.lookback_months) for kind, c in plan] == [
        ("acreage", 12),
        ("lookback", 22),
        ("lookback", 30),
    ]


def test_widened_acreage_band_can_be_configured() -> None:
    search = SearchConfig(widened_acreage_ratio_min=0.1, widened_acreage_ratio_max=8)

    assert (search.widened_ratio_min, search.widened_ratio_max) == (0.1, 8)
    with pytest.raises(ValidationError, match="widened_acreage_ratio_min"):
        SearchConfig(widened_acreage_ratio_min=0.5)
    with pytest.raises(ValidationError, match="widened_acreage_ratio_max"):
        SearchConfig(widened_acreage_ratio_max=2)


class _FakeGather:
    """Returns `pool` regardless of window, recording every (radius, months) it was asked for."""

    def __init__(self, pool: list[Candidate], errors: list[SourceError] | None = None) -> None:
        self.pool = pool
        self.errors = errors or []
        self.calls: list[tuple[float, int]] = []

    def __call__(self, radius_mi: float, lookback_months: int) -> GatherResult:
        self.calls.append((radius_mi, lookback_months))
        return GatherResult(list(self.pool), list(self.errors))


def test_widening_stops_at_configured_maximums_and_reports_every_step() -> None:
    fake = _FakeGather([_cand("1")])

    result = run_guardrails(SUBJECT, fake, SEARCH, COUNTY, today=TODAY)

    assert [s.label for s in result.widening_steps] == [
        "radius:1.5mi",
        "radius:2.25mi",
        "radius:3.375mi",
        "radius:5mi",
        "acreage:0.165-6x",
        "lookback:36mo",
    ]
    assert fake.calls[0] == (1, 24)
    assert fake.calls[-1] == (5, 36)
    assert len(fake.calls) == 7
    assert max(radius for radius, _ in fake.calls) == 5
    assert max(months for _, months in fake.calls) == 36
    assert len(result.kept) == 1
    assert result.criteria is not None
    assert result.criteria.radius_mi == 5
    assert result.criteria.lookback_months == 36


def test_widening_stops_as_soon_as_enough_candidates_survive() -> None:
    fake = _FakeGather([_cand("1"), _cand("2", lat=LAT + 1.2 * MI)])

    result = run_guardrails(SUBJECT, fake, SearchConfig(min_candidates=2), COUNTY, today=TODAY)

    assert [s.label for s in result.widening_steps] == ["radius:1.5mi"]
    assert fake.calls == [(1, 24), (1.5, 24)]
    assert len(result.kept) == 2


def test_no_widening_when_initial_pass_has_enough() -> None:
    fake = _FakeGather([_cand("1")])

    result = run_guardrails(SUBJECT, fake, SearchConfig(min_candidates=1), COUNTY, today=TODAY)

    assert result.widening_steps == []
    assert fake.calls == [(1, 24)]
    assert not result.kept[0].widened


def test_candidates_first_admitted_by_widened_pass_carry_flag_and_step() -> None:
    near = _cand("1")
    mid = _cand("2", lat=LAT + 1.2 * MI)  # inside 1.5 mi, outside 1 mi
    big = _cand("3", acreage=40.0)  # ratio 4: outside 0.33-3, inside 0.165-6
    old = _cand("4", event_date=date(2024, 3, 1))  # 30 months old
    fake = _FakeGather([near, mid, big, old])

    result = run_guardrails(SUBJECT, fake, SearchConfig(min_candidates=4), COUNTY, today=TODAY)

    by_id = {c.source_id: c for c in result.kept}
    assert set(by_id) == {"1", "2", "3", "4"}
    assert (by_id["1"].widened, by_id["1"].widen_step) == (False, None)
    assert (by_id["2"].widened, by_id["2"].widen_step) == (True, "radius:1.5mi")
    assert (by_id["3"].widened, by_id["3"].widen_step) == (True, "acreage:0.165-6x")
    assert (by_id["4"].widened, by_id["4"].widen_step) == (True, "lookback:36mo")
    assert [s.survivors for s in result.widening_steps] == [2, 2, 2, 2, 3, 4]


def test_rejected_and_source_errors_come_from_the_run() -> None:
    error = SourceError("landwatch", "timed out")
    fake = _FakeGather([_cand("1"), _cand("2", price=None)], errors=[error])

    result = run_guardrails(SUBJECT, fake, SearchConfig(min_candidates=1), COUNTY, today=TODAY)

    assert [c.source_id for c in result.kept] == ["1"]
    assert [(r.candidate.source_id, r.reason) for r in result.rejected] == [("2", "missing_price")]
    assert result.source_errors == [error]


def test_source_errors_are_not_repeated_across_widening_steps() -> None:
    error = SourceError("landwatch", "timed out")
    fake = _FakeGather([], errors=[error])

    result = run_guardrails(SUBJECT, fake, SEARCH, COUNTY, today=TODAY)

    assert len(fake.calls) == 7
    assert result.source_errors == [error]


def test_duplicates_from_a_regather_are_deduped_before_filtering() -> None:
    same_a = _cand("1", source="county_sales")
    same_b = _cand("2", source="landwatch", sources=["landwatch"], apn=same_a.apn)
    fake = _FakeGather([same_a, same_b])

    result = run_guardrails(SUBJECT, fake, SearchConfig(min_candidates=1), COUNTY, today=TODAY)

    assert len(result.kept) == 1
    assert result.kept[0].sources == ["county_sales", "landwatch"]
