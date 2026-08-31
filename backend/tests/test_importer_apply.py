from datetime import date
from decimal import Decimal

from sqlalchemy import select

from app.importer.apply import (
    apply_net_worth,
    apply_portfolio_history,
    apply_positions,
    apply_reference_data,
    apply_spending,
)
from app.importer.parsers import (
    parse_net_worth,
    parse_portfolio,
    parse_positions,
    parse_reference_data,
    parse_spending,
)
from app.importer.report import SheetReport
from app.models import (
    Account,
    AccountBalance,
    CardCredit,
    CategoryBudget,
    ContributionLimit,
    CreditCard,
    CreditLimitEvent,
    CustomEvent,
    DividendPayment,
    EsppOffering,
    LatestPrice,
    MonthlyCashflow,
    MonthlySpending,
    NetWorthSnapshot,
    Person,
    PortfolioAccount,
    PortfolioValueHistory,
    PositionTransaction,
    RewardCategory,
    RewardRate,
    RsuGrant,
    Security,
    SecurityDividendEvent,
    SpendingCategory,
)
from tests.portfolio_factories import acct
from tests.workbook_builder import (
    build_workbook,
    default_portfolio_rows,
    default_positions_rows,
    load_readonly,
)


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


async def test_apply_reference_data_never_reverts_refresh_owned_dividend_metadata(db):
    # Post-Plan-4 the price refresh owns annual_dividend/ex_div_date (Yahoo TTM) —
    # a re-import must seed them on CREATE only, never revert live values to the
    # sheet's GOOGLEFINANCE leftovers (same insert-only posture as latest_prices).
    report = SheetReport()
    await apply_reference_data(db, parse_reference_data(sheets()["ReferenceData"]), report)
    await db.commit()
    divc = (await db.execute(select(Security).where(Security.ticker == "DIVC"))).scalar_one()
    assert divc.annual_dividend is not None  # seeded at create
    divc.annual_dividend = Decimal("9.9999")  # simulate a refresh-written TTM value
    divc.ex_div_date = date(2026, 6, 1)
    await db.commit()

    report2 = SheetReport()
    await apply_reference_data(db, parse_reference_data(sheets()["ReferenceData"]), report2)
    await db.commit()
    await db.refresh(divc)
    assert divc.annual_dividend == Decimal("9.9999")
    assert divc.ex_div_date == date(2026, 6, 1)


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
            portfolio_account=acct("Old"),
            type="buy",
            shares=Decimal("1"),
            price=Decimal("1"),
            sort_index=990,
            source="import",
        )
    )
    db.add(  # UI-owned row: source 'ui' keeps it out of the sync's view entirely
        PositionTransaction(
            security_id=acme_id,
            portfolio_account=acct("Manual"),
            type="buy",
            shares=Decimal("2"),
            price=Decimal("2"),
            source="ui",
        )
    )
    await db.commit()
    wb2 = sheets()
    report2 = SheetReport()
    by_name2 = await apply_reference_data(db, parse_reference_data(wb2["ReferenceData"]), report2)
    await apply_positions(db, parse_positions(wb2["Positions"]), by_name2, report2)
    await db.commit()
    assert report2.entities["position_transactions"].deletes == 1
    remaining = (
        (
            await db.execute(
                select(PortfolioAccount.label).join(
                    PositionTransaction,
                    PositionTransaction.portfolio_account_id == PortfolioAccount.id,
                )
            )
        )
        .scalars()
        .all()
    )
    assert "Manual" in remaining and "Old" not in remaining


async def test_apply_positions_preserves_ui_rows_any_sort_index(db):
    """UI-created rows (source='ui') survive re-import even at import-like sort_index."""
    wb = sheets()
    report = SheetReport()
    by_name = await apply_reference_data(db, parse_reference_data(wb["ReferenceData"]), report)
    await db.commit()
    acme_id = (await db.execute(select(Security).where(Security.ticker == "ACME"))).scalar_one().id
    db.add(
        PositionTransaction(
            security_id=acme_id,
            portfolio_account=acct("UI Acct"),
            type="buy",
            shares=Decimal("1"),
            price=Decimal("5"),
            sort_index=990,  # the Plan 4 API assigns max(all) + 10 — deep in importer territory
            source="ui",
        )
    )
    await db.commit()
    empty = sheets(positions=default_positions_rows()[:1])  # header only: sheet lost every row
    report2 = SheetReport()
    await apply_positions(db, parse_positions(empty["Positions"]), by_name, report2)
    await db.commit()
    # a sync that deletes strays must NOT delete (or even load) the UI row
    assert report2.entities["position_transactions"].deletes == 0
    remaining = (await db.execute(select(PositionTransaction))).scalars().all()
    assert [t.source for t in remaining] == ["ui"]


async def test_apply_positions_marks_created_rows_import(db):
    """Created rows are stamped source='import' — the key the sync owns them by."""
    wb = sheets(positions=default_positions_rows()[:2])  # header + one Acme buy
    report = SheetReport()
    by_name = await apply_reference_data(db, parse_reference_data(wb["ReferenceData"]), report)
    await apply_positions(db, parse_positions(wb["Positions"]), by_name, report)
    await db.commit()
    row = (await db.execute(select(PositionTransaction))).scalar_one()
    assert row.source == "import"
    assert row.sort_index > 0  # sheet row order preserved; no longer an ownership signal


async def test_apply_positions_sort_index_collision_leaves_ui_row_alone(db):
    """An incoming sheet row whose sort_index equals a UI row's must create a NEW
    import row, not adopt/mutate the UI row."""
    wb = sheets(positions=default_positions_rows()[:2])  # header + one row -> sort_index 20
    report = SheetReport()
    by_name = await apply_reference_data(db, parse_reference_data(wb["ReferenceData"]), report)
    await db.commit()
    acme_id = (await db.execute(select(Security).where(Security.ticker == "ACME"))).scalar_one().id
    db.add(
        PositionTransaction(
            security_id=acme_id,
            portfolio_account=acct("UI Acct"),
            type="sell",
            shares=Decimal("3"),
            price=Decimal("7"),
            sort_index=20,  # collides with the incoming sheet row (folding tie-breaks on id)
            source="ui",
        )
    )
    await db.commit()
    await apply_positions(db, parse_positions(wb["Positions"]), by_name, report)
    await db.commit()
    rows = (
        (await db.execute(select(PositionTransaction).order_by(PositionTransaction.id)))
        .scalars()
        .all()
    )
    assert sorted(r.source for r in rows) == ["import", "ui"]
    assert [r.sort_index for r in rows] == [20, 20]
    assert report.entities["position_transactions"].creates == 1
    ui_row = next(r for r in rows if r.source == "ui")
    assert (ui_row.account, ui_row.type, ui_row.shares) == ("UI Acct", "sell", Decimal("3.000000"))


async def test_apply_positions_creates_primary_owned_portfolio_accounts(db):
    """Sheet labels become owned rows: the importer resolves through the same door the
    router does (2026-08-28 spec §8), so a re-import needs zero workbook changes."""
    db.add(Person(name="Me", is_primary=True))
    await db.commit()
    me = (await db.execute(select(Person).where(Person.is_primary))).scalar_one()

    wb = sheets()
    report = SheetReport()
    by_name = await apply_reference_data(db, parse_reference_data(wb["ReferenceData"]), report)
    await apply_positions(db, parse_positions(wb["Positions"]), by_name, report)
    await db.commit()

    rows = (
        (await db.execute(select(PortfolioAccount).order_by(PortfolioAccount.label)))
        .scalars()
        .all()
    )
    assert [(r.label, r.person_id) for r in rows] == [("Fido", me.id), ("RH Taxable", me.id)]


async def test_reimport_keeps_a_retagged_label_with_its_new_owner(db):
    """The user re-tags "Fido" to their partner in Settings; the next sheet import must
    leave that alone — get-or-create GETS."""
    me, sam = Person(name="Me", is_primary=True), Person(name="Sam", is_primary=False)
    db.add_all([me, sam])
    await db.commit()

    wb = sheets()
    report = SheetReport()
    by_name = await apply_reference_data(db, parse_reference_data(wb["ReferenceData"]), report)
    await apply_positions(db, parse_positions(wb["Positions"]), by_name, report)
    await db.commit()
    fido = (
        await db.execute(select(PortfolioAccount).where(PortfolioAccount.label == "Fido"))
    ).scalar_one()
    fido.person_id = sam.id
    await db.commit()

    wb2 = sheets()
    report2 = SheetReport()
    by_name2 = await apply_reference_data(db, parse_reference_data(wb2["ReferenceData"]), report2)
    await apply_positions(db, parse_positions(wb2["Positions"]), by_name2, report2)
    await db.commit()

    after = (
        (await db.execute(select(PortfolioAccount).order_by(PortfolioAccount.label)))
        .scalars()
        .all()
    )
    assert [(r.label, r.person_id) for r in after] == [("Fido", sam.id), ("RH Taxable", me.id)]
    assert report2.entities["position_transactions"].updates == 0  # and no phantom diffs


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


async def test_refdata_rename_keeps_positions_attached(db):
    from tests.workbook_builder import default_reference_data_rows

    wb = sheets()
    report = SheetReport()
    by_name = await apply_reference_data(db, parse_reference_data(wb["ReferenceData"]), report)
    await apply_positions(db, parse_positions(wb["Positions"]), by_name, report)
    await db.commit()
    acme_id = (await db.execute(select(Security).where(Security.ticker == "ACME"))).scalar_one().id

    rows = default_reference_data_rows()
    rows[1][1] = "Acme Fund"  # cosmetic rename; Positions still says 'Acme ETF'
    wb2 = sheets(reference_data=rows)
    report2 = SheetReport()
    by_name2 = await apply_reference_data(db, parse_reference_data(wb2["ReferenceData"]), report2)
    await apply_positions(db, parse_positions(wb2["Positions"]), by_name2, report2)
    await db.commit()
    assert any("renamed" in w for w in report2.warnings)
    tickers = set((await db.execute(select(Security.ticker))).scalars().all())
    assert "X-ACMEETF" not in tickers  # no synthetic duplicate minted
    acme_txns = (
        (
            await db.execute(
                select(PositionTransaction).where(PositionTransaction.security_id == acme_id)
            )
        )
        .scalars()
        .all()
    )
    assert len(acme_txns) == 2  # holdings stayed on the real security


async def test_apply_spending_duplicate_slug_is_report_error(db):
    from tests.workbook_builder import default_spending_rows

    rows = default_spending_rows()
    rows[0][2] = "Food!"  # slugs to 'food', colliding with column 2
    report = SheetReport()
    await apply_spending(db, parse_spending(sheets(spending=rows)["Spending"]), report)
    await db.commit()  # must not raise IntegrityError
    assert any("share slug" in e for e in report.errors)


async def test_apply_net_worth_warns_on_db_account_missing_from_sheet(db):
    from tests.workbook_builder import default_net_worth_rows

    report = SheetReport()
    await apply_net_worth(db, parse_net_worth(sheets()["Net Worth"]), report)
    await db.commit()
    rows = default_net_worth_rows()
    rows[1][2] = "Primary Checking"  # renamed column: old 'checking' slug left in DB
    report2 = SheetReport()
    await apply_net_worth(db, parse_net_worth(sheets(net_worth=rows)["Net Worth"]), report2)
    await db.commit()
    assert any("no column in the sheet" in w for w in report2.warnings)


async def test_apply_taxes_years_inputs_brackets(db):
    from app.importer.apply import apply_taxes
    from app.importer.parsers import parse_taxes
    from app.models import TaxInput, TaxYear

    report = SheetReport()
    await apply_taxes(db, parse_taxes(sheets()["Taxes"]), report)
    await db.commit()
    assert report.entities["tax_years"].creates == 2
    assert report.entities["tax_inputs"].creates == 86  # 43 keys x 2 years
    assert report.entities["tax_brackets"].creates == 14  # 7 x 2 years
    years = (await db.execute(select(TaxYear.year))).scalars().all()
    assert sorted(years) == [2023, 2024]
    exempt = (
        await db.execute(
            select(TaxInput.value).where(
                TaxInput.year == 2023, TaxInput.key == "unq_div_state_exempt_pct"
            )
        )
    ).scalar_one()
    assert exempt == Decimal("0.9645")

    report2 = SheetReport()
    await apply_taxes(db, parse_taxes(sheets()["Taxes"]), report2)
    await db.commit()
    assert report2.entities["tax_inputs"].creates == 0
    assert report2.entities["tax_inputs"].skips == 86
    assert report2.entities["tax_brackets"].skips == 14


async def test_apply_taxes_translates_folded_niit_cg_rates(db):
    """The migration's importer companion (2026-08-31 spec C2): a re-import must not
    reintroduce folded 18.8/23.8 CG rates the engine would double-charge next to its
    explicit NIIT line. Exact matches only — the 2023 column below stores the GENUINE
    base pair and must land verbatim."""
    from app.importer.apply import apply_taxes
    from app.importer.parsers import parse_taxes
    from app.models import TaxBracket
    from tests.workbook_builder import default_taxes_rows

    rows = default_taxes_rows()
    cg = next(i for i, row in enumerate(rows) if row[0] == "CAPITAL GAINS TAX INFO")
    # Columns are (2023, 2024): base rates in 2023, the sheet's folded cache in 2024.
    rows[cg + 2 : cg + 2] = [
        [None, "Bracket 2 Rate", 0.15, 0.188, None],
        [None, "Bracket 2 Threshold", 44625.0, 47026.0, None],
        [None, "Bracket 3 Rate", 0.20, 0.238, None],
        [None, "Bracket 3 Threshold", 492300.0, 518900.0, None],
    ]
    report = SheetReport()
    await apply_taxes(db, parse_taxes(sheets(taxes=rows)["Taxes"]), report)
    await db.commit()

    stored = {
        (b.year, b.bracket_index): b.rate
        for b in (
            await db.execute(select(TaxBracket).where(TaxBracket.jurisdiction == "capital_gains"))
        )
        .scalars()
        .all()
    }
    assert stored[(2023, 2)] == Decimal("0.15")  # genuine base rate: untouched
    assert stored[(2023, 3)] == Decimal("0.20")
    assert stored[(2024, 2)] == Decimal("0.15")  # folded 0.188: translated
    assert stored[(2024, 3)] == Decimal("0.20")  # folded 0.238: translated
    assert [w for w in report.warnings if "folds NIIT in" in w] == [
        "tax_brackets[2024/capital_gains/2]: sheet rate 0.188 folds NIIT in — imported "
        "as 0.15 (the app computes NIIT separately)",
        "tax_brackets[2024/capital_gains/3]: sheet rate 0.238 folds NIIT in — imported "
        "as 0.2 (the app computes NIIT separately)",
    ]

    # Re-import: the sheet still folds, so the translation (and its warning) repeats,
    # while the stored rows diff as SKIPS — never an update ping-pong.
    report2 = SheetReport()
    await apply_taxes(db, parse_taxes(sheets(taxes=rows)["Taxes"]), report2)
    await db.commit()
    assert report2.entities["tax_brackets"].creates == 0
    assert report2.entities["tax_brackets"].updates == 0
    assert len([w for w in report2.warnings if "folds NIIT in" in w]) == 2


async def test_apply_taxes_syncs_brackets_and_inputs_within_imported_years(db):
    from app.importer.apply import apply_taxes
    from app.importer.parsers import parse_taxes
    from app.models import TaxBracket, TaxInput
    from tests.workbook_builder import default_taxes_rows

    report = SheetReport()
    await apply_taxes(db, parse_taxes(sheets()["Taxes"]), report)
    await db.commit()
    rows = [
        row
        for row in default_taxes_rows()
        if not (row[1] == "Bracket 2 Rate" and row[0] is None)
        and not (row[1] == "Bracket 2 Threshold" and row[0] is None)
    ]  # federal bracket 2 removed from the sheet
    report2 = SheetReport()
    await apply_taxes(db, parse_taxes(sheets(taxes=rows)["Taxes"]), report2)
    await db.commit()
    assert report2.entities["tax_brackets"].deletes == 2  # 2023 + 2024 federal bracket 2
    remaining = (
        (
            await db.execute(
                select(TaxBracket).where(
                    TaxBracket.jurisdiction == "federal", TaxBracket.bracket_index == 2
                )
            )
        )
        .scalars()
        .all()
    )
    assert remaining == []
    # UI-created data for a year the sheet doesn't know stays untouched
    from app.models import TaxYear

    db.add(TaxYear(year=2030))
    await db.flush()
    db.add(TaxInput(year=2030, key="annual_salary", value=Decimal("1")))
    await db.commit()
    report3 = SheetReport()
    await apply_taxes(db, parse_taxes(sheets()["Taxes"]), report3)
    await db.commit()
    untouched = (
        await db.execute(
            select(TaxInput).where(TaxInput.year == 2030, TaxInput.key == "annual_salary")
        )
    ).scalar_one()
    assert untouched.value == Decimal("1.0000")


async def test_apply_taxes_keeps_inputs_for_keys_the_sheet_does_not_carry(db):
    # P0 (marriage spec section 3.1): a key the workbook carries NO value for in ANY year
    # column is outside the sheet's vocabulary — its rows are hand/UI-owned and must survive
    # a re-import. Sheet-carried cells still win exactly as before.
    from app.importer.apply import apply_taxes
    from app.importer.parsers import parse_taxes
    from app.models import TaxInput
    from tests.workbook_builder import default_taxes_rows

    report = SheetReport()
    await apply_taxes(db, parse_taxes(sheets()["Taxes"]), report)
    await db.commit()
    assert report.entities["tax_inputs"].creates == 86

    hand_edited = (
        await db.execute(
            select(TaxInput).where(TaxInput.year == 2023, TaxInput.key == "capital_loss_deductions")
        )
    ).scalar_one()
    hand_edited.value = Decimal("-3000.0000")
    await db.commit()

    rows = default_taxes_rows()
    for row in rows:
        if row[1] == "Capital Loss Deductions":
            row[2] = row[3] = row[4] = None
        if row[1] == "Annual Salary":
            row[2] = 111.0
    report2 = SheetReport()
    await apply_taxes(db, parse_taxes(sheets(taxes=rows)["Taxes"]), report2)
    await db.commit()

    assert report2.entities["tax_inputs"].deletes == 0
    assert report2.entities["tax_inputs"].updates == 1  # annual_salary 2023 only
    assert report2.entities["tax_inputs"].skips == 83  # 42 sheet keys x 2 years, minus that 1
    survivors = {
        row.year: row.value
        for row in (
            await db.execute(select(TaxInput).where(TaxInput.key == "capital_loss_deductions"))
        ).scalars()
    }
    assert survivors == {2023: Decimal("-3000.0000"), 2024: Decimal("225.0000")}
    salary = (
        await db.execute(
            select(TaxInput.value).where(TaxInput.year == 2023, TaxInput.key == "annual_salary")
        )
    ).scalar_one()
    assert salary == Decimal("111.0000")


async def test_apply_taxes_keeps_brackets_for_jurisdictions_absent_from_the_sheet(db):
    # P0 (marriage spec section 3.2): bracket tables parked under a jurisdiction the workbook
    # never mentions are invisible to the sweep. The six sheet jurisdictions still sync-delete
    # exactly as today — pinned in the same test so a wider fix cannot slip through.
    from app.importer.apply import apply_taxes
    from app.importer.parsers import parse_taxes
    from app.models import TaxBracket
    from tests.workbook_builder import default_taxes_rows

    report = SheetReport()
    await apply_taxes(db, parse_taxes(sheets()["Taxes"]), report)
    await db.commit()
    assert report.entities["tax_brackets"].creates == 14

    db.add(
        TaxBracket(
            year=2023,
            jurisdiction="federal_mfj",
            bracket_index=1,
            rate=Decimal("0.1000"),
            threshold=Decimal("0.00"),
        )
    )
    await db.commit()

    rows = [
        row
        for row in default_taxes_rows()
        if not (row[1] == "Bracket 2 Rate" and row[0] is None)
        and not (row[1] == "Bracket 2 Threshold" and row[0] is None)
    ]  # federal bracket 2 removed from the sheet
    report2 = SheetReport()
    await apply_taxes(db, parse_taxes(sheets(taxes=rows)["Taxes"]), report2)
    await db.commit()

    assert report2.entities["tax_brackets"].deletes == 2  # 2023 + 2024 federal bracket 2 only
    gone = (
        (
            await db.execute(
                select(TaxBracket).where(
                    TaxBracket.jurisdiction == "federal", TaxBracket.bracket_index == 2
                )
            )
        )
        .scalars()
        .all()
    )
    assert gone == []
    survivor = (
        await db.execute(select(TaxBracket).where(TaxBracket.jurisdiction == "federal_mfj"))
    ).scalar_one()
    assert survivor.year == 2023 and survivor.bracket_index == 1
    assert survivor.rate == Decimal("0.1000")


async def test_apply_taxes_never_touches_partner_rows_or_married_brackets(db):
    """The marriage-data hazard (audit §9.1), closed for good.

    A re-import may rewrite the PRIMARY person's sheet-tracked values and the single-filer
    bracket tables — that is the sheet-wins contract. It must not see anything else."""
    from app.importer.apply import apply_taxes
    from app.importer.parsers import parse_taxes
    from app.models import Person, TaxBracket, TaxInput

    me = Person(name="Me", is_primary=True)
    partner = Person(name="Partner", is_primary=False)
    db.add_all([me, partner])
    await db.commit()

    report = SheetReport()
    await apply_taxes(db, parse_taxes(sheets()["Taxes"]), report)
    await db.commit()
    # Sheet-written per-person rows land on the PRIMARY person; household rows stay NULL.
    salary = (
        await db.execute(
            select(TaxInput).where(TaxInput.year == 2024, TaxInput.key == "annual_salary")
        )
    ).scalar_one()
    assert salary.person_id == me.id
    interest = (
        await db.execute(
            select(TaxInput).where(TaxInput.year == 2024, TaxInput.key == "interest_total")
        )
    ).scalar_one()
    assert interest.person_id is None
    # Sheet-written brackets are single-filer rows.
    assert {row.filing_status for row in (await db.execute(select(TaxBracket))).scalars()} == {
        "single"
    }

    # Now the marriage data, inside a year the sheet DOES cover.
    db.add(
        TaxInput(year=2024, key="latest_w2_income", person_id=partner.id, value=Decimal("90000"))
    )
    db.add(
        TaxInput(year=2024, key="w2_fed_withholding", person_id=partner.id, value=Decimal("12000"))
    )
    db.add(
        TaxBracket(
            year=2024,
            jurisdiction="federal",
            filing_status="married_joint",
            bracket_index=1,
            rate=Decimal("0.1000"),
            threshold=Decimal("0.00"),
        )
    )
    await db.commit()

    report2 = SheetReport()
    await apply_taxes(db, parse_taxes(sheets()["Taxes"]), report2)
    await db.commit()

    assert report2.entities["tax_inputs"].deletes == 0
    assert report2.entities["tax_brackets"].deletes == 0
    survivors = (
        (
            await db.execute(
                select(TaxInput).where(TaxInput.year == 2024, TaxInput.person_id == partner.id)
            )
        )
        .scalars()
        .all()
    )
    assert sorted(row.key for row in survivors) == ["latest_w2_income", "w2_fed_withholding"]
    assert sorted(row.value for row in survivors) == [
        Decimal("12000.0000"),
        Decimal("90000.0000"),
    ]
    joint = (
        (await db.execute(select(TaxBracket).where(TaxBracket.filing_status == "married_joint")))
        .scalars()
        .all()
    )
    assert len(joint) == 1
    # ...and the sheet-covered single data still synced exactly as before.
    assert report2.entities["tax_inputs"].skips == 86
    assert report2.entities["tax_brackets"].skips == 14


async def test_apply_taxes_still_syncs_the_primary_persons_rows(db):
    """Immunity is for OTHER people, not for the primary: a cell that leaves the sheet
    still takes the primary's row with it."""
    from app.importer.apply import apply_taxes
    from app.importer.parsers import parse_taxes
    from app.models import Person, TaxInput
    from tests.workbook_builder import default_taxes_rows

    db.add(Person(name="Me", is_primary=True))
    await db.commit()
    report = SheetReport()
    await apply_taxes(db, parse_taxes(sheets()["Taxes"]), report)
    await db.commit()

    # One YEAR's cell is blanked, not the label row: parse_taxes pins the whole label
    # sequence, so a removed row aborts the parse, and blanking EVERY column would take the
    # key out of the sheet's vocabulary entirely (the P0 immunity next door). Blanking 2023
    # alone keeps `gross_paycheck` — a per-person key — sheet-carried, so its 2023 row is
    # squarely the sweep's to retire even though it belongs to the primary person.
    trimmed = default_taxes_rows()
    for row in trimmed:
        if row[1] == "Gross Paycheck":
            row[2] = None
    report2 = SheetReport()
    await apply_taxes(db, parse_taxes(sheets(taxes=trimmed)["Taxes"]), report2)
    await db.commit()
    assert report2.entities["tax_inputs"].deletes == 1  # 2023 only; 2024 still carries it
    remaining = {
        row.year: row.person_id
        for row in (
            await db.execute(select(TaxInput).where(TaxInput.key == "gross_paycheck"))
        ).scalars()
    }
    assert remaining == {2024: (await db.execute(select(Person.id))).scalar_one()}


async def test_apply_espp_lots_and_periods(db):
    from app.importer.apply import apply_espp
    from app.importer.parsers import parse_espp
    from app.models import EsppLot, EsppPeriod

    report = SheetReport()
    await apply_espp(db, parse_espp(sheets()["ESPP"]), report)
    await db.commit()
    assert report.entities["espp_lots"].creates == 2
    assert report.entities["espp_periods"].creates == 2
    lot = (
        await db.execute(select(EsppLot).where(EsppLot.purchase_date == date(2024, 2, 29)))
    ).scalar_one()
    assert lot.subscription_price == Decimal("40.00000")
    assert lot.sold_date is None
    # sold fields are user-owned: set one, re-apply, verify preserved
    lot.sold_date = date(2025, 10, 1)
    lot.sold_price = Decimal("55.00000")
    await db.commit()
    report2 = SheetReport()
    await apply_espp(db, parse_espp(sheets()["ESPP"]), report2)
    await db.commit()
    assert report2.entities["espp_lots"].skips == 2
    refreshed = (
        await db.execute(select(EsppLot).where(EsppLot.purchase_date == date(2024, 2, 29)))
    ).scalar_one()
    assert refreshed.sold_date == date(2025, 10, 1)
    period = (
        await db.execute(select(EsppPeriod).where(EsppPeriod.label == "February 2025 Purchase"))
    ).scalar_one()
    assert period.period_start == date(2024, 9, 1)
    assert period.contribution_pct == Decimal("0.100000000")


async def test_apply_paycheck_derives_effective_date_from_focal(db):
    from app.importer.apply import apply_focal_history, apply_paycheck
    from app.importer.parsers import parse_focal_history, parse_paycheck
    from app.models import CompEvent, PaycheckProfile, Person

    db.add(Person(name="Me", is_primary=True))
    await db.flush()
    wb = sheets()
    report = SheetReport()
    focal = parse_focal_history(wb["Focal History"])
    await apply_focal_history(db, focal, report)
    await apply_paycheck(db, parse_paycheck(wb["Paycheck Modeler"]), focal, report)
    await db.commit()
    assert report.entities["comp_events"].creates == 2
    assert report.entities["paycheck_profiles"].creates == 1
    profile = (await db.execute(select(PaycheckProfile))).scalar_one()
    assert profile.effective_date == date(2024, 1, 1)  # latest focal year with a New Base
    assert profile.annual_salary == Decimal("120000.00")
    assert profile.person_id == (await db.execute(select(Person))).scalar_one().id
    assert profile.pay_periods_per_year == 24
    assert any("effective_date" in w for w in report.warnings)
    events = (await db.execute(select(CompEvent))).scalars().all()
    assert {(e.focal_year, e.new_base is None) for e in events} == {(2024, False), (2025, True)}

    report2 = SheetReport()
    wb2 = sheets()
    focal2 = parse_focal_history(wb2["Focal History"])
    await apply_focal_history(db, focal2, report2)
    await apply_paycheck(db, parse_paycheck(wb2["Paycheck Modeler"]), focal2, report2)
    await db.commit()
    assert report2.entities["paycheck_profiles"].skips == 1
    assert report2.entities["comp_events"].skips == 2


async def test_apply_paycheck_without_focal_new_base_skips(db):
    from app.importer.apply import apply_focal_history, apply_paycheck
    from app.importer.parsers import parse_focal_history, parse_paycheck
    from app.models import PaycheckProfile
    from tests.workbook_builder import default_focal_rows

    rows = default_focal_rows()
    rows[2][3] = None  # 2024 loses its New Base -> no derivable effective_date
    wb = sheets(focal=rows)
    report = SheetReport()
    focal = parse_focal_history(wb["Focal History"])
    await apply_focal_history(db, focal, report)
    await apply_paycheck(db, parse_paycheck(wb["Paycheck Modeler"]), focal, report)
    await db.commit()
    assert (await db.execute(select(PaycheckProfile))).scalars().all() == []
    assert any("no focal year" in w.lower() for w in report.warnings)


async def test_apply_paycheck_never_touches_a_partner_profile(db):
    """The paycheck twin of the tax sweep's immunity (audit §9.1, spec §4.1): the workbook
    is ONE person's paycheck, so a partner's profile — even on the very date the sheet
    derives — is invisible to Apply."""
    from app.importer.apply import apply_focal_history, apply_paycheck
    from app.importer.parsers import parse_focal_history, parse_paycheck
    from app.models import PaycheckProfile, Person

    me = Person(name="Me", is_primary=True)
    partner = Person(name="Partner", is_primary=False)
    db.add_all([me, partner])
    await db.flush()
    db.add(
        PaycheckProfile(
            person_id=partner.id,
            effective_date=date(2024, 1, 1),  # the date the sheet derives, on purpose
            annual_salary=Decimal("96000.00"),
            withholding_pct=Decimal("0.220000000"),
        )
    )
    await db.commit()

    wb = sheets()
    report = SheetReport()
    focal = parse_focal_history(wb["Focal History"])
    await apply_focal_history(db, focal, report)
    await apply_paycheck(db, parse_paycheck(wb["Paycheck Modeler"]), focal, report)
    await db.commit()

    # A CREATE on the primary's timeline, not an update of somebody else's row.
    assert report.entities["paycheck_profiles"].creates == 1
    assert report.entities["paycheck_profiles"].updates == 0
    rows = {row.person_id: row for row in (await db.execute(select(PaycheckProfile))).scalars()}
    assert rows[partner.id].annual_salary == Decimal("96000.00")
    assert rows[partner.id].withholding_pct == Decimal("0.220000000")
    assert rows[me.id].annual_salary == Decimal("120000.00")  # the sheet's, on the primary
    assert rows[me.id].effective_date == date(2024, 1, 1)


async def test_apply_espp_warns_on_stale_period_rows(db):
    import datetime as dt

    from app.importer.apply import apply_espp
    from app.importer.parsers import parse_espp
    from tests.workbook_builder import default_espp_rows

    report = SheetReport()
    await apply_espp(db, parse_espp(sheets()["ESPP"]), report)
    await db.commit()  # creates 'February 2025 Purchase' + 'August 2025 Purchase'

    rows = default_espp_rows()
    rows.append(
        [None] * 8 + [dt.datetime(2025, 2, 27), dt.datetime(2026, 2, 27), 80.0, 41.0, 60.0, 35.0]
    )  # new lot advances the derived February label to 2026
    report2 = SheetReport()
    await apply_espp(db, parse_espp(sheets(espp=rows)["ESPP"]), report2)
    await db.commit()
    assert any("February 2025 Purchase" in w and "no longer derived" in w for w in report2.warnings)


async def test_reimport_preserves_user_owned_is_component(db):
    from app.importer.cells import CellIssues
    from app.importer.parsers import ParsedAccountColumn, ParsedNetWorth
    from app.importer.report import SheetReport

    db.add(
        Account(
            name="Traditional 401(k)",
            slug="traditional-401-k",
            group="pre_tax",
            sort_order=11,
            is_component=True,
        )
    )
    await db.commit()

    parsed = ParsedNetWorth(
        accounts=[
            ParsedAccountColumn(
                name="Traditional 401(k)", group="pre_tax", sort_order=11, column=11
            )
        ],
        snapshots=[],
        issues=CellIssues(),
    )
    report = SheetReport()
    await apply_net_worth(db, parsed, report)
    await db.commit()

    account = (
        await db.execute(select(Account).where(Account.slug == "traditional-401-k"))
    ).scalar_one()
    assert account.is_component is True  # importer diff-fields are {name, group, sort_order} only


async def test_fresh_import_flags_known_component_accounts_at_create(db):
    """Fresh DB: the five 401(k) source buckets import flagged, their aggregate does not.

    Without create-time seeding a fresh deploy double-counts them — migration
    f1b36c0cf33c's backfill runs at boot, before the accounts exist to flip.
    """
    from app.importer.apply import COMPONENT_SLUGS_AT_CREATE
    from app.importer.cells import CellIssues, slugify
    from app.importer.parsers import ParsedAccountColumn, ParsedNetWorth

    sheet_names = [
        "Employer Match 401(k)",
        "Reverse Rollover 401(k)",
        "Traditional 401(k)",
        "Roth Basic 401(k)",
        "After-Tax 401(k)",
    ]
    # Pin the sheet-name -> slug -> constant chain: slugify() drift would silently
    # un-flag every bucket on the next fresh import.
    assert {slugify(name) for name in sheet_names} == COMPONENT_SLUGS_AT_CREATE

    parsed = ParsedNetWorth(
        accounts=[
            *(
                ParsedAccountColumn(name=name, group="pre_tax", sort_order=i, column=i)
                for i, name in enumerate(sheet_names, start=3)
            ),
            ParsedAccountColumn(
                name="Fidelity Traditional 401(k)", group="pre_tax", sort_order=9, column=9
            ),
            ParsedAccountColumn(
                name="Fidelity Roth 401(k)", group="post_tax", sort_order=10, column=10
            ),
        ],
        snapshots=[],
        issues=CellIssues(),
    )
    report = SheetReport()
    await apply_net_worth(db, parsed, report)
    await db.commit()

    accounts = {a.slug: a for a in (await db.execute(select(Account))).scalars()}
    for slug in COMPONENT_SLUGS_AT_CREATE:
        assert accounts[slug].is_component is True, slug
    # The aggregate stays counted — only its source buckets fold in — and each component
    # links to its aggregate even though the sheet creates the aggregate LAST.
    assert accounts["fidelity-traditional-401-k"].is_component is False
    trad_id = accounts["fidelity-traditional-401-k"].id
    roth_id = accounts["fidelity-roth-401-k"].id
    assert accounts["employer-match-401-k"].parent_account_id == trad_id
    assert accounts["reverse-rollover-401-k"].parent_account_id == trad_id
    assert accounts["traditional-401-k"].parent_account_id == trad_id
    assert accounts["roth-basic-401-k"].parent_account_id == roth_id
    assert accounts["after-tax-401-k"].parent_account_id == roth_id
    assert accounts["fidelity-traditional-401-k"].parent_account_id is None
    assert any("employer-match-401-k]: created (pre_tax, component)" in s for s in report.samples)


async def test_component_without_aggregate_in_sheet_gets_no_parent(db):
    """A known component whose aggregate column is absent still imports flagged,
    with the parent link simply unset — never an error."""
    from app.importer.cells import CellIssues
    from app.importer.parsers import ParsedAccountColumn, ParsedNetWorth

    parsed = ParsedNetWorth(
        accounts=[
            ParsedAccountColumn(name="After-Tax 401(k)", group="post_tax", sort_order=3, column=3)
        ],
        snapshots=[],
        issues=CellIssues(),
    )
    report = SheetReport()
    await apply_net_worth(db, parsed, report)
    await db.commit()

    account = (
        await db.execute(select(Account).where(Account.slug == "after-tax-401-k"))
    ).scalar_one()
    assert account.is_component is True
    assert account.parent_account_id is None


async def test_apply_portfolio_history_creates_then_skips(db):
    parsed = parse_portfolio(sheets()["Portfolio"])
    report = SheetReport()
    await apply_portfolio_history(db, parsed, report)
    await db.commit()
    assert report.entities["portfolio_value_history"].creates == 3

    rows = (
        (
            await db.execute(
                select(PortfolioValueHistory).order_by(PortfolioValueHistory.snapshot_date)
            )
        )
        .scalars()
        .all()
    )
    assert [r.snapshot_date for r in rows] == [
        date(2023, 10, 23),
        date(2023, 10, 30),
        date(2023, 11, 6),
    ]
    assert rows[1].market_value == Decimal("53413.36")
    assert rows[1].sp500_value == Decimal("53001.35")
    assert rows[1].cost_basis == Decimal("55212.09")

    # Idempotent second pass: same workbook -> all skips, nothing rewritten
    report2 = SheetReport()
    await apply_portfolio_history(db, parse_portfolio(sheets()["Portfolio"]), report2)
    await db.commit()
    counts = report2.entities["portfolio_value_history"]
    assert (counts.creates, counts.updates, counts.skips) == (0, 0, 3)


async def test_apply_portfolio_history_diff_updates_changed_values(db):
    parsed = parse_portfolio(sheets()["Portfolio"])
    await apply_portfolio_history(db, parsed, SheetReport())
    await db.commit()

    rows = default_portfolio_rows()
    rows[3][28] = 99999.99  # r4 col AC: revised market value for 2023-10-30
    changed = parse_portfolio(load_readonly(build_workbook(portfolio=rows))["Portfolio"])
    report = SheetReport()
    await apply_portfolio_history(db, changed, report)
    await db.commit()

    counts = report.entities["portfolio_value_history"]
    assert (counts.creates, counts.updates, counts.skips) == (0, 1, 2)
    assert any("portfolio_value_history[2023-10-30]" in s for s in report.samples)
    row = (
        await db.execute(
            select(PortfolioValueHistory).where(
                PortfolioValueHistory.snapshot_date == date(2023, 10, 30)
            )
        )
    ).scalar_one()
    assert row.market_value == Decimal("99999.99")


async def test_apply_portfolio_history_reupload_overrides_live_rows(db):
    """THE OVERRIDE CONTRACT (user directive 2026-08-21): the workbook owns the series up
    to its last row — a live row at a sheet date is overwritten with the sheet's values,
    live rows at dates the sheet never had (including strays from the daily-append era)
    are deleted, and rows past the sheet's last date survive as the live continuation the
    sheet hasn't caught up to yet."""
    # Sheet series: 2023-10-23 / 10-30 / 11-06. Seed a live row AT the sheet's last
    # Monday with drifted values, one stray mid-week row inside the covered range, and
    # one live Monday row beyond it.
    db.add_all(
        [
            PortfolioValueHistory(
                snapshot_date=date(2023, 11, 1),  # a Wednesday the sheet never had
                market_value=Decimal("60000.00"),
                cost_basis=Decimal("55000.00"),
                sp500_value=Decimal("53100.00"),
            ),
            PortfolioValueHistory(
                snapshot_date=date(2023, 11, 6),  # the sheet's last Monday, live-written
                market_value=Decimal("63000.00"),
                cost_basis=Decimal("62000.00"),
                sp500_value=Decimal("55000.00"),
            ),
            PortfolioValueHistory(
                snapshot_date=date(2023, 11, 13),  # the Monday after the sheet's last row
                market_value=Decimal("61000.00"),
                cost_basis=Decimal("55000.00"),
                sp500_value=Decimal("53200.00"),
            ),
        ]
    )
    await db.commit()

    report = SheetReport()
    await apply_portfolio_history(db, parse_portfolio(sheets()["Portfolio"]), report)
    await db.commit()

    counts = report.entities["portfolio_value_history"]
    assert (counts.creates, counts.updates, counts.deletes) == (2, 1, 1)
    assert any("portfolio_value_history[2023-11-01]: deleted" in s for s in report.samples)
    rows = (
        (
            await db.execute(
                select(PortfolioValueHistory).order_by(PortfolioValueHistory.snapshot_date)
            )
        )
        .scalars()
        .all()
    )
    assert [r.snapshot_date for r in rows] == [
        date(2023, 10, 23),
        date(2023, 10, 30),
        date(2023, 11, 6),
        date(2023, 11, 13),
    ]
    # The sheet's numbers stand at the shared date — the live row's drift is gone.
    assert rows[2].market_value == Decimal("63577.56")
    assert rows[2].cost_basis == Decimal("62399.04")
    assert rows[2].sp500_value == Decimal("55548.29")


async def test_apply_portfolio_history_empty_sheet_deletes_nothing(db):
    """Hollow history columns parse to an empty series — that must read as 'nothing to
    say', never as 'wipe the table'."""
    from app.importer.cells import CellIssues
    from app.importer.parsers import ParsedPortfolio

    db.add(
        PortfolioValueHistory(
            snapshot_date=date(2023, 11, 13),
            market_value=Decimal("61000.00"),
            cost_basis=Decimal("55000.00"),
            sp500_value=Decimal("53200.00"),
        )
    )
    await db.commit()

    report = SheetReport()
    await apply_portfolio_history(db, ParsedPortfolio(history=[], issues=CellIssues()), report)
    await db.commit()

    counts = report.entities["portfolio_value_history"]
    assert (counts.creates, counts.updates, counts.deletes) == (0, 0, 0)
    assert (await db.execute(select(PortfolioValueHistory))).scalar_one() is not None


async def test_importer_never_writes_dividends(db):
    """THE OWNERSHIP CONTRACT (user decision 2026-08-20): the dashboard is the system of
    record for dividends — a re-import must not create, update, or delete ANY
    dividend_payments row, manual or auto. If a future importer change touches
    dividends, this is the test that must be argued with."""
    wb = sheets()
    report = SheetReport()
    by_name = await apply_reference_data(db, parse_reference_data(wb["ReferenceData"]), report)
    await apply_positions(db, parse_positions(wb["Positions"]), by_name, report)
    await apply_net_worth(db, parse_net_worth(wb["Net Worth"]), report)
    await apply_spending(db, parse_spending(wb["Spending"]), report)
    await apply_portfolio_history(db, parse_portfolio(wb["Portfolio"]), report)
    await db.commit()

    sec = (await db.execute(select(Security).order_by(Security.id))).scalars().first()
    # The row apply_positions already minted for the sheet's label — NOT the acct() factory,
    # which would mint a second row and collide on the unique label (its docstring's rule).
    rh_taxable = (
        await db.execute(select(PortfolioAccount).where(PortfolioAccount.label == "RH Taxable"))
    ).scalar_one()
    manual = DividendPayment(security_id=sec.id, pay_date=date(2026, 5, 1), amount=Decimal("12.34"))
    auto = DividendPayment(
        security_id=sec.id,
        portfolio_account=rh_taxable,
        pay_date=date(2026, 6, 19),
        amount=Decimal("8.20"),
        source="auto",
        ex_date=date(2026, 6, 19),
        per_share=Decimal("0.820000"),
        shares_held=Decimal("10.000000"),
    )
    db.add_all([manual, auto])
    await db.commit()
    before = {
        row.id: (row.source, row.account, row.pay_date, row.amount, row.ex_date)
        for row in (await db.execute(select(DividendPayment))).scalars()
    }
    assert len(before) == 2

    wb2 = sheets()
    report2 = SheetReport()
    by_name2 = await apply_reference_data(db, parse_reference_data(wb2["ReferenceData"]), report2)
    await apply_positions(db, parse_positions(wb2["Positions"]), by_name2, report2)
    await apply_net_worth(db, parse_net_worth(wb2["Net Worth"]), report2)
    await apply_spending(db, parse_spending(wb2["Spending"]), report2)
    await apply_portfolio_history(db, parse_portfolio(wb2["Portfolio"]), report2)
    await db.commit()

    after = {
        row.id: (row.source, row.account, row.pay_date, row.amount, row.ex_date)
        for row in (
            await db.execute(select(DividendPayment).execution_options(populate_existing=True))
        ).scalars()
    }
    assert after == before
    assert "dividend_payments" not in report2.entities


def grant_row(row: RsuGrant) -> tuple:
    """EVERY stored column, so "byte-identical" below is literally what the assert compares —
    and a column added to the model later is covered without anyone editing this pin."""
    return tuple(getattr(row, column.key) for column in RsuGrant.__table__.columns)


async def test_importer_never_writes_rsu_grants(db):
    """Same ownership contract for equity grants (2026-08-21 spec): rsu_grants is
    dashboard-only, so a re-import must leave it byte-identical. Runs the whole orchestrator
    rather than the dividends pin's applier subset — the sheets that could plausibly reach a
    comp table (ESPP, Paycheck Modeler, Focal History) only run under run_import."""
    from app.importer.service import run_import

    db.add(
        RsuGrant(
            kind="refresh",
            label="2025 focal",
            focal_year=2025,
            shares=480,
            grant_price=Decimal("121.5000"),
            first_vest_date=date(2025, 6, 18),
            cliff_pct=Decimal("0.0625"),
            notes="pre-import row",
        )
    )
    await db.commit()
    before = {row.id: grant_row(row) for row in (await db.execute(select(RsuGrant))).scalars()}
    assert len(before) == 1

    report = await run_import(build_workbook(), db, dry_run=False)
    assert report.applied is True  # a blocked import would pin nothing

    # populate_existing, or the identity map would hand back the pre-import objects and this
    # would pass even if the import had rewritten every column (the dividends pin's note).
    after = {
        row.id: grant_row(row)
        for row in (
            await db.execute(select(RsuGrant).execution_options(populate_existing=True))
        ).scalars()
    }
    assert after == before
    assert all("rsu_grants" not in sheet.entities for sheet in report.sheets.values())


def offering_row(row: EsppOffering) -> tuple:
    """EVERY stored column, as grant_row above — an offerings column added later is
    covered by the pin below without anyone editing it."""
    return tuple(getattr(row, column.key) for column in EsppOffering.__table__.columns)


async def test_importer_never_writes_espp_offerings(db):
    """espp_offerings is dashboard-only (2026-08-23 spec §2.1, the rsu_grants posture):
    the workbook has no offerings concept, so an import must neither create, update nor
    delete a row."""
    from app.importer.service import run_import

    db.add(EsppOffering(offering_start=date(2023, 9, 1), subscription_price=Decimal("48.509")))
    await db.commit()
    before = {
        row.id: offering_row(row) for row in (await db.execute(select(EsppOffering))).scalars()
    }
    assert len(before) == 1

    for _ in range(2):
        report = await run_import(build_workbook(), db, dry_run=False)
        assert report.applied is True  # a blocked import would pin nothing

    # populate_existing, or the identity map would hand back the pre-import objects and this
    # would pass even if the import had rewritten every column (the dividends pin's note).
    after = {
        row.id: offering_row(row)
        for row in (
            await db.execute(select(EsppOffering).execution_options(populate_existing=True))
        ).scalars()
    }
    assert after == before
    assert all("espp_offerings" not in sheet.entities for sheet in report.sheets.values())


def budget_row(row: CategoryBudget) -> tuple:
    """EVERY stored column, as grant_row above — a budgets column added later is covered
    by the pin below without anyone editing it."""
    return tuple(getattr(row, column.key) for column in CategoryBudget.__table__.columns)


async def test_importer_never_writes_category_budgets(db):
    """category_budgets is dashboard-only (2026-08-24 spec §2, the rsu_grants posture):
    the workbook has no budgets concept, so a re-import must neither create, update nor
    delete a row — even while it UPDATES the very category the budget hangs off."""
    from app.importer.service import run_import

    # Slug "food" matches the workbook's Food column, and sort_order 99 does NOT match:
    # the import diff-updates the category row itself, which makes the pin sharp — the
    # parent table moves, the budgets table must not (categories are upserted by slug,
    # never deleted, so the CASCADE can't fire through an import).
    cat = SpendingCategory(name="Food", slug="food", sort_order=99)
    db.add(cat)
    await db.flush()
    db.add(
        CategoryBudget(
            category_id=cat.id, effective_month=date(2026, 1, 1), amount=Decimal("400.00")
        )
    )
    db.add(CategoryBudget(category_id=cat.id, effective_month=date(2026, 6, 1), amount=None))
    await db.commit()
    before = {
        row.id: budget_row(row) for row in (await db.execute(select(CategoryBudget))).scalars()
    }
    assert len(before) == 2

    for _ in range(2):
        report = await run_import(build_workbook(), db, dry_run=False)
        assert report.applied is True  # a blocked import would pin nothing

    # populate_existing, or the identity map would hand back the pre-import objects and
    # this would pass even if the import had rewritten every column (the dividends pin's
    # note).
    after = {
        row.id: budget_row(row)
        for row in (
            await db.execute(select(CategoryBudget).execution_options(populate_existing=True))
        ).scalars()
    }
    assert after == before
    assert all("category_budgets" not in sheet.entities for sheet in report.sheets.values())


def custom_event_row(row: CustomEvent) -> tuple:
    """EVERY stored column, as grant_row above — a column added later is covered by the
    pin below without anyone editing it."""
    return tuple(getattr(row, column.key) for column in CustomEvent.__table__.columns)


async def test_importer_never_writes_custom_events(db):
    """custom_events is dashboard-only (2026-08-24 financial-calendar spec §9.3, the
    rsu_grants posture): no sheet maps to user-entered calendar events, so a re-import
    must neither create, update nor delete a row."""
    from app.importer.service import run_import

    db.add(CustomEvent(event_date=date(2026, 9, 12), label="pre-import", detail="kept"))
    await db.commit()
    before = {
        row.id: custom_event_row(row) for row in (await db.execute(select(CustomEvent))).scalars()
    }
    assert len(before) == 1

    for _ in range(2):
        report = await run_import(build_workbook(), db, dry_run=False)
        assert report.applied is True  # a blocked import would pin nothing

    # populate_existing, or the identity map would hand back the pre-import objects and
    # this would pass even if the import had rewritten every column (the dividends pin's
    # note).
    after = {
        row.id: custom_event_row(row)
        for row in (
            await db.execute(select(CustomEvent).execution_options(populate_existing=True))
        ).scalars()
    }
    assert after == before
    assert all("custom_events" not in sheet.entities for sheet in report.sheets.values())


def credit_card_rows(model):
    """Column-reflection snapshots, as grant_row above — a column added to any
    credit-card table later is covered without anyone editing this pin."""

    def snapshot(rows):
        return {row.id: tuple(getattr(row, c.key) for c in model.__table__.columns) for row in rows}

    return snapshot


async def test_importer_never_writes_credit_card_tables(db):
    """All five credit-card tables are dashboard-only (2026-08-25 spec §2, the
    rsu_grants posture): the workbook's Credit Card Matrix sheet is reference material,
    never a source — a re-import must not create, update or delete a row in any of
    them, even while it diff-updates the spending category a reward category maps to."""
    from app.importer.service import run_import

    # Map onto a category the workbook WILL diff-update (the budgets pin's trick):
    # slug "food" matches the workbook's Food column, sort_order 99 does not.
    spending = SpendingCategory(name="Food", slug="food", sort_order=99)
    db.add(spending)
    await db.flush()
    card = CreditCard(
        name="Venture X",
        slug="venture-x",
        annual_fee=Decimal("395.00"),
        rewards_currency="miles",
        point_value_cents=Decimal("1.7"),
    )
    db.add(card)
    await db.flush()
    category = RewardCategory(
        name="Dining", slug="dining", spending_category_id=spending.id, pinned_card_id=card.id
    )
    db.add(category)
    await db.flush()
    db.add(CardCredit(card_id=card.id, label="Travel credit", annual_value=Decimal("300")))
    db.add(RewardRate(card_id=card.id, category_id=category.id, multiplier=Decimal("2")))
    db.add(
        CreditLimitEvent(
            card_id=card.id, effective_date=date(2023, 5, 12), limit_amount=Decimal("20000")
        )
    )
    await db.commit()

    models = [CreditCard, CardCredit, RewardCategory, RewardRate, CreditLimitEvent]
    before = {}
    for model in models:
        rows = (await db.execute(select(model))).scalars().all()
        before[model.__tablename__] = credit_card_rows(model)(rows)
    assert all(len(snap) == 1 for snap in before.values())  # a pin over nothing pins nothing

    for _ in range(2):
        report = await run_import(build_workbook(), db, dry_run=False)
        assert report.applied is True  # a blocked import would pin nothing

    # populate_existing, or the identity map would hand back the pre-import objects and
    # this would pass even if the import had rewritten every column (the dividends pin's
    # note).
    after = {}
    for model in models:
        rows = (
            (await db.execute(select(model).execution_options(populate_existing=True)))
            .scalars()
            .all()
        )
        after[model.__tablename__] = credit_card_rows(model)(rows)
    assert after == before
    assert all(table not in sheet.entities for sheet in report.sheets.values() for table in after)


def contribution_limit_row(row: ContributionLimit) -> tuple:
    """EVERY stored column, as grant_row above — a column added later is covered by the
    pin below without anyone editing it."""
    return tuple(getattr(row, column.key) for column in ContributionLimit.__table__.columns)


async def test_importer_never_writes_contribution_limits(db):
    """contribution_limits is dashboard-only (2026-08-27 spec §3 item 3, the custom_events
    posture): no sheet carries IRS caps, so a re-import must neither create, update nor
    delete a row."""
    from app.importer.service import run_import

    db.add(ContributionLimit(year=2026, key="limit_401k_elective", value=Decimal("24500.00")))
    await db.commit()
    before = {
        row.id: contribution_limit_row(row)
        for row in (await db.execute(select(ContributionLimit))).scalars()
    }
    assert len(before) == 1  # a pin over nothing pins nothing

    for _ in range(2):
        report = await run_import(build_workbook(), db, dry_run=False)
        assert report.applied is True  # a blocked import would pin nothing

    # populate_existing, or the identity map would hand back the pre-import objects and
    # this would pass even if the import had rewritten every column (the dividends pin's
    # note).
    after = {
        row.id: contribution_limit_row(row)
        for row in (
            await db.execute(select(ContributionLimit).execution_options(populate_existing=True))
        ).scalars()
    }
    assert after == before
    assert all("contribution_limits" not in sheet.entities for sheet in report.sheets.values())


def dividend_event_row(row: SecurityDividendEvent) -> tuple:
    """EVERY stored column, as grant_row above — a column added later is covered by the
    pin below without anyone editing it."""
    return tuple(getattr(row, column.key) for column in SecurityDividendEvent.__table__.columns)


async def test_importer_never_writes_dividend_events_or_clears_the_sync_marker(db):
    """security_dividend_events is dashboard-only (2026-08-28 spec, the custom_events
    posture): the workbook carries no dividend HISTORY, so a re-import must neither
    create, update nor delete a row. The sharper half is the marker: the import
    diff-updates the very security these rows hang off, and clearing
    dividend_events_floor would re-arm the deep fetch on every refresh forever. (The
    import DOES legitimately re-arm it by extending portfolio_value_history backward —
    that is the floor comparison's job, not a column write, and is pinned in
    test_dividend_events.)"""
    from app.importer.service import run_import

    # A name the workbook WILL diff-update (the budgets pin's trick), so the parent row
    # provably moves while the annotations and the marker stand still.
    sec = Security(ticker="ACME", name="Stale Name", industry="ETF", holding_type="etf")
    sec.dividend_events_floor = date(2023, 10, 23)
    db.add(sec)
    await db.flush()
    db.add_all(
        [
            SecurityDividendEvent(
                security_id=sec.id, ex_date=date(2024, 3, 15), per_share=Decimal("1.710000")
            ),
            SecurityDividendEvent(
                security_id=sec.id, ex_date=date(2024, 6, 14), per_share=Decimal("1.750000")
            ),
        ]
    )
    await db.commit()
    before = {
        row.id: dividend_event_row(row)
        for row in (await db.execute(select(SecurityDividendEvent))).scalars()
    }
    assert len(before) == 2  # a pin over nothing pins nothing

    for _ in range(2):
        report = await run_import(build_workbook(), db, dry_run=False)
        assert report.applied is True  # a blocked import would pin nothing

    # populate_existing, or the identity map would hand back the pre-import objects and
    # this would pass even if the import had rewritten every column (the dividends pin's
    # note).
    after = {
        row.id: dividend_event_row(row)
        for row in (
            await db.execute(
                select(SecurityDividendEvent).execution_options(populate_existing=True)
            )
        ).scalars()
    }
    assert after == before
    assert all("security_dividend_events" not in sheet.entities for sheet in report.sheets.values())
    refreshed = (
        await db.execute(
            select(Security)
            .where(Security.ticker == "ACME")
            .execution_options(populate_existing=True)
        )
    ).scalar_one()
    assert refreshed.name == "Acme ETF"  # the import DID move the parent row…
    assert refreshed.dividend_events_floor == date(2023, 10, 23)  # …and left the marker
