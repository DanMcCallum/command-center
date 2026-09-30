"""Re-rank a stored run under the current `scoring` config, entirely offline.

`load_run` returns each result's stored Jev answers, features and candidate snapshot; this
re-runs `score` and `rank` over them and rebuilds a `RunReport`, so `comps rescore` prints
through the same `render_report` as `comps find`. No client is involved: nothing here can
reach Jev, a scraper, or Regrid, and nothing is written back to the database.
"""

import sqlite3
from typing import Any

from land_comps.config import Settings
from land_comps.report import RankedComp, RunReport
from land_comps.runs import load_run
from land_comps.scoring import Features, ScoredComp, rank, score


def rescore_run(conn: sqlite3.Connection, settings: Settings, run_id: str) -> RunReport:
    """The stored run `run_id` re-scored and re-ranked with `settings.scoring`.

    Raises `RunNotFoundError` / `StoredRunError` (from `load_run`) when the run is missing or
    was saved without the detail rescoring needs. The header, counts and cost are the
    original run's: only scores, tiers, gates and ranks change.
    """
    summary, stored = load_run(conn, run_id)
    scored: list[ScoredComp] = []
    detail: dict[int, tuple[Features, dict[str, Any]]] = {}
    for item in stored:
        comp = ScoredComp(
            item.candidate, score(item.candidate, item.answers, item.features, settings)
        )
        scored.append(comp)
        detail[id(comp)] = (item.features, item.state)
    comps = [
        RankedComp(position, item.candidate, item.result, *detail[id(item)])
        for position, item in enumerate(rank(scored), start=1)
    ]
    return RunReport(summary, comps)
