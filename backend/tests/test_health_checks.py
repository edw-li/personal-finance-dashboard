from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal

from app.models import (
    Account,
    AccountBalance,
    AppSetting,
    LatestPrice,
    MonthlyCashflow,
    MonthlySpending,
    NetWorthSnapshot,
    Security,
    SpendingCategory,
)
from app.services.coverage import load_coverage
from app.services.health_checks import (
    BACKUP_ERROR_DAYS,
    BACKUP_WARN_HOURS,
    SNAPSHOT_WARN_HOURS,
    STALE_QUOTE_DAYS,
    check_backup,
    check_coverage_gaps,
    check_identical_snapshot,
    check_net_pay_without_spending,
    check_snapshot,
    check_spending_gap,
    check_stale_quotes,
    check_zero_filled_spending,
    run_checks,
)
from app.services.snapshot import snapshots_dir

NOW = datetime(2026, 9, 4, 12, 0, tzinfo=UTC)


async def categories(db) -> tuple[SpendingCategory, SpendingCategory]:
    food = SpendingCategory(name="Food", slug="food", sort_order=1)
    rent = SpendingCategory(name="Rent", slug="rent", sort_order=2)
    db.add_all([food, rent])
    await db.flush()
    return food, rent


def test_thresholds_are_the_frontend_twins():
    # src/utils/staleness.ts: STALE_AFTER_DAYS = 4, BACKUP_STALE_HOURS = 48,
    # BACKUP_OVERDUE_DAYS = 7.
    assert (STALE_QUOTE_DAYS, BACKUP_WARN_HOURS, BACKUP_ERROR_DAYS, SNAPSHOT_WARN_HOURS) == (
        4,
        48,
        7,
        36,
    )


async def test_zero_filled_spending_names_the_phantom_month_with_a_repair_action(db):
    food, rent = await categories(db)
    # September: every row $0.00, no take-home - the audit's phantom month.
    db.add_all(
        [
            MonthlySpending(month=date(2026, 9, 1), category_id=food.id, amount=Decimal("0.00")),
            MonthlySpending(month=date(2026, 9, 1), category_id=rent.id, amount=Decimal("0.00")),
            # August: zeros but WITH a cashflow row - a real month of no spending, not a
            # phantom.
            MonthlySpending(month=date(2026, 8, 1), category_id=food.id, amount=Decimal("0.00")),
            MonthlyCashflow(month=date(2026, 8, 1), net_pay=Decimal("5000.00")),
            # July: real amounts.
            MonthlySpending(month=date(2026, 7, 1), category_id=food.id, amount=Decimal("400.00")),
        ]
    )
    await db.commit()
    check = check_zero_filled_spending(await load_coverage(db))
    assert check.severity == "error" and check.count == 1 and check.months == [date(2026, 9, 1)]
    assert check.title == "Zero-filled spending month"
    assert "Sep 2026" in check.detail
    assert check.fix is not None
    assert (check.fix.kind, check.fix.action) == ("action", "delete_spending_month")
    await db.execute(
        MonthlySpending.__table__.delete().where(MonthlySpending.month == date(2026, 9, 1))
    )
    await db.commit()
    assert check_zero_filled_spending(await load_coverage(db)).severity == "ok"


async def test_coverage_gaps_look_back_twelve_months_and_skip_the_current(db):
    food, _ = await categories(db)
    account = Account(name="A", slug="a", group="cash", sort_order=1)
    db.add(account)
    await db.flush()
    for month in (date(2026, 8, 1), date(2026, 7, 1), date(2025, 8, 1), date(2026, 9, 1)):
        snapshot = NetWorthSnapshot(month=month)
        db.add(snapshot)
        await db.flush()
        db.add(
            AccountBalance(snapshot_id=snapshot.id, account_id=account.id, balance=Decimal("1.00"))
        )
    db.add(MonthlySpending(month=date(2026, 7, 1), category_id=food.id, amount=Decimal("1.00")))
    db.add(MonthlySpending(month=date(2026, 6, 1), category_id=food.id, amount=Decimal("1.00")))
    await db.commit()
    without_spending, without_balances = await check_coverage_gaps(db, today=NOW.date())
    # August has balances and no spending; September is the CURRENT month and is skipped;
    # Aug 2025 is outside the twelve-month window.
    assert without_spending.severity == "warn" and without_spending.months == [date(2026, 8, 1)]
    assert without_spending.fix is not None
    assert (without_spending.fix.kind, without_spending.fix.to) == (
        "link",
        "/update?month=2026-08-01&step=spending",
    )
    assert without_balances.severity == "warn" and without_balances.months == [date(2026, 6, 1)]
    assert without_balances.fix.to == "/update?month=2026-06-01&step=balances"


async def test_stale_quotes_counts_active_auto_priced_securities_only(db):
    fresh = Security(ticker="AAA", name="A", holding_type="stock")
    stale = Security(ticker="BBB", name="B", holding_type="stock")
    manual = Security(ticker="CCC", name="C", holding_type="private", is_manual_priced=True)
    retired = Security(ticker="DDD", name="D", holding_type="stock", is_active=False)
    db.add_all([fresh, stale, manual, retired])
    await db.flush()
    old = NOW - timedelta(days=STALE_QUOTE_DAYS + 1)
    db.add_all(
        [
            LatestPrice(
                security_id=fresh.id,
                price=Decimal("1"),
                quoted_at=NOW - timedelta(days=1),
                source="yfinance",
            ),
            LatestPrice(security_id=stale.id, price=Decimal("1"), quoted_at=old, source="yfinance"),
            LatestPrice(security_id=manual.id, price=Decimal("1"), quoted_at=old, source="manual"),
            LatestPrice(
                security_id=retired.id, price=Decimal("1"), quoted_at=old, source="yfinance"
            ),
        ]
    )
    await db.commit()
    check = await check_stale_quotes(db, now=NOW)
    assert check.severity == "warn" and check.count == 1
    assert "BBB" in check.detail and check.fix.to == "/portfolio"


async def test_stale_quotes_compares_bar_dates_like_the_frontend_twin(db):
    # staleness.ts: stale iff today's UTC midnight - the bar DATE > 4 days. A bar exactly
    # four days back is fresh on both screens; five days back is stale on both. An instant
    # cutoff (now - 4d) would call the four-day bar stale here and fresh in the holdings
    # table for the rest of the day.
    edge = Security(ticker="EDGE", name="Edge", holding_type="stock")
    over = Security(ticker="OVER", name="Over", holding_type="stock")
    db.add_all([edge, over])
    await db.flush()
    midnight = datetime.combine(NOW.date(), time.min, tzinfo=UTC)
    db.add(
        LatestPrice(
            security_id=edge.id,
            price=Decimal("1"),
            quoted_at=midnight - timedelta(days=STALE_QUOTE_DAYS),
            source="yfinance",
        )
    )
    await db.commit()
    assert (await check_stale_quotes(db, now=NOW)).severity == "ok"
    db.add(
        LatestPrice(
            security_id=over.id,
            price=Decimal("1"),
            quoted_at=midnight - timedelta(days=STALE_QUOTE_DAYS + 1),
            source="yfinance",
        )
    )
    await db.commit()
    check = await check_stale_quotes(db, now=NOW)
    assert check.severity == "warn" and check.count == 1
    assert "OVER" in check.detail and "EDGE" not in check.detail


async def test_identical_snapshot_is_an_info_with_a_link_to_the_latest_month(db):
    account = Account(name="A", slug="a", group="cash", sort_order=1)
    db.add(account)
    await db.flush()
    for month in (date(2026, 7, 1), date(2026, 8, 1)):
        snapshot = NetWorthSnapshot(month=month)
        db.add(snapshot)
        await db.flush()
        db.add(
            AccountBalance(
                snapshot_id=snapshot.id, account_id=account.id, balance=Decimal("100.00")
            )
        )
    await db.commit()
    check = await check_identical_snapshot(db)
    assert check.severity == "info" and check.months == [date(2026, 8, 1)]
    assert check.fix.to == "/update?month=2026-08-01"


async def test_backup_check_is_info_off_prod_and_grades_the_marker_on_prod(db):
    assert (await check_backup(db, now=NOW, environment="dev")).severity == "info"
    absent = await check_backup(db, now=NOW, environment="prod")
    assert absent.severity == "error" and absent.fix.to == "/settings#backups"
    marker = AppSetting(
        key="backup_status",
        value={
            "last_success_at": (NOW - timedelta(hours=3)).isoformat(),
            "object_key": "k",
            "size": "108K",
            "verified": True,
        },
    )
    db.add(marker)
    await db.commit()
    assert (await check_backup(db, now=NOW, environment="prod")).severity == "ok"
    marker.value = {**marker.value, "verified": False, "verify_error": "row count mismatch"}
    await db.commit()
    unverified = await check_backup(db, now=NOW, environment="prod")
    assert unverified.severity == "warn" and "row count mismatch" in unverified.detail
    marker.value = {
        "last_success_at": (NOW - timedelta(hours=BACKUP_WARN_HOURS + 1)).isoformat(),
        "object_key": "k",
        "size": "1M",
    }
    await db.commit()
    assert (await check_backup(db, now=NOW, environment="prod")).severity == "warn"
    marker.value = {
        "last_success_at": (NOW - timedelta(days=BACKUP_ERROR_DAYS + 1)).isoformat(),
        "object_key": "k",
        "size": "1M",
    }
    await db.commit()
    assert (await check_backup(db, now=NOW, environment="prod")).severity == "error"


def test_snapshot_check_reads_the_stored_files():
    assert check_snapshot(now=NOW, snapshot_enabled=False).severity == "ok"
    none_yet = check_snapshot(now=NOW, snapshot_enabled=True)
    assert none_yet.severity == "warn" and (none_yet.fix.kind, none_yet.fix.action) == (
        "action",
        "snapshot_now",
    )
    directory = snapshots_dir()
    directory.mkdir(parents=True)
    (directory / "finance-export-20260902-233000.zip").write_bytes(b"x")  # 36h+ before NOW
    assert check_snapshot(now=NOW, snapshot_enabled=True).severity == "warn"
    (directory / "finance-export-20260903-233000.zip").write_bytes(b"x")  # 12.5h before NOW
    assert check_snapshot(now=NOW, snapshot_enabled=True).severity == "ok"


async def test_run_checks_returns_the_nine_in_order(db):
    checks = await run_checks(db, now=NOW, environment="dev", snapshot_enabled=False)
    assert [c.id for c in checks] == [
        "zero_filled_spending",
        "spending_gap",
        "net_pay_without_spending",
        "balances_without_spending",
        "spending_without_balances",
        "stale_quotes",
        "identical_snapshot",
        "backup",
        "snapshot",
    ]
    assert [c.severity for c in checks] == [
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "info",
        "ok",
    ]


async def test_spending_gap_names_months_missing_inside_the_balances_window(db):
    food, _rent = await categories(db)
    db.add_all(
        [
            NetWorthSnapshot(month=date(2026, 7, 1)),
            NetWorthSnapshot(month=date(2026, 9, 1)),
            MonthlySpending(month=date(2026, 7, 1), category_id=food.id, amount=Decimal("400.00")),
            # September was saved with balances only: 19 rows of $0.00, no take-home.
            MonthlySpending(month=date(2026, 9, 1), category_id=food.id, amount=Decimal("0.00")),
        ]
    )
    await db.commit()
    coverage = await load_coverage(db)

    gap = check_spending_gap(coverage)
    assert gap.severity == "warn" and gap.count == 1
    assert gap.months == [date(2026, 8, 1)]  # nothing at all on file, and inside the window
    assert gap.fix.to == "/update?month=2026-08-01&step=spending"
    # The empty September belongs to the zero-filled check; neither claims the other's month.
    assert check_zero_filled_spending(coverage).months == [date(2026, 9, 1)]


async def test_spending_gap_is_ok_when_the_window_is_covered(db):
    food, _rent = await categories(db)
    db.add_all(
        [
            NetWorthSnapshot(month=date(2026, 7, 1)),
            MonthlySpending(month=date(2026, 7, 1), category_id=food.id, amount=Decimal("400.00")),
        ]
    )
    await db.commit()
    assert check_spending_gap(await load_coverage(db)).severity == "ok"


async def test_net_pay_without_spending_refuses_to_read_as_a_frugal_month(db):
    db.add(MonthlyCashflow(month=date(2026, 8, 1), net_pay=Decimal("6373.09")))
    await db.commit()
    check = check_net_pay_without_spending(await load_coverage(db))
    assert check.severity == "warn" and check.months == [date(2026, 8, 1)]
    assert check.fix.to == "/update?month=2026-08-01&step=spending"
    assert "take-home was entered but no spending row exists" in check.detail
