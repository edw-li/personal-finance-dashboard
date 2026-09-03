"""The export ZIP as a service (2026-09-03 data-lifecycle spec §6): one builder shared by
GET /export/snapshot, the nightly stored snapshot, the pre-restore/pre-import restore point
and the restore's identity hashing. The table list is HAND-MAINTAINED, not reflected: a
future table must be a conscious export decision, and test_export_api pins the list
against Base.metadata so forgetting one fails the suite until it is listed here or named
in EXCLUDED_TABLES.

Cell spellings live here in BOTH directions — json_cell (export) and parse_cell (restore,
undo) side by side — so they cannot drift (spec §7).
"""

import asyncio
import csv
import io
import json
import os
import re
import zipfile
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path

from sqlalchemy import Column, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import sqltypes

from app.config import settings
from app.models import (
    Account,
    AccountBalance,
    AppSetting,
    CalendarEventOverride,
    CalendarFeedToken,
    CardCredit,
    CategoryBudget,
    CompEvent,
    ContributionLimit,
    CreditCard,
    CreditLimitEvent,
    CustomEvent,
    DividendPayment,
    EsppLot,
    EsppOffering,
    EsppPeriod,
    LatestPrice,
    LifecycleRun,
    MonthlyCashflow,
    MonthlySpending,
    NetWorthSnapshot,
    PaycheckProfile,
    Person,
    PortfolioAccount,
    PortfolioValueHistory,
    PositionTransaction,
    PriceHistory,
    RewardCategory,
    RewardRate,
    RsuGrant,
    Security,
    SecurityDividendEvent,
    SpendingCategory,
    TaxBracket,
    TaxInput,
    TaxInputDefinition,
    TaxYear,
    UserPreference,
)
from app.services.assistant_models import KEY_SETTING

# Every user-data table, in the spec's order (2026-08-31 §B1 + user_preferences). `users`
# is excluded — password hash, and on a single-user app nothing else in it is worth
# exporting; `alembic_version` is not a Base.metadata table at all (the manifest carries
# the head instead).
EXPORTED_TABLES: tuple[tuple[type, str], ...] = (
    (Account, "accounts"),
    (NetWorthSnapshot, "net_worth_snapshots"),
    (AccountBalance, "account_balances"),
    (SpendingCategory, "spending_categories"),
    (MonthlySpending, "monthly_spending"),
    (MonthlyCashflow, "monthly_cashflow"),
    (CategoryBudget, "category_budgets"),
    (Security, "securities"),
    (PortfolioAccount, "portfolio_accounts"),
    (PositionTransaction, "position_transactions"),
    (DividendPayment, "dividend_payments"),
    (LatestPrice, "latest_prices"),
    (PriceHistory, "price_history"),
    (SecurityDividendEvent, "security_dividend_events"),
    (PortfolioValueHistory, "portfolio_value_history"),
    (TaxYear, "tax_years"),
    (TaxBracket, "tax_brackets"),
    (TaxInputDefinition, "tax_input_definitions"),
    (TaxInput, "tax_inputs"),
    (EsppLot, "espp_lots"),
    (EsppPeriod, "espp_periods"),
    (EsppOffering, "espp_offerings"),
    (PaycheckProfile, "paycheck_profiles"),
    (CompEvent, "comp_events"),
    (RsuGrant, "rsu_grants"),
    (CreditCard, "credit_cards"),
    (CardCredit, "card_credits"),
    (RewardCategory, "reward_categories"),
    (RewardRate, "reward_rates"),
    (CreditLimitEvent, "credit_limit_events"),
    (ContributionLimit, "contribution_limits"),
    (CustomEvent, "custom_events"),
    (CalendarEventOverride, "calendar_event_overrides"),
    (CalendarFeedToken, "calendar_feed_tokens"),
    (Person, "people"),
    (AppSetting, "app_settings"),
    (UserPreference, "user_preferences"),
)

# Operational trails are NOT exported — a restore must be recorded in them, not replaced
# by them (spec §6); users carries the password hash.
EXCLUDED_TABLES = frozenset({"users", "change_log", "lifecycle_runs"})

# Redacted ROWS (assistant spec 2026-09-01 §3): the assistant API key must not ride into
# every export ZIP. Keyed by table name; the filter reads `row.key`, so a listed table MUST
# have a `key` column (pinned by test_export_list_pins_every_metadata_table).
REDACTED_ROWS: dict[str, frozenset[str]] = {"app_settings": frozenset({KEY_SETTING})}

# File-name grammar for the data volume (spec §8). Stored snapshots carry SECONDS (the
# download filename keeps HHMM) so a manual "Snapshot now" in the nightly's minute cannot
# overwrite it; restore points add microseconds for the same reason. Both anchored, so a
# name from a URL can never carry a path separator.
SNAPSHOT_NAME_RE = re.compile(r"^finance-export-(\d{8})-(\d{6})\.zip$")
RESTORE_POINT_NAME_RE = re.compile(r"^pre-restore-\d{8}-\d{6}-\d{6}\.zip$")
RESTORE_POINTS_KEEP = 3


def data_root() -> Path:
    return Path(settings.data_dir)


def snapshots_dir() -> Path:
    return data_root() / "snapshots"


def restore_points_dir() -> Path:
    return data_root() / "restore-points"


def snapshot_name(at: datetime) -> str:
    return f"finance-export-{at.astimezone(UTC):%Y%m%d-%H%M%S}.zip"


def snapshot_stamp(name: str) -> datetime | None:
    """The UTC instant a stored snapshot's name encodes, or None for a foreign name."""
    match = SNAPSHOT_NAME_RE.fullmatch(name)
    if match is None:
        return None
    try:
        return datetime.strptime(f"{match.group(1)}{match.group(2)}", "%Y%m%d%H%M%S").replace(
            tzinfo=UTC
        )
    except ValueError:
        return None


def csv_cell(value: object) -> str:
    """One CSV spelling per type (2026-08-31 §B1): NULL is the EMPTY cell, Decimals are
    plain strings (format 'f' — str() can spell exponents), dates ISO, booleans lowercase
    true/false, JSONB compact JSON. csv.writer supplies the RFC-4180 quoting."""
    if value is None:
        return ""
    if isinstance(value, bool):  # before anything numeric-adjacent: bool subclasses int
        return "true" if value else "false"
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, date):  # datetime subclasses date; isoformat serves both
        return value.isoformat()
    if isinstance(value, dict | list):
        return json.dumps(value, separators=(",", ":"), sort_keys=True)
    return str(value)


def json_cell(value: object) -> object:
    """The JSON twin: identical spellings for Decimal and dates, but None/bool/int/str and
    JSONB structures stay native — this file exists for programmatic re-import."""
    if isinstance(value, bool):
        return value
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, date):
        return value.isoformat()
    return value


def parse_cell(column: Column, raw: object) -> object:
    """json_cell's inverse, keyed on the COLUMN's type — the restore and the undo replay
    both read finance-export.json spellings back into what the ORM would have held.
    ValueError (never a bare TypeError) names the column so a router can 422 with it."""
    if raw is None:
        return None
    kind = column.type
    try:
        if isinstance(kind, sqltypes.JSON):
            return raw  # dict or list, native either way
        if isinstance(kind, sqltypes.Boolean):
            if not isinstance(raw, bool):
                raise ValueError(f"{column.table.name}.{column.key}: expected a boolean")
            return raw
        if isinstance(kind, sqltypes.Numeric):  # Numeric and its subclasses; NOT Integer
            return Decimal(str(raw))
        if isinstance(kind, sqltypes.Integer):
            if isinstance(raw, bool):
                raise ValueError(f"{column.table.name}.{column.key}: expected an integer")
            return int(raw)
        if isinstance(kind, sqltypes.DateTime):
            return datetime.fromisoformat(str(raw))
        if isinstance(kind, sqltypes.Date):
            return date.fromisoformat(str(raw))
        return str(raw)
    except (ValueError, TypeError, ArithmeticError) as exc:
        raise ValueError(f"{column.table.name}.{column.key}: {raw!r} does not parse") from exc


def row_dict(obj: object, columns: list[Column]) -> dict[str, object]:
    """Raw Python values in model-definition column order."""
    return {column.key: getattr(obj, column.key) for column in columns}


def json_row(obj: object) -> dict[str, object]:
    """The export's JSON spelling of one ORM row — also the change log's row image (§9)."""
    return {column.key: json_cell(getattr(obj, column.key)) for column in obj.__table__.columns}


def csv_for_rows(columns: list[Column], rows: Iterable[Mapping[str, object]]) -> str:
    """The CSV member for one table. Rows are mappings of RAW values (row_dict, or parse_cell
    output), so live rows and parsed snapshot rows write byte-identical text — which is
    what lets the restore call a table `identical` by hash."""
    sink = io.StringIO()
    writer = csv.writer(sink)  # csv's default \r\n line ending IS RFC 4180's
    writer.writerow([column.key for column in columns])
    for row in rows:
        writer.writerow([csv_cell(row.get(column.key)) for column in columns])
    return sink.getvalue()


async def alembic_head(db: AsyncSession) -> str | None:
    """The system router's exact probe: to_regclass, not try/except — a missing
    alembic_version is an EXPECTED state (create_all-built databases, every test run), and
    a failed SELECT would abort the session's transaction mid-request."""
    has_alembic = (
        await db.execute(text("SELECT to_regclass('alembic_version') IS NOT NULL"))
    ).scalar_one()
    if not has_alembic:
        return None
    head_row = await db.execute(text("SELECT version_num FROM alembic_version"))
    return head_row.scalars().first()


@dataclass(frozen=True)
class SnapshotZip:
    payload: bytes
    filename: str  # the download name, HHMM like every export before it
    exported_at: datetime
    alembic_head: str | None
    counts: dict[str, int]


async def build_snapshot_zip(db: AsyncSession) -> SnapshotZip:
    exported_at = datetime.now(UTC)
    head = await alembic_head(db)
    counts: dict[str, int] = {}
    json_tables: dict[str, list[dict[str, object]]] = {}
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for model, table_name in EXPORTED_TABLES:
            columns = list(model.__table__.columns)  # model-definition order
            rows = (
                (
                    await db.execute(
                        # Ordered by primary key so two exports of the same data are
                        # byte-identical (diffable backups).
                        select(model).order_by(*model.__table__.primary_key.columns)
                    )
                )
                .scalars()
                .all()
            )
            redacted_keys = REDACTED_ROWS.get(table_name)
            if redacted_keys is not None:
                rows = [row for row in rows if row.key not in redacted_keys]
            counts[table_name] = len(rows)
            raw_rows = [row_dict(row, columns) for row in rows]
            archive.writestr(f"csv/{table_name}.csv", csv_for_rows(columns, raw_rows))
            json_tables[table_name] = [
                {key: json_cell(value) for key, value in raw.items()} for raw in raw_rows
            ]
        manifest = {
            "exported_at": exported_at.isoformat(),
            "environment": settings.environment,
            "alembic_head": head,
            "app": "personal-finance-dashboard",
            "note": (
                "full user-data export; users and alembic_version are excluded by design; "
                "see redactions for withheld rows"
            ),
            "tables": counts,
            "redactions": [
                f"{table}.{key}"
                for table, keys in sorted(REDACTED_ROWS.items())
                for key in sorted(keys)
            ],
        }
        archive.writestr("manifest.json", json.dumps(manifest, indent=2))
        archive.writestr(
            "finance-export.json",
            json.dumps(
                {
                    "exported_at": exported_at.isoformat(),
                    "alembic_head": head,
                    "tables": json_tables,
                },
                indent=2,
            ),
        )
    return SnapshotZip(
        payload=buffer.getvalue(),
        filename=f"finance-export-{exported_at:%Y%m%d-%H%M}.zip",
        exported_at=exported_at,
        alembic_head=head,
        counts=counts,
    )


def trim_directory(directory: Path, pattern: re.Pattern[str], keep: int) -> list[str]:
    """Delete every file matching `pattern` beyond the newest `keep` (names sort
    chronologically by construction). Returns the removed names. Sync — callers in async
    code wrap it in asyncio.to_thread."""
    names = sorted((p.name for p in directory.iterdir() if pattern.fullmatch(p.name)), reverse=True)
    removed = names[keep:]
    for name in removed:
        (directory / name).unlink()
    return removed


def write_file(
    directory: Path, name: str, payload: bytes, pattern: re.Pattern[str], keep: int
) -> Path:
    """ATOMIC publish of one archive, then trim. The bytes land in `<name>.part` and
    os.replace renames them into place: a crash mid-write leaves a `.part` that matches
    NO name pattern, never a truncated ZIP that the listing would happily offer to
    restore. os.replace is atomic within a directory on both POSIX and Windows. The trim
    runs AFTER the replace so the new file counts toward `keep`. Sync — async callers wrap
    it in asyncio.to_thread (the nightly snapshot job in L4 shares this writer)."""
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / name
    part = directory / f"{name}.part"
    part.write_bytes(payload)
    os.replace(part, path)
    trim_directory(directory, pattern, keep)
    return path


@dataclass(frozen=True)
class RestorePoint:
    name: str
    path: Path
    size_bytes: int
    run_id: int


async def write_restore_point(db: AsyncSession, *, actor: str | None) -> RestorePoint:
    """The current database's ZIP to <data_dir>/restore-points, keep three, recorded as a
    `restore_point` run (spec §7 step 1, §9 imports). COMMITS its own run row before
    returning: a restore or import that then fails and rolls back must still leave the
    point listed. File IO rides to_thread — blocking writes on the event loop are the
    ASYNC rules' whole complaint."""
    snap = await build_snapshot_zip(db)
    name = f"pre-restore-{snap.exported_at:%Y%m%d-%H%M%S-%f}.zip"
    path = await asyncio.to_thread(
        write_file,
        restore_points_dir(),
        name,
        snap.payload,
        RESTORE_POINT_NAME_RE,
        RESTORE_POINTS_KEEP,
    )
    run = LifecycleRun(
        kind="restore_point",
        dry_run=False,
        ok=True,
        actor=actor,
        filename=name,
        size_bytes=len(snap.payload),
        report={"tables": snap.counts},
    )
    db.add(run)
    await db.commit()
    return RestorePoint(name=name, path=path, size_bytes=len(snap.payload), run_id=run.id)
