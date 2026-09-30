"""Load `config.yaml` into a validated `Settings` model.

Thresholds, weights, and county/actor settings come from the YAML file;
secrets come from the environment (optionally via a `.env` file) so tests
can run without API keys.
"""

from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class SearchConfig(BaseModel):
    initial_radius_mi: float = Field(default=1, gt=0)
    max_radius_mi: float = Field(default=5, gt=0, le=5)
    acreage_ratio_min: float = Field(default=0.33, gt=0)
    acreage_ratio_max: float = Field(default=3.0, gt=0)
    lookback_months: int = Field(default=24, gt=0)
    max_lookback_months: int = Field(default=36, gt=0)
    lookback_step_months: int = Field(default=12, gt=0)
    widened_acreage_ratio_min: float | None = Field(default=None, gt=0)
    widened_acreage_ratio_max: float | None = Field(default=None, gt=0)
    min_candidates: int = Field(default=8, ge=0)
    nominal_price_floor: float = Field(default=1000, ge=0)

    @model_validator(mode="after")
    def _check_ranges(self) -> "SearchConfig":
        errors: list[str] = []
        if self.acreage_ratio_min > self.acreage_ratio_max:
            errors.append(
                f"search.acreage_ratio_min ({self.acreage_ratio_min}) must be <= "
                f"search.acreage_ratio_max ({self.acreage_ratio_max})"
            )
        if self.initial_radius_mi > self.max_radius_mi:
            errors.append(
                f"search.initial_radius_mi ({self.initial_radius_mi}) must be <= "
                f"search.max_radius_mi ({self.max_radius_mi})"
            )
        if self.lookback_months > self.max_lookback_months:
            errors.append(
                f"search.lookback_months ({self.lookback_months}) must be <= "
                f"search.max_lookback_months ({self.max_lookback_months})"
            )
        if self.widened_ratio_min > self.acreage_ratio_min:
            errors.append(
                f"search.widened_acreage_ratio_min ({self.widened_ratio_min}) must be <= "
                f"search.acreage_ratio_min ({self.acreage_ratio_min})"
            )
        if self.widened_ratio_max < self.acreage_ratio_max:
            errors.append(
                f"search.widened_acreage_ratio_max ({self.widened_ratio_max}) must be >= "
                f"search.acreage_ratio_max ({self.acreage_ratio_max})"
            )
        if errors:
            raise ValueError("; ".join(errors))
        return self

    @property
    def widened_ratio_min(self) -> float:
        """Lower acreage ratio once the band is widened: configured, else half the normal min."""
        if self.widened_acreage_ratio_min is not None:
            return self.widened_acreage_ratio_min
        return self.acreage_ratio_min / 2

    @property
    def widened_ratio_max(self) -> float:
        """Upper acreage ratio once the band is widened: configured, else double the normal max."""
        if self.widened_acreage_ratio_max is not None:
            return self.widened_acreage_ratio_max
        return self.acreage_ratio_max * 2


class TierFloors(BaseModel):
    excellent: float = Field(default=0.85, ge=0, le=1)
    good: float = Field(default=0.65, ge=0, le=1)
    marginal: float = Field(default=0.40, ge=0, le=1)

    @model_validator(mode="after")
    def _check_order(self) -> "TierFloors":
        if not (self.excellent >= self.good >= self.marginal):
            raise ValueError(
                f"scoring.tier_floors must satisfy excellent ({self.excellent}) >= "
                f"good ({self.good}) >= marginal ({self.marginal})"
            )
        return self


class ScoringConfig(BaseModel):
    w1: float = 0.30
    w2: float = 0.15
    w3: float = 0.15
    w4: float = 0.15
    w5: float = 0.10
    w6: float = 0.10
    w7: float = 0.05
    tier_floors: TierFloors = Field(default_factory=TierFloors)
    min_confidence: float = Field(default=0.5, ge=0, le=1)
    red_flag_policy: Literal["warn", "reject"] = "warn"


class ApifyConfig(BaseModel):
    landwatch_actor_id: str
    realtor_actor_id: str
    max_items: int = Field(default=500, gt=0)
    cache_ttl_days: int = Field(default=7, ge=0)
    run_timeout_secs: int = Field(default=300, gt=0)


class CountyConfig(BaseModel):
    fips: str
    apn_length: int = Field(gt=0)
    sales_file: str
    parcels_file: str
    centroids_file: str | None = None
    column_mapping: dict[str, str]
    vacant_land_codes: list[str]
    excluded_deed_types: list[str]

    @field_validator("fips")
    @classmethod
    def _fips_is_numeric_string(cls, value: str) -> str:
        if not value.isdigit():
            raise ValueError(f"county.fips must be a numeric string, got {value!r}")
        return value


class RegridConfig(BaseModel):
    monthly_record_cap: int = Field(default=2000, gt=0)


class Secrets(BaseSettings):
    """Loaded from the environment, falling back to a `.env` file (see `.env.example`)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    typesafe_api_key: str | None = None
    apify_token: str | None = None
    regrid_token: str | None = None


class Settings(BaseModel):
    search: SearchConfig = Field(default_factory=SearchConfig)
    scoring: ScoringConfig = Field(default_factory=ScoringConfig)
    apify: ApifyConfig
    county: CountyConfig
    regrid: RegridConfig = Field(default_factory=RegridConfig)
    secrets: Secrets = Field(default_factory=Secrets)


def load_settings(path: str | Path = "config.yaml") -> Settings:
    """Load and validate settings from a YAML file; secrets come from the environment."""
    config_path = Path(path)
    if not config_path.exists():
        raise FileNotFoundError(f"Config file not found: {config_path}")

    raw = yaml.safe_load(config_path.read_text())
    if not isinstance(raw, dict):
        raise ValueError(
            f"Config file {config_path} must contain a YAML mapping, got {type(raw).__name__}"
        )

    return Settings.model_validate(raw)
