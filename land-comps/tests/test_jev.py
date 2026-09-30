import json
import sqlite3
import threading
from collections.abc import Sequence
from typing import Any

import httpx2
import pytest

from land_comps.config import Settings
from land_comps.db import init_db
from land_comps.jev import (
    MAX_TRIES,
    JevApiError,
    JevFatalError,
    JevJudge,
    JevUnavailableError,
    JudgedAnswers,
    RawChoice,
    RawNoul,
    RawResponse,
    RawScore,
    TypeSafeTransport,
)
from land_comps.questions import QUESTION_IDS, QUESTIONS, QuestionSpec

STATE: dict[str, Any] = {"subject": {"acreage": 5}, "candidate": {"acreage": 4}, "comparison": {}}


def _raw(*, input_tokens: int | None = 1200, good: float = 0.9) -> RawResponse:
    legend = {0: "a", 1: "b", 2: "c", 3: "d"}
    return RawResponse(
        nouls={
            "is_good_comp": RawNoul(good),
            "arms_length": RawNoul(0.95),
            "red_flags": RawNoul(0.05),
        },
        scores={
            "physical_similarity": RawScore(2.4, 0.8, legend),
            "access_utilities_similarity": RawScore(3.0, 0.9, legend),
            "market_similarity": RawScore(1.7, 0.6, legend),
        },
        choices={"quality_tier": RawChoice("good", 0.7, {"good": 0.72, "marginal": 0.28})},
        input_tokens=input_tokens,
    )


class FakeTransport:
    """Replays scripted outcomes (a response or an exception), then keeps returning the last."""

    def __init__(self, *outcomes: RawResponse | JevApiError) -> None:
        self._outcomes = list(outcomes) or [_raw()]
        self.calls: list[tuple[dict[str, Any], str]] = []
        self._lock = threading.Lock()

    def ask(
        self, state: dict[str, Any], questions: Sequence[QuestionSpec], model: str
    ) -> RawResponse:
        with self._lock:
            self.calls.append((state, model))
            outcome = self._outcomes.pop(0) if len(self._outcomes) > 1 else self._outcomes[0]
        assert [q.id for q in questions] == list(QUESTION_IDS)
        if isinstance(outcome, JevApiError):
            raise outcome
        return outcome


@pytest.fixture
def conn() -> sqlite3.Connection:
    return init_db(":memory:")


def _judge(
    transport: FakeTransport, conn: sqlite3.Connection, sleeps: list[float] | None = None
) -> JevJudge:
    record = sleeps if sleeps is not None else []
    return JevJudge(transport, conn, sleep=record.append)


def test_judge_maps_all_seven_answers(conn: sqlite3.Connection) -> None:
    transport = FakeTransport(_raw(good=0.9))

    answers = _judge(transport, conn).judge(STATE)

    assert answers.is_good_comp.probability == 0.9
    assert answers.is_good_comp.confidence == pytest.approx(0.8)  # derived from the 0.5 midpoint
    assert answers.physical_similarity.score == 2.4
    assert answers.physical_similarity.legend[3] == "d"
    assert answers.quality_tier.choice == "good"
    assert answers.quality_tier.probability == 0.72
    assert answers.quality_tier.confidence == 0.7
    assert transport.calls == [(STATE, "jev-latest")]


def test_second_identical_judge_hits_cache_with_zero_client_calls(
    conn: sqlite3.Connection,
) -> None:
    transport = FakeTransport(_raw())
    judge = _judge(transport, conn)

    first = judge.judge_with_usage(STATE)
    second = judge.judge_with_usage(dict(STATE))

    assert len(transport.calls) == 1
    assert (first.cached, second.cached) == (False, True)
    assert second.answers == first.answers
    assert second.input_tokens == 1200
    row = conn.execute("SELECT input_tokens FROM jev_cache").fetchone()
    assert row["input_tokens"] == 1200


def test_cache_survives_a_new_judge_but_not_a_changed_state_or_model(
    conn: sqlite3.Connection,
) -> None:
    transport = FakeTransport(_raw())
    _judge(transport, conn).judge(STATE)

    _judge(transport, conn).judge(STATE)
    assert len(transport.calls) == 1

    _judge(transport, conn).judge({**STATE, "comparison": {"distance_miles": 1}})
    JevJudge(transport, conn, model="jev-other", sleep=lambda _: None).judge(STATE)
    assert len(transport.calls) == 3


def test_unreadable_cache_entry_is_a_miss_and_is_overwritten(conn: sqlite3.Connection) -> None:
    transport = FakeTransport(_raw())
    judge = _judge(transport, conn)
    judge.judge(STATE)
    conn.execute("UPDATE jev_cache SET response_json = '{not json'")

    judge.judge(STATE)
    judge.judge(STATE)

    assert len(transport.calls) == 2


def test_429_twice_then_success_retries_with_exponential_backoff(
    conn: sqlite3.Connection,
) -> None:
    transport = FakeTransport(JevApiError(429, "slow down"), JevApiError(529, "overloaded"), _raw())
    sleeps: list[float] = []

    answers = _judge(transport, conn, sleeps).judge(STATE)

    assert answers.quality_tier.choice == "good"
    assert len(transport.calls) == 3
    assert sleeps == [1.0, 2.0]


def test_retry_after_header_lengthens_the_wait(conn: sqlite3.Connection) -> None:
    transport = FakeTransport(JevApiError(429, "slow", retry_after_secs=7.5), _raw())
    sleeps: list[float] = []

    _judge(transport, conn, sleeps).judge(STATE)

    assert sleeps == [7.5]


def test_gives_up_after_five_tries(conn: sqlite3.Connection) -> None:
    transport = FakeTransport(JevApiError(529, "overloaded"))
    sleeps: list[float] = []

    with pytest.raises(JevUnavailableError, match="gave up after 5 tries"):
        _judge(transport, conn, sleeps).judge(STATE)

    assert len(transport.calls) == MAX_TRIES == 5
    assert sleeps == [1.0, 2.0, 4.0, 8.0]
    assert conn.execute("SELECT COUNT(*) FROM jev_cache").fetchone()[0] == 0


def test_401_fails_fast_with_a_clear_message(conn: sqlite3.Connection) -> None:
    transport = FakeTransport(JevApiError(401, "bad key"))
    sleeps: list[float] = []

    with pytest.raises(JevFatalError, match="TYPESAFE_API_KEY"):
        _judge(transport, conn, sleeps).judge(STATE)

    assert len(transport.calls) == 1
    assert sleeps == []


def test_422_fails_fast_and_includes_the_detail(conn: sqlite3.Connection) -> None:
    transport = FakeTransport(JevApiError(422, "criteria: too short"))

    with pytest.raises(JevFatalError, match=r"HTTP 422.*criteria: too short"):
        _judge(transport, conn).judge(STATE)

    assert len(transport.calls) == 1


def test_missing_answer_is_fatal_and_not_cached(conn: sqlite3.Connection) -> None:
    incomplete = _raw()
    transport = FakeTransport(
        RawResponse(incomplete.nouls, incomplete.scores, {}, incomplete.input_tokens)
    )

    with pytest.raises(JevFatalError, match="quality_tier"):
        _judge(transport, conn).judge(STATE)

    assert conn.execute("SELECT COUNT(*) FROM jev_cache").fetchone()[0] == 0


def test_judge_many_returns_results_in_order_with_tokens_and_cache_flags(
    conn: sqlite3.Connection,
) -> None:
    transport = FakeTransport(_raw(input_tokens=900))
    judge = _judge(transport, conn)
    states = [{**STATE, "comparison": {"distance_miles": i}} for i in range(12)]
    judge.judge(states[3])  # pre-warm one entry

    results = judge.judge_many(states, concurrency=4)

    assert len(results) == 12
    assert all(isinstance(r, JudgedAnswers) for r in results)
    judged = [r for r in results if isinstance(r, JudgedAnswers)]
    assert [r.cached for r in judged] == [i == 3 for i in range(12)]
    assert all(r.input_tokens == 900 for r in judged)
    assert len(transport.calls) == 12  # 11 new + 1 warm-up
    assert conn.execute("SELECT COUNT(*) FROM jev_cache").fetchone()[0] == 12


def test_judge_many_reports_exhausted_retries_without_sinking_the_batch(
    conn: sqlite3.Connection,
) -> None:
    class Picky(FakeTransport):
        def ask(
            self, state: dict[str, Any], questions: Sequence[QuestionSpec], model: str
        ) -> RawResponse:
            if state["comparison"].get("distance_miles") == 1:
                raise JevApiError(529, "overloaded")
            return super().ask(state, questions, model)

    states = [{**STATE, "comparison": {"distance_miles": i}} for i in range(3)]

    results = _judge(Picky(_raw()), conn).judge_many(states)

    assert isinstance(results[0], JudgedAnswers)
    assert isinstance(results[1], JevUnavailableError)
    assert isinstance(results[2], JudgedAnswers)


def test_judge_many_raises_on_a_fatal_error(conn: sqlite3.Connection) -> None:
    transport = FakeTransport(JevApiError(401, "bad key"))
    states = [{**STATE, "comparison": {"distance_miles": i}} for i in range(20)]

    with pytest.raises(JevFatalError, match="TYPESAFE_API_KEY"):
        _judge(transport, conn).judge_many(states, concurrency=2)


def test_judge_many_rejects_nonpositive_concurrency(conn: sqlite3.Connection) -> None:
    with pytest.raises(ValueError, match="concurrency"):
        _judge(FakeTransport(), conn).judge_many([STATE], concurrency=0)


def test_from_settings_requires_an_api_key(
    conn: sqlite3.Connection, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    settings = Settings.model_validate(
        {
            "apify": {"landwatch_actor_id": "a", "realtor_actor_id": "b"},
            "county": {
                "fips": "08093",
                "apn_length": 10,
                "sales_file": "s",
                "parcels_file": "p",
                "column_mapping": {},
                "vacant_land_codes": [],
                "excluded_deed_types": [],
            },
            "secrets": {"typesafe_api_key": None, "_env_file": None},
        }
    )

    with pytest.raises(JevFatalError, match="TYPESAFE_API_KEY"):
        JevJudge.from_settings(settings, conn)


# -- the real SDK adapter, against a mocked HTTP transport --------------------------------


def _sdk_transport(handler: httpx2.MockTransport) -> TypeSafeTransport:
    return TypeSafeTransport("test-key", http_transport=handler)


def test_sdk_adapter_sends_seven_questions_and_maps_the_response(
    conn: sqlite3.Connection,
) -> None:
    sent: list[dict[str, Any]] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        sent.append(json.loads(request.content))
        legend = {"0": "a", "1": "b", "2": "c", "3": "d"}
        probs = {"0": 0.1, "1": 0.1, "2": 0.2, "3": 0.6}
        score = {"type": "score", "score": 2.3, "confidence": 0.8, "legend": legend}
        return httpx2.Response(
            200,
            json={
                "model": "jev-latest",
                "usage": {"input_tokens": 1500, "output_tokens": 7},
                "answers": {
                    "is_good_comp": {"type": "noul", "noul": 0.8},
                    "arms_length": {"type": "noul", "noul": 0.9},
                    "red_flags": {"type": "noul", "noul": 0.1},
                    "physical_similarity": {**score, "probabilities": probs},
                    "access_utilities_similarity": {**score, "probabilities": probs},
                    "market_similarity": {**score, "probabilities": probs},
                    "quality_tier": {
                        "type": "choice",
                        "choice": "excellent",
                        "confidence": 0.9,
                        "probabilities": {"excellent": 0.9, "good": 0.1},
                    },
                },
            },
        )

    judge = JevJudge(_sdk_transport(httpx2.MockTransport(handler)), conn)
    judged = judge.judge_with_usage(STATE)

    body = sent[0]
    assert body["model"] == "jev-latest"
    assert body["state"] == STATE
    assert list(body["questions"]) == [q.id for q in QUESTIONS]
    assert {q["type"] for q in body["questions"].values()} == {"noul", "score", "choice"}
    assert len(body["questions"]["physical_similarity"]["criteria"]) == 4
    assert set(body["questions"]["quality_tier"]["criteria"]) == {
        "excellent",
        "good",
        "marginal",
        "reject",
    }
    assert set(body["questions"]["arms_length"]["criteria"]) == {"true", "false"}
    assert judged.input_tokens == 1500
    assert judged.answers.physical_similarity.score == 2.3
    assert judged.answers.physical_similarity.legend[0] == "a"
    assert judged.answers.quality_tier.probability == 0.9


@pytest.mark.parametrize(
    ("status", "expected"),
    [(401, JevFatalError), (422, JevFatalError)],
)
def test_sdk_adapter_maps_http_errors_to_fail_fast(
    conn: sqlite3.Connection, status: int, expected: type[Exception]
) -> None:
    calls = 0

    def handler(request: httpx2.Request) -> httpx2.Response:
        nonlocal calls
        calls += 1
        return httpx2.Response(status, json={"error": {"message": "nope"}})

    judge = JevJudge(_sdk_transport(httpx2.MockTransport(handler)), conn, sleep=lambda _: None)

    with pytest.raises(expected):
        judge.judge(STATE)
    assert calls == 1  # the SDK's own retries are off; ours do not apply to 401/422


def test_sdk_adapter_429_is_retried_by_the_judge(conn: sqlite3.Connection) -> None:
    calls = 0

    def handler(request: httpx2.Request) -> httpx2.Response:
        nonlocal calls
        calls += 1
        return httpx2.Response(429, headers={"retry-after": "2"}, json={"error": "slow"})

    sleeps: list[float] = []
    judge = JevJudge(_sdk_transport(httpx2.MockTransport(handler)), conn, sleep=sleeps.append)

    with pytest.raises(JevUnavailableError):
        judge.judge(STATE)

    assert calls == MAX_TRIES
    assert sleeps[0] == 2.0  # Retry-After of 2s beats the 1s base delay
