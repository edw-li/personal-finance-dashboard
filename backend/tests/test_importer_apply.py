from datetime import date
from decimal import Decimal

from sqlalchemy import select

from app.importer.apply import (
    apply_net_worth,
    apply_positions,
    apply_reference_data,
    apply_spending,
)
from app.importer.parsers import (
    parse_net_worth,
    parse_positions,
    parse_reference_data,
    parse_spending,
)
from app.importer.report import SheetReport
from app.models import (
    Account,
    AccountBalance,
    LatestPrice,
    MonthlyCashflow,
    MonthlySpending,
    NetWorthSnapshot,
    PositionTransaction,
    Security,
    SpendingCategory,
)
from tests.workbook_builder import build_workbook, load_readonly


def sheets(**overrides):
    return load_readonly(build_workbook(**overrides))


async def test_apply_reference_data_creates_then_skips(db):
    wb = sheets()
    parsed = parse_reference_data(wb["ReferenceData"])
    report = SheetReport()
    by_name = await apply_reference_data(db, parsed, report)
    await db.commit()
    assert report.entities["securities"].creates == 3
    assert report.entities["latest_prices"].creates == 2  # DIVC '#N/A' price skipped
    assert set(by_name) == {"Acme ETF", "Div Corp", "Mut Fund"}
    acme = (await db.execute(select(Security).where(Security.ticker == "ACME"))).scalar_one()
    assert acme.holding_type == "etf" and acme.is_manual_priced is False
    price = await db.get(LatestPrice, acme.id)
    assert price.price == Decimal("100.5000") and price.source == "manual"
    assert price.quoted_at is not None

    report2 = SheetReport()
    await apply_reference_data(db, parse_reference_data(sheets()["ReferenceData"]), report2)
    await db.commit()
    assert report2.entities["securities"].creates == 0
    assert report2.entities["securities"].skips == 3
    assert report2.entities["latest_prices"].skips == 2  # insert-only: never updated


async def test_apply_reference_data_updates_changed_metadata_only(db):
    report = SheetReport()
    await apply_reference_data(db, parse_reference_data(sheets()["ReferenceData"]), report)
    await db.commit()
    # User flags survive re-import; metadata updates flow through
    acme = (await db.execute(select(Security).where(Security.ticker == "ACME"))).scalar_one()
    acme.is_active = False
    await db.commit()
    from tests.workbook_builder import default_reference_data_rows

    rows = default_reference_data_rows()
    rows[1][2] = "Large Blend"  # sector change
    report2 = SheetReport()
    await apply_reference_data(
        db, parse_reference_data(sheets(reference_data=rows)["ReferenceData"]), report2
    )
    await db.commit()
    assert report2.entities["securities"].updates == 1
    refreshed = (await db.execute(select(Security).where(Security.ticker == "ACME"))).scalar_one()
    assert refreshed.industry == "Large Blend"
    assert refreshed.is_active is False  # untouched


async def test_apply_positions_full_flow(db):
    wb = sheets()
    report = SheetReport()
    by_name = await apply_reference_data(db, parse_reference_data(wb["ReferenceData"]), report)
    parsed = parse_positions(wb["Positions"])
    await apply_positions(db, parsed, by_name, report)
    await db.commit()
    assert report.entities["position_transactions"].creates == 3
    # Unknown name auto-created: private, manual-priced, synthetic ticker, warning
    mystery = (
        await db.execute(select(Security).where(Security.name == "Mystery Fund"))
    ).scalar_one()
    assert mystery.ticker == "X-MYSTERYF"
    assert mystery.holding_type == "private" and mystery.is_manual_priced is True
    assert any("Mystery Fund" in w for w in report.warnings)
    txns = (
        (await db.execute(select(PositionTransaction).order_by(PositionTransaction.sort_index)))
        .scalars()
        .all()
    )
    assert [t.sort_index for t in txns] == [20, 40, 50]
    assert txns[0].shares == Decimal("10.123457")

    # Idempotent second pass
    wb2 = sheets()
    report2 = SheetReport()
    by_name2 = await apply_reference_data(db, parse_reference_data(wb2["ReferenceData"]), report2)
    await apply_positions(db, parse_positions(wb2["Positions"]), by_name2, report2)
    await db.commit()
    counts = report2.entities["position_transactions"]
    assert (counts.creates, counts.updates, counts.deletes) == (0, 0, 0)
    assert counts.skips == 3


async def test_apply_positions_deletes_importer_strays_keeps_ui_rows(db):
    wb = sheets()
    report = SheetReport()
    by_name = await apply_reference_data(db, parse_reference_data(wb["ReferenceData"]), report)
    await apply_positions(db, parse_positions(wb["Positions"]), by_name, report)
    await db.commit()
    acme_id = (await db.execute(select(Security).where(Security.ticker == "ACME"))).scalar_one().id
    db.add(  # stale importer-owned row (as if its sheet row was deleted)
        PositionTransaction(
            security_id=acme_id,
            account="Old",
            type="buy",
            shares=Decimal("1"),
            price=Decimal("1"),
            sort_index=990,
        )
    )
    db.add(  # UI-owned row: sort_index 0 default — never touched by the sync
        PositionTransaction(
            security_id=acme_id,
            account="Manual",
            type="buy",
            shares=Decimal("2"),
            price=Decimal("2"),
        )
    )
    await db.commit()
    wb2 = sheets()
    report2 = SheetReport()
    by_name2 = await apply_reference_data(db, parse_reference_data(wb2["ReferenceData"]), report2)
    await apply_positions(db, parse_positions(wb2["Positions"]), by_name2, report2)
    await db.commit()
    assert report2.entities["position_transactions"].deletes == 1
    remaining = (await db.execute(select(PositionTransaction.account))).scalars().all()
    assert "Manual" in remaining and "Old" not in remaining


async def test_apply_net_worth_accounts_snapshots_balances(db):
    report = SheetReport()
    await apply_net_worth(db, parse_net_worth(sheets()["Net Worth"]), report)
    await db.commit()
    assert report.entities["accounts"].creates == 3
    assert report.entities["net_worth_snapshots"].creates == 2
    assert report.entities["account_balances"].creates == 6
    checking = (await db.execute(select(Account).where(Account.slug == "checking"))).scalar_one()
    assert checking.group == "cash" and checking.sort_order == 3
    january = (
        await db.execute(select(NetWorthSnapshot).where(NetWorthSnapshot.month == date(2024, 1, 1)))
    ).scalar_one()
    assert january.recorded_on == date(2024, 1, 5)
    cc = (await db.execute(select(Account).where(Account.slug == "credit-card"))).scalar_one()
    cc_balance = (
        await db.execute(
            select(AccountBalance.balance).where(
                AccountBalance.snapshot_id == january.id, AccountBalance.account_id == cc.id
            )
        )
    ).scalar_one()
    assert cc_balance == Decimal("-25.00")

    report2 = SheetReport()
    await apply_net_worth(db, parse_net_worth(sheets()["Net Worth"]), report2)
    await db.commit()
    assert report2.entities["account_balances"].creates == 0
    assert report2.entities["account_balances"].skips == 6


async def test_apply_net_worth_updates_changed_balance(db):
    report = SheetReport()
    await apply_net_worth(db, parse_net_worth(sheets()["Net Worth"]), report)
    await db.commit()
    from tests.workbook_builder import default_net_worth_rows

    rows = default_net_worth_rows()
    rows[2][2] = 111.11  # Checking, January
    report2 = SheetReport()
    await apply_net_worth(db, parse_net_worth(sheets(net_worth=rows)["Net Worth"]), report2)
    await db.commit()
    assert report2.entities["account_balances"].updates == 1
    assert any("checking" in s.lower() for s in report2.samples)


async def test_apply_spending_categories_months_cashflow(db):
    report = SheetReport()
    await apply_spending(db, parse_spending(sheets()["Spending"]), report)
    await db.commit()
    assert report.entities["spending_categories"].creates == 2
    assert report.entities["monthly_spending"].creates == 4
    assert report.entities["monthly_cashflow"].creates == 2
    food = (
        await db.execute(select(SpendingCategory).where(SpendingCategory.slug == "food"))
    ).scalar_one()
    january_food = (
        await db.execute(
            select(MonthlySpending.amount).where(
                MonthlySpending.month == date(2024, 1, 1),
                MonthlySpending.category_id == food.id,
            )
        )
    ).scalar_one()
    assert january_food == Decimal("100.00")
    cashflow = await db.get(MonthlyCashflow, date(2024, 1, 1))
    assert cashflow.net_pay == Decimal("3000.00")

    report2 = SheetReport()
    await apply_spending(db, parse_spending(sheets()["Spending"]), report2)
    await db.commit()
    assert report2.entities["monthly_spending"].creates == 0
    assert report2.entities["monthly_spending"].skips == 4
