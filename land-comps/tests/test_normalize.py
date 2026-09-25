import pytest

from land_comps.normalize import looks_like_apn, normalize_address, normalize_apn

APN_LENGTH = 10  # placeholder Park County length from config.example.yaml


@pytest.mark.parametrize(
    ("dashed", "undashed"),
    [
        ("123-456-789", "123456789"),
        ("12.34.56.78", "12345678"),
        ("AB-12-34", "AB1234"),
    ],
)
def test_normalize_apn_dashed_and_undashed_match(dashed: str, undashed: str) -> None:
    assert normalize_apn(dashed, "08093", APN_LENGTH) == normalize_apn(
        undashed, "08093", APN_LENGTH
    )


def test_normalize_apn_zero_pads_to_configured_length() -> None:
    assert normalize_apn("789", "08093", APN_LENGTH) == "0000000789"


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("123 Main Street", "123 MAIN ST"),
        ("123 main st.", "123 MAIN ST"),
        ("123   Main    St", "123 MAIN ST"),
        ("123 Main St Apt 4", "123 MAIN ST UNIT 4"),
        ("123 Main St #4", "123 MAIN ST UNIT 4"),
    ],
)
def test_normalize_address_variants(raw: str, expected: str) -> None:
    assert normalize_address(raw) == expected


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("123-456-789", True),
        ("123456789", True),
        ("12.34.56.78", True),
        ("123 Main St", False),
        ("456 Elk Ridge Rd", False),
    ],
)
def test_looks_like_apn(text: str, expected: bool) -> None:
    assert looks_like_apn(text) is expected
