import sqlite3
from pathlib import Path
from typing import Annotated

import typer
from rich.console import Console
from rich.markup import escape
from rich.table import Table

from land_comps import __version__
from land_comps.config import Settings, load_settings
from land_comps.db import init_db
from land_comps.models import Parcel
from land_comps.normalize import looks_like_apn, normalize_apn
from land_comps.regrid import ParcelLookup, RegridClient, RegridError

app = typer.Typer(
    name="comps",
    help="Jev-ranked vacant-land comp finder.",
    no_args_is_help=True,
)
console = Console()
err_console = Console(stderr=True)

NO_MATCH_EXIT_CODE = 2
DEFAULT_DB_PATH = Path("data/land_comps.sqlite")


def default_regrid_factory(settings: Settings, conn: sqlite3.Connection) -> ParcelLookup:
    """Build the live Regrid client from the configured token and monthly cap."""
    token = settings.secrets.regrid_token
    if not token:
        raise RegridError("REGRID_TOKEN is not set; add it to .env or the environment")
    return RegridClient(token, conn, settings.regrid.monthly_record_cap)


# Commands obtain their Regrid client through this hook so tests can substitute a fake.
regrid_client_factory = default_regrid_factory


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


@app.command()
def subject(
    target: Annotated[str, typer.Argument(help="Subject APN or street address.")],
    config: Annotated[Path, typer.Option(help="Path to the YAML config file.")] = Path(
        "config.yaml"
    ),
    db: Annotated[Path, typer.Option(help="Path to the SQLite cache database.")] = DEFAULT_DB_PATH,
) -> None:
    """Resolve a subject APN or address to its Regrid parcel and print its attributes."""
    try:
        settings = load_settings(config)
    except (FileNotFoundError, ValueError) as exc:
        err_console.print(f"[red]Config error:[/red] {exc}")
        raise typer.Exit(code=1) from exc

    db.parent.mkdir(parents=True, exist_ok=True)
    conn = init_db(db)
    try:
        client = regrid_client_factory(settings, conn)
        if looks_like_apn(target):
            apn = normalize_apn(target, settings.county.fips, settings.county.apn_length)
            parcel = client.by_apn(apn, settings.county.fips)
        else:
            parcel = client.by_address(target)
    except RegridError as exc:
        err_console.print(f"[red]Regrid error:[/red] {exc}")
        raise typer.Exit(code=1) from exc
    finally:
        conn.close()

    if parcel is None:
        err_console.print(f"No parcel found for {target!r}. Check the APN or address and retry.")
        raise typer.Exit(code=NO_MATCH_EXIT_CODE)

    console.print(_parcel_table(parcel))


if __name__ == "__main__":
    app()
