"""Small parsing helpers shared by the Apify listing sources (LandWatch, Realtor.com).

Scraper output is loosely typed: numbers arrive as `"$1,200"` strings, dates as
ISO timestamps or `MM/DD/YYYY`, lists as comma-joined text. These helpers turn
those into the strict types `Candidate` wants, returning `None` for anything
missing or unparseable so callers can decide whether the record is still useful.
"""

import hashlib
import json
import re
from datetime import date, datetime
from typing import Any

from land_comps.geo import haversine_miles

_NUMBER_RE = re.compile(r"-?(?:\d+(?:\.\d+)?|\.\d+)")


def to_float(value: Any) -> float | None:
    """A finite number from an int/float, or the first number in a string like `"$1,200"`."""
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int | float):
        number = float(value)
    elif isinstance(value, str):
        match = _NUMBER_RE.search(value.replace(",", ""))
        if match is None:
            return None
        number = float(match.group())
    else:
        return None
    return number if number == number and abs(number) != float("inf") else None


def to_text(value: Any) -> str | None:
    """A stripped non-empty string, or None."""
    if value is None or isinstance(value, bool):
        return None
    text = str(value).strip()
    return text or None


def to_date(value: Any) -> date | None:
    """A date from an ISO date/datetime string or `MM/DD/YYYY`; else None."""
    text = to_text(value)
    if text is None:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).date()
    except ValueError:
        pass
    try:
        return datetime.strptime(text, "%m/%d/%Y").date()
    except ValueError:
        return None


def to_text_list(value: Any) -> list[str]:
    """A list of non-empty strings from a list or a comma/semicolon-separated string."""
    if isinstance(value, str):
        parts: list[Any] = re.split(r"[,;]", value)
    elif isinstance(value, list):
        parts = value
    else:
        return []
    return [text for part in parts if (text := to_text(part)) is not None]


def positive(value: float | None) -> float | None:
    """`value` if it is greater than zero, else None (zero acres/price means unknown)."""
    return value if value is not None and value > 0 else None


def within_radius(
    subject_lat: float, subject_lon: float, lat: float | None, lon: float | None, radius_mi: float
) -> bool:
    """True when the point is within `radius_mi`, or when it has no GPS to judge by."""
    if lat is None or lon is None:
        return True
    return haversine_miles(subject_lat, subject_lon, lat, lon) <= radius_mi


def fallback_source_id(item: dict[str, Any]) -> str:
    """A stable ID for an item the actor gave no ID or URL: a hash of its contents."""
    blob = json.dumps(item, sort_keys=True, default=str)
    return "h" + hashlib.sha1(blob.encode()).hexdigest()[:16]
