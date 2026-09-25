"""Shared domain models: parcels, candidates, and Jev-scored comp results.

These are the data contract every pipeline stage (resolve, gather, dedupe,
guardrails, score) passes between each other and persists to SQLite.
"""

from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, Field


class Parcel(BaseModel):
    """A resolved parcel (subject or a candidate's underlying parcel), from Regrid."""

    apn: str
    address: str | None = None
    lat: float
    lon: float
    acreage: float | None = None
    zoning: str | None = None
    land_use: str | None = None
    county_fips: str
    zip: str | None = None


class Candidate(BaseModel):
    """A normalized comp candidate from one or more sources, pre- or post-dedup."""

    source: str
    sources: list[str] = Field(default_factory=list)
    source_id: str
    status: Literal["sold", "active", "pending"]
    apn: str | None = None
    address: str | None = None
    lat: float | None = None
    lon: float | None = None
    acreage: float | None = None
    price: float | None = None
    list_price: float | None = None
    sold_price: float | None = None
    price_per_acre: float | None = None
    event_date: date | None = None
    deed_type: str | None = None
    road_access: str | None = None
    utilities: list[str] = Field(default_factory=list)
    topography: str | None = None
    description: str | None = None
    url: str | None = None
    raw: dict[str, Any] = Field(default_factory=dict)


class NoulAnswer(BaseModel):
    """A calibrated true/false judgment from Jev (e.g. `is_good_comp`, `arms_length`)."""

    probability: float = Field(ge=0, le=1)
    confidence: float = Field(ge=0, le=1)


class ScoreAnswer(BaseModel):
    """A 4-level (0-3) similarity judgment from Jev, with the level definitions it saw."""

    score: int = Field(ge=0, le=3)
    confidence: float = Field(ge=0, le=1)
    legend: dict[int, str] = Field(default_factory=dict)


class ChoiceAnswer(BaseModel):
    """The `quality_tier` judgment: one of the four tiers, with its own probability."""

    choice: Literal["excellent", "good", "marginal", "reject"]
    probability: float = Field(ge=0, le=1)
    confidence: float = Field(ge=0, le=1)


class JevAnswers(BaseModel):
    """The 7 typed Jev judgments for one (subject, candidate) pair (PRD section 5)."""

    is_good_comp: NoulAnswer
    arms_length: NoulAnswer
    physical_similarity: ScoreAnswer
    access_utilities_similarity: ScoreAnswer
    market_similarity: ScoreAnswer
    red_flags: NoulAnswer
    quality_tier: ChoiceAnswer


class CompResult(BaseModel):
    """The scored outcome for one candidate: `score()`'s composite, tier, and gates."""

    composite: float
    tier: Literal["excellent", "good", "marginal", "reject"]
    gates_triggered: list[str] = Field(default_factory=list)
    answers: JevAnswers
