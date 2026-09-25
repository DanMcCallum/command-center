import pytest
from pydantic import ValidationError

from land_comps.models import (
    Candidate,
    ChoiceAnswer,
    CompResult,
    JevAnswers,
    NoulAnswer,
    ScoreAnswer,
)


def _sample_answers() -> JevAnswers:
    noul = NoulAnswer(probability=0.9, confidence=0.8)
    score = ScoreAnswer(score=2, confidence=0.75, legend={0: "different", 3: "same"})
    return JevAnswers(
        is_good_comp=noul,
        arms_length=noul,
        physical_similarity=score,
        access_utilities_similarity=score,
        market_similarity=score,
        red_flags=NoulAnswer(probability=0.1, confidence=0.9),
        quality_tier=ChoiceAnswer(choice="good", probability=0.7, confidence=0.8),
    )


def test_candidate_status_rejects_unknown_value() -> None:
    with pytest.raises(ValidationError):
        Candidate(source="landwatch", source_id="1", status="withdrawn")


def test_candidate_status_accepts_documented_values() -> None:
    for status in ("sold", "active", "pending"):
        candidate = Candidate(source="landwatch", source_id="1", status=status)
        assert candidate.status == status
        assert candidate.sources == []
        assert candidate.utilities == []
        assert candidate.raw == {}


def test_score_answer_rejects_out_of_range_score() -> None:
    with pytest.raises(ValidationError):
        ScoreAnswer(score=4, confidence=0.5)


def test_comp_result_holds_composite_tier_gates_and_answers() -> None:
    result = CompResult(
        composite=0.72,
        tier="good",
        gates_triggered=["red_flag"],
        answers=_sample_answers(),
    )
    assert result.tier == "good"
    assert result.gates_triggered == ["red_flag"]
    assert result.answers.quality_tier.choice == "good"
