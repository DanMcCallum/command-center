import pytest

from land_comps.geo import acreage_ratio, haversine_miles

# Nashville, TN -> Los Angeles, CA: the standard haversine worked example
# (movable-type.co.uk / Chris Veness), published as 2887.26 km = 1794.06 mi.
NASHVILLE = (36.12, -86.67)
LOS_ANGELES = (33.94, -118.40)
EXPECTED_MILES = 1794.06


def test_haversine_known_pair_within_half_percent() -> None:
    distance = haversine_miles(*NASHVILLE, *LOS_ANGELES)
    assert distance == pytest.approx(EXPECTED_MILES, rel=0.005)


def test_haversine_same_point_is_zero() -> None:
    assert haversine_miles(*NASHVILLE, *NASHVILLE) == pytest.approx(0.0, abs=1e-9)


@pytest.mark.parametrize(
    ("subject", "candidate"),
    [(None, 5.0), (5.0, None), (0, 5.0), (5.0, 0)],
)
def test_acreage_ratio_none_or_zero_input_returns_none(
    subject: float | None, candidate: float | None
) -> None:
    assert acreage_ratio(subject, candidate) is None


def test_acreage_ratio_is_candidate_over_subject() -> None:
    assert acreage_ratio(5.0, 10.0) == pytest.approx(2.0)
