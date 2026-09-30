"""Import the CRM tool's comps for benchmark subjects (`comps bench import`).

The CSV has one row per (subject, CRM comp). Identifiers are normalized with the same helpers
the pipeline uses (`normalize_apn`, `normalize_address`) so step 14 can match CRM comps to
gathered candidates. Rows that cannot be matched later (no APN and no address) or that are
malformed are skipped and reported, never silently dropped.

Re-importing is idempotent: every subject present in the file with at least one valid row has
its existing benchmark comps replaced (conservative: a corrected CSV supersedes the old one,
and subjects absent from the file are left alone).
"""

import csv
import math
import re
import sqlite3
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

from land_comps.config import Settings
from land_comps.normalize import looks_like_apn, normalize_address, normalize_apn

REQUIRED_COLUMNS = (
    "subject_id",
    "comp_apn",
    "comp_address",
    "comp_price",
    "comp_date",
    "comp_status",
)
OPTIONAL_COLUMNS = ("crm_rating",)
VALID_STATUSES = ("sold", "active")

_PRICE_STRIP_RE = re.compile(r"[$,\s]")


class BenchImportError(Exception):
    """The benchmark CSV cannot be read at all (missing file or columns)."""


@dataclass(frozen=True)
class SkippedRow:
    line: int  # 1-based line number in the CSV file (the header is line 1)
    reason: str


@dataclass
class ImportResult:
    rows_read: int = 0
    rows_stored: int = 0
    subjects: int = 0
    replaced: int = 0  # previously stored comps removed because their subject was re-imported
    skipped: list[SkippedRow] = field(default_factory=list)


@dataclass(frozen=True)
class _Row:
    subject_id: str
    comp_apn: str | None
    comp_address: str | None
    comp_price: float | None
    comp_date: str | None
    comp_status: str
    crm_rating: str | None


def normalize_subject_id(raw: str, settings: Settings) -> str:
    """A subject given as APN or address, normalized the way `comps find` reads its target."""
    if looks_like_apn(raw):
        return normalize_apn(raw, settings.county.fips, settings.county.apn_length)
    return normalize_address(raw)


def _parse_row(raw: dict[str, str | None], settings: Settings) -> _Row | str:
    """The normalized row, or the reason it must be skipped."""

    def cell(name: str) -> str:
        return (raw.get(name) or "").strip()

    subject_raw, apn_raw, address_raw = cell("subject_id"), cell("comp_apn"), cell("comp_address")
    if not subject_raw:
        return "missing subject_id"
    if not any(c.isalnum() for c in subject_raw):
        return f"subject_id holds no usable characters: {subject_raw!r}"
    if not apn_raw and not address_raw:
        return "missing both comp_apn and comp_address"
    # A placeholder like "-" or "N/A" must not become a zero-padded APN or an empty address.
    if not any(c.isalnum() for c in apn_raw):
        apn_raw = ""
    if not any(c.isalnum() for c in address_raw):
        address_raw = ""
    if not apn_raw and not address_raw:
        return "comp_apn and comp_address hold no usable characters"

    status = cell("comp_status").lower()
    if status not in VALID_STATUSES:
        return f"comp_status must be sold or active, got {cell('comp_status')!r}"

    price: float | None = None
    if cell("comp_price"):
        try:
            price = float(_PRICE_STRIP_RE.sub("", cell("comp_price")))
        except ValueError:
            return f"comp_price is not a number: {cell('comp_price')!r}"
        if not math.isfinite(price) or price < 0:
            return f"comp_price is not a non-negative number: {cell('comp_price')!r}"

    comp_date: str | None = None
    if cell("comp_date"):
        try:
            comp_date = date.fromisoformat(cell("comp_date")).isoformat()
        except ValueError:
            return f"comp_date must be YYYY-MM-DD, got {cell('comp_date')!r}"

    return _Row(
        subject_id=normalize_subject_id(subject_raw, settings),
        comp_apn=(
            normalize_apn(apn_raw, settings.county.fips, settings.county.apn_length)
            if apn_raw
            else None
        ),
        comp_address=normalize_address(address_raw) if address_raw else None,
        comp_price=price,
        comp_date=comp_date,
        comp_status=status,
        crm_rating=cell("crm_rating") or None,
    )


def import_benchmark(conn: sqlite3.Connection, settings: Settings, csv_path: Path) -> ImportResult:
    """Load `csv_path` into `benchmark_comps`; see the module docstring for the rules.

    Raises `BenchImportError` when the file is unreadable or lacks a required column.
    """
    result = ImportResult()
    rows: list[_Row] = []
    try:
        with csv_path.open(newline="", encoding="utf-8-sig") as handle:
            reader = csv.DictReader(handle)
            missing = [c for c in REQUIRED_COLUMNS if c not in (reader.fieldnames or [])]
            if missing:
                raise BenchImportError(
                    f"{csv_path} is missing required column(s): {', '.join(missing)}"
                )
            for raw in reader:
                result.rows_read += 1
                parsed = _parse_row(raw, settings)
                if isinstance(parsed, str):
                    result.skipped.append(SkippedRow(reader.line_num, parsed))
                else:
                    rows.append(parsed)
    except (OSError, UnicodeDecodeError, csv.Error) as exc:
        raise BenchImportError(f"Cannot read {csv_path}: {exc}") from exc

    subjects = sorted({row.subject_id for row in rows})
    with conn:
        for subject_id in subjects:
            cursor = conn.execute("DELETE FROM benchmark_comps WHERE subject_id = ?", (subject_id,))
            result.replaced += cursor.rowcount
        conn.executemany(
            "INSERT INTO benchmark_comps (subject_id, comp_apn, comp_address, comp_price, "
            "comp_date, comp_status, crm_rating) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [
                (
                    r.subject_id,
                    r.comp_apn,
                    r.comp_address,
                    r.comp_price,
                    r.comp_date,
                    r.comp_status,
                    r.crm_rating,
                )
                for r in rows
            ],
        )
    result.rows_stored = len(rows)
    result.subjects = len(subjects)
    return result
