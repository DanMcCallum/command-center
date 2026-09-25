import sqlite3
from pathlib import Path

from land_comps.db import init_db

EXPECTED_TABLES = {
    "parcels",
    "county_sales",
    "candidates",
    "source_cache",
    "jev_cache",
    "runs",
    "run_results",
}


def _table_names(conn: sqlite3.Connection) -> set[str]:
    rows = conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
    return {row["name"] for row in rows}


def test_init_db_creates_all_tables(tmp_path: Path) -> None:
    conn = init_db(tmp_path / "land_comps.sqlite")
    assert EXPECTED_TABLES <= _table_names(conn)


def test_init_db_is_idempotent(tmp_path: Path) -> None:
    db_path = tmp_path / "land_comps.sqlite"

    first = init_db(db_path)
    first.close()
    second = init_db(db_path)

    assert EXPECTED_TABLES <= _table_names(second)
