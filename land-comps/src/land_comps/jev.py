"""Cached, retrying Jev judgments for (subject, candidate) states (PRD sections 5 and 8).

`JevJudge` asks all seven comp questions in one `system_one` request per state and
returns them as `JevAnswers`. Raw answers are stored in `jev_cache`, keyed by
sha256(model + state JSON + questions JSON), so re-scoring and repeat runs cost nothing
and any change to the model, the state, or a question's wording is a cache miss.

`typesafe-sdk` is reached only through the `JevTransport` protocol. `TypeSafeTransport`
is the real adapter (the SDK is fully typed, so no `Any` leaks past it); tests inject a
fake transport and never touch the network. The SDK's own retries are turned off so the
backoff here is the only retry layer.
"""

import hashlib
import json
import logging
import sqlite3
import threading
import time
from collections.abc import Callable, Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from typing import Any, Protocol

import httpx2
from pydantic import ValidationError
from typesafe_sdk import (
    Choice,
    Noul,
    NoulCriteria,
    RetryPolicy,
    Score,
    TypeSafeAPIConnectionError,
    TypeSafeAPIError,
    TypeSafeClient,
    TypeSafeRateLimitError,
)

from land_comps.config import Settings
from land_comps.models import ChoiceAnswer, JevAnswers, NoulAnswer, ScoreAnswer
from land_comps.questions import QUESTIONS, QuestionSpec, questions_json

logger = logging.getLogger(__name__)

JEV_MODEL = "jev-latest"
MAX_TRIES = 5
BASE_DELAY_SECS = 1.0
MAX_DELAY_SECS = 30.0
DEFAULT_CONCURRENCY = 8
# List price of jev-latest input, USD per million tokens (PRD section 8); only for cost reports.
JEV_INPUT_USD_PER_MTOK = 0.042

_TRANSIENT_STATUSES = frozenset({408, 429, 500, 502, 503, 504, 529})


@dataclass(frozen=True)
class JudgedAnswers:
    """One state's answers with the input tokens Jev reported and whether the cache served it."""

    answers: JevAnswers
    input_tokens: int | None
    cached: bool


class JevError(Exception):
    """A Jev failure, worded for the operator."""


class JevFatalError(JevError):
    """A failure that retrying cannot fix (bad key, invalid request, unusable response)."""


class JevUnavailableError(JevError):
    """A transient failure (rate limit, overload, network) that outlasted every retry."""


class JevApiError(Exception):
    """What a `JevTransport` raises for a failed request: HTTP status (None if the request
    never got a response), a message, and the server's requested wait, if any."""

    def __init__(
        self, status: int | None, message: str, *, retry_after_secs: float | None = None
    ) -> None:
        super().__init__(message)
        self.status = status
        self.message = message
        self.retry_after_secs = retry_after_secs

    @property
    def transient(self) -> bool:
        return self.status is None or self.status in _TRANSIENT_STATUSES


@dataclass(frozen=True)
class RawNoul:
    probability: float


@dataclass(frozen=True)
class RawScore:
    score: float
    confidence: float
    legend: Mapping[int, str]


@dataclass(frozen=True)
class RawChoice:
    choice: str
    confidence: float
    probabilities: Mapping[str, float]


@dataclass(frozen=True)
class RawResponse:
    """A transport's answer to one request, keyed by question ID, in plain values."""

    nouls: Mapping[str, RawNoul]
    scores: Mapping[str, RawScore]
    choices: Mapping[str, RawChoice]
    input_tokens: int | None


class JevTransport(Protocol):
    """One `system_one` request. Raises `JevApiError` on any failure."""

    def ask(
        self, state: dict[str, Any], questions: Sequence[QuestionSpec], model: str
    ) -> RawResponse: ...


def _sdk_questions(specs: Sequence[QuestionSpec]) -> dict[str, Any]:
    questions: dict[str, Any] = {}
    for spec in specs:
        if spec.kind == "noul" and isinstance(spec.criteria, dict):
            questions[spec.id] = Noul(
                instructions=spec.instructions,
                criteria=NoulCriteria(true=spec.criteria["true"], false=spec.criteria["false"]),
            )
        elif spec.kind == "score" and isinstance(spec.criteria, tuple):
            questions[spec.id] = Score(instructions=spec.instructions, criteria=list(spec.criteria))
        elif spec.kind == "choice" and isinstance(spec.criteria, dict):
            questions[spec.id] = Choice(
                instructions=spec.instructions, criteria=dict(spec.criteria)
            )
        else:
            raise ValueError(f"question {spec.id!r}: criteria do not fit type {spec.kind!r}")
    return questions


class TypeSafeTransport:
    """`JevTransport` on the real `typesafe-sdk` client."""

    def __init__(self, api_key: str, *, http_transport: httpx2.BaseTransport | None = None) -> None:
        # SDK retries off: `JevJudge._ask_with_retry` is the only retry layer.
        self._client = TypeSafeClient(
            api_key=api_key, retry=RetryPolicy(max_retries=0), transport=http_transport
        )

    def ask(
        self, state: dict[str, Any], questions: Sequence[QuestionSpec], model: str
    ) -> RawResponse:
        try:
            response = self._client.system_one(
                state=state, questions=_sdk_questions(questions), model=model
            )
        except TypeSafeRateLimitError as exc:
            wait = None if exc.retry_after_ms is None else exc.retry_after_ms / 1000
            raise JevApiError(exc.status, str(exc), retry_after_secs=wait) from exc
        except TypeSafeAPIError as exc:
            raise JevApiError(exc.status, str(exc)) from exc
        except TypeSafeAPIConnectionError as exc:
            raise JevApiError(None, f"could not reach the TypeSafe API: {exc}") from exc

        return RawResponse(
            nouls={name: RawNoul(a.noul) for name, a in response.nouls.items()},
            scores={
                name: RawScore(
                    a.score, a.confidence, {level: _legend_text(v) for level, v in a.legend.items()}
                )
                for name, a in response.scores.items()
            },
            choices={
                name: RawChoice(a.choice, a.confidence, dict(a.probabilities))
                for name, a in response.choices.items()
            },
            input_tokens=response.usage.input_tokens,
        )


def _legend_text(value: object) -> str:
    return value if isinstance(value, str) else json.dumps(value, sort_keys=True)


def _failure_message(exc: JevApiError) -> str:
    if exc.status == 401:
        return (
            "Jev rejected the TypeSafe API key (HTTP 401); check TYPESAFE_API_KEY. "
            f"Detail: {exc.message}"
        )
    if exc.status == 422:
        return f"Jev rejected the request as invalid (HTTP 422): {exc.message}"
    if exc.status is None:
        return exc.message
    return f"Jev request failed (HTTP {exc.status}): {exc.message}"


def _noul(name: str, raw: RawNoul | None) -> NoulAnswer:
    if raw is None:
        raise JevFatalError(f"Jev response is missing the {name!r} answer")
    # Noul carries no separate confidence, so use distance from the 0.5 coin-flip:
    # 0 when the probability is even, 1 when it is certain either way.
    return NoulAnswer(probability=raw.probability, confidence=abs(2 * raw.probability - 1))


def _score(name: str, raw: RawScore | None) -> ScoreAnswer:
    if raw is None:
        raise JevFatalError(f"Jev response is missing the {name!r} answer")
    return ScoreAnswer(score=raw.score, confidence=raw.confidence, legend=dict(raw.legend))


def to_answers(raw: RawResponse) -> JevAnswers:
    """Map a transport response to `JevAnswers`, failing clearly on a missing or bad answer."""
    choice = raw.choices.get("quality_tier")
    if choice is None:
        raise JevFatalError("Jev response is missing the 'quality_tier' answer")
    try:
        return JevAnswers(
            is_good_comp=_noul("is_good_comp", raw.nouls.get("is_good_comp")),
            arms_length=_noul("arms_length", raw.nouls.get("arms_length")),
            physical_similarity=_score(
                "physical_similarity", raw.scores.get("physical_similarity")
            ),
            access_utilities_similarity=_score(
                "access_utilities_similarity", raw.scores.get("access_utilities_similarity")
            ),
            market_similarity=_score("market_similarity", raw.scores.get("market_similarity")),
            red_flags=_noul("red_flags", raw.nouls.get("red_flags")),
            quality_tier=ChoiceAnswer.model_validate(
                {
                    "choice": choice.choice,
                    "probability": choice.probabilities.get(choice.choice),
                    "confidence": choice.confidence,
                }
            ),
        )
    except ValidationError as exc:
        raise JevFatalError(f"Jev returned an answer outside the expected shape: {exc}") from exc


class JevJudge:
    """Judge (subject, candidate) states with Jev, through a `jev_cache` result cache."""

    def __init__(
        self,
        transport: JevTransport,
        conn: sqlite3.Connection,
        *,
        model: str = JEV_MODEL,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._transport = transport
        self._conn = conn
        self._model = model
        self._sleep = sleep
        self._questions_json = questions_json()
        # `judge_many` shares one connection across worker threads; serialize its use.
        self._db_lock = threading.Lock()

    @classmethod
    def from_settings(cls, settings: Settings, conn: sqlite3.Connection) -> "JevJudge":
        """Build a judge on the real SDK using `TYPESAFE_API_KEY` from the environment."""
        key = settings.secrets.typesafe_api_key
        if not key:
            raise JevFatalError("TYPESAFE_API_KEY is not set (see .env.example)")
        return cls(TypeSafeTransport(key), conn)

    def judge(self, state: dict[str, Any]) -> JevAnswers:
        """The seven answers for `state`, from cache when this exact request was seen before."""
        return self.judge_with_usage(state).answers

    def judge_with_usage(self, state: dict[str, Any]) -> JudgedAnswers:
        """Like `judge`, but also reports the input tokens and whether the cache answered."""
        state_json = json.dumps(state, sort_keys=True, default=str)
        key = self._cache_key(state_json)
        hit = self._read_cache(key)
        if hit is not None:
            return hit

        raw = self._ask_with_retry(state)
        answers = to_answers(raw)
        self._write_cache(key, answers, raw.input_tokens)
        return JudgedAnswers(answers, raw.input_tokens, cached=False)

    def judge_many(
        self, states: Sequence[dict[str, Any]], concurrency: int = DEFAULT_CONCURRENCY
    ) -> list[JudgedAnswers | JevUnavailableError]:
        """Judge every state on up to `concurrency` threads, results in input order.

        Each result carries the input tokens for its call. A state whose retries run out
        comes back as its `JevUnavailableError` so the rest still complete. A fatal error
        (bad key, invalid request) aborts the batch: pending requests are cancelled and
        the error is raised.
        """
        if concurrency < 1:
            raise ValueError(f"concurrency must be >= 1, got {concurrency}")
        with ThreadPoolExecutor(max_workers=concurrency) as pool:
            futures = [pool.submit(self._judge_one, state) for state in states]
            try:
                for future in as_completed(futures):
                    future.result()  # surface a fatal error now instead of after the slowest call
            except BaseException:
                for future in futures:
                    future.cancel()
                raise
            return [future.result() for future in futures]

    def _judge_one(self, state: dict[str, Any]) -> JudgedAnswers | JevUnavailableError:
        try:
            return self.judge_with_usage(state)
        except JevUnavailableError as exc:
            logger.warning("Jev unavailable for one candidate: %s", exc)
            return exc

    def _ask_with_retry(self, state: dict[str, Any]) -> RawResponse:
        for attempt in range(1, MAX_TRIES + 1):
            try:
                return self._transport.ask(state, QUESTIONS, self._model)
            except JevApiError as exc:
                if not exc.transient:
                    raise JevFatalError(_failure_message(exc)) from exc
                if attempt == MAX_TRIES:
                    raise JevUnavailableError(
                        f"{_failure_message(exc)} (gave up after {MAX_TRIES} tries)"
                    ) from exc
                delay = min(BASE_DELAY_SECS * 2 ** (attempt - 1), MAX_DELAY_SECS)
                if exc.retry_after_secs is not None:
                    delay = min(max(delay, exc.retry_after_secs), MAX_DELAY_SECS)
                logger.info(
                    "Jev try %d/%d failed (%s); retrying in %.1fs",
                    attempt,
                    MAX_TRIES,
                    exc.status,
                    delay,
                )
                self._sleep(delay)
        raise AssertionError("unreachable: the last attempt returns or raises")

    def _cache_key(self, state_json: str) -> str:
        material = "\n".join((self._model, state_json, self._questions_json))
        return hashlib.sha256(material.encode()).hexdigest()

    def _read_cache(self, key: str) -> JudgedAnswers | None:
        with self._db_lock:
            row = self._conn.execute(
                "SELECT response_json, input_tokens FROM jev_cache WHERE key = ?", (key,)
            ).fetchone()
        if row is None:
            return None
        try:
            answers = JevAnswers.model_validate_json(row["response_json"])
        except ValidationError:
            # Unreadable entry: treat as a miss and overwrite it after the call.
            logger.warning("Unreadable jev_cache entry %s; asking Jev again", key[:12])
            return None
        return JudgedAnswers(answers, row["input_tokens"], cached=True)

    def _write_cache(self, key: str, answers: JevAnswers, input_tokens: int | None) -> None:
        with self._db_lock, self._conn:
            self._conn.execute(
                "INSERT OR REPLACE INTO jev_cache (key, response_json, input_tokens) "
                "VALUES (?, ?, ?)",
                (key, answers.model_dump_json(), input_tokens),
            )
