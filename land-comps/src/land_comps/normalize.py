"""Deterministic normalization for APNs and street addresses.

Used at dedup time (matching the same parcel across sources) and at subject
resolution time (deciding whether user input is an APN or an address).
"""

import re

_SUFFIX_MAP = {
    "STREET": "ST",
    "ROAD": "RD",
    "DRIVE": "DR",
    "LANE": "LN",
    "AVENUE": "AVE",
    "AV": "AVE",
    "COURT": "CT",
}

_UNIT_MAP = {
    "APARTMENT": "UNIT",
    "APT": "UNIT",
    "SUITE": "UNIT",
    "STE": "UNIT",
    "UNIT": "UNIT",
}

_PUNCTUATION_RE = re.compile(r"[.,]")
_APN_STRIP_RE = re.compile(r"[^0-9A-Za-z]")
_ADDRESS_WORD_RE = re.compile(r"[A-Za-z]{3,}")


def normalize_apn(raw: str, county_fips: str, apn_length: int) -> str:
    """Strip punctuation/whitespace and zero-pad to `apn_length`.

    `apn_length` is the county's APN digit count, typically read from
    `Settings.county.apn_length`; callers pass it explicitly rather than
    loading config here so this stays a pure, deterministic helper.
    `county_fips` is threaded through for future multi-county support, where
    normalization rules may differ per county.
    """
    _ = county_fips  # unused today; single-county MVP, reserved for later
    digits = _APN_STRIP_RE.sub("", raw).upper()
    return digits.zfill(apn_length)


def normalize_address(raw: str) -> str:
    """Uppercase, collapse whitespace, and standardize suffixes and unit markers."""
    text = raw.upper().replace("#", " UNIT ")
    text = _PUNCTUATION_RE.sub("", text)
    tokens = text.split()
    normalized_tokens = [_SUFFIX_MAP.get(t, _UNIT_MAP.get(t, t)) for t in tokens]
    return " ".join(normalized_tokens)


def looks_like_apn(text: str) -> bool:
    """True for a compact numeric/dashed identifier; false for a street address.

    Street addresses always contain a 3+ letter word (a street name or a
    suffix like AVE/RD); APNs are digits (optionally with a short letter
    prefix/suffix, e.g. county-format "AB-12-34") with only dashes, dots,
    or spaces as separators.
    """
    stripped = text.strip()
    if not stripped or _ADDRESS_WORD_RE.search(stripped):
        return False
    return bool(re.fullmatch(r"[0-9A-Za-z][0-9A-Za-z\-. ]*", stripped)) and any(
        c.isdigit() for c in stripped
    )
