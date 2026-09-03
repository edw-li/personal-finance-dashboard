"""The two host scripts are exercised by hand on the box (spec §4: shell is tested there);
these pins keep their CONTRACTS visible to the suite — the marker fields the system
schema parses, the verify phase's shape, the drill's steps — and syntax-check them with
Git Bash when it is installed."""

import shutil
import subprocess
from pathlib import Path

import pytest

from app.database import database_url_from_parts, database_url_parts

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
BACKUP = SCRIPTS / "backup_db.sh"
DRILL = SCRIPTS / "restore_drill.sh"


def _find_bash() -> str | None:
    """Git's bash, in preference to whatever is first on PATH.

    On Windows `shutil.which("bash")` finds C:\\Windows\\System32\\bash.exe — the WSL launcher,
    which either has no distro installed (an interactive install prompt, not a syntax check)
    or runs a Linux bash that cannot see the repo at a Windows path. Git Bash is the shell
    these scripts are actually checked with, and it ships with the git that cloned the repo.
    """
    direct = Path(r"C:\Program Files\Git\bin\bash.exe")
    if direct.is_file():
        return str(direct)
    git = shutil.which("git")
    if git is not None:
        # <git>/mingw64/libexec/git-core -> <git>/bin/bash.exe
        exec_path = subprocess.run(
            [git, "--exec-path"], capture_output=True, text=True, check=False
        ).stdout.strip()
        if exec_path:
            candidate = Path(exec_path).parents[2] / "bin" / "bash.exe"
            if candidate.is_file():
                return str(candidate)
    found = shutil.which("bash")
    if found is not None and Path(found).parent.name.lower() == "system32":
        return None  # the WSL shim, not a shell we can syntax-check with
    return found


def _bash_syntax_ok(script: Path) -> None:
    bash = _find_bash()
    if bash is None:
        pytest.skip("no usable bash found")
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


def test_backup_verify_refuses_to_pass_on_counts_it_could_not_read():
    text = BACKUP.read_text(encoding="utf-8")
    # The old `|| echo '?'` made a failed psql compare EQUAL to another failed psql: a run
    # that verified nothing recorded verified:true and wrote `"monthly_spending": ?` — jsonb
    # the INSERT rejects. Counts are digits or the verification fails with a reason.
    assert "echo '?'" not in text
    assert "*[!0-9]*) return 1" in text
    assert 'VERIFY_ERROR="live row counts unreadable' in text
    assert 'VERIFY_ERROR="row counts unreadable in ${VERIFY_DB}' in text


def test_backup_cleans_up_the_scratch_database_and_uses_mktemp():
    text = BACKUP.read_text(encoding="utf-8")
    # A predictable /tmp/verify_err_$$ is a symlink target on a shared box.
    assert "/tmp/verify_err_" not in text
    assert 'VERIFY_ERR_FILE="$(mktemp)"' in text
    # A cron run meets SIGTERM on every deploy; without these the scratch database leaks.
    assert "trap 'cleanup_verify; exit 130' INT" in text
    assert "trap 'cleanup_verify; exit 143' TERM" in text


def test_restore_drill_exists_and_runs_the_four_steps():
    text = DRILL.read_text(encoding="utf-8")
    assert "alembic upgrade head" in text
    assert "app.seed" in text
    assert "app.lifecycle restore" in text and "app.lifecycle verify" in text
    assert "CREATE DATABASE" in text and "DROP DATABASE IF EXISTS" in text
    assert "PASS" in text and "FAIL" in text
    # Every step's failure is a drill FAIL, not a bare `set -e` exit with no verdict.
    assert text.count("|| fail") == 4
    _bash_syntax_ok(DRILL)


def test_restore_drill_resolves_python_and_cleans_up_before_it_cds():
    text = DRILL.read_text(encoding="utf-8")
    # README 5.5 passes a repo-relative PYTHON; every use of it (the EXIT trap included) runs
    # after `cd "$BACKEND_DIR"`, so it has to be made absolute BEFORE that cd — otherwise the
    # drill exits 127 partway in and leaks its scratch database.
    resolve = text.index("PYTHON_REQUESTED=")
    assert resolve < text.index('cd "$BACKEND_DIR"' + chr(10))
    assert 'PYTHON="$(cd "$(dirname "$PYTHON_REQUESTED")" && pwd)/$(basename' in text
    assert 'PYTHON="$(command -v "$PYTHON_REQUESTED" || true)"' in text
    # The usage error the header promises is 2, not ${1:?}'s 1.
    assert "${1:?" not in text
    assert 'if [ "$#" -ne 1 ]; then' in text and "exit 2" in text
    # One trap for both leaks: the scratch database and the mktemp -d data dir.
    assert "trap cleanup EXIT" in text
    assert 'rm -rf "$DATA_DIR"' in text


def test_restore_drill_takes_its_credentials_from_database_url():
    text = DRILL.read_text(encoding="utf-8")
    # The backend container has DATABASE_URL and nothing else — no POSTGRES_USER/PASSWORD,
    # and .dockerignore keeps .env out of the image — so POSTGRES_*-only meant finance:finance.
    assert "database_url_parts" in text and "database_url_from_parts" in text
    assert 'DB_USER="${POSTGRES_USER:-${URL_USER:-finance}}"' in text
    assert 'DB_PASSWORD="${POSTGRES_PASSWORD:-${URL_PASSWORD:-finance}}"' in text
    # Credentials ride the environment, never argv: `ps` on the prod box is world-readable.
    assert "DRILL_ADMIN_URL" in text and "sys.argv" not in text


def test_database_url_parts_decodes_and_from_parts_re_encodes():
    # The exact shape docker-compose.prod.yml hands the backend, with a password that has to
    # survive both directions: %40 -> @ when the drill resolves its credentials, @ -> %40 in
    # every DSN it then builds. Concatenating the decoded password back into a URL by hand
    # would put two @ in it, and no login.
    url = "postgresql+asyncpg://finance:s%40cr%2Fet@host.docker.internal:5432/finance"
    parts = database_url_parts(url)
    assert parts == {
        "host": "host.docker.internal",
        "port": "5432",
        "user": "finance",
        "password": "s@cr/et",
        "database": "finance",
    }
    assert database_url_from_parts(parts) == url
    # ...and the two DSNs the drill actually builds from those parts.
    assert database_url_from_parts({**parts, "database": "postgres"}, driver="postgresql") == (
        "postgresql://finance:s%40cr%2Fet@host.docker.internal:5432/postgres"
    )


def test_database_url_parts_defaults_the_port_postgres_omits():
    parts = database_url_parts("postgresql+asyncpg://finance:finance@db/finance")
    assert (parts["host"], parts["port"]) == ("db", "5432")
