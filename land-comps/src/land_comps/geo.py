"""Deterministic distance and acreage-comparison math.

Exact facts like these are computed in code and handed to Jev as state; Jev
is only asked for the semantic judgments code can't make well (PRD section 4).
"""

import math

EARTH_RADIUS_MILES = 3958.7613


def haversine_miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two lat/lon points, in miles."""
    lat1_rad, lon1_rad, lat2_rad, lon2_rad = (
        math.radians(lat1),
        math.radians(lon1),
        math.radians(lat2),
        math.radians(lon2),
    )
    dlat = lat2_rad - lat1_rad
    dlon = lon2_rad - lon1_rad
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(dlon / 2) ** 2
    return EARTH_RADIUS_MILES * 2 * math.asin(math.sqrt(a))


def acreage_ratio(subject_acres: float | None, candidate_acres: float | None) -> float | None:
    """Candidate acreage as a ratio of subject acreage; None if either is missing or zero."""
    if not subject_acres or not candidate_acres:
        return None
    return candidate_acres / subject_acres
