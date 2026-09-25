from typer.testing import CliRunner

from land_comps.cli import app

runner = CliRunner()


def test_help_lists_version_command() -> None:
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0
    assert "version" in result.stdout


def test_version_command_prints_version_string() -> None:
    result = runner.invoke(app, ["version"])
    assert result.exit_code == 0
    assert "land-comps" in result.stdout
