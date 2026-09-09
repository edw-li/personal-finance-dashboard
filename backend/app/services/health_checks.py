"""Data health (2026-09-03 data-lifecycle spec §11): one cheap query per check, each
answering a HealthCheckOut with its severity and, when there is something to do, a fix —
a link into the app or an action the Data-health card runs (`delete_spending_month` per
month in `months`, `snapshot_now`). The instant `now` is injected so the AGE rules are
clock-testable; the calendar-day rules read the product clock (services/clock.py).
Thresholds are twins of src/utils/staleness.ts; test_health_checks pins them."""

import asyncio
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    AccountBalance,
    AppSetting,
    LatestPrice,
    MonthlySpending,
    NetWorthSnapshot,
    Security,
    TaxInput,
    TaxYear,
)
from app.schemas.lifecycle import HealthCheckOut, HealthFixOut
from app.schemas.system import BackupStatusOut
from app.services import clock
from app.services.coverage import Coverage, load_coverage
from app.services.people import load_people
from app.services.snapshot import SNAPSHOT_NAME_RE, snapshot_stamp, snapshots_dir
from app.services.tax_service import derive_suggestions
from app.tax_keys import SINGLE

STALE_QUOTE_DAYS = 4  # staleness.ts STALE_AFTER_DAYS
BACKUP_WARN_HOURS = 48  # staleness.ts BACKUP_STALE_HOURS
BACKUP_ERROR_DAYS = 7  # staleness.ts BACKUP_OVERDUE_DAYS
SNAPSHOT_WARN_HOURS = 36
COVERAGE_WINDOW_MONTHS = 12
BACKUP_STATUS_KEY = "backup_status"  # app/api/system.py's key, read here without the router
# One cent. The stored itemized figure is Numeric(14,4) and the workbook summed its
# own formula at full precision, so the equality test has to tolerate the rounding
# that happened on the way in — and no more than that, or a hand-typed figure that
# happens to land near the legacy sum would be called a leftover.
LEGACY_ITEMIZED_TOLERANCE = Decimal("0.01")
SEC199A_KEY = "itemized_sec199a_div"
ITEMIZED_KEY = "itemized_deduction"


def _ok(check_id: str, title: str) -> HealthCheckOut:
    return HealthCheckOut(id=check_id, severity="ok", title=title, detail="")


def _label(month: date) -> str:
    return f"{month:%b %Y}"


def _months_back(month: date, n: int) -> date:
    index = month.year * 12 + (month.month - 1) - n
    return date(index // 12, index % 12 + 1, 1)


def _month_gap(
    check_id: str, title: str, months: list[date], step: str, verb: str
) -> HealthCheckOut:
    """A warn-level "these months are not on file" card with a link into the wizard's
    step for the FIRST of them. Shared by every gap rule so one sentence shape, one
    severity and one link format cover them all."""
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


def check_zero_filled_spending(coverage: Coverage) -> HealthCheckOut:
    """Months saved with rows that are ALL $0.00 — the audit's phantom month, in its two
    shapes, both from `coverage` so this card, the footer and the ribbon can never disagree.

    `coverage.empty` (2026-09-04 honest-numbers spec §3) is a month with no take-home
    either: nothing about it is real, so it is an ERROR. `coverage.zero_with_net_pay`
    (2026-09-09 audit item 1) is the wizard's own phantom — the old save shipped all
    nineteen seeded "0.00" boxes behind a single take-home figure — but a deliberately
    confirmed $0 month with pay has the very same shape, so it can only be a WARN and its
    sentence has to leave that reading open.

    Both offer the same repair, and it removes the zero spending rows only: the take-home is
    the one figure the user really typed, and a month left with it reads honestly as
    "take-home entered, spending missing" on the very next card.
    """
    months = sorted({*coverage.empty, *coverage.zero_with_net_pay})
    if not months:
        return _ok("zero_filled_spending", "Spending months carry real amounts")
    plural = "s" if len(months) > 1 else ""
    sentences = []
    if coverage.empty:
        sentences.append(
            f"{', '.join(_label(m) for m in coverage.empty)}: every category is $0.00 and no "
            "take-home was entered — an empty month that reads as spending nothing."
        )
    if coverage.zero_with_net_pay:
        sentences.append(
            "All-zero spending beside a take-home figure for "
            f"{', '.join(_label(m) for m in coverage.zero_with_net_pay)} — delete the zero "
            "rows unless you recorded a genuine $0 month."
        )
    return HealthCheckOut(
        id="zero_filled_spending",
        # The louder of the two shapes wins when a book carries both.
        severity="error" if coverage.empty else "warn",
        title=f"Zero-filled spending month{plural}",
        detail=" ".join(sentences),
        count=len(months),
        months=months,
        fix=HealthFixOut(
            kind="action", action="delete_spending_month", label="Delete the zero-filled rows"
        ),
    )


def check_spending_gap(coverage: Coverage) -> HealthCheckOut:
    """Months inside the BALANCES window with no spending rows and no take-home.

    Distinct from `balances_without_spending`, which reads the trailing twelve COMPLETE
    months and needs a snapshot in the month itself: this one covers the whole window the
    balances span, which is what the footer and the attention list quote.
    """
    return _month_gap(
        "spending_gap",
        "Spending months never entered",
        coverage.missing,
        "spending",
        "balances cover this month but no spending or take-home was ever entered",
    )


def check_net_pay_without_spending(coverage: Coverage) -> HealthCheckOut:
    """Take-home saved alone. The month is ENTERED, and its living spend is 0 — so
    without this card it would read as the most frugal month on record (spec §6)."""
    return _month_gap(
        "net_pay_without_spending",
        "Take-home entered, spending missing",
        coverage.net_pay_without_spending,
        "spending",
        "take-home was entered but no spending row exists",
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

    return (
        _month_gap(
            "balances_without_spending",
            "Balances entered, spending missing",
            without_spending,
            "spending",
            "balances were saved but no spending row exists",
        ),
        _month_gap(
            "spending_without_balances",
            "Spending entered, balances missing",
            without_balances,
            "balances",
            "spending was saved but no balances snapshot exists",
        ),
    )


async def check_stale_quotes(db: AsyncSession, *, now: datetime) -> HealthCheckOut:
    # DATES, not instants: staleness.ts truncates quoted_at to its bar DAY and compares it
    # against today's UTC midnight, so an instant cutoff would have this card and the
    # holdings table disagree about the same row for a day (a Friday bar reading stale here
    # on Monday evening). `quoted_at < midnight(today - 4d)` is exactly the twin's
    # `today - bar_date > 4 days`, because date(q) < D iff q < midnight(D).
    cutoff = datetime.combine(now.date() - timedelta(days=STALE_QUOTE_DAYS), time.min, tzinfo=UTC)
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


async def check_sec199a_in_itemized(db: AsyncSession) -> HealthCheckOut:
    """Years whose stored itemized deduction still has the §199A line inside it.

    §199A moved below the line on 2026-09-09 (taxes spec 4h): the engine deducts it in its
    own right now, and `derive_suggestions` dropped it from the itemized formula. A year
    whose `itemized_deduction` was APPLIED from the old chip therefore carries the same
    dollars twice — once inside the itemized total, once below the line — and understates
    the tax silently, which is the failure this card exists to name.

    The test is exact rather than heuristic: the only difference between the two formulas
    IS the §199A term, so a stored figure equal (to the cent) to `suggestion + §199A` is a
    figure the old chip wrote. A hand-typed total, or a year whose §199A line is zero, is
    left alone — absent a positive §199A there is nothing double-counted to begin with.

    Values are assembled through the taxes router's own `_assemble_inputs`, narrowed to the
    people THIS year's return covers, so the suggestion compared against is exactly the one
    the page offers. Summing every stored row instead would be wrong for a filing-separately
    year with a partner's rows on file: their income is off that return, but it would still
    raise the MAGI the SALT phase-down is judged on, shrink the suggestion, and let a real
    leftover pass unnoticed. The import is function-local, the way `assistant_context`
    borrows the routers it reads — a service must not import a router at module scope.
    """
    from app.api.taxes import _assemble_inputs, _return_people

    check_id = "sec199a_in_itemized"
    title = "Itemized deductions exclude the §199A line"
    statuses = {
        row.year: row.filing_status for row in (await db.execute(select(TaxYear))).scalars()
    }
    people = await load_people(db)
    rows_by_year: dict[int, list[TaxInput]] = {}
    for row in (await db.execute(select(TaxInput))).scalars():
        rows_by_year.setdefault(row.year, []).append(row)

    years: list[int] = []
    for year in sorted(rows_by_year):
        status = statuses.get(year, SINGLE)
        columns = [person.id for person in _return_people(people, status)] or [None]
        inputs = _assemble_inputs(rows_by_year[year], columns)
        sec199a = inputs.get(SEC199A_KEY)
        itemized = inputs.get(ITEMIZED_KEY)
        if sec199a is None or sec199a <= 0 or itemized is None:
            continue
        suggested = derive_suggestions(year, inputs, status)[ITEMIZED_KEY]
        if abs(itemized - (suggested + sec199a)) <= LEGACY_ITEMIZED_TOLERANCE:
            years.append(year)
    if not years:
        return _ok(check_id, title)
    plural = "s" if len(years) > 1 else ""
    return HealthCheckOut(
        id=check_id,
        severity="warn",
        title=f"Itemized deduction for {', '.join(str(y) for y in years)} still includes "
        f"the §199A line",
        detail=(
            f"{', '.join(str(y) for y in years)}: the stored itemized total matches the OLD "
            "formula, which added the §199A line the engine now deducts on its own — so those "
            f"dollars are deducted twice and the year{plural} read{'' if plural else 's'} "
            "under-taxed. The repair rewrites the total to the current suggestion."
        ),
        count=len(years),
        years=years,
        fix=HealthFixOut(
            kind="action",
            action="rewrite_itemized_deduction",
            label="Rewrite the itemized total",
        ),
    )


async def run_checks(
    db: AsyncSession, *, now: datetime, environment: str, snapshot_enabled: bool
) -> list[HealthCheckOut]:
    # ONE coverage read for the three rules that share its definition.
    coverage = await load_coverage(db)
    # `now` is UTC ON PURPOSE (check_stale_quotes' note) and stays that way for the
    # AGE comparisons. The coverage window is a CALENDAR question — which months are
    # complete — so it reads the product clock instead, or the last evening of a month
    # would close that month's window early in Pacific eyes (audit item 31).
    without_spending, without_balances = await check_coverage_gaps(db, today=clock.product_today())
    return [
        check_zero_filled_spending(coverage),
        check_spending_gap(coverage),
        check_net_pay_without_spending(coverage),
        without_spending,
        without_balances,
        await check_sec199a_in_itemized(db),
        await check_stale_quotes(db, now=now),
        await check_identical_snapshot(db),
        await check_backup(db, now=now, environment=environment),
        await asyncio.to_thread(check_snapshot, now=now, snapshot_enabled=snapshot_enabled),
    ]
