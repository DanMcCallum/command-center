from datetime import date
from typing import Any

import pytest

from land_comps.config import ApifyConfig, CountyConfig, Settings
from land_comps.models import Candidate, CompResult, JevAnswers, Parcel
from land_comps.scoring import (
    Features,
    ScoredComp,
    Tier,
    compute_features,
    rank,
    score,
)

TODAY = date(2026, 9, 30)
SUBJECT = Parcel(apn="1", lat=39.0, lon=-105.5, acreage=10, county_fips="08093")


def _settings(**scoring: Any) -> Settings:
    return Settings.model_validate(
        {
            "apify": ApifyConfig(landwatch_actor_id="a", realtor_actor_id="b"),
            "county": CountyConfig(
                fips="08093",
                apn_length=10,
                sales_file="s",
                parcels_file="p",
                column_mapping={},
                vacant_land_codes=[],
                excluded_deed_types=[],
            ),
            "scoring": scoring,
        }
    )


def _answers(
    *,
    good: float = 1.0,
    arms: float = 1.0,
    level: float = 3.0,
    red: float = 0.0,
    choice: str = "excellent",
    tier_conf: float = 0.9,
) -> JevAnswers:
    def score_answer() -> dict[str, Any]:
        return {"score": level, "confidence": 0.9}

    return JevAnswers.model_validate(
        {
            "is_good_comp": {"probability": good, "confidence": 0.9},
            "arms_length": {"probability": arms, "confidence": 0.9},
            "physical_similarity": score_answer(),
            "access_utilities_similarity": score_answer(),
            "market_similarity": score_answer(),
            "red_flags": {"probability": red, "confidence": 0.9},
            "quality_tier": {"choice": choice, "probability": 0.8, "confidence": tier_conf},
        }
    )


def _cand(status: str = "sold", **fields: Any) -> Candidate:
    return Candidate.model_validate(
        {"source": "county_sales", "source_id": "x", "status": status, **fields}
    )


PERFECT = Features(distance_miles=0.0, months_since_event=0)


def test_perfect_sold_candidate_scores_one() -> None:
    result = score(_cand(), _answers(), PERFECT, _settings())
    assert result.composite == pytest.approx(1.0)
    assert result.tier == "excellent"
    assert result.gates_triggered == []


def test_composite_formula_terms() -> None:
    answers = _answers(good=0.5, level=1.5)  # similarity terms are 1.5/3 = 0.5
    features = Features(distance_miles=2.5, months_since_event=12)  # 0.5 and 0.5
    result = score(_cand("active"), answers, features, _settings())
    # 0.30*0.5 + 0.45*0.5 + 0.10*0.5 + 0.10*0.5 + 0.05*0 (not sold)
    assert result.composite == pytest.approx(0.15 + 0.225 + 0.05 + 0.05)


def test_recency_and_proximity_clamped_to_unit_interval() -> None:
    far_and_old = Features(distance_miles=50.0, months_since_event=200)
    result = score(_cand("active"), _answers(good=0, level=0), far_and_old, _settings())
    assert result.composite == pytest.approx(0.0)
    # A negative distance/months (should not happen) cannot push above the weight.
    beyond = Features(distance_miles=-3.0, months_since_event=-5)
    result = score(_cand("active"), _answers(good=0, level=0), beyond, _settings())
    assert result.composite == pytest.approx(0.10 + 0.10)


def test_missing_features_contribute_zero() -> None:
    result = score(_cand("active"), _answers(), Features(), _settings())
    assert result.composite == pytest.approx(0.30 + 0.45)


def test_changing_a_weight_changes_composite() -> None:
    answers = _answers(good=1.0)
    assert score(_cand(), answers, PERFECT, _settings()).composite == pytest.approx(1.0)
    assert score(_cand(), answers, PERFECT, _settings(w1=0.60)).composite == pytest.approx(1.30)
    assert score(_cand(), answers, PERFECT, _settings(w7=0.0)).composite == pytest.approx(0.95)


def test_arms_length_gate_forces_reject() -> None:
    result = score(_cand(), _answers(arms=0.49), PERFECT, _settings())
    assert result.tier == "reject"
    assert result.gates_triggered == ["arms_length"]


def test_arms_length_at_threshold_passes() -> None:
    result = score(_cand(), _answers(arms=0.5), PERFECT, _settings())
    assert result.tier == "excellent"
    assert result.gates_triggered == []


def test_arms_length_threshold_is_configurable() -> None:
    result = score(_cand(), _answers(arms=0.6), PERFECT, _settings(arms_length_min=0.7))
    assert result.tier == "reject"


def test_red_flags_warn_policy_marks_but_keeps_tier() -> None:
    result = score(_cand(), _answers(red=0.71), PERFECT, _settings(red_flag_policy="warn"))
    assert result.tier == "excellent"
    assert result.gates_triggered == ["red_flag"]


def test_red_flags_reject_policy_rejects() -> None:
    result = score(_cand(), _answers(red=0.71), PERFECT, _settings(red_flag_policy="reject"))
    assert result.tier == "reject"
    assert result.gates_triggered == ["red_flags_reject"]


@pytest.mark.parametrize("policy", ["warn", "reject"])
def test_red_flags_at_threshold_do_not_trip(policy: str) -> None:
    result = score(_cand(), _answers(red=0.7), PERFECT, _settings(red_flag_policy=policy))
    assert result.tier == "excellent"
    assert result.gates_triggered == []


def test_both_gates_reported() -> None:
    result = score(_cand(), _answers(arms=0.1, red=0.9), PERFECT, _settings())
    assert result.tier == "reject"
    assert result.gates_triggered == ["arms_length", "red_flag"]


def test_demotion_by_floor() -> None:
    # composite = 0.30 + 0.45 + 0 + 0 + 0.05 = 0.80 < 0.85 excellent floor, >= 0.65 good
    features = Features(distance_miles=99.0, months_since_event=99)
    result = score(_cand(), _answers(), features, _settings())
    assert result.composite == pytest.approx(0.80)
    assert result.tier == "good"
    assert result.gates_triggered == ["below_tier_floor"]


def test_demotion_by_confidence() -> None:
    result = score(_cand(), _answers(tier_conf=0.49), PERFECT, _settings())
    assert result.tier == "good"
    assert result.gates_triggered == ["low_tier_confidence"]


def test_confidence_at_minimum_is_not_demoted() -> None:
    result = score(_cand(), _answers(tier_conf=0.5), PERFECT, _settings())
    assert result.tier == "excellent"


def test_both_demotion_reasons_demote_only_one_level() -> None:
    features = Features(distance_miles=99.0, months_since_event=99)
    result = score(_cand(), _answers(tier_conf=0.1), features, _settings())
    assert result.tier == "good"
    assert result.gates_triggered == ["below_tier_floor", "low_tier_confidence"]


def test_floor_is_that_of_the_choice_not_the_demoted_tier() -> None:
    # good choice, composite 0.80 >= good floor 0.65: no demotion
    features = Features(distance_miles=99.0, months_since_event=99)
    result = score(_cand(), _answers(choice="good"), features, _settings())
    assert result.tier == "good"


def test_marginal_demotes_to_reject() -> None:
    result = score(_cand(), _answers(choice="marginal", tier_conf=0.1), PERFECT, _settings())
    assert result.tier == "reject"


def test_reject_choice_stays_reject_without_gates() -> None:
    result = score(_cand(), _answers(choice="reject", tier_conf=0.1), PERFECT, _settings())
    assert result.tier == "reject"
    assert result.gates_triggered == []


def test_hard_gate_reject_skips_demotion_reasons() -> None:
    result = score(_cand(), _answers(arms=0.0, tier_conf=0.1), PERFECT, _settings())
    assert result.gates_triggered == ["arms_length"]


def _scored(status: str, tier: Tier, composite: float, source_id: str = "x") -> ScoredComp:
    return ScoredComp(
        candidate=_cand(status, source_id=source_id),
        result=CompResult(composite=composite, tier=tier, answers=_answers()),
    )


def test_rank_orders_by_tier_then_composite() -> None:
    items = [
        _scored("sold", "reject", 0.99, "a"),
        _scored("sold", "good", 0.70, "b"),
        _scored("sold", "excellent", 0.86, "c"),
        _scored("sold", "good", 0.90, "d"),
        _scored("sold", "marginal", 0.45, "e"),
    ]
    assert [i.candidate.source_id for i in rank(items)] == ["c", "d", "b", "e", "a"]


def test_rank_sold_above_active_and_pending_on_ties() -> None:
    items = [
        _scored("active", "good", 0.7, "act"),
        _scored("pending", "good", 0.7, "pen"),
        _scored("sold", "good", 0.7, "sold"),
    ]
    assert [i.candidate.source_id for i in rank(items)] == ["sold", "act", "pen"]


def test_rank_tie_ignores_float_noise() -> None:
    items = [
        _scored("active", "good", 0.7 + 1e-12, "act"),
        _scored("sold", "good", 0.7, "sold"),
    ]
    assert [i.candidate.source_id for i in rank(items)] == ["sold", "act"]


def test_rank_higher_composite_beats_sold_bonus() -> None:
    items = [_scored("sold", "good", 0.70, "sold"), _scored("active", "good", 0.71, "act")]
    assert [i.candidate.source_id for i in rank(items)] == ["act", "sold"]


def test_rank_does_not_mutate_input() -> None:
    items = [_scored("sold", "reject", 0.1, "a"), _scored("sold", "excellent", 0.9, "b")]
    rank(items)
    assert items[0].candidate.source_id == "a"


def test_compute_features() -> None:
    cand = _cand(lat=39.0 + 1 / 69.0912, lon=-105.5, event_date=date(2026, 3, 30))
    features = compute_features(SUBJECT, cand, TODAY)
    assert features.distance_miles == pytest.approx(1.0, abs=0.01)
    assert features.months_since_event == 6


def test_compute_features_missing_inputs() -> None:
    assert compute_features(SUBJECT, _cand(), TODAY) == Features()
