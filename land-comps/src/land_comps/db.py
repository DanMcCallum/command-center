"""SQLite schema for local caching and run persistence.

Everything the pipeline touches lives in one file-based SQLite database:
resolved parcels, ingested county sales, normalized candidates, source/Jev
response caches, and the ranked output of each `comps find` run.
"""

import sqlite3
from pathlib import Path

_SCHEMA = """
CREATE TABLE IF NOT EXISTS parcels (
    apn TEXT PRIMARY KEY,
    county_fips TEXT NOT NULL,
    address TEXT,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    acreage REAL,
    zoning TEXT,
    land_use TEXT,
    zip TEXT
);

CREATE TABLE IF NOT EXISTS county_sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    apn TEXT NOT NULL,
    sale_date TEXT,
    sale_price REAL,
    deed_type TEXT,
    land_use_code TEXT,
    is_vacant INTEGER NOT NULL DEFAULT 0,
    acreage REAL,
    lat REAL,
    lon REAL,
    UNIQUE (apn, sale_date, sale_price)
);

CREATE INDEX IF NOT EXISTS idx_county_sales_apn ON county_sales (apn);
CREATE INDEX IF NOT EXISTS idx_county_sales_latlon ON county_sales (lat, lon);

CREATE TABLE IF NOT EXISTS candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    source_id TEXT NOT NULL,
    sources TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL,
    apn TEXT,
    address TEXT,
    lat REAL,
    lon REAL,
    acreage REAL,
    price REAL,
    list_price REAL,
    sold_price REAL,
    price_per_acre REAL,
    event_date TEXT,
    deed_type TEXT,
    road_access TEXT,
    utilities TEXT NOT NULL DEFAULT '[]',
    topography TEXT,
    description TEXT,
    url TEXT,
    raw TEXT NOT NULL DEFAULT '{}',
    UNIQUE (source, source_id)
);

CREATE TABLE IF NOT EXISTS source_cache (
    key TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jev_cache (
    key TEXT PRIMARY KEY,
    response_json TEXT NOT NULL,
    input_tokens INTEGER
);

CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    subject_input TEXT NOT NULL,
    subject_apn TEXT,
    created_at TEXT NOT NULL,
    params_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS run_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES runs (id),
    candidate_id INTEGER REFERENCES candidates (id),
    composite REAL NOT NULL,
    tier TEXT NOT NULL,
    gates_triggered TEXT NOT NULL DEFAULT '[]',
    answers_json TEXT NOT NULL,
    features_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_run_results_run_id ON run_results (run_id);
"""


def init_db(path: str | Path) -> sqlite3.Connection:
    """Open (creating if needed) the SQLite DB at `path` and ensure all tables exist.

    Safe to call repeatedly: every statement is `CREATE ... IF NOT EXISTS`.
    """
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(_SCHEMA)
    conn.commit()
    return conn
