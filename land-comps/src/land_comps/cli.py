import typer
from rich.console import Console

from land_comps import __version__

app = typer.Typer(
    name="comps",
    help="Jev-ranked vacant-land comp finder.",
    no_args_is_help=True,
)
console = Console()


@app.callback()
def main() -> None:
    """Jev-ranked vacant-land comp finder."""


@app.command()
def version() -> None:
    """Print the installed land-comps version."""
    console.print(f"land-comps {__version__}")


if __name__ == "__main__":
    app()
