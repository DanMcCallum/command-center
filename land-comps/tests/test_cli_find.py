import csv
import json
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import pytest
import yaml
from rich.console import Console
from typer.testing import CliRunner, Result

from land_comps import cli
from land_comps.apify_runner import ApifyRunner
from land_comps.db import init_db
from land_comps.gather import NamedSource
from land_comps.geo import haversine_miles
from land_comps.jev import JevFatalError, JevJudge, JevUnavailableError, JudgedAnswers
from land_comps.models import Candidate, JevAnswers, Parcel
from land_comps.pipeline import FindClients
from land_comps.regrid import QuotaExceeded
from land_comps.scoring import Features
from land_comps.sources import SourceError

runner = CliRunner()
EXAMPLE_CONFIG = Path(__file__).parent.parent / "config.example.yaml"

SUBJECT = Parcel(
    apn="0034567890",
    address="1234 County Road 18",
    lat=39.222615,
    lon=-105.991278,
    acreage=5.0,
    zoning="A-1",
    land_use="Vacant Land",
    county_fips="08093",
    zip="80440",
)
TODAY = date.today()


def _cand(
    source: str, source_id: str, status: str, miles: float, months: int, **f: Any
) -> Candidate:
    fields: dict[str, Any] = {
        "source": source,
        "sources": [source],
        "source_id": source_id,
        "status": status,
        "lat": SUBJECT.lat + miles / 69.0,
        "lon": SUBJECT.lon,
        "acreage": 5.0,
        "price": 50000.0,
        "event_date": TODAY - timedelta(days=30 * months),
    }
    return Candidate.model_validate({**fields, **f})


SOLD_BEST = _cand("county_sales", "a", "sold", 0.2, 3, apn="0034567001", deed_type="WD")
# The same parcel as SOLD_BEST seen on a listing site: dedupe must collapse the pair.
SOLD_BEST_DUP = _cand(
    "realtor", "a-dup", "sold", 0.2, 3, apn="0034567001", url="https://realtor.example/a"
)
LISTED = _cand(
    "landwatch", "b", "active", 0.5, 6, address="B Aspen Rd", price=60000.0, acreage=4.5,
    url="https://landwatch.example/b",
)  # fmt: skip
PENDING = _cand("landwatch", "g", "pending", 0.6, 4, address="G Pine Rd", url="https://lw/g")
SOLD_MARGINAL = _cand("county_sales", "c", "sold", 0.8, 8, apn="0034567003", acreage=6.0)
SOLD_REJECT = _cand("county_sales", "f", "sold", 0.9, 9, apn="0034567006")
FILTERED_NOMINAL = _cand("county_sales", "d", "sold", 0.3, 2, apn="0034567004", price=500.0)
FILTERED_ACREAGE = _cand("county_sales", "e", "sold", 0.3, 2, apn="0034567005", acreage=100.0)

ALL_CANDIDATES = [
    SOLD_BEST,
    SOLD_BEST_DUP,
    LISTED,
    PENDING,
    SOLD_MARGINAL,
    SOLD_REJECT,
    FILTERED_NOMINAL,
    FILTERED_ACREAGE,
]


def _answers(good: float, level: float, choice: str) -> JevAnswers:
    def score() -> dict[str, float]:
        return {"score": level, "confidence": 0.9}

    return JevAnswers.model_validate(
        {
            "is_good_comp": {"probability": good, "confidence": 0.9},
            "arms_length": {"probability": 0.95, "confidence": 0.9},
            "physical_similarity": score(),
            "access_utilities_similarity": score(),
            "market_similarity": score(),
            "red_flags": {"probability": 0.05, "confidence": 0.9},
            "quality_tier": {"choice": choice, "probability": 0.8, "confidence": 0.9},
        }
    )


ANSWERS = {
    "0034567001": _answers(1.0, 3.0, "excellent"),
    "B Aspen Rd": _answers(0.9, 2.5, "good"),
    "G Pine Rd": _answers(0.7, 2.4, "good"),
    "0034567003": _answers(0.5, 1.5, "marginal"),
    "0034567006": _answers(0.1, 0.0, "reject"),
}
DEFAULT_ANSWERS = ANSWERS["G Pine Rd"]  # for candidates a test adds (e.g. APNs from --resolve-apn)
# Expected order: tier, then composite; sold and listing comps share one rank.
EXPECTED_ORDER = ["0034567001", "B Aspen Rd", "G Pine Rd", "0034567003"]


class FakeRegrid:
    """Resolves the subject; `by_point` resolves listings to an APN (for --resolve-apn)."""

    def __init__(self) -> None:
        self.points: list[tuple[float, float]] = []

    def by_apn(self, apn: str, county_fips: str) -> Parcel | None:
        return SUBJECT if apn == SUBJECT.apn else None

    def by_address(self, address: str) -> Parcel | None:
        return SUBJECT if "county road 18" in address.lower() else None

    def by_point(self, lat: float, lon: float) -> Parcel | None:
        self.points.append((lat, lon))
        return SUBJECT.model_copy(update={"apn": f"99{round(lat * 1e5)}"})


class FakeJudge:
    def __init__(self, unavailable: set[str] | None = None, fatal: bool = False) -> None:
        self.calls = 0
        self.unavailable = unavailable or set()
        self.fatal = fatal

    def judge_many(
        self, states: list[dict[str, Any]], concurrency: int = 8
    ) -> list[JudgedAnswers | JevUnavailableError]:
        if self.fatal:
            raise JevFatalError("Jev rejected the API key (HTTP 401)")
        out: list[JudgedAnswers | JevUnavailableError] = []
        for state in states:
            self.calls += 1
            key = state["candidate"].get("apn") or state["candidate"]["address"]
            if key in self.unavailable:
                out.append(JevUnavailableError("rate limited (gave up after 5 tries)"))
            else:
                out.append(
                    JudgedAnswers(
                        ANSWERS.get(key, DEFAULT_ANSWERS), input_tokens=1000, cached=False
                    )
                )
        return out


def _miles(subject: Parcel, candidate: Candidate) -> float:
    assert candidate.lat is not None and candidate.lon is not None
    return haversine_miles(subject.lat, subject.lon, candidate.lat, candidate.lon)


def _source(name: str, candidates: list[Candidate]) -> NamedSource:
    return NamedSource(name, lambda subject, radius, months: list(candidates))


def _failing_source(name: str) -> NamedSource:
    def fetch(subject: Parcel, radius: float, months: int) -> list[Candidate]:
        raise SourceError("actor/landwatch", "run timed out")

    return NamedSource(name, fetch)


class Harness:
    def __init__(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, **config: Any) -> None:
        self.tmp_path = tmp_path
        self.db = tmp_path / "x.sqlite"
        self.regrid = FakeRegrid()
        self.judge = FakeJudge()
        self.sources = [
            _source("county_sales", [SOLD_BEST, SOLD_MARGINAL, SOLD_REJECT, FILTERED_NOMINAL]),
            _source("landwatch", [LISTED, PENDING, FILTERED_ACREAGE]),
            _source("realtor", [SOLD_BEST_DUP]),
        ]
        raw = yaml.safe_load(EXAMPLE_CONFIG.read_text())
        raw["search"]["min_candidates"] = 1
        raw["search"].update(config)
        self.config = tmp_path / "config.yaml"
        self.config.write_text(yaml.safe_dump(raw))
        monkeypatch.setattr(cli, "console", Console(width=300))
        monkeypatch.setattr(cli, "find_clients_factory", self._clients)

    def _clients(self, settings: Any, conn: Any) -> FindClients:
        return FindClients(regrid=self.regrid, sources=self.sources, judge=self.judge)

    def invoke(self, *args: str, target: str = "34567890") -> Result:
        return runner.invoke(
            cli.app,
            ["find", target, "--config", str(self.config), "--db", str(self.db), *args],
        )


@pytest.fixture
def harness(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Harness:
    return Harness(tmp_path, monkeypatch)


def _export_json(harness: Harness, *args: str) -> dict[str, Any]:
    out = harness.tmp_path / "results.json"
    result = harness.invoke("--out", str(out), *args)
    assert result.exit_code == 0, result.output
    loaded: dict[str, Any] = json.loads(out.read_text())
    return loaded


def _keys(document: dict[str, Any]) -> list[str]:
    return [c["candidate"]["apn"] or c["candidate"]["address"] for c in document["comps"]]


def test_fixture_subject_ranks_in_expected_order_and_renders_both_sections(
    harness: Harness,
) -> None:
    result = harness.invoke()

    assert result.exit_code == 0, result.output
    out = result.output
    assert out.index("Sold comps") < out.index("Listing comps")
    sold_section, listing_section = out.split("Listing comps")
    assert "0034567001" in sold_section and "0034567003" in sold_section
    assert "B Aspen Rd" in listing_section and "G Pine Rd" in listing_section
    assert "SOLD" in sold_section and "LIST" in listing_section and "PEND" in listing_section
    assert "Subject: APN 0034567890" in out
    # Positions in the printed table follow the rank: 1, 2 and 4 sold/list interleaved.
    assert out.index("0034567001") < out.index("0034567003")
    assert out.index("B Aspen Rd") < out.index("G Pine Rd")


def test_run_row_and_results_are_persisted(harness: Harness) -> None:
    result = harness.invoke()
    assert result.exit_code == 0, result.output

    conn = init_db(harness.db)
    runs = conn.execute("SELECT * FROM runs").fetchall()
    assert len(runs) == 1
    assert runs[0]["subject_input"] == "34567890"
    assert runs[0]["subject_apn"] == SUBJECT.apn
    results = conn.execute(
        "SELECT * FROM run_results WHERE run_id = ? ORDER BY id", (runs[0]["id"],)
    ).fetchall()
    # Every judged candidate is stored (rejects included), in rank order.
    assert len(results) == 5
    assert [r["tier"] for r in results][:4] == ["excellent", "good", "good", "marginal"]
    assert results[-1]["tier"] == "reject"


def test_stored_run_holds_everything_rescoring_needs(harness: Harness) -> None:
    assert harness.invoke().exit_code == 0

    conn = init_db(harness.db)
    row = conn.execute("SELECT * FROM run_results ORDER BY id LIMIT 1").fetchone()
    answers = JevAnswers.model_validate_json(row["answers_json"])
    assert answers == ANSWERS["0034567001"]
    stored = json.loads(row["features_json"])
    features = Features.model_validate(stored["features"])
    candidate = Candidate.model_validate(stored["candidate"])
    assert features.distance_miles == pytest.approx(0.2, abs=0.01)
    assert features.months_since_event is not None
    assert candidate.apn == "0034567001"
    assert candidate.sources == ["county_sales", "realtor"]  # the merged record, not one source
    assert stored["state"]["comparison"]["distance_miles"] == pytest.approx(0.2, abs=0.01)
    assert stored["state"]["candidate"]["apn"] == "0034567001"
    run = json.loads(conn.execute("SELECT params_json FROM runs").fetchone()["params_json"])
    assert run["counts"]["judged"] == 5
    assert run["subject"]["apn"] == SUBJECT.apn


def test_json_export_has_full_results_with_raw_jev_answers_and_provenance(
    harness: Harness,
) -> None:
    document = _export_json(harness)

    assert _keys(document) == EXPECTED_ORDER  # reject-tier hidden by default
    assert [c["rank"] for c in document["comps"]] == [1, 2, 3, 4]
    first = document["comps"][0]
    assert first["section"] == "sold"
    assert first["result"]["tier"] == "excellent"
    assert first["result"]["composite"] > 0.9
    assert first["result"]["answers"]["is_good_comp"] == {"probability": 1.0, "confidence": 0.9}
    assert first["result"]["answers"]["quality_tier"]["choice"] == "excellent"
    assert first["result"]["answers"]["physical_similarity"]["score"] == 3.0
    assert {p["source"] for p in first["provenance"]} == {"county_sales", "realtor"}
    assert first["urls"] == ["https://realtor.example/a"]
    assert first["candidate"]["sources"] == ["county_sales", "realtor"]
    assert document["comps"][1]["urls"] == ["https://landwatch.example/b"]
    assert document["run"]["subject"]["apn"] == SUBJECT.apn
    assert document["run"]["counts"] == {
        "gathered": 8,
        "deduped": 7,
        "filtered": 2,
        "judged": 5,
        "unjudged": 0,
    }


def test_csv_export_has_the_table_columns(harness: Harness) -> None:
    out = harness.tmp_path / "results.csv"
    result = harness.invoke("--out", str(out))

    assert result.exit_code == 0, result.output
    with out.open(newline="") as handle:
        rows = list(csv.DictReader(handle))
    assert list(rows[0]) == [
        "rank", "tier", "composite", "status", "apn", "address", "acreage", "price",
        "price_per_acre", "distance_mi", "date", "sources", "flags",
    ]  # fmt: skip
    assert [r["rank"] for r in rows] == ["1", "2", "3", "4"]
    assert [r["status"] for r in rows] == ["SOLD", "LIST", "PEND", "SOLD"]
    assert rows[0]["apn"] == "0034567001"
    assert rows[0]["sources"] == "county_sales;realtor"
    assert float(rows[0]["price_per_acre"]) == pytest.approx(10000.0)
    assert rows[1]["address"] == "B Aspen Rd"


def test_rejects_hidden_unless_requested(harness: Harness) -> None:
    hidden = harness.invoke()
    shown = harness.invoke("--include-rejects")

    assert "0034567006" not in hidden.output
    assert "1 reject-tier comps hidden" in hidden.output
    assert "0034567006" in shown.output
    document = _export_json(harness, "--include-rejects")
    assert _keys(document) == [*EXPECTED_ORDER, "0034567006"]
    assert document["comps"][-1]["result"]["tier"] == "reject"


def test_top_limits_displayed_and_exported_comps(harness: Harness) -> None:
    document = _export_json(harness, "--top", "2")

    assert _keys(document) == EXPECTED_ORDER[:2]


def test_footer_reports_counts_filter_reasons_and_cost(harness: Harness) -> None:
    result = harness.invoke()

    assert "Gathered 8 | deduped 7 | filtered 2 (acreage_out_of_band 1, nominal_price 1)" in (
        result.output
    )
    assert "judged 5" in result.output
    # 5 judged candidates x 1,000 tokens at $0.042 per million tokens.
    assert "Jev 5,000 input tokens ($0.0002)" in result.output
    assert "Apify 0 items" in result.output and "Regrid 0 records" in result.output


def test_failed_source_shows_in_header_without_crashing(harness: Harness) -> None:
    harness.sources[1] = _failing_source("landwatch")

    result = harness.invoke()

    assert result.exit_code == 0, result.output
    assert "Source error: actor/landwatch: run timed out" in result.output
    assert "0034567001" in result.output  # the other sources still produce comps
    assert "B Aspen Rd" not in result.output


def test_widening_steps_are_shown_in_the_header(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    harness = Harness(tmp_path, monkeypatch, min_candidates=4)
    pool = [
        _cand("county_sales", "n1", "sold", 0.2, 3, apn="0034567001"),
        _cand("county_sales", "n2", "sold", 0.4, 3, apn="0034567003"),
        _cand("landwatch", "m1", "active", 0.7, 3, address="G Pine Rd"),
        _cand("landwatch", "m2", "active", 0.9, 3, address="B Aspen Rd"),
        _cand("landwatch", "far", "active", 1.2, 3, address="Far Rd"),
    ]

    def fetch(subject: Parcel, radius: float, months: int) -> list[Candidate]:
        return [c for c in pool if _miles(subject, c) <= radius]

    harness.sources = [NamedSource("county_sales", fetch)]

    result = harness.invoke("--radius", "0.5")

    assert result.exit_code == 0, result.output
    assert "Widened: radius:0.75mi (3 kept), radius:1.125mi (4 kept)" in result.output
    assert "Search: radius 1.125 mi" in result.output
    assert "widened:radius:0.75mi" in result.output  # the flag on the comp widening found
    assert "Far Rd" not in result.output


def test_radius_above_the_maximum_is_rejected_before_any_client_is_built(
    harness: Harness, monkeypatch: pytest.MonkeyPatch
) -> None:
    def explode(settings: Any, conn: Any) -> FindClients:
        raise AssertionError("no client may be built for an invalid radius")

    monkeypatch.setattr(cli, "find_clients_factory", explode)

    result = harness.invoke("--radius", "5.5")

    assert result.exit_code == 1
    assert "exceeds the maximum search radius of 5 mi" in result.output
    assert not harness.db.exists()


def test_radius_at_the_maximum_is_accepted(harness: Harness) -> None:
    assert harness.invoke("--radius", "5").exit_code == 0


def test_nonpositive_radius_is_rejected(harness: Harness) -> None:
    result = harness.invoke("--radius", "0")

    assert result.exit_code == 1
    assert "must be positive" in result.output


def test_bad_out_extension_is_rejected_up_front(harness: Harness) -> None:
    result = harness.invoke("--out", str(harness.tmp_path / "results.xlsx"))

    assert result.exit_code == 1
    assert "must end in .json or .csv" in result.output
    assert not harness.db.exists()


def test_unwritable_out_path_exits_1(harness: Harness) -> None:
    result = harness.invoke("--out", str(harness.tmp_path / "missing-dir" / "r.json"))

    assert result.exit_code == 1
    assert "Could not write" in result.output


def test_unknown_subject_exits_2_and_saves_nothing(harness: Harness) -> None:
    result = harness.invoke(target="99999999")

    assert result.exit_code == 2
    assert "No parcel found" in result.output
    conn = init_db(harness.db)
    assert conn.execute("SELECT COUNT(*) FROM runs").fetchone()[0] == 0


def test_address_subject_is_resolved_by_address(harness: Harness) -> None:
    result = harness.invoke(target="1234 County Road 18, Fairplay CO")

    assert result.exit_code == 0, result.output
    assert "0034567001" in result.output


def test_candidate_jev_cannot_answer_is_reported_not_fatal(harness: Harness) -> None:
    harness.judge.unavailable = {"G Pine Rd"}

    result = harness.invoke()

    assert result.exit_code == 0, result.output
    assert "judged 4 (+1 unjudged)" in result.output
    assert "Unjudged: G Pine Rd: rate limited" in result.output
    assert "PEND" not in result.output


def test_fatal_jev_error_exits_1(harness: Harness) -> None:
    harness.judge.fatal = True

    result = harness.invoke()

    assert result.exit_code == 1
    assert "Jev rejected the API key" in result.output
    conn = init_db(harness.db)
    assert conn.execute("SELECT COUNT(*) FROM runs").fetchone()[0] == 0


def test_regrid_failure_exits_1(harness: Harness, monkeypatch: pytest.MonkeyPatch) -> None:
    def exhausted(settings: Any, conn: Any) -> FindClients:
        raise QuotaExceeded("cap reached (2000/2000)")

    monkeypatch.setattr(cli, "find_clients_factory", exhausted)

    result = harness.invoke()

    assert result.exit_code == 1
    assert "cap reached" in result.output


def test_resolve_apn_flag_looks_up_listing_apns(harness: Harness) -> None:
    without = harness.invoke()
    assert without.exit_code == 0
    assert harness.regrid.points == []

    result = harness.invoke("--resolve-apn")

    assert result.exit_code == 0, result.output
    # Only candidates lacking an APN (the two listings) are looked up.
    assert len(harness.regrid.points) == 2


def test_default_clients_require_a_typesafe_key(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    monkeypatch.chdir(tmp_path)  # no .env here
    monkeypatch.setattr(cli, "parcel_lookup_factory", lambda s, c: FakeRegrid())
    harness = Harness(tmp_path, monkeypatch)
    monkeypatch.setattr(cli, "find_clients_factory", cli.default_find_clients)

    result = harness.invoke()

    assert result.exit_code == 1
    assert "TYPESAFE_API_KEY" in result.output


# --- comps rescore -------------------------------------------------------------------------


def _forbid_clients(monkeypatch: pytest.MonkeyPatch) -> None:
    def factory(*args: Any, **kwargs: Any) -> Any:
        raise AssertionError("rescore built a network client")

    monkeypatch.setattr(cli, "find_clients_factory", factory)
    monkeypatch.setattr(cli, "parcel_lookup_factory", factory)
    monkeypatch.setattr(cli, "build_sources", factory)
    monkeypatch.setattr(JevJudge, "from_settings", factory)
    monkeypatch.setattr(ApifyRunner, "from_settings", factory)


def _reweight(harness: Harness, **scoring: Any) -> None:
    raw = yaml.safe_load(harness.config.read_text())
    raw["scoring"].update(scoring)
    harness.config.write_text(yaml.safe_dump(raw))


def _run_id(harness: Harness) -> str:
    conn = init_db(harness.db)
    try:
        return str(conn.execute("SELECT id FROM runs").fetchone()["id"])
    finally:
        conn.close()


def _rescore(harness: Harness, run_id: str, *args: str) -> Result:
    return runner.invoke(
        cli.app,
        ["rescore", run_id, "--config", str(harness.config), "--db", str(harness.db), *args],
    )


def test_rescore_with_changed_weight_reorders_without_any_client_call(
    harness: Harness, monkeypatch: pytest.MonkeyPatch
) -> None:
    before = _export_json(harness)
    assert _keys(before) == EXPECTED_ORDER
    judge_calls, run_id = harness.judge.calls, _run_id(harness)
    # Recency alone: G Pine Rd (4 months old) now outranks B Aspen Rd (6 months old).
    _reweight(harness, w1=0, w2=0, w3=0, w4=0, w5=1.0, w6=0, w7=0)
    _forbid_clients(monkeypatch)
    harness.regrid.points.clear()

    out = harness.tmp_path / "rescored.json"
    result = _rescore(harness, run_id, "--out", str(out))

    assert result.exit_code == 0, result.output
    assert result.output.index("G Pine Rd") < result.output.index("B Aspen Rd")
    assert "Sold comps" in result.output and "Listing comps" in result.output
    assert f"run {run_id}" in result.output
    rescored = json.loads(out.read_text())
    assert _keys(rescored) == ["0034567001", "G Pine Rd", "B Aspen Rd", "0034567003"]
    assert [c["rank"] for c in rescored["comps"]] == [1, 2, 3, 4]
    assert harness.judge.calls == judge_calls
    assert harness.regrid.points == []
    # Nothing is saved: the original run is untouched and no second run exists.
    conn = init_db(harness.db)
    assert conn.execute("SELECT COUNT(*) FROM runs").fetchone()[0] == 1
    tiers = [r["tier"] for r in conn.execute("SELECT tier FROM run_results ORDER BY id")]
    assert tiers[:4] == ["excellent", "good", "good", "marginal"]


def test_rescore_with_unchanged_config_matches_the_original_ranking(
    harness: Harness, monkeypatch: pytest.MonkeyPatch
) -> None:
    before = _export_json(harness, "--include-rejects")
    _forbid_clients(monkeypatch)
    out = harness.tmp_path / "again.json"

    result = _rescore(harness, _run_id(harness), "--include-rejects", "--out", str(out))

    assert result.exit_code == 0, result.output
    after = json.loads(out.read_text())
    assert _keys(after) == _keys(before)
    assert [c["result"]["composite"] for c in after["comps"]] == pytest.approx(
        [c["result"]["composite"] for c in before["comps"]]
    )


def test_rescore_unknown_run_id_exits_nonzero_with_message(harness: Harness) -> None:
    assert harness.invoke().exit_code == 0

    result = _rescore(harness, "no-such-run")

    assert result.exit_code == 1
    assert "No run with id 'no-such-run'" in result.output


def test_rescore_missing_database_exits_nonzero(harness: Harness) -> None:
    result = _rescore(harness, "whatever")

    assert result.exit_code == 1
    assert "does not exist" in " ".join(result.output.split())
    assert not harness.db.exists()


def test_rescore_run_saved_without_detail_reports_it(harness: Harness) -> None:
    assert harness.invoke().exit_code == 0
    conn = init_db(harness.db)
    with conn:
        conn.execute("UPDATE run_results SET features_json = '{}'")
    conn.close()

    result = _rescore(harness, _run_id(harness))

    assert result.exit_code == 1
    assert "cannot be rescored" in result.output
