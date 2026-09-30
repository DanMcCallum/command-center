import json
import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from land_comps.apify_runner import ActorRun, ApifyActorClient, ApifyRunner
from land_comps.config import ApifyConfig, Settings
from land_comps.db import init_db
from land_comps.sources import SourceError

ACTOR = "acme/landwatch-scraper"
START = datetime(2026, 9, 1, tzinfo=UTC)


class FakeActorClient:
    def __init__(
        self,
        items: list[dict[str, Any]] | None = None,
        status: str = "SUCCEEDED",
        error: Exception | None = None,
    ) -> None:
        self.items = items if items is not None else [{"id": 1}, {"id": 2}, {"id": 3}]
        self.status = status
        self.error = error
        self.calls: list[tuple[str, dict[str, Any], int, int]] = []

    def run_actor(
        self, actor_id: str, run_input: dict[str, Any], *, timeout_secs: int, max_items: int
    ) -> ActorRun:
        self.calls.append((actor_id, run_input, timeout_secs, max_items))
        if self.error is not None:
            raise self.error
        return ActorRun(run_id=f"run{len(self.calls)}", status=self.status, items=self.items)


class Clock:
    def __init__(self) -> None:
        self.now = START

    def __call__(self) -> datetime:
        return self.now


@pytest.fixture
def conn(tmp_path: Path) -> sqlite3.Connection:
    return init_db(tmp_path / "t.sqlite")


def _runner(
    conn: sqlite3.Connection, client: FakeActorClient, clock: Clock | None = None, **cfg: Any
) -> ApifyRunner:
    config = ApifyConfig(landwatch_actor_id="lw", realtor_actor_id="rt", **cfg)
    return ApifyRunner(client, conn, config, clock=clock or Clock())


def test_run_returns_items(conn: sqlite3.Connection) -> None:
    client = FakeActorClient()

    items = _runner(conn, client).run(ACTOR, {"zip": "80440"})

    assert items == [{"id": 1}, {"id": 2}, {"id": 3}]
    assert client.calls == [(ACTOR, {"zip": "80440"}, 300, 500)]


def test_items_capped_at_max_items(conn: sqlite3.Connection) -> None:
    client = FakeActorClient(items=[{"id": i} for i in range(10)])

    items = _runner(conn, client, max_items=4).run(ACTOR, {})

    assert [i["id"] for i in items] == [0, 1, 2, 3]
    assert client.calls[0][3] == 4


def test_repeat_run_within_ttl_uses_cache(conn: sqlite3.Connection) -> None:
    client, clock = FakeActorClient(), Clock()
    runner = _runner(conn, client, clock, cache_ttl_days=7)

    first = runner.run_with_provenance(ACTOR, {"a": 1, "b": 2})
    clock.now = START + timedelta(days=6, hours=23)
    second = runner.run_with_provenance(ACTOR, {"b": 2, "a": 1})  # key order must not matter

    assert len(client.calls) == 1
    assert (first.cached, second.cached) == (False, True)
    assert second.items == first.items
    assert second.run_id == first.run_id == "run1"
    assert second.actor_id == ACTOR


def test_expired_entry_reruns(conn: sqlite3.Connection) -> None:
    client, clock = FakeActorClient(), Clock()
    runner = _runner(conn, client, clock, cache_ttl_days=7)

    runner.run(ACTOR, {"a": 1})
    clock.now = START + timedelta(days=7)
    result = runner.run_with_provenance(ACTOR, {"a": 1})

    assert len(client.calls) == 2
    assert not result.cached
    assert result.run_id == "run2"
    # The refreshed entry is fresh again.
    runner.run(ACTOR, {"a": 1})
    assert len(client.calls) == 2


def test_ttl_zero_disables_cache(conn: sqlite3.Connection) -> None:
    client = FakeActorClient()
    runner = _runner(conn, client, cache_ttl_days=0)

    runner.run(ACTOR, {})
    runner.run(ACTOR, {})

    assert len(client.calls) == 2


def test_cache_keyed_by_actor_and_input(conn: sqlite3.Connection) -> None:
    client = FakeActorClient()
    runner = _runner(conn, client)

    runner.run(ACTOR, {"zip": "80440"})
    runner.run(ACTOR, {"zip": "80421"})
    runner.run("other/actor", {"zip": "80440"})

    assert len(client.calls) == 3
    keys = [r["key"] for r in conn.execute("SELECT key FROM source_cache")]
    assert f'apify:{ACTOR}:{{"zip": "80440"}}' in keys


def test_failing_client_raises_source_error_naming_actor(conn: sqlite3.Connection) -> None:
    client = FakeActorClient(error=RuntimeError("connection reset"))

    with pytest.raises(SourceError) as exc_info:
        _runner(conn, client).run(ACTOR, {})

    assert exc_info.value.source == ACTOR
    assert ACTOR in str(exc_info.value)
    assert "connection reset" in exc_info.value.reason
    assert isinstance(exc_info.value.__cause__, RuntimeError)


@pytest.mark.parametrize("status", ["FAILED", "TIMED-OUT", "ABORTED", "RUNNING"])
def test_unsuccessful_status_raises_and_is_not_cached(
    conn: sqlite3.Connection, status: str
) -> None:
    client = FakeActorClient(status=status)
    runner = _runner(conn, client)

    with pytest.raises(SourceError, match=status):
        runner.run(ACTOR, {})

    assert conn.execute("SELECT COUNT(*) FROM source_cache").fetchone()[0] == 0


def test_source_error_from_client_passes_through(conn: sqlite3.Connection) -> None:
    client = FakeActorClient(error=SourceError(ACTOR, "did not finish"))

    with pytest.raises(SourceError, match="did not finish"):
        _runner(conn, client).run(ACTOR, {})


def test_corrupt_cache_entry_is_a_miss(conn: sqlite3.Connection) -> None:
    client = FakeActorClient()
    runner = _runner(conn, client)
    runner.run(ACTOR, {})
    conn.execute("UPDATE source_cache SET payload = 'not json'")

    runner.run(ACTOR, {})

    assert len(client.calls) == 2
    payload = conn.execute("SELECT payload FROM source_cache").fetchone()[0]
    assert json.loads(payload)["run_id"] == "run2"


def test_cache_entry_with_naive_timestamp_is_a_miss(conn: sqlite3.Connection) -> None:
    client = FakeActorClient()
    runner = _runner(conn, client)
    runner.run(ACTOR, {})
    conn.execute("UPDATE source_cache SET fetched_at = '2020-01-01 00:00:00'")

    runner.run(ACTOR, {})

    assert len(client.calls) == 2


def test_from_settings_requires_token(
    conn: sqlite3.Connection, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("APIFY_TOKEN", raising=False)
    settings = Settings.model_validate(
        {
            "apify": {"landwatch_actor_id": "lw", "realtor_actor_id": "rt"},
            "county": {
                "fips": "08093",
                "apn_length": 10,
                "sales_file": "s",
                "parcels_file": "p",
                "column_mapping": {},
                "vacant_land_codes": [],
                "excluded_deed_types": [],
            },
            "secrets": {"apify_token": None},
        }
    )

    with pytest.raises(SourceError, match="APIFY_TOKEN"):
        ApifyRunner.from_settings(settings, conn)


class _FakeApifyClient:
    """Stands in for `apify_client.ApifyClient` inside the adapter."""

    def __init__(self, run: Any, items: list[dict[str, Any]]) -> None:
        self._run = run
        self._items = items
        self.call_kwargs: dict[str, Any] = {}
        self.list_limit: int | None = None

    def actor(self, actor_id: str) -> SimpleNamespace:
        def call(**kwargs: Any) -> Any:
            self.call_kwargs = kwargs
            return self._run

        return SimpleNamespace(call=call)

    def dataset(self, dataset_id: str) -> SimpleNamespace:
        def list_items(*, limit: int) -> SimpleNamespace:
            self.list_limit = limit
            return SimpleNamespace(items=self._items[:limit])

        return SimpleNamespace(list_items=list_items)


def _adapter(fake: _FakeApifyClient) -> ApifyActorClient:
    adapter = ApifyActorClient("tok")
    adapter._client = fake  # type: ignore[assignment]
    return adapter


def test_adapter_reads_dataset_of_successful_run() -> None:
    fake = _FakeApifyClient(
        SimpleNamespace(id="r9", status="SUCCEEDED", default_dataset_id="d9"),
        [{"id": i} for i in range(5)],
    )

    run = _adapter(fake).run_actor(ACTOR, {"x": 1}, timeout_secs=120, max_items=2)

    assert (run.run_id, run.status, run.items) == ("r9", "SUCCEEDED", [{"id": 0}, {"id": 1}])
    assert fake.list_limit == 2
    assert fake.call_kwargs["run_input"] == {"x": 1}
    assert fake.call_kwargs["run_timeout"] == timedelta(seconds=120)


def test_adapter_skips_dataset_for_failed_run() -> None:
    fake = _FakeApifyClient(
        SimpleNamespace(id="r9", status="FAILED", default_dataset_id="d9"), [{"id": 1}]
    )

    run = _adapter(fake).run_actor(ACTOR, {}, timeout_secs=120, max_items=2)

    assert (run.status, run.items) == ("FAILED", [])
    assert fake.list_limit is None


def test_adapter_run_that_never_finishes_raises() -> None:
    with pytest.raises(SourceError, match="did not finish"):
        _adapter(_FakeApifyClient(None, [])).run_actor(ACTOR, {}, timeout_secs=5, max_items=1)
