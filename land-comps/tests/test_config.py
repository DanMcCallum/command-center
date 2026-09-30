from pathlib import Path

import pytest
from pydantic import ValidationError

from land_comps.config import load_settings

EXAMPLE_CONFIG = Path(__file__).parent.parent / "config.example.yaml"


def test_loads_example_config_with_documented_defaults() -> None:
    settings = load_settings(EXAMPLE_CONFIG)

    assert settings.search.initial_radius_mi == 1
    assert settings.search.max_radius_mi == 5
    assert settings.search.acreage_ratio_min == 0.33
    assert settings.search.acreage_ratio_max == 3.0
    assert settings.search.lookback_months == 24
    assert settings.search.max_lookback_months == 36
    assert settings.search.lookback_step_months == 12
    assert settings.search.widened_ratio_min == 0.165
    assert settings.search.widened_ratio_max == 6.0
    assert settings.search.min_candidates == 8
    assert settings.search.nominal_price_floor == 1000

    assert settings.scoring.red_flag_policy == "warn"
    assert settings.scoring.arms_length_min == 0.5
    assert settings.scoring.red_flags_max == 0.7

    assert settings.apify.cache_ttl_days == 7

    assert settings.county.fips == "08093"
    assert isinstance(settings.county.fips, str)

    assert settings.regrid.monthly_record_cap == 2000


def test_invalid_acreage_ratio_raises_validation_error(tmp_path: Path) -> None:
    text = EXAMPLE_CONFIG.read_text().replace("acreage_ratio_min: 0.33", "acreage_ratio_min: 5")
    bad_config = tmp_path / "config.yaml"
    bad_config.write_text(text)

    with pytest.raises(ValidationError) as exc_info:
        load_settings(bad_config)

    message = str(exc_info.value)
    assert "acreage_ratio_min" in message
    assert "acreage_ratio_max" in message


def test_max_radius_above_hard_ceiling_rejected(tmp_path: Path) -> None:
    text = EXAMPLE_CONFIG.read_text().replace("max_radius_mi: 5", "max_radius_mi: 6")
    bad_config = tmp_path / "config.yaml"
    bad_config.write_text(text)

    with pytest.raises(ValidationError) as exc_info:
        load_settings(bad_config)

    assert "max_radius_mi" in str(exc_info.value)


def test_invalid_red_flag_policy_rejected(tmp_path: Path) -> None:
    text = EXAMPLE_CONFIG.read_text().replace("red_flag_policy: warn", "red_flag_policy: ignore")
    bad_config = tmp_path / "config.yaml"
    bad_config.write_text(text)

    with pytest.raises(ValidationError) as exc_info:
        load_settings(bad_config)

    assert "red_flag_policy" in str(exc_info.value)


def test_missing_config_file_raises() -> None:
    with pytest.raises(FileNotFoundError):
        load_settings("does-not-exist.yaml")


def test_secrets_are_optional_without_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.chdir(tmp_path)  # an operator's real land-comps/.env must not leak in
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    monkeypatch.delenv("APIFY_TOKEN", raising=False)
    monkeypatch.delenv("REGRID_TOKEN", raising=False)

    settings = load_settings(EXAMPLE_CONFIG)

    assert settings.secrets.typesafe_api_key is None
    assert settings.secrets.apify_token is None
    assert settings.secrets.regrid_token is None


def test_secrets_loaded_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TYPESAFE_API_KEY", "test-key")

    settings = load_settings(EXAMPLE_CONFIG)

    assert settings.secrets.typesafe_api_key == "test-key"
