"""Cached, failure-visible wrapper around Apify actor runs.

`ApifyRunner` is what the LandWatch and Realtor.com sources call. It talks to
Apify only through the small `ActorClient` protocol, so tests inject a fake and
never touch the network; `ApifyActorClient` is the real `apify-client` adapter.
Successful runs are cached in `source_cache` for `apify.cache_ttl_days`, so a
repeat search is free. Any failure or timeout raises `SourceError` naming the
actor, so a scraper outage shows up in the run instead of as an empty result.
"""

import json
import sqlite3
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

from apify_client import ApifyClient
from apify_client.errors import ApifyApiError

from land_comps.config import ApifyConfig, Settings
from land_comps.sources import SourceError

# Extra time beyond the actor's own run timeout to wait for Apify to report the outcome.
_WAIT_SLACK_SECS = 30


@dataclass(frozen=True)
class ActorRun:
    """The outcome of one actor run: Apify's run ID and terminal status, plus dataset items."""

    run_id: str
    status: str
    items: list[dict[str, Any]]


@dataclass(frozen=True)
class ApifyResult:
    """Dataset items plus the provenance of the run that produced them."""

    actor_id: str
    run_id: str
    items: list[dict[str, Any]]
    fetched_at: datetime
    cached: bool


class ActorClient(Protocol):
    """Runs an actor to completion and returns its dataset; the seam tests fake."""

    def run_actor(
        self,
        actor_id: str,
        run_input: dict[str, Any],
        *,
        timeout_secs: int,
        max_items: int,
    ) -> ActorRun: ...


class ApifyActorClient:
    """`ActorClient` backed by the real `apify-client` package."""

    def __init__(self, token: str) -> None:
        self._client = ApifyClient(token)

    def run_actor(
        self,
        actor_id: str,
        run_input: dict[str, Any],
        *,
        timeout_secs: int,
        max_items: int,
    ) -> ActorRun:
        run = self._client.actor(actor_id).call(
            run_input=run_input,
            run_timeout=timedelta(seconds=timeout_secs),
            wait_duration=timedelta(seconds=timeout_secs + _WAIT_SLACK_SECS),
            logger=None,
        )
        if run is None:
            raise SourceError(actor_id, f"run did not finish within {timeout_secs}s")
        status = str(run.status)
        if status != "SUCCEEDED":
            return ActorRun(run_id=run.id, status=status, items=[])
        page = self._client.dataset(run.default_dataset_id).list_items(limit=max_items)
        return ActorRun(run_id=run.id, status=status, items=page.items)


def _utc_now() -> datetime:
    return datetime.now(UTC)


class ApifyRunner:
    """Run Apify actors with a `source_cache` result cache and an item cap."""

    def __init__(
        self,
        client: ActorClient,
        conn: sqlite3.Connection,
        config: ApifyConfig,
        *,
        clock: Callable[[], datetime] = _utc_now,
    ) -> None:
        self._client = client
        self._conn = conn
        self._config = config
        self._clock = clock

    @classmethod
    def from_settings(cls, settings: Settings, conn: sqlite3.Connection) -> "ApifyRunner":
        """Build a runner on the real Apify client using `APIFY_TOKEN` from the environment."""
        token = settings.secrets.apify_token
        if not token:
            raise SourceError("apify", "APIFY_TOKEN is not set (see .env.example)")
        return cls(ApifyActorClient(token), conn, settings.apify)

    def run(self, actor_id: str, input: dict[str, Any]) -> list[dict[str, Any]]:
        """Dataset items for `actor_id` run with `input`, from cache when still fresh."""
        return self.run_with_provenance(actor_id, input).items

    def run_with_provenance(self, actor_id: str, run_input: dict[str, Any]) -> ApifyResult:
        """Like `run`, but also reports the Apify run ID and whether the cache answered."""
        key = self._cache_key(actor_id, run_input)
        cached = self._read_cache(key, actor_id)
        if cached is not None:
            return cached

        cap = self._config.max_items
        try:
            outcome = self._client.run_actor(
                actor_id, run_input, timeout_secs=self._config.run_timeout_secs, max_items=cap
            )
        except SourceError:
            raise
        except ApifyApiError as exc:
            raise SourceError(actor_id, f"Apify API error: {exc}") from exc
        except Exception as exc:
            raise SourceError(actor_id, f"{type(exc).__name__}: {exc}") from exc

        if outcome.status != "SUCCEEDED":
            raise SourceError(actor_id, f"run {outcome.run_id} ended with status {outcome.status}")
        result = ApifyResult(
            actor_id=actor_id,
            run_id=outcome.run_id,
            items=outcome.items[:cap],
            fetched_at=self._clock(),
            cached=False,
        )
        self._write_cache(key, result)
        return result

    @staticmethod
    def _cache_key(actor_id: str, run_input: dict[str, Any]) -> str:
        return f"apify:{actor_id}:{json.dumps(run_input, sort_keys=True, default=str)}"

    def _read_cache(self, key: str, actor_id: str) -> ApifyResult | None:
        row = self._conn.execute(
            "SELECT payload, fetched_at FROM source_cache WHERE key = ?", (key,)
        ).fetchone()
        if row is None:
            return None
        try:
            fetched_at = datetime.fromisoformat(row["fetched_at"])
            payload = json.loads(row["payload"])
            run_id = str(payload["run_id"])
            items = list(payload["items"])
            expired = self._clock() - fetched_at >= timedelta(days=self._config.cache_ttl_days)
        except (ValueError, KeyError, TypeError):
            return None  # unreadable entry: treat as a miss and overwrite it on the next run
        if expired:
            return None
        return ApifyResult(
            actor_id=actor_id,
            run_id=run_id,
            items=items[: self._config.max_items],
            fetched_at=fetched_at,
            cached=True,
        )

    def _write_cache(self, key: str, result: ApifyResult) -> None:
        payload = json.dumps({"run_id": result.run_id, "items": result.items})
        with self._conn:
            self._conn.execute(
                "INSERT OR REPLACE INTO source_cache (key, payload, fetched_at) VALUES (?, ?, ?)",
                (key, payload, result.fetched_at.isoformat()),
            )
