"""Concurrent candidate gathering across every enabled source.

`gather` runs each source on its own worker thread and collects what comes
back. A source that raises `SourceError` (or fails unexpectedly) is recorded in
`GatherResult.source_errors` while the other sources' candidates are still
returned, so one broken scraper never sinks a run.
"""

import logging
import sqlite3
from collections.abc import Callable, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

from land_comps.apify_runner import ApifyRunner
from land_comps.config import Settings
from land_comps.county_sales import SOURCE_NAME as COUNTY_SOURCE
from land_comps.county_sales import CountySalesSource
from land_comps.landwatch import SOURCE_NAME as LANDWATCH_SOURCE
from land_comps.landwatch import LandWatchSource
from land_comps.models import Candidate, Parcel
from land_comps.realtor import SOURCE_NAME as REALTOR_SOURCE
from land_comps.realtor import RealtorSource
from land_comps.sources import SourceError

logger = logging.getLogger(__name__)

FetchFn = Callable[[Parcel, float, int], list[Candidate]]


@dataclass(frozen=True)
class NamedSource:
    """A candidate source under the name `gather` logs and reports errors against."""

    name: str
    fetch: FetchFn


@dataclass
class GatherResult:
    """Candidates from every source that answered, plus one error per source that did not."""

    candidates: list[Candidate] = field(default_factory=list)
    source_errors: list[SourceError] = field(default_factory=list)
    counts: dict[str, int] = field(default_factory=dict)


def _run_source(
    source: NamedSource, subject: Parcel, radius_mi: float, lookback_months: int
) -> list[Candidate] | SourceError:
    try:
        return source.fetch(subject, radius_mi, lookback_months)
    except SourceError as exc:
        return exc
    except Exception as exc:  # any source bug is isolated, logged, and reported as an error
        logger.exception("source %s failed unexpectedly", source.name)
        return SourceError(source.name, f"unexpected {type(exc).__name__}: {exc}")


def gather(
    subject: Parcel,
    radius_mi: float,
    lookback_months: int,
    sources: Sequence[NamedSource],
) -> GatherResult:
    """Query all `sources` concurrently and merge their candidates (pre-dedup).

    Candidates keep source order (the order of `sources`), so results are
    deterministic regardless of which thread finishes first. The per-source
    candidate counts are logged and kept in `GatherResult.counts`.
    """
    result = GatherResult()
    if not sources:
        return result

    with ThreadPoolExecutor(max_workers=len(sources), thread_name_prefix="gather") as pool:
        futures = [
            pool.submit(_run_source, source, subject, radius_mi, lookback_months)
            for source in sources
        ]
        outcomes = [future.result() for future in futures]

    for source, outcome in zip(sources, outcomes, strict=True):
        if isinstance(outcome, SourceError):
            logger.warning("source %s failed: %s", source.name, outcome.reason)
            result.source_errors.append(outcome)
            continue
        result.counts[source.name] = len(outcome)
        result.candidates.extend(outcome)
        logger.info("source %s returned %d candidates", source.name, len(outcome))
    return result


class _UnavailableSource:
    """Stands in for a source that could not be built, so its failure is reported by `gather`."""

    def __init__(self, name: str, error: SourceError) -> None:
        self._name = name
        self._error = error

    def fetch(self, subject: Parcel, radius_mi: float, lookback_months: int) -> list[Candidate]:
        raise SourceError(self._name, self._error.reason)


def build_sources(settings: Settings, conn: sqlite3.Connection) -> list[NamedSource]:
    """The enabled sources: county sales always, plus LandWatch and Realtor.com via Apify.

    When `APIFY_TOKEN` is missing the two listing sources are still returned,
    each raising the runner's `SourceError`, so the gap shows up in
    `source_errors` instead of silently shrinking the candidate pool.
    """
    county = CountySalesSource(conn, settings.county)
    sources = [
        NamedSource(
            COUNTY_SOURCE,
            lambda subject, radius, months: county.fetch(subject, radius, months),
        )
    ]

    try:
        runner = ApifyRunner.from_settings(settings, conn)
    except SourceError as exc:
        return sources + [
            NamedSource(name, _UnavailableSource(name, exc).fetch)
            for name in (LANDWATCH_SOURCE, REALTOR_SOURCE)
        ]

    landwatch = LandWatchSource(runner, settings.apify.landwatch_actor_id)
    realtor = RealtorSource(runner, settings.apify.realtor_actor_id)
    sources.append(
        NamedSource(
            LANDWATCH_SOURCE, lambda subject, radius, _months: landwatch.fetch(subject, radius)
        )
    )
    sources.append(
        NamedSource(REALTOR_SOURCE, lambda subject, radius, _months: realtor.fetch(subject, radius))
    )
    return sources
