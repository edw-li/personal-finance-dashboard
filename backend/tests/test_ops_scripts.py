"""The two host scripts are exercised by hand on the box (spec §4: shell is tested there);
these pins keep their CONTRACTS visible to the suite — the marker fields the system
schema parses, the verify phase's shape, the drill's steps — and syntax-check them with
Git Bash when it is installed."""

import json
import os
import re
import shutil
import subprocess
import sys
import uuid
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


def _function(text: str, name: str) -> str:
    """One top-level function from the script, verbatim: `name() {` to the first column-0 `}`."""
    match = re.search(rf"^{name}\(\) \{{.*?^\}}", text, re.MULTILINE | re.DOTALL)
    assert match is not None, name
    return match.group(0)


def _gpg_bash() -> str:
    """Git Bash (or the runner's bash) with gpg, gpgconf, gzip and gunzip — or a skip.
    gunzip too: decrypt_dump pipes into it."""
    bash = _find_bash()
    if bash is None:
        pytest.skip("no usable bash found")
    tools = " && ".join(f"command -v {tool}" for tool in ("gpg", "gpgconf", "gzip", "gunzip"))
    if subprocess.run([bash, "-c", tools], capture_output=True).returncode != 0:
        pytest.skip("gpg, gpgconf, gzip or gunzip not available to bash")
    return bash


def test_backup_hands_gpg_the_passphrase_on_a_file_descriptor():
    """Anything on a command line is readable by every user on the box through ps or
    /proc/<pid>/cmdline for as long as the dump runs (2026-09-23 spec §B4)."""
    text = BACKUP.read_text(encoding="utf-8")
    assert '--passphrase "$BACKUP_PASSPHRASE"' not in text
    assert text.count("--passphrase-fd 3") == 2
    assert text.count('3<<<"$BACKUP_PASSPHRASE"') == 2
    # The dump pipeline encrypts through the same function the round trip below exercises.
    assert re.search(r'\| gzip \\\n\s+\| encrypt_stream "\$DUMP_FILE"', text)
    # The upload's OCI keys ride the environment too (lane B1 review, Important 3) — pinned
    # here because the end-to-end run below skips wherever gpg is missing.
    assert '"$OCI_ACCESS_KEY" "$OCI_SECRET_KEY"' not in text
    assert "export OCI_ACCESS_KEY OCI_SECRET_KEY" in text
    assert 'os.environ["OCI_ACCESS_KEY"]' in text and 'os.environ["OCI_SECRET_KEY"]' in text
    _bash_syntax_ok(BACKUP)


def test_backup_round_trips_through_its_own_functions_without_the_passphrase_in_argv(tmp_path):
    """The script's OWN two functions, lifted verbatim and run through a real gpg: what goes
    in comes back out, and a shim first on PATH proves the passphrase never rode argv. Runs
    wherever bash and gpg exist (CI's ubuntu runner, Git Bash here); skips elsewhere."""
    bash = _gpg_bash()
    text = BACKUP.read_text(encoding="utf-8")
    shim = tmp_path / "shim"
    shim.mkdir()
    # A gpg FIRST on PATH that records every argument it is handed, then runs the real one
    # with the descriptors it inherited — fd 3 included.
    (shim / "gpg").write_bytes(
        b'#!/bin/bash\nprintf \'%s\\n\' "$@" >> "$ARGV_LOG"\nexec "$REAL_GPG" "$@"\n'
    )
    passphrase = "s3cr3t with spaces & $igns"
    script = "\n".join(
        [
            "set -euo pipefail",
            'export GNUPGHOME="$(mktemp -d)"',
            "trap 'gpgconf --kill gpg-agent >/dev/null 2>&1 || true; rm -rf \"$GNUPGHOME\"' EXIT",
            'export REAL_GPG="$(command -v gpg)" ARGV_LOG="$PWD/argv.log"',
            'chmod +x shim/gpg && export PATH="$PWD/shim:$PATH"',
            'BACKUP_PASSPHRASE="$1"',
            'DUMP_FILE="dump.sql.gz.gpg"',
            _function(text, "encrypt_stream"),
            _function(text, "decrypt_dump"),
            "printf 'CREATE TABLE t();\\n' | gzip | encrypt_stream \"$DUMP_FILE\"",
            "decrypt_dump",
        ]
    )
    result = subprocess.run(
        [bash, "-c", script, "bash", passphrase],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout == "CREATE TABLE t();\n"
    argv = (tmp_path / "argv.log").read_text()
    # Both calls went through the shim, and neither carried the passphrase.
    assert argv.count("--passphrase-fd") == 2
    assert passphrase not in argv
    assert b"CREATE TABLE" not in (tmp_path / "dump.sql.gz.gpg").read_bytes()


def test_backup_decrypt_refuses_a_wrong_passphrase_and_still_reads_an_argv_era_dump(tmp_path):
    """The fd-3 decrypt is only half of §B4's promise: a wrong passphrase must fail loudly
    with no plaintext on stdout, and every .sql.gz.gpg already in the bucket — written by the
    old `--passphrase "$BACKUP_PASSPHRASE"` command line — must still decrypt (2026-09-23 lane
    B1 review, M10). Each step gets a fresh GNUPGHOME: gpg-agent caches symmetric passphrases,
    and a cached right one would let the wrong-passphrase step pass for the wrong reason."""
    bash = _gpg_bash()
    text = BACKUP.read_text(encoding="utf-8")
    passphrase = "s3cr3t with spaces & $igns"
    script = "\n".join(
        [
            "set -uo pipefail",
            'HOMES=""',
            "fresh_home() {",
            "  gpgconf --kill gpg-agent >/dev/null 2>&1 || true",
            '  GNUPGHOME="$(mktemp -d)"; export GNUPGHOME; HOMES="$HOMES $GNUPGHOME"',
            "}",
            "trap 'gpgconf --kill gpg-agent >/dev/null 2>&1 || true; rm -rf $HOMES' EXIT",
            _function(text, "encrypt_stream"),
            _function(text, "decrypt_dump"),
            "fresh_home",
            'BACKUP_PASSPHRASE="$1"; DUMP_FILE="new.sql.gz.gpg"',
            "printf 'CREATE TABLE secret_rows();\\n' | gzip"
            ' | encrypt_stream "$DUMP_FILE" || exit 3',
            "fresh_home",
            'BACKUP_PASSPHRASE="wrong $1"',
            "if decrypt_dump > wrong.out 2> wrong.err; then echo WRONG-PASSPHRASE-DECRYPTED; fi",
            "fresh_home",
            'BACKUP_PASSPHRASE="$1"; DUMP_FILE="old.sql.gz.gpg"',
            # The exact pre-§B4 pipeline tail (git show 7c70bc3:backend/scripts/backup_db.sh).
            "printf 'CREATE TABLE old_rows();\\n' | gzip | gpg --symmetric --batch --yes"
            ' --cipher-algo AES256 --pinentry-mode loopback --passphrase "$BACKUP_PASSPHRASE"'
            ' -o "$DUMP_FILE" || exit 4',
            "fresh_home",
            "decrypt_dump || exit 5",
        ]
    )
    result = subprocess.run(
        [bash, "-c", script, "bash", passphrase],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        timeout=180,
    )
    assert result.returncode == 0, result.stderr
    assert "WRONG-PASSPHRASE-DECRYPTED" not in result.stdout
    assert "secret_rows" not in (tmp_path / "wrong.out").read_text(errors="replace")
    assert result.stdout.endswith("CREATE TABLE old_rows();\n"), result.stdout


FAKE_BOTO3 = """import json, os


def _log(entry):
    with open(os.environ["BOTO_LOG"], "a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry) + "\\n")


class _Client:
    def upload_file(self, filename, bucket, key):
        _log({"upload": [bucket, key]})

    def delete_object(self, Bucket, Key):
        _log({"delete": [Bucket, Key]})


def client(service, **kwargs):
    _log({
        "client": service,
        "access": kwargs.get("aws_access_key_id"),
        "secret": kwargs.get("aws_secret_access_key"),
        "region": kwargs.get("region_name"),
    })
    return _Client()
"""

# Every external command the script runs with arguments worth reading, first on PATH: each
# records `== <name>` and its argv, one argument per line, then plays its part.
SHIMS = {
    "pg_dump": "printf 'CREATE TABLE t();\\n'",
    "psql": "\n".join(
        [
            'for arg in "$@"; do [ "$arg" = "-Atc" ] && { echo 3; exit 0; }; done',
            'for arg in "$@"; do [ "$arg" = "-c" ] && exit 0; done',
            "cat > /dev/null",
        ]
    ),
    "createdb": "exit 0",
    "dropdb": "exit 0",
    "gpg": 'exec "$REAL_GPG" "$@"',
    "python3": 'exec "$REAL_PYTHON" "$@"',
}


def test_the_backup_run_puts_no_secret_on_any_command_line(tmp_path):
    """The whole script, end to end, against shims: pg_dump, psql, createdb, dropdb, gpg and
    python3 each record their argv, the upload runs the script's real Python against a fake
    boto3, and the secrets come from a .env the way prod's cron sees them. None of the four —
    OCI access key, OCI secret key, backup passphrase, database password — may appear in any
    argv: `ps` and /proc/<pid>/cmdline are world-readable (2026-09-23 spec §B4; lane B1
    review, Important 3 — the upload used to take both OCI keys as arguments)."""
    bash = _gpg_bash()
    root = tmp_path / "root"
    scripts = root / "backend" / "scripts"
    scripts.mkdir(parents=True)
    # A copy, so SCRIPT_DIR/../../.env is THIS test's .env and never a real one on the box.
    shutil.copy(BACKUP, scripts / "backup_db.sh")
    db = f"b1ops_{uuid.uuid4().hex[:10]}"
    secrets = {
        "OCI_ACCESS_KEY": "AKIA-access-4f1e9c",
        "OCI_SECRET_KEY": "sk/9Qe+secret=Zt7",
        "BACKUP_PASSPHRASE": "pass phrase & $igns 42",
        "POSTGRES_PASSWORD": "pg-pw-8d3b",
    }
    env_lines = [
        f"POSTGRES_DB={db}",
        "POSTGRES_USER=finance",
        "OCI_REGION=us-ashburn-1",
        "OCI_NAMESPACE=nsx",
        "OCI_BUCKET_NAME=bucket-x",
        *(f"{key}='{value}'" for key, value in secrets.items()),
    ]
    (root / ".env").write_text("\n".join(env_lines) + "\n", encoding="utf-8", newline="\n")
    shim = tmp_path / "shim"
    shim.mkdir()
    for name, body in SHIMS.items():
        (shim / name).write_text(
            f'#!/bin/bash\n{{ echo "== {name}"; printf \'%s\\n\' "$@"; }} >> "$ARGV_LOG"\n{body}\n',
            encoding="utf-8",
            newline="\n",
        )
    fakes = tmp_path / "fakes"
    (fakes / "boto3").mkdir(parents=True)
    (fakes / "botocore").mkdir()
    (fakes / "boto3" / "__init__.py").write_text(FAKE_BOTO3, encoding="utf-8")
    (fakes / "botocore" / "__init__.py").write_text("", encoding="utf-8")
    (fakes / "botocore" / "config.py").write_text(
        "class Config:\n    def __init__(self, **kwargs):\n        self.kwargs = kwargs\n",
        encoding="utf-8",
    )
    argv_log = tmp_path / "argv.log"
    boto_log = tmp_path / "boto.log"
    runner = "\n".join(
        [
            'export REAL_GPG="$(command -v gpg)"',
            'export GNUPGHOME="$(mktemp -d)"',
            "trap 'gpgconf --kill gpg-agent >/dev/null 2>&1 || true; rm -rf \"$GNUPGHOME\"' EXIT",
            # $PWD (the shim's parent), not the Windows-shaped path: a drive colon splits PATH.
            'chmod +x "$PWD"/shim/* && export PATH="$PWD/shim:$PATH"',
            'bash "$1"',
        ]
    )
    env = {
        **{key: value for key, value in os.environ.items() if key not in secrets},
        "ARGV_LOG": argv_log.as_posix(),
        "BOTO_LOG": boto_log.as_posix(),
        "REAL_PYTHON": Path(sys.executable).as_posix(),
        "PYTHONPATH": str(fakes),
    }
    result = subprocess.run(
        [bash, "-c", runner, "bash", (scripts / "backup_db.sh").as_posix()],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        timeout=300,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "Verify OK" in result.stdout and "Backup complete." in result.stdout, result.stdout
    argv = argv_log.read_text(encoding="utf-8")
    # The shims were really in the path of every call the check is about.
    for name in SHIMS:
        assert f"== {name}\n" in argv, name
    for key, value in secrets.items():
        assert value not in argv, key
    calls = [json.loads(line) for line in boto_log.read_text(encoding="utf-8").splitlines()]
    # ...and the upload still got its keys — from the environment.
    assert calls[0] == {
        "client": "s3",
        "access": secrets["OCI_ACCESS_KEY"],
        "secret": secrets["OCI_SECRET_KEY"],
        "region": "us-ashburn-1",
    }
    assert calls[1]["upload"][0] == "bucket-x"
    key = calls[1]["upload"][1]
    assert re.fullmatch(rf"backups/{db}_\d{{4}}-\d{{2}}-\d{{2}}\.sql\.gz\.gpg", key), key
    # Retention sweeps both flavors of the expired day.
    expired = [call["delete"][1] for call in calls[2:]]
    assert [name.startswith(f"backups/{db}_") for name in expired] == [True, True]
    assert [Path(name).suffix for name in expired] == [".gz", ".gpg"]


def test_restore_drill_exists_and_runs_the_four_steps():
    text = DRILL.read_text(encoding="utf-8")
    assert "alembic upgrade head" in text
    assert "app.seed" in text
    assert "app.lifecycle restore" in text and "app.lifecycle verify" in text
    assert "CREATE DATABASE" in text and "DROP DATABASE IF EXISTS" in text
    assert "PASS" in text and "FAIL" in text
    # Every step's failure is a drill FAIL, not a bare `set -e` exit with no verdict —
    # CREATE DATABASE included.
    assert text.count("|| fail") == 5
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
    # One trap for both leaks: the scratch database and the drill's temp dir. The rm must
    # never name the INHERITED DATA_DIR — that is /data inside the container, the mounted
    # finance-data volume with every real snapshot and restore point on it, and any exit
    # before the drill overwrote the variable would have deleted the lot.
    assert "trap cleanup EXIT" in text
    assert 'rm -rf "$DATA_DIR"' not in text
    assert 'rm -rf "$DRILL_DATA_DIR"' in text
    assert 'export DATA_DIR="$DRILL_DATA_DIR"' in text
    # ...and the directory exists before the trap that removes it is armed.
    assert text.index('DRILL_DATA_DIR="$(mktemp -d)"') < text.index("trap cleanup EXIT")


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
