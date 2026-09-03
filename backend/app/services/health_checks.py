"""Data health (2026-09-03 data-lifecycle spec §11): one cheap query per check, each
answering a HealthCheckOut with its severity and, when there is something to do, a fix —
a link into the app or an action the Data-health card runs (`delete_spending_month` per
month in `months`, `snapshot_now`). `now` is injected so the rules are clock-testable.
Thresholds are twins of src/utils/staleness.ts; test_health_checks pins them."""

import asyncio
from datetime import date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    AccountBalance,
    AppSetting,
    LatestPrice,
    MonthlyCashflow,
    MonthlySpending,
    NetWorthSnapshot,
    Security,
)
from app.schemas.lifecycle import HealthCheckOut, HealthFixOut
from app.schemas.system import BackupStatusOut
from app.services.snapshot import SNAPSHOT_NAME_RE, snapshot_stamp, snapshots_dir

STALE_QUOTE_DAYS = 4  # staleness.ts STALE_AFTER_DAYS
BACKUP_WARN_HOURS = 48  # staleness.ts BACKUP_STALE_HOURS
BACKUP_ERROR_DAYS = 7  # staleness.ts BACKUP_OVERDUE_DAYS
SNAPSHOT_WARN_HOURS = 36
COVERAGE_WINDOW_MONTHS = 12
BACKUP_STATUS_KEY = "backup_status"  # app/api/system.py's key, read here without the router


def _ok(check_id: str, title: str) -> HealthCheckOut:
    return HealthCheckOut(id=check_id, severity="ok", title=title, detail="")


def _label(month: date) -> str:
    return f"{month:%b %Y}"


def _months_back(month: date, n: int) -> date:
    index = month.year * 12 + (month.month - 1) - n
    return date(index // 12, index % 12 + 1, 1)


async def check_zero_filled_spending(db: AsyncSession) -> HealthCheckOut:
    zero_months = (
        await db.execute(
            select(MonthlySpending.month)
            .group_by(MonthlySpending.month)
            .having(func.max(func.abs(MonthlySpending.amount)) == 0)
            .order_by(MonthlySpending.month)
        )
    ).scalars()
    cashflow_months = set((await db.execute(select(MonthlyCashflow.month))).scalars())
    months = [month for month in zero_months if month not in cashflow_months]
    if not months:
        return _ok("zero_filled_spending", "Spending months carry real amounts")
    plural = "s" if len(months) > 1 else ""
    return HealthCheckOut(
        id="zero_filled_spending",
        severity="error",
        title=f"Zero-filled spending month{plural}",
        detail=(
            f"{', '.join(_label(m) for m in months)}: every category is $0.00 and no take-home "
            "was entered — an empty month that reads as spending nothing."
        ),
        count=len(months),
        months=months,
        fix=HealthFixOut(
            kind="action", action="delete_spending_month", label="Delete the zero-filled month"
        ),
    )


async def check_coverage_gaps(
    db: AsyncSession, *, today: date
) -> tuple[HealthCheckOut, HealthCheckOut]:
    """Balances without spending, and the inverse, over the last twelve COMPLETE months."""
    current = today.replace(day=1)
    floor = _months_back(current, COVERAGE_WINDOW_MONTHS)

    def in_window(month: date) -> bool:
        return floor <= month < current

    balances = {
        m for m in (await db.execute(select(NetWorthSnapshot.month))).scalars() if in_window(m)
    }
    spending = {
        m
        for m in (await db.execute(select(MonthlySpending.month).distinct())).scalars()
        if in_window(m)
    }
    without_spending = sorted(balances - spending)
    without_balances = sorted(spending - balances)

    def gap(check_id: str, title: str, months: list[date], step: str, verb: str) -> HealthCheckOut:
        if not months:
            return _ok(check_id, title)
        first = months[0]
        return HealthCheckOut(
            id=check_id,
            severity="warn",
            title=title,
            detail=f"{', '.join(_label(m) for m in months)}: {verb}.",
            count=len(months),
            months=months,
            fix=HealthFixOut(
                kind="link",
                to=f"/update?month={first.isoformat()}&step={step}",
                label=f"Enter {_label(first)} {step}",
            ),
        )

    return (
        gap(
            "balances_without_spending",
            "Balances entered, spending missing",
            without_spending,
            "spending",
            "balances were saved but no spending row exists",
        ),
        gap(
            "spending_without_balances",
            "Spending entered, balances missing",
            without_balances,
            "balances",
            "spending was saved but no balances snapshot exists",
        ),
    )


async def check_stale_quotes(db: AsyncSession, *, now: datetime) -> HealthCheckOut:
    cutoff = now - timedelta(days=STALE_QUOTE_DAYS)
    tickers = list(
        (
            await db.execute(
                select(Security.ticker)
                .join(LatestPrice, LatestPrice.security_id == Security.id)
                .where(
                    Security.is_active.is_(True),
                    Security.is_manual_priced.is_(False),
                    LatestPrice.quoted_at < cutoff,
                )
                .order_by(Security.ticker)
            )
        ).scalars()
    )
    if not tickers:
        return _ok("stale_quotes", "Quotes are fresh")
    return HealthCheckOut(
        id="stale_quotes",
        severity="warn",
        title="Stale quotes",
        detail=(
            f"{len(tickers)} active holding(s) quoted more than {STALE_QUOTE_DAYS} days ago: "
            f"{', '.join(tickers)}."
        ),
        count=len(tickers),
        fix=HealthFixOut(kind="link", to="/portfolio", label="Open Portfolio"),
    )


async def check_identical_snapshot(db: AsyncSession) -> HealthCheckOut:
    snapshots = list(
        (
            await db.execute(
                select(NetWorthSnapshot).order_by(NetWorthSnapshot.month.desc()).limit(2)
            )
        ).scalars()
    )
    if len(snapshots) < 2:
        return _ok("identical_snapshot", "Latest balances differ from the month before")
    rows = (
        await db.execute(
            select(
                AccountBalance.snapshot_id, AccountBalance.account_id, AccountBalance.balance
            ).where(AccountBalance.snapshot_id.in_([s.id for s in snapshots]))
        )
    ).all()
    latest = {(a, b) for s, a, b in rows if s == snapshots[0].id}
    previous = {(a, b) for s, a, b in rows if s == snapshots[1].id}
    if not latest or latest != previous:
        return _ok("identical_snapshot", "Latest balances differ from the month before")
    return HealthCheckOut(
        id="identical_snapshot",
        severity="info",
        title="Two identical months",
        detail=(
            f"{_label(snapshots[0].month)} carries exactly {_label(snapshots[1].month)}'s "
            "balances — a copied month, or a month nothing moved."
        ),
        count=1,
        months=[snapshots[0].month],
        fix=HealthFixOut(
            kind="link",
            to=f"/update?month={snapshots[0].month.isoformat()}",
            label=f"Review {_label(snapshots[0].month)}",
        ),
    )


async def check_backup(db: AsyncSession, *, now: datetime, environment: str) -> HealthCheckOut:
    if environment != "prod":
        return HealthCheckOut(
            id="backup",
            severity="info",
            title="Backups are not configured here",
            detail="Nightly database dumps run on the production host only.",
        )
    fix = HealthFixOut(kind="link", to="/settings#backups", label="Open Backups")
    setting = await db.get(AppSetting, BACKUP_STATUS_KEY)
    marker: BackupStatusOut | None = None
    if setting is not None and isinstance(setting.value, dict):
        try:
            marker = BackupStatusOut.model_validate(setting.value)
        except ValueError:
            marker = None
    if marker is None:
        return HealthCheckOut(
            id="backup",
            severity="error",
            title="No backup recorded",
            detail="No nightly dump has ever been recorded on this server.",
            count=1,
            fix=fix,
        )
    age = now - marker.last_success_at
    if age > timedelta(days=BACKUP_ERROR_DAYS):
        return HealthCheckOut(
            id="backup",
            severity="error",
            title="Backup overdue",
            detail=f"The last successful dump was {age.days} days ago.",
            count=1,
            fix=fix,
        )
    if age > timedelta(hours=BACKUP_WARN_HOURS):
        return HealthCheckOut(
            id="backup",
            severity="warn",
            title="Backup stale",
            detail=(f"The last successful dump was {int(age.total_seconds() // 3600)} hours ago."),
            count=1,
            fix=fix,
        )
    if marker.verified is False:
        return HealthCheckOut(
            id="backup",
            severity="warn",
            title="Last backup not verified",
            detail=marker.verify_error or "The verify phase reported no reason.",
            count=1,
            fix=fix,
        )
    return _ok("backup", "Nightly backup is recent" + (" and verified" if marker.verified else ""))


def check_snapshot(*, now: datetime, snapshot_enabled: bool) -> HealthCheckOut:
    """Sync (filesystem) — run_checks wraps it in asyncio.to_thread."""
    if not snapshot_enabled:
        return _ok("snapshot", "Stored snapshots are disabled here")
    directory = snapshots_dir()
    names = (
        sorted(
            (p.name for p in directory.iterdir() if SNAPSHOT_NAME_RE.fullmatch(p.name)),
            reverse=True,
        )
        if directory.is_dir()
        else []
    )
    newest = snapshot_stamp(names[0]) if names else None
    fix = HealthFixOut(kind="action", action="snapshot_now", label="Snapshot now")
    if newest is None:
        return HealthCheckOut(
            id="snapshot",
            severity="warn",
            title="No stored snapshot yet",
            detail="The nightly snapshot has not written a file to the data volume.",
            count=1,
            fix=fix,
        )
    age = now - newest
    if age > timedelta(hours=SNAPSHOT_WARN_HOURS):
        return HealthCheckOut(
            id="snapshot",
            severity="warn",
            title="Stored snapshot is old",
            detail=(f"The newest stored snapshot is {int(age.total_seconds() // 3600)} hours old."),
            count=1,
            fix=fix,
        )
    return _ok("snapshot", "A stored snapshot is recent")


async def run_checks(
    db: AsyncSession, *, now: datetime, environment: str, snapshot_enabled: bool
) -> list[HealthCheckOut]:
    without_spending, without_balances = await check_coverage_gaps(db, today=now.date())
    return [
        await check_zero_filled_spending(db),
        without_spending,
        without_balances,
        await check_stale_quotes(db, now=now),
        await check_identical_snapshot(db),
        await check_backup(db, now=now, environment=environment),
        await asyncio.to_thread(check_snapshot, now=now, snapshot_enabled=snapshot_enabled),
    ]
