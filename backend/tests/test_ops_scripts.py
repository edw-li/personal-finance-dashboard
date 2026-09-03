"""The two host scripts are exercised by hand on the box (spec §4: shell is tested there);
these pins keep their CONTRACTS visible to the suite — the marker fields the system
schema parses, the verify phase's shape, the drill's steps — and syntax-check them with
bash when one is on PATH."""

import shutil
import subprocess
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
BACKUP = SCRIPTS / "backup_db.sh"
DRILL = SCRIPTS / "restore_drill.sh"


def _bash_syntax_ok(script: Path) -> None:
    bash = shutil.which("bash")
    if bash is None:
        pytest.skip("no bash on PATH")
    result = subprocess.run([bash, "-n", str(script)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr


def test_backup_script_has_a_verify_phase_that_writes_the_marker_fields():
    text = BACKUP.read_text(encoding="utf-8")
    # The verify phase: a scratch database, a restore with ON_ERROR_STOP, a count compare,
    # and a drop — never on the live database name.
    assert "createdb" in text and "dropdb" in text
    assert text.count("ON_ERROR_STOP=1") >= 3
    assert 'VERIFY_TABLES="net_worth_snapshots monthly_spending position_transactions"' in text
    # Marker fields BackupStatusOut parses (Optional, so old markers still load). Spelled
    # with the BACKSLASH the script needs inside its double-quoted JSON: the file never
    # contains a bare "size_bytes", only \"size_bytes\", so a plain pin would pass on a
    # script that dropped the escaping and then wrote JSON psql rejects.
    for field in (
        '\\"size_bytes\\"',
        '\\"encrypted\\"',
        '\\"retention_days\\"',
        '\\"verified\\"',
        '\\"verified_at\\"',
        '\\"row_counts\\"',
        '\\"verify_error\\"',
    ):
        assert field in text, field
    # The run entry gains `verified` too.
    assert '\\"verified\\": ${VERIFIED}' in text
    # A verify failure must not fail the run: retention still runs, exit stays 0.
    assert "WARN: backup NOT verified" in text
    _bash_syntax_ok(BACKUP)


def test_restore_drill_exists_and_runs_the_four_steps():
    text = DRILL.read_text(encoding="utf-8")
    assert "alembic upgrade head" in text
    assert "app.seed" in text
    assert "app.lifecycle restore" in text and "app.lifecycle verify" in text
    assert "CREATE DATABASE" in text and "DROP DATABASE IF EXISTS" in text
    assert "PASS" in text and "FAIL" in text
    _bash_syntax_ok(DRILL)
