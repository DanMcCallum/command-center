import sqlite3
from pathlib import Path
from typing import Annotated

import typer
from rich.console import Console
from rich.markup import escape
from rich.table import Table

from land_comps import __version__
from land_comps.apify_runner import ApifyRunner
from land_comps.bench import BenchImportError, import_benchmark
from land_comps.bench_review import ScoreReviewError, score_review
from land_comps.bench_run import (
    REVIEWED_PRECISION_TARGET,
    BenchResult,
    BenchRunError,
    run_benchmark,
)
from land_comps.config import Settings, load_settings
from land_comps.county import IngestError, geocode_county, ingest_county
from land_comps.db import init_db
from land_comps.gather import build_sources
from land_comps.jev import JevError, JevJudge
from land_comps.models import Parcel
from land_comps.pipeline import (
    FindClients,
    FindError,
    SubjectNotFoundError,
    effective_search,
    resolve_subject,
    run_find,
)
from land_comps.regrid import ParcelLookup, RegridClient, RegridError
from land_comps.report import (
    ExportError,
    RankedComp,
    RunReport,
    export_format,
    render_report,
    select_comps,
    write_export,
)
from land_comps.rescore import rescore_run
from land_comps.runs import RunNotFoundError, StoredRunError
from land_comps.sources import SourceError

app = typer.Typer(
    name="comps",
    help="Jev-ranked vacant-land comp finder.",
    no_args_is_help=True,
)
ingest_app = typer.Typer(help="Load and enrich local data sources.", no_args_is_help=True)
app.add_typer(ingest_app, name="ingest")
bench_app = typer.Typer(help="Benchmark against the CRM tool's comps.", no_args_is_help=True)
app.add_typer(bench_app, name="bench")
console = Console()
err_console = Console(stderr=True)

NO_MATCH_EXIT_CODE = 2
DEFAULT_DB_PATH = Path("data/land_comps.sqlite")
DEFAULT_REPORTS_DIR = Path("reports")


def default_regrid_factory(settings: Settings, conn: sqlite3.Connection) -> ParcelLookup:
    """Build the live Regrid client from the configured token and monthly cap."""
    token = settings.secrets.regrid_token
    if not token:
        raise RegridError("REGRID_TOKEN is not set; add it to .env or the environment")
    return RegridClient(token, conn, settings.regrid.monthly_record_cap)


# Commands obtain their Regrid client through this hook so tests can substitute a fake.
regrid_client_factory = default_regrid_factory


def default_find_clients(settings: Settings, conn: sqlite3.Connection) -> FindClients:
    """Live clients for `comps find`: Regrid, county + Apify sources, and the Jev judge.

    The Jev key is checked here, before any paid Regrid or Apify call is made.
    """
    judge = JevJudge.from_settings(settings, conn)
    regrid = regrid_client_factory(settings, conn)
    try:
        runner: ApifyRunner | None = ApifyRunner.from_settings(settings, conn)
    except SourceError:
        runner = None  # build_sources reports the missing token as a per-source error
    return FindClients(
        regrid=regrid,
        sources=build_sources(settings, conn, runner),
        judge=judge,
        apify_items_fetched=(lambda: runner.items_fetched) if runner else (lambda: 0),
    )


# `comps find` obtains all of its clients through this hook so tests can substitute fakes.
find_clients_factory = default_find_clients


@app.callback()
def main() -> None:
    """Jev-ranked vacant-land comp finder."""


@app.command()
def version() -> None:
    """Print the installed land-comps version."""
    console.print(f"land-comps {__version__}")


def _parcel_table(parcel: Parcel) -> Table:
    def show(value: object | None) -> str:
        # Regrid text is free-form; escape it so `[...]` is not parsed as Rich markup.
        return "n/a" if value is None else escape(str(value))

    table = Table(title="Subject parcel", show_header=False)
    table.add_column("Field", style="bold")
    table.add_column("Value")
    table.add_row("APN", show(parcel.apn))
    table.add_row("Address", show(parcel.address))
    table.add_row("Acreage", "n/a" if parcel.acreage is None else f"{parcel.acreage:.2f}")
    table.add_row("Zoning", show(parcel.zoning))
    table.add_row("Land use", show(parcel.land_use))
    table.add_row("Lat/Lon", f"{parcel.lat:.6f}, {parcel.lon:.6f}")
    table.add_row("ZIP", show(parcel.zip))
    return table


def _load_settings_or_exit(config: Path) -> Settings:
    try:
        return load_settings(config)
    except (FileNotFoundError, ValueError) as exc:
        err_console.print(f"[red]Config error:[/red] {exc}")
        raise typer.Exit(code=1) from exc


@app.command()
def subject(
    target: Annotated[str, typer.Argument(help="Subject APN or street address.")],
    config: Annotated[Path, typer.Option(help="Path to the YAML config file.")] = Path(
        "config.yaml"
    ),
    db: Annotated[Path, typer.Option(help="Path to the SQLite cache database.")] = DEFAULT_DB_PATH,
) -> None:
    """Resolve a subject APN or address to its Regrid parcel and print its attributes."""
    settings = _load_settings_or_exit(config)

    db.parent.mkdir(parents=True, exist_ok=True)
    conn = init_db(db)
    try:
        parcel = resolve_subject(regrid_client_factory(settings, conn), settings, target)
    except RegridError as exc:
        err_console.print(f"[red]Regrid error:[/red] {exc}")
        raise typer.Exit(code=1) from exc
    finally:
        conn.close()

    if parcel is None:
        err_console.print(f"No parcel found for {target!r}. Check the APN or address and retry.")
        raise typer.Exit(code=NO_MATCH_EXIT_CODE)

    console.print(_parcel_table(parcel))


@app.command()
def find(
    target: Annotated[str, typer.Argument(help="Subject APN or street address.")],
    radius: Annotated[
        float | None,
        typer.Option(help="Initial search radius in miles (may not exceed search.max_radius_mi)."),
    ] = None,
    top: Annotated[
        int | None, typer.Option(min=1, help="Show only the N best-ranked comps.")
    ] = None,
    include_rejects: Annotated[
        bool, typer.Option("--include-rejects", help="Also show reject-tier comps.")
    ] = False,
    out: Annotated[
        Path | None, typer.Option(help="Also write the shown comps to this .json or .csv file.")
    ] = None,
    resolve_apn: Annotated[
        bool,
        typer.Option(
            "--resolve-apn", help="Look up missing listing APNs via Regrid (uses Regrid records)."
        ),
    ] = False,
    config: Annotated[Path, typer.Option(help="Path to the YAML config file.")] = Path(
        "config.yaml"
    ),
    db: Annotated[Path, typer.Option(help="Path to the SQLite database.")] = DEFAULT_DB_PATH,
) -> None:
    """Find, judge, and rank comps for a subject APN or address, and save the run."""
    settings = _load_settings_or_exit(config)
    try:
        if out is not None:
            export_format(out)  # reject a bad extension before spending anything
        effective_search(settings, radius)  # reject a bad radius before any network call
    except (ExportError, FindError) as exc:
        err_console.print(f"[red]Error:[/red] {escape(str(exc))}")
        raise typer.Exit(code=1) from exc

    db.parent.mkdir(parents=True, exist_ok=True)
    conn = init_db(db)
    try:
        clients = find_clients_factory(settings, conn)
        report = run_find(
            target, settings, conn, clients, radius_mi=radius, resolve_apn=resolve_apn
        )
    except SubjectNotFoundError as exc:
        err_console.print(f"{escape(str(exc))}")
        raise typer.Exit(code=NO_MATCH_EXIT_CODE) from exc
    except (FindError, RegridError, JevError) as exc:
        err_console.print(f"[red]Error:[/red] {escape(str(exc))}")
        raise typer.Exit(code=1) from exc
    finally:
        conn.close()

    render_report(console, report, top=top, include_rejects=include_rejects)
    if out is not None:
        _write_export_or_exit(out, report, select_comps(report.comps, top, include_rejects))


def _write_export_or_exit(out: Path, report: RunReport, shown: list[RankedComp]) -> None:
    try:
        write_export(out, report, shown)
    except OSError as exc:
        err_console.print(f"[red]Could not write {escape(str(out))}:[/red] {escape(str(exc))}")
        raise typer.Exit(code=1) from exc
    console.print(f"Wrote {len(shown)} comps to {escape(str(out))}")


@app.command()
def rescore(
    run_id: Annotated[str, typer.Argument(help="ID of a past run (shown in its report header).")],
    top: Annotated[
        int | None, typer.Option(min=1, help="Show only the N best-ranked comps.")
    ] = None,
    include_rejects: Annotated[
        bool, typer.Option("--include-rejects", help="Also show reject-tier comps.")
    ] = False,
    out: Annotated[
        Path | None, typer.Option(help="Also write the shown comps to this .json or .csv file.")
    ] = None,
    config: Annotated[Path, typer.Option(help="Path to the YAML config file.")] = Path(
        "config.yaml"
    ),
    db: Annotated[Path, typer.Option(help="Path to the SQLite database.")] = DEFAULT_DB_PATH,
) -> None:
    """Re-rank a past run under the current scoring config (offline; nothing is saved)."""
    settings = _load_settings_or_exit(config)
    if out is not None:
        try:
            export_format(out)  # reject a bad extension before doing any work
        except ExportError as exc:
            err_console.print(f"[red]Error:[/red] {escape(str(exc))}")
            raise typer.Exit(code=1) from exc

    if not db.exists():
        err_console.print(f"[red]Error:[/red] database {escape(str(db))} does not exist.")
        raise typer.Exit(code=1)
    conn = init_db(db)
    try:
        report = rescore_run(conn, settings, run_id)
    except (RunNotFoundError, StoredRunError) as exc:
        err_console.print(f"[red]Error:[/red] {escape(str(exc))}")
        raise typer.Exit(code=1) from exc
    finally:
        conn.close()

    console.print(f"Rescored run {escape(run_id)} with the current scoring config (nothing saved).")
    render_report(console, report, top=top, include_rejects=include_rejects)
    if out is not None:
        _write_export_or_exit(out, report, select_comps(report.comps, top, include_rejects))


@bench_app.command("import")
def bench_import(
    csv_path: Annotated[Path, typer.Argument(help="CRM comps CSV (see PRD US-021 for columns).")],
    config: Annotated[Path, typer.Option(help="Path to the YAML config file.")] = Path(
        "config.yaml"
    ),
    db: Annotated[Path, typer.Option(help="Path to the SQLite database.")] = DEFAULT_DB_PATH,
) -> None:
    """Load CRM benchmark comps into SQLite (re-importing replaces each subject's comps)."""
    settings = _load_settings_or_exit(config)
    if not csv_path.is_file():
        err_console.print(
            f"[red]Import error:[/red] Cannot read {escape(str(csv_path))}: not a file."
        )
        raise typer.Exit(code=1)

    db.parent.mkdir(parents=True, exist_ok=True)
    conn = init_db(db)
    try:
        result = import_benchmark(conn, settings, csv_path)
    except BenchImportError as exc:
        err_console.print(f"[red]Import error:[/red] {escape(str(exc))}")
        raise typer.Exit(code=1) from exc
    finally:
        conn.close()

    console.print(
        f"Read {result.rows_read} rows: stored {result.rows_stored} comps for "
        f"{result.subjects} subjects, skipped {len(result.skipped)}."
    )
    if result.replaced:
        console.print(f"Replaced {result.replaced} previously imported comps for those subjects.")
    for skipped in result.skipped:
        console.print(f"[yellow]Skipped line {skipped.line}:[/yellow] {escape(skipped.reason)}")


@bench_app.command("run")
def bench_run(
    reports_dir: Annotated[
        Path, typer.Option(help="Directory for the bench_<ts>.md and review_<ts>.csv reports.")
    ] = DEFAULT_REPORTS_DIR,
    config: Annotated[Path, typer.Option(help="Path to the YAML config file.")] = Path(
        "config.yaml"
    ),
    db: Annotated[Path, typer.Option(help="Path to the SQLite database.")] = DEFAULT_DB_PATH,
) -> None:
    """Run `find` for every imported benchmark subject and write the metrics and review files."""
    settings = _load_settings_or_exit(config)
    if not db.exists():
        err_console.print(f"[red]Error:[/red] database {escape(str(db))} does not exist.")
        raise typer.Exit(code=1)

    conn = init_db(db)
    try:
        clients = find_clients_factory(settings, conn)
        result = run_benchmark(
            conn, settings, lambda target: run_find(target, settings, conn, clients), reports_dir
        )
    except (BenchRunError, FindError, RegridError, JevError) as exc:
        err_console.print(f"[red]Error:[/red] {escape(str(exc))}")
        raise typer.Exit(code=1) from exc
    finally:
        conn.close()

    _print_bench_summary(result)
    if not result.succeeded:
        raise typer.Exit(code=1)


@bench_app.command("score-review")
def bench_score_review(
    review_csv: Annotated[
        Path,
        typer.Argument(help="review_<ts>.csv from `comps bench run`, with human_label filled in."),
    ],
) -> None:
    """Score human labels (good/bad) and append reviewed precision to the matching bench report."""
    try:
        result = score_review(review_csv)
    except ScoreReviewError as exc:
        err_console.print(f"[red]Error:[/red] {escape(str(exc))}")
        raise typer.Exit(code=1) from exc

    score = result.score

    def pct(value: float | None) -> str:
        return "n/a" if value is None else f"{value * 100:.0f}%"

    verdict = "n/a" if score.precision is None else ("PASS" if score.passes else "FAIL")
    console.print(
        f"Reviewed precision of our top 5: {pct(score.precision)} "
        f"({score.top5_good}/{score.top5_labeled}), "
        f"target >= {REVIEWED_PRECISION_TARGET * 100:.0f}%: {verdict}. "
        f"CRM comps labeled bad: {pct(score.bad_share)} ({score.crm_bad}/{score.crm_labeled})."
    )
    if score.unlabeled:
        console.print(
            f"[yellow]{score.unlabeled} of {score.rows} review rows are unlabeled[/yellow] "
            "and left out of both ratios; the result is provisional."
        )
    console.print(f"Appended results to {escape(str(result.bench_path))}")


def _print_bench_summary(result: BenchResult) -> None:
    overall = result.overall

    def pct(value: float | None) -> str:
        return "n/a" if value is None else f"{value * 100:.0f}%"

    console.print(
        f"Ran {len(result.subjects)} benchmark subjects ({len(result.succeeded)} succeeded): "
        f"recall {pct(overall.recall)}, ranking agreement {pct(overall.agreement)}, "
        f"filter loss {pct(overall.filter_loss)}, overlap@5 {pct(overall.overlap_at_5)}."
    )
    for subject in result.subjects:
        if not subject.ok:
            err_console.print(
                f"[yellow]Subject {escape(subject.subject_id)} failed:[/yellow] "
                f"{escape(subject.error or '')}"
            )
    console.print(f"Wrote {escape(str(result.bench_path))}")
    console.print(f"Wrote {escape(str(result.review_path))}")


@ingest_app.command("county")
def ingest_county_command(
    sales: Annotated[
        Path | None, typer.Option(help="County sales CSV (default: county.sales_file).")
    ] = None,
    parcels: Annotated[
        Path | None, typer.Option(help="County parcels CSV (default: county.parcels_file).")
    ] = None,
    centroids: Annotated[
        Path | None,
        typer.Option(help="Parcel centroids CSV with lat/lon (default: county.centroids_file)."),
    ] = None,
    config: Annotated[Path, typer.Option(help="Path to the YAML config file.")] = Path(
        "config.yaml"
    ),
    db: Annotated[Path, typer.Option(help="Path to the SQLite database.")] = DEFAULT_DB_PATH,
) -> None:
    """Load county sales and parcel CSVs into SQLite (re-running upserts, never duplicates)."""
    settings = _load_settings_or_exit(config)
    county = settings.county
    sales_path = sales or Path(county.sales_file)
    parcels_path = parcels or Path(county.parcels_file)
    centroids_path = centroids or (Path(county.centroids_file) if county.centroids_file else None)

    db.parent.mkdir(parents=True, exist_ok=True)
    conn = init_db(db)
    try:
        result = ingest_county(conn, county, sales_path, parcels_path, centroids_path)
    except IngestError as exc:
        err_console.print(f"[red]Ingest error:[/red] {escape(str(exc))}")
        raise typer.Exit(code=1) from exc
    finally:
        conn.close()

    console.print(
        f"Read {result.rows_read} sales rows: loaded {result.rows_loaded}, "
        f"skipped {result.rows_skipped} (missing APN, sale date, or price)."
    )
    if result.rows_without_parcel:
        console.print(
            f"{result.rows_without_parcel} loaded sales have no parcels-file row "
            "(land use comes from the sales file only, else treated as not vacant)."
        )
    console.print(f"Total rows: {result.total}")
    console.print(f"Vacant rows: {result.vacant}")
    console.print(f"Vacant rows missing coordinates: {result.vacant_missing_coords}")


@ingest_app.command("geocode-county")
def geocode_county_command(
    limit: Annotated[
        int | None, typer.Option(min=1, help="Maximum number of sales to look up.")
    ] = None,
    config: Annotated[Path, typer.Option(help="Path to the YAML config file.")] = Path(
        "config.yaml"
    ),
    db: Annotated[Path, typer.Option(help="Path to the SQLite database.")] = DEFAULT_DB_PATH,
) -> None:
    """Fill coordinates for recent vacant county sales via Regrid (stops cleanly at the cap)."""
    settings = _load_settings_or_exit(config)

    db.parent.mkdir(parents=True, exist_ok=True)
    conn = init_db(db)
    try:
        client = regrid_client_factory(settings, conn)
        result = geocode_county(conn, settings, client, limit=limit)
    except RegridError as exc:
        err_console.print(f"[red]Regrid error:[/red] {escape(str(exc))}")
        raise typer.Exit(code=1) from exc
    finally:
        conn.close()

    console.print(
        f"Looked up {result.attempted} sales: filled {result.filled}, "
        f"no Regrid match {result.no_match}."
    )
    if result.quota_exceeded:
        console.print(
            "[yellow]Regrid monthly record cap reached; stopped early.[/yellow] "
            "Re-run next month or raise regrid.monthly_record_cap."
        )
    console.print(f"Remaining vacant sales without coordinates: {result.remaining}")


if __name__ == "__main__":
    app()
