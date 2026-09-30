import pytest

from land_comps.listing_fields import to_float
from land_comps.realtor import _is_vacant_land


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("$1,200.50", 1200.5),
        ("Approx. 12 acres", 12.0),
        ("Est. $50,000", 50000.0),
        ("12 acres, 3 tracts", 12.0),
        ("12.5 ac.", 12.5),
        ("-79.5", -79.5),
        ("n/a", None),
        (True, None),
    ],
)
def test_to_float_takes_the_first_number(raw: object, expected: float | None) -> None:
    assert to_float(raw) == expected


def test_realtor_land_lot_label_counts_as_land() -> None:
    assert _is_vacant_land({"property_type": "Land/Lot"})
