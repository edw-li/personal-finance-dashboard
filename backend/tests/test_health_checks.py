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
from app.services import clock
from app.services.coverage import load_coverage
from app.services.health_checks import (
    BACKUP_ERROR_DAYS,
    BACKUP_WARN_HOURS,
    SNAPSHOT_WARN_HOURS,
    STALE_QUOTE_DAYS,
    check_backup,
    check_coverage_gaps,
    check_future_snapshot,
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


async def test_zero_filled_spending_also_flags_zeros_beside_a_take_home(db):
    """The wizard's real bug (2026-09-09 audit item 1): a take-home figure carried a page of
    seeded $0.00 rows past the empty-month guard, so the month is "entered" and its zeros
    read as a real month of spending nothing. Coverage calls it entered - correctly - which
    is exactly why this card has to name it."""
    food, rent = await categories(db)
    db.add_all(
        [
            MonthlySpending(month=date(2026, 8, 1), category_id=food.id, amount=Decimal("0.00")),
            MonthlySpending(month=date(2026, 8, 1), category_id=rent.id, amount=Decimal("0.00")),
            MonthlyCashflow(month=date(2026, 8, 1), net_pay=Decimal("5000.00")),
            # July: a real month beside a take-home - never flagged.
            MonthlySpending(month=date(2026, 7, 1), category_id=food.id, amount=Decimal("400.00")),
            MonthlyCashflow(month=date(2026, 7, 1), net_pay=Decimal("5000.00")),
            # June: take-home alone, no rows at all - that is the net_pay_without_spending
            # card's month, not this one.
            MonthlyCashflow(month=date(2026, 6, 1), net_pay=Decimal("5000.00")),
        ]
    )
    await db.commit()
    coverage = await load_coverage(db)
    assert coverage.empty == []  # August is ENTERED: it carries a take-home row
    assert coverage.zero_with_net_pay == [date(2026, 8, 1)]
    check = check_zero_filled_spending(coverage)
    # WARN, not error: a deliberately confirmed $0 month with pay has this exact shape, so
    # the card suggests rather than accuses.
    assert check.severity == "warn" and check.months == [date(2026, 8, 1)]
    assert check.detail == (
        "All-zero spending beside a take-home figure for Aug 2026 — delete the zero rows "
        "unless you recorded a genuine $0 month."
    )
    assert check.fix is not None
    assert (check.fix.kind, check.fix.action) == ("action", "delete_spending_month")


async def test_zero_filled_spending_takes_the_louder_severity_when_a_book_has_both(db):
    food, _rent = await categories(db)
    db.add_all(
        [
            # Sep: nothing real at all — the error shape.
            MonthlySpending(month=date(2026, 9, 1), category_id=food.id, amount=Decimal("0.00")),
            # Aug: zeros beside a real take-home — the warn shape.
            MonthlySpending(month=date(2026, 8, 1), category_id=food.id, amount=Decimal("0.00")),
            MonthlyCashflow(month=date(2026, 8, 1), net_pay=Decimal("5000.00")),
        ]
    )
    await db.commit()
    check = check_zero_filled_spending(await load_coverage(db))
    assert check.severity == "error"
    assert check.months == [date(2026, 8, 1), date(2026, 9, 1)] and check.count == 2
    assert check.title == "Zero-filled spending months"
    # One sentence per shape, the error's first.
    assert check.detail.startswith("Sep 2026: every category is $0.00")
    assert "All-zero spending beside a take-home figure for Aug 2026" in check.detail


async def _gaps(db, monkeypatch, day: date):
    """check_coverage_gaps on `day`, fed the month status /coverage computes that day."""
    monkeypatch.setattr(clock, "product_today", lambda: day)
    return await check_coverage_gaps(db, status=(await load_coverage(db)).status)


async def test_coverage_gaps_wait_for_the_flows_to_be_overdue(db, monkeypatch):
    """T5 (2026-09-23 spec): a month's spending is not missing before its flows are overdue —
    the 16th of the next month by default — so the just-ended month is a to-do (Needs
    attention), not a gap. Its BALANCES are another matter: an ended month's were due on its
    own 1st and are overdue by its last day at the latest."""
    food, _ = await categories(db)
    account = Account(name="A", slug="a", group="cash", sort_order=1)
    db.add(account)
    await db.flush()
    for month in (date(2026, 8, 1), date(2026, 7, 1), date(2025, 8, 1), date(2026, 9, 1)):
        snapshot = NetWorthSnapshot(month=month, recorded_on=month)
        db.add(snapshot)
        await db.flush()
        db.add(
            AccountBalance(snapshot_id=snapshot.id, account_id=account.id, balance=Decimal("1.00"))
        )
    db.add(MonthlySpending(month=date(2026, 7, 1), category_id=food.id, amount=Decimal("1.00")))
    db.add(MonthlySpending(month=date(2026, 6, 1), category_id=food.id, amount=Decimal("1.00")))
    await db.commit()
    # Sep 4: August's spending is due, not overdue (from Sep 16) — no gap yet. June has spending
    # and no balances, and its balances were due long ago.
    without_spending, without_balances = await _gaps(db, monkeypatch, NOW.date())
    assert without_spending.severity == "ok"
    assert without_balances.severity == "warn" and without_balances.months == [date(2026, 6, 1)]
    assert without_balances.fix is not None
    assert without_balances.fix.to == "/update?month=2026-06-01&step=balances"
    # Sep 16: August is overdue. Aug 2025 is outside the twelve-month window; September is the
    # current month and is skipped.
    without_spending, _ = await _gaps(db, monkeypatch, date(2026, 9, 16))
    assert without_spending.severity == "warn" and without_spending.months == [date(2026, 8, 1)]
    assert without_spending.fix is not None
    assert (without_spending.fix.kind, without_spending.fix.to) == (
        "link",
        "/update?month=2026-08-01&step=spending",
    )


async def test_coverage_gaps_follow_the_reminder_day(db, monkeypatch):
    """The threshold is the reminder date's (spec §0.4(c)): with a day-28 reminder August's
    flows are overdue only from Oct 13 — three months can be due at once."""
    db.add(AppSetting(key="calendar_update_due_day", value={"value": 28}))
    db.add(NetWorthSnapshot(month=date(2026, 8, 1), recorded_on=date(2026, 8, 1)))
    await db.commit()
    assert (await _gaps(db, monkeypatch, date(2026, 10, 12)))[0].severity == "ok"
    assert (await _gaps(db, monkeypatch, date(2026, 10, 13)))[0].months == [date(2026, 8, 1)]


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
    check = await check_identical_snapshot(db, status=(await load_coverage(db)).status)
    assert check.severity == "info" and check.months == [date(2026, 8, 1)]
    assert check.fix.to == "/update?month=2026-08-01"


async def test_identical_snapshot_compares_the_latest_two_final_snapshots(db, monkeypatch):
    """T5 (2026-09-23 spec): Oct 1 balances typed on Sep 22 — usually by copying September's —
    are provisional. The check compares the latest two FINAL snapshots, so the routine's own
    early draft never reads as a copied month, and a real copy between two final months still
    does."""
    monkeypatch.setattr(clock, "product_today", lambda: date(2026, 9, 23))
    account = Account(name="A", slug="a", group="cash", sort_order=1)
    db.add(account)
    await db.flush()
    for month, recorded, balance in (
        (date(2026, 8, 1), date(2026, 8, 1), "90.00"),
        (date(2026, 9, 1), date(2026, 9, 1), "100.00"),
        (date(2026, 10, 1), date(2026, 9, 22), "100.00"),  # the early copy: provisional
    ):
        snapshot = NetWorthSnapshot(month=month, recorded_on=recorded)
        db.add(snapshot)
        await db.flush()
        db.add(
            AccountBalance(snapshot_id=snapshot.id, account_id=account.id, balance=Decimal(balance))
        )
    await db.commit()
    check = await check_identical_snapshot(db, status=(await load_coverage(db)).status)
    assert check.severity == "ok"
    # The same copy once final (saved again on Oct 1): now it IS two identical months.
    monkeypatch.setattr(clock, "product_today", lambda: date(2026, 10, 1))
    await db.execute(
        NetWorthSnapshot.__table__.update()
        .where(NetWorthSnapshot.month == date(2026, 10, 1))
        .values(recorded_on=date(2026, 10, 1))
    )
    await db.commit()
    check = await check_identical_snapshot(db, status=(await load_coverage(db)).status)
    assert check.severity == "info" and check.months == [date(2026, 10, 1)]


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


async def test_run_checks_returns_the_ten_in_order(db):
    checks = await run_checks(db, now=NOW, environment="dev", snapshot_enabled=False)
    assert [c.id for c in checks] == [
        "zero_filled_spending",
        "spending_gap",
        "net_pay_without_spending",
        "balances_without_spending",
        "spending_without_balances",
        # `sec199a_in_itemized` sat here from 2026-09-09 to 2026-09-11, when the derived
        # totals stopped being stored and there was no longer a stale total to name.
        "stale_quotes",
        "identical_snapshot",
        "backup",
        "snapshot",
        # The tenth, APPENDED so the nine keep their order and ids (2026-09-23 spec §T5).
        "future_snapshot",
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
        "ok",
    ]


async def test_future_snapshot_names_balances_filed_more_than_a_month_ahead(db, monkeypatch):
    """T5 (2026-09-23 spec §0.4(b)): the current snapshot is the latest up to NEXT month, so an
    early next-month snapshot is the routine's own and anything further ahead is never used as
    your balances — the check names it and links to that month's Balances step."""
    monkeypatch.setattr(clock, "product_today", lambda: date(2026, 9, 23))
    db.add(NetWorthSnapshot(month=date(2026, 9, 1), recorded_on=date(2026, 9, 1)))
    db.add(NetWorthSnapshot(month=date(2026, 10, 1), recorded_on=date(2026, 9, 22)))
    await db.commit()
    ok = check_future_snapshot((await load_coverage(db)).status)
    assert (ok.severity, ok.title) == ("ok", "No balances filed ahead of their month")
    db.add(NetWorthSnapshot(month=date(2026, 12, 1)))
    await db.commit()
    check = check_future_snapshot((await load_coverage(db)).status)
    assert (check.severity, check.months, check.count) == ("warn", [date(2026, 12, 1)], 1)
    assert check.title == "Balances filed ahead of their month"
    assert check.detail == (
        "Balances filed for Dec 2026, more than a month ahead — they are not used as your "
        "current balances. Delete them or file them under the right month."
    )
    assert check.fix is not None
    assert (check.fix.kind, check.fix.to, check.fix.label) == (
        "link",
        "/update?month=2026-12-01&step=balances",
        "Open Dec 2026 balances",
    )
    # Two of them: both named, the link on the first.
    db.add(NetWorthSnapshot(month=date(2027, 1, 1)))
    await db.commit()
    both = check_future_snapshot((await load_coverage(db)).status)
    assert both.count == 2 and both.detail.startswith("Balances filed for Dec 2026 and Jan 2027,")
    assert both.fix is not None and both.fix.to == "/update?month=2026-12-01&step=balances"


async def test_the_four_time_checks_are_quiet_on_the_real_routine(db, monkeypatch):
    """The spec's §V4 shape in miniature on Sep 23: Sep 1 balances on the 1st, Oct 1 typed early
    on Sep 22 (a copy of September's), September's rent saved during September, August
    complete — no WARN from spending_gap, the coverage gaps, identical_snapshot or
    future_snapshot."""
    monkeypatch.setattr(clock, "product_today", lambda: date(2026, 9, 23))
    food, _ = await categories(db)
    account = Account(name="A", slug="a", group="cash", sort_order=1)
    db.add(account)
    await db.flush()
    for month, recorded, balance in (
        (date(2026, 8, 1), date(2026, 8, 1), "90.00"),
        (date(2026, 9, 1), date(2026, 9, 1), "100.00"),
        (date(2026, 10, 1), date(2026, 9, 22), "100.00"),
    ):
        snapshot = NetWorthSnapshot(month=month, recorded_on=recorded)
        db.add(snapshot)
        await db.flush()
        db.add(
            AccountBalance(snapshot_id=snapshot.id, account_id=account.id, balance=Decimal(balance))
        )
    db.add(MonthlySpending(month=date(2026, 8, 1), category_id=food.id, amount=Decimal("500.00")))
    db.add(MonthlyCashflow(month=date(2026, 8, 1), net_pay=Decimal("5000.00")))
    db.add(MonthlySpending(month=date(2026, 9, 1), category_id=food.id, amount=Decimal("2072.23")))
    await db.commit()
    checks = {
        c.id: c for c in await run_checks(db, now=NOW, environment="dev", snapshot_enabled=False)
    }
    for check_id in (
        "spending_gap",
        "balances_without_spending",
        "spending_without_balances",
        "identical_snapshot",
        "future_snapshot",
    ):
        assert checks[check_id].severity == "ok", check_id


async def test_spending_gap_names_months_missing_inside_the_balances_window(db, monkeypatch):
    # The windows end at the newest OVERDUE month since 2026-09-24 (2026-09-23 spec §K3): on
    # Oct 20 flows are overdue through September, so the window is Jul..Sep — August still
    # missing, September has rows.
    monkeypatch.setattr(clock, "product_today", lambda: date(2026, 10, 20))
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


async def test_spending_gap_never_claims_balances_past_the_last_snapshot(db, monkeypatch):
    # K3's windows end at the newest OVERDUE month, not at the last snapshot (2026-09-23 spec
    # §K3). On Jan 5 2027 with balances only through Oct 1, October and November are both overdue
    # with nothing entered — but November has no balances, so the old "balances cover this month"
    # was false (found on the §V4 real-data walk). The sentence says what is true of every month
    # in the window: it has ended, its update is overdue, and nothing was entered.
    monkeypatch.setattr(clock, "product_today", lambda: date(2027, 1, 5))
    food, _rent = await categories(db)
    db.add_all(
        [
            NetWorthSnapshot(month=date(2026, 9, 1)),
            NetWorthSnapshot(month=date(2026, 10, 1)),
            MonthlySpending(month=date(2026, 9, 1), category_id=food.id, amount=Decimal("400.00")),
        ]
    )
    await db.commit()

    gap = check_spending_gap(await load_coverage(db))
    assert gap.months == [date(2026, 10, 1), date(2026, 11, 1)]
    assert gap.detail == (
        "Oct 2026, Nov 2026: ended and overdue, with no spending or take-home ever entered."
    )


async def test_spending_gap_is_ok_when_the_window_is_covered(db, monkeypatch):
    # July is the newest overdue month on Aug 20 (spec §K3) — and it is covered.
    monkeypatch.setattr(clock, "product_today", lambda: date(2026, 8, 20))
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
