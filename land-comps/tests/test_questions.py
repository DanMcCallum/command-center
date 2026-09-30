import json

from land_comps.questions import QUESTION_IDS, QUESTIONS, questions_json


def test_seven_questions_with_the_prd_ids_and_types() -> None:
    assert {q.id: q.kind for q in QUESTIONS} == {
        "is_good_comp": "noul",
        "arms_length": "noul",
        "red_flags": "noul",
        "physical_similarity": "score",
        "access_utilities_similarity": "score",
        "market_similarity": "score",
        "quality_tier": "choice",
    }
    assert len(QUESTION_IDS) == 7


def test_criteria_shapes() -> None:
    for spec in QUESTIONS:
        assert spec.instructions.strip()
        if spec.kind == "noul":
            assert isinstance(spec.criteria, dict) and set(spec.criteria) == {"true", "false"}
        elif spec.kind == "score":
            assert isinstance(spec.criteria, tuple) and len(spec.criteria) == 4
        else:
            assert isinstance(spec.criteria, dict)
            assert list(spec.criteria) == ["excellent", "good", "marginal", "reject"]
        values = spec.criteria.values() if isinstance(spec.criteria, dict) else spec.criteria
        assert all(text.strip() for text in values)


def test_question_ids_are_not_part_of_the_instructions() -> None:
    for spec in QUESTIONS:
        assert spec.id not in spec.instructions


def test_questions_json_is_stable() -> None:
    assert questions_json() == questions_json()
    assert [q["id"] for q in json.loads(questions_json())] == list(QUESTION_IDS)
