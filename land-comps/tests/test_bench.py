from pathlib import Path

import pytest
import yaml
from rich.console import Console
from typer.testing import CliRunner

from land_comps import cli
from land_comps.bench import BenchImportError, import_benchmark, normalize_subject_id
from land_comps.config import Settings, load_settings
from land_comps.db import init_db

runner = CliRunner()
FIXTURE = Path(__file__).parent / "fixtures" / "benchmark" / "crm_comps.csv"
EXAMPLE_CONFIG = Path(__file__).parent.parent / "config.example.yaml"
SUBJECT_APN = "0034567890"
SUBJECT_ADDRESS = "1500 COUNTY RD 18"


@pytest.fixture
def settings() -> Settings:
    return load_settings(EXAMPLE_CONFIG)


def test_fixture_import_stores_eight_rows_and_reports_the_skipped_one(
    tmp_path: Path, settings: Settings
) -> None:
    conn = init_db(tmp_path / "x.sqlite")

    result = import_benchmark(conn, settings, FIXTURE)

    assert (result.rows_read, result.rows_stored, result.subjects) == (9, 8, 2)
    assert len(result.skipped) == 1
    assert result.skipped[0].line == 10
    assert "both comp_apn and comp_address" in result.skipped[0].reason
    per_subject = dict(
        conn.execute("SELECT subject_id, COUNT(*) FROM benchmark_comps GROUP BY subject_id")
    )
    assert per_subject == {SUBJECT_APN: 4, SUBJECT_ADDRESS: 4}


def test_identifiers_are_normalized_and_optional_fields_kept(
    tmp_path: Path, settings: Settings
) -> None:
    conn = init_db(tmp_path / "x.sqlite")
    import_benchmark(conn, settings, FIXTURE)

    rows = conn.execute(
        "SELECT * FROM benchmark_comps WHERE subject_id = ? ORDER BY id", (SUBJECT_APN,)
    ).fetchall()

    assert [r["comp_apn"] for r in rows] == ["0034567001", "0034567002", None, "0034567004"]
    assert [r["comp_address"] for r in rows] == [None, "12 ASPEN RD", "7 PINE LN FAIRPLAY", None]
    assert [r["comp_price"] for r in rows] == [52000.0, 48000.0, 65000.0, 41000.0]
    assert [r["comp_date"] for r in rows][0] == "2026-03-15"
    assert [r["comp_status"] for r in rows] == ["sold", "sold", "active", "sold"]
    assert [r["crm_rating"] for r in rows] == ["5", "4", "3", None]
    # A row with neither price, date nor rating is still a valid comp.
    bare = conn.execute("SELECT * FROM benchmark_comps WHERE comp_apn = '0099887004'").fetchone()
    assert bare["comp_price"] is None and bare["comp_date"] is None


def test_reimport_replaces_per_subject_without_duplicating(
    tmp_path: Path, settings: Settings
) -> None:
    conn = init_db(tmp_path / "x.sqlite")
    import_benchmark(conn, settings, FIXTURE)

    again = import_benchmark(conn, settings, FIXTURE)

    assert again.rows_stored == 8 and again.replaced == 8
    assert conn.execute("SELECT COUNT(*) FROM benchmark_comps").fetchone()[0] == 8


def test_reimport_leaves_subjects_absent_from_the_file_alone(
    tmp_path: Path, settings: Settings
) -> None:
    conn = init_db(tmp_path / "x.sqlite")
    import_benchmark(conn, settings, FIXTURE)
    only_apn_subject = tmp_path / "one.csv"
    only_apn_subject.write_text(
        "subject_id,comp_apn,comp_address,comp_price,comp_date,comp_status\n"
        "34567890,0034567001,,1000,2026-01-01,sold\n"
    )

    result = import_benchmark(conn, settings, only_apn_subject)

    assert result.replaced == 4
    counts = dict(
        conn.execute("SELECT subject_id, COUNT(*) FROM benchmark_comps GROUP BY subject_id")
    )
    assert counts == {SUBJECT_APN: 1, SUBJECT_ADDRESS: 4}


def test_malformed_rows_are_skipped_with_reasons(tmp_path: Path, settings: Settings) -> None:
    conn = init_db(tmp_path / "x.sqlite")
    bad = tmp_path / "bad.csv"
    bad.write_text(
        "subject_id,comp_apn,comp_address,comp_price,comp_date,comp_status\n"
        ",0034567001,,1,2026-01-01,sold\n"
        "0034567890,0034567001,,abc,2026-01-01,sold\n"
        "0034567890,0034567001,,1,01/02/2026,sold\n"
        "0034567890,0034567001,,1,2026-01-01,leased\n"
        "0034567890,---,,1,2026-01-01,sold\n"
        "0034567890,0034567001,,nan,2026-01-01,sold\n"
    )

    result = import_benchmark(conn, settings, bad)

    assert result.rows_stored == 0 and len(result.skipped) == 6
    reasons = " | ".join(s.reason for s in result.skipped)
    for expected in ("subject_id", "comp_price is not a number", "YYYY-MM-DD", "leased"):
        assert expected in reasons
    assert conn.execute("SELECT COUNT(*) FROM benchmark_comps").fetchone()[0] == 0


def test_placeholder_identifiers_are_not_stored_as_bogus_keys(
    tmp_path: Path, settings: Settings
) -> None:
    conn = init_db(tmp_path / "x.sqlite")
    src = tmp_path / "placeholder.csv"
    src.write_text(
        "subject_id,comp_apn,comp_address,comp_price,comp_date,comp_status\n"
        "0034567890,-,1 Main St,1,2026-01-01,sold\n"
        '0034567890,0034567001,", .",1,2026-01-01,sold\n'
        ",,,1,2026-01-01,sold\n"
        "0034567890,0034567001,,-5,2026-01-01,sold\n"
        '"., ",0034567001,,1,2026-01-01,sold\n'
    )

    result = import_benchmark(conn, settings, src)

    assert result.rows_stored == 2 and len(result.skipped) == 3
    rows = conn.execute("SELECT comp_apn, comp_address FROM benchmark_comps ORDER BY id").fetchall()
    assert rows[0][0] is None and rows[0][1]
    assert rows[1][0] and rows[1][1] is None


def test_missing_required_column_or_file_is_an_error(tmp_path: Path, settings: Settings) -> None:
    conn = init_db(tmp_path / "x.sqlite")
    no_status = tmp_path / "cols.csv"
    no_status.write_text("subject_id,comp_apn\n1,2\n")

    with pytest.raises(BenchImportError, match="comp_status"):
        import_benchmark(conn, settings, no_status)
    with pytest.raises(BenchImportError, match="Cannot read"):
        import_benchmark(conn, settings, tmp_path / "missing.csv")


def test_subject_id_accepts_apn_or_address(settings: Settings) -> None:
    assert normalize_subject_id("34-567-890", settings) == SUBJECT_APN
    assert normalize_subject_id("1500 County Road 18", settings) == SUBJECT_ADDRESS


def _cli(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, *args: str) -> tuple[int, str]:
    monkeypatch.setattr(cli, "console", Console(width=200))
    config = tmp_path / "config.yaml"
    config.write_text(yaml.safe_dump(yaml.safe_load(EXAMPLE_CONFIG.read_text())))
    result = runner.invoke(
        cli.app,
        ["bench", "import", *args, "--config", str(config), "--db", str(tmp_path / "x.sqlite")],
    )
    return result.exit_code, result.output


def test_cli_import_reports_counts_and_skipped_rows(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    code, output = _cli(tmp_path, monkeypatch, str(FIXTURE))

    assert code == 0, output
    assert "stored 8 comps for 2 subjects, skipped 1" in output
    assert "Skipped line 10" in output


def test_cli_import_missing_file_exits_1(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    code, output = _cli(tmp_path, monkeypatch, str(tmp_path / "nope.csv"))

    assert code == 1
    assert "Cannot read" in output
    assert not (tmp_path / "x.sqlite").exists()
