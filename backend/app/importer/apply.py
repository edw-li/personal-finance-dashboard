"""Load-compare-write appliers: parsed dataclasses -> ORM upserts + report counts.

No openpyxl imports. Every applier preloads existing rows by natural key in one query,
diffs in memory, and mutates/creates through the ORM (row volumes are ~2k total). The
caller (service.py) owns the transaction: nothing here commits.
"""

from datetime import UTC, date, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.importer.cells import slugify, synthetic_ticker
from app.importer.parsers import (
    ParsedEspp,
    ParsedFocalHistory,
    ParsedNetWorth,
    ParsedPaycheck,
    ParsedPortfolio,
    ParsedPositions,
    ParsedReferenceData,
    ParsedSpending,
    ParsedTaxes,
)
from app.importer.report import SheetReport
from app.models import (
    Account,
    AccountBalance,
    CompEvent,
    EsppLot,
    EsppPeriod,
    LatestPrice,
    MonthlyCashflow,
    MonthlySpending,
    NetWorthSnapshot,
    PaycheckProfile,
    PortfolioValueHistory,
    PositionTransaction,
    Security,
    SpendingCategory,
    TaxBracket,
    TaxInput,
    TaxInputDefinition,
    TaxYear,
)
from app.seed import seed_tax_definitions


def _diff_update(obj, fields: dict, counts, report: SheetReport, sample_key: str) -> None:
    changed: list[str] = []
    for attr, new in fields.items():
        old = getattr(obj, attr)
        if old != new:
            setattr(obj, attr, new)
            changed.append(f"{attr} {old} -> {new}")
    if changed:
        counts.updates += 1
        report.add_sample(f"{sample_key}: " + "; ".join(changed))
    else:
        counts.skips += 1


async def apply_reference_data(
    db: AsyncSession, parsed: ParsedReferenceData, report: SheetReport
) -> dict[str, Security]:
    """Upsert securities; seed latest_prices insert-only. Returns name -> Security."""
    security_counts = report.counts("securities")
    price_counts = report.counts("latest_prices")
    existing = {s.ticker: s for s in (await db.execute(select(Security))).scalars()}
    by_name: dict[str, Security] = {}
    for row in parsed.securities:
        fields = {
            "name": row.name,
            "industry": row.industry,
            "holding_type": row.holding_type,
        }
        # annual_dividend/ex_div_date seed on CREATE only — post-Plan-4 the price
        # refresh owns them (Yahoo TTM), same insert-only posture as latest_prices
        # below; a re-import must not revert live metadata to sheet leftovers.
        seed_only = {
            "annual_dividend": row.annual_dividend,
            "ex_div_date": row.ex_div_date,
        }
        security = existing.get(row.ticker)
        if security is None:
            # is_manual_priced/is_active stay user-owned after creation
            security = Security(ticker=row.ticker, **fields, **seed_only)
            db.add(security)
            security_counts.creates += 1
            report.add_sample(f"securities[{row.ticker}]: created")
        else:
            old_name = security.name
            _diff_update(security, fields, security_counts, report, f"securities[{row.ticker}]")
            if old_name != row.name:
                # Positions rows may still carry the old name; keep resolving it to this
                # ticker instead of minting a synthetic duplicate and reassigning holdings.
                by_name.setdefault(old_name, security)
                report.warnings.append(
                    f"ReferenceData: {row.ticker} renamed {old_name!r} -> {row.name!r}; "
                    "Positions rows using the old name still match this ticker"
                )
        by_name[row.name] = security
    await db.flush()  # ids needed for latest_prices and callers

    priced = [row for row in parsed.securities if row.last_price is not None]
    existing_prices = {p.security_id for p in (await db.execute(select(LatestPrice))).scalars()}
    for row in priced:
        security = by_name[row.name]
        if security.id in existing_prices:
            price_counts.skips += 1  # price service owns updates; import only seeds
            continue
        db.add(
            LatestPrice(
                security_id=security.id,
                price=row.last_price,
                quoted_at=datetime.now(UTC),
                source="manual",
            )
        )
        price_counts.creates += 1
        report.add_sample(f"latest_prices[{row.ticker}]: seeded {row.last_price} (manual)")
    return by_name


async def apply_positions(
    db: AsyncSession,
    parsed: ParsedPositions,
    securities_by_name: dict[str, Security],
    report: SheetReport,
) -> None:
    txn_counts = report.counts("position_transactions")
    security_counts = report.counts("securities")
    # Merge the DB view over the ReferenceData map: on RE-imports, previously auto-created
    # securities (synthetic tickers) exist in the DB but not in the refdata map — without
    # this merge they would be created twice and violate the unique ticker constraint.
    all_securities = (await db.execute(select(Security))).scalars().all()
    taken_tickers = {s.ticker for s in all_securities}
    lookup = {s.name: s for s in all_securities}
    lookup.update(securities_by_name)
    for txn in parsed.transactions:
        if txn.name not in lookup:
            ticker = synthetic_ticker(txn.name, taken_tickers)
            taken_tickers.add(ticker)
            security = Security(
                ticker=ticker,
                name=txn.name,
                industry=None,
                holding_type="private",
                is_manual_priced=True,  # a synthetic ticker can never be quoted
            )
            db.add(security)
            lookup[txn.name] = security
            security_counts.creates += 1
            report.warnings.append(
                f"Positions: security {txn.name!r} not in ReferenceData — auto-created "
                f"active with synthetic ticker {ticker} (private, manual-priced)"
            )
    await db.flush()

    existing = {
        t.sort_index: t
        for t in (
            await db.execute(
                select(PositionTransaction).where(PositionTransaction.source == "import")
            )
        ).scalars()
    }
    incoming_indexes: set[int] = set()
    for txn in parsed.transactions:
        incoming_indexes.add(txn.sort_index)
        fields = {
            "security_id": lookup[txn.name].id,
            "account": txn.account,
            "type": txn.type,
            "txn_date": txn.txn_date,
            "shares": txn.shares,
            "price": txn.price,
            "fees": txn.fees,
            "split_factor": txn.split_factor,
        }
        row = existing.get(txn.sort_index)
        if row is None:
            db.add(PositionTransaction(sort_index=txn.sort_index, source="import", **fields))
            txn_counts.creates += 1
            report.add_sample(
                f"position_transactions[{txn.sort_index}]: {txn.type} "
                f"{txn.shares} {txn.name} @ {txn.price}"
            )
        else:
            _diff_update(
                row,
                fields,
                txn_counts,
                report,
                f"position_transactions[{txn.sort_index}]",
            )
    # Sync: importer-owned rows (source='import') whose sheet row disappeared are deleted.
    # UI-created rows (source='ui') are invisible to the sync at ANY sort_index (Plan 4
    # contract, superseding Plan 2's sort_index-0 rule) — so a sheet row may land on a UI
    # row's sort_index; both survive and cost-basis folding tie-breaks the pair on id.
    for sort_index, row in existing.items():
        if sort_index not in incoming_indexes:
            await db.delete(row)
            txn_counts.deletes += 1
            report.add_sample(f"position_transactions[{sort_index}]: deleted (row left sheet)")


# The five Net Worth source-bucket columns whose sums ALSO appear as their own sheet
# columns (Fidelity Traditional 401(k) = employer match + reverse rollover + traditional;
# Fidelity Roth 401(k) = roth basic + after-tax — exact at every snapshot). Counting both
# sides double-counts pre/post-tax totals, so these import flagged out of the rollups,
# linked to their aggregate so the UI nests them under it (the sheet lists them BEFORE
# the aggregate). Seeded at CREATION only: after that both fields are user-owned
# (accounts CRUD) and re-imports never touch them. Migration f1b36c0cf33c backfilled the
# same five flags but is a no-op on a fresh DB (migrations run at boot, before the
# accounts exist to flip); e5b93d0a416f does the same for the parent links.
COMPONENT_PARENT_SLUG_AT_CREATE: dict[str, str] = {
    "employer-match-401-k": "fidelity-traditional-401-k",
    "reverse-rollover-401-k": "fidelity-traditional-401-k",
    "traditional-401-k": "fidelity-traditional-401-k",
    "roth-basic-401-k": "fidelity-roth-401-k",
    "after-tax-401-k": "fidelity-roth-401-k",
}
COMPONENT_SLUGS_AT_CREATE = frozenset(COMPONENT_PARENT_SLUG_AT_CREATE)


async def apply_net_worth(db: AsyncSession, parsed: ParsedNetWorth, report: SheetReport) -> None:
    account_counts = report.counts("accounts")
    snapshot_counts = report.counts("net_worth_snapshots")
    balance_counts = report.counts("account_balances")

    existing_accounts = {a.slug: a for a in (await db.execute(select(Account))).scalars()}
    accounts_by_name: dict[str, Account] = {}
    seen_slugs: set[str] = set()
    created_component_slugs: list[str] = []
    for column in parsed.accounts:
        slug = slugify(column.name)
        if not slug:
            report.errors.append(
                f"Net Worth: account name {column.name!r} has no ASCII alphanumeric "
                "characters — cannot derive a slug; rename it in the sheet"
            )
            continue
        if slug in seen_slugs:
            report.errors.append(
                f"Net Worth: accounts {column.name!r} and another column share slug "
                f"{slug!r} — rename one in the sheet"
            )
            continue
        seen_slugs.add(slug)
        account = existing_accounts.get(slug)
        fields = {"name": column.name, "group": column.group, "sort_order": column.sort_order}
        if account is None:
            is_component = slug in COMPONENT_SLUGS_AT_CREATE
            # is_active default True; both flags are user-owned after creation
            account = Account(slug=slug, is_component=is_component, **fields)
            db.add(account)
            account_counts.creates += 1
            if is_component:
                created_component_slugs.append(slug)
            suffix = ", component" if is_component else ""
            report.add_sample(f"accounts[{slug}]: created ({column.group}{suffix})")
        else:
            _diff_update(account, fields, account_counts, report, f"accounts[{slug}]")
        accounts_by_name[column.name] = account

    if created_component_slugs:
        # Wire just-created components to their aggregate (create-time only, mirroring
        # the flag). The parent may itself be new this pass — flush for ids first; a
        # parent absent from both the sheet and the DB simply leaves the link unset.
        await db.flush()
        accounts_by_slug = {a.slug: a for a in existing_accounts.values()}
        accounts_by_slug.update({a.slug: a for a in accounts_by_name.values()})
        for slug in created_component_slugs:
            parent = accounts_by_slug.get(COMPONENT_PARENT_SLUG_AT_CREATE[slug])
            if parent is not None:
                accounts_by_slug[slug].parent_account_id = parent.id

    sheet_slugs = {slugify(column.name) for column in parsed.accounts}
    for slug, account in existing_accounts.items():
        if account.is_active and slug not in sheet_slugs:
            report.warnings.append(
                f"Net Worth: account {account.name!r} ({slug}) exists in the database but "
                "has no column in the sheet — left untouched; deactivate or merge manually "
                "if it was renamed"
            )

    existing_snapshots = {
        s.month: s for s in (await db.execute(select(NetWorthSnapshot))).scalars()
    }
    snapshots_by_month = {}
    for snap in parsed.snapshots:
        row = existing_snapshots.get(snap.month)
        if row is None:
            row = NetWorthSnapshot(month=snap.month, recorded_on=snap.recorded_on)
            db.add(row)
            snapshot_counts.creates += 1
        else:
            _diff_update(
                row,
                {"recorded_on": snap.recorded_on},
                snapshot_counts,
                report,
                f"net_worth_snapshots[{snap.month.isoformat()}]",
            )
        snapshots_by_month[snap.month] = row
    await db.flush()

    existing_balances = {
        (b.snapshot_id, b.account_id): b
        for b in (await db.execute(select(AccountBalance))).scalars()
    }
    for snap in parsed.snapshots:
        snapshot = snapshots_by_month[snap.month]
        for account_name, balance in snap.balances.items():
            account = accounts_by_name.get(account_name)
            if account is None:
                continue  # slug-collision error above already reported
            key = (snapshot.id, account.id)
            row = existing_balances.get(key)
            if row is None:
                db.add(
                    AccountBalance(snapshot_id=snapshot.id, account_id=account.id, balance=balance)
                )
                balance_counts.creates += 1
            else:
                _diff_update(
                    row,
                    {"balance": balance},
                    balance_counts,
                    report,
                    f"account_balances[{snap.month.isoformat()}/{account.slug}]",
                )


async def apply_portfolio_history(
    db: AsyncSession, parsed: ParsedPortfolio, report: SheetReport
) -> None:
    """Upsert the weekly value-history series by snapshot_date, then delete rows the
    workbook doesn't carry, up to its last date: a re-upload OVERRIDES whatever the live
    Monday snapshots wrote (user directive 2026-08-21, superseding the original
    no-deletes posture) — which also flushes any stray rows from the retired daily-append
    era. Rows PAST the sheet's last date survive: they are the live continuation the
    sheet hasn't caught up to yet. An empty parsed series deletes nothing (hollow history
    columns must read as 'nothing to say', never as 'wipe the table')."""
    counts = report.counts("portfolio_value_history")
    existing = {
        row.snapshot_date: row
        for row in (await db.execute(select(PortfolioValueHistory))).scalars()
    }
    imported_dates = {point.snapshot_date for point in parsed.history}
    for point in parsed.history:
        fields = {
            "market_value": point.market_value,
            "cost_basis": point.cost_basis,
            "sp500_value": point.sp500_value,
        }
        row = existing.get(point.snapshot_date)
        if row is None:
            db.add(PortfolioValueHistory(snapshot_date=point.snapshot_date, **fields))
            counts.creates += 1
        else:
            _diff_update(
                row,
                fields,
                counts,
                report,
                f"portfolio_value_history[{point.snapshot_date.isoformat()}]",
            )
    if not parsed.history:
        return
    last_imported = max(imported_dates)
    for snapshot_date in sorted(existing):
        if snapshot_date <= last_imported and snapshot_date not in imported_dates:
            await db.delete(existing[snapshot_date])
            counts.deletes += 1
            report.add_sample(
                f"portfolio_value_history[{snapshot_date.isoformat()}]: deleted "
                "(absent from workbook — the sheet owns the series up to its last row)"
            )


async def apply_spending(db: AsyncSession, parsed: ParsedSpending, report: SheetReport) -> None:
    category_counts = report.counts("spending_categories")
    spend_counts = report.counts("monthly_spending")
    cashflow_counts = report.counts("monthly_cashflow")

    existing_categories = {
        c.slug: c for c in (await db.execute(select(SpendingCategory))).scalars()
    }
    categories_by_name: dict[str, SpendingCategory] = {}
    seen_slugs: set[str] = set()
    for column in parsed.categories:
        slug = slugify(column.name)
        if not slug:
            report.errors.append(
                f"Spending: category name {column.name!r} has no ASCII alphanumeric "
                "characters — cannot derive a slug; rename it in the sheet"
            )
            continue
        if slug in seen_slugs:
            report.errors.append(
                f"Spending: categories {column.name!r} and another column share slug "
                f"{slug!r} — rename one in the sheet"
            )
            continue
        seen_slugs.add(slug)
        category = existing_categories.get(slug)
        fields = {"name": column.name, "sort_order": column.sort_order}
        if category is None:
            category = SpendingCategory(slug=slug, **fields)
            db.add(category)
            category_counts.creates += 1
            report.add_sample(f"spending_categories[{slug}]: created")
        else:
            _diff_update(category, fields, category_counts, report, f"spending_categories[{slug}]")
        categories_by_name[column.name] = category
    await db.flush()

    existing_spend = {
        (s.month, s.category_id): s for s in (await db.execute(select(MonthlySpending))).scalars()
    }
    existing_cashflow = {c.month: c for c in (await db.execute(select(MonthlyCashflow))).scalars()}
    for month_row in parsed.months:
        for category_name, amount in month_row.amounts.items():
            category = categories_by_name.get(category_name)
            if category is None:
                continue  # empty-slug error above already reported
            key = (month_row.month, category.id)
            row = existing_spend.get(key)
            if row is None:
                db.add(
                    MonthlySpending(month=month_row.month, category_id=category.id, amount=amount)
                )
                spend_counts.creates += 1
            else:
                _diff_update(
                    row,
                    {"amount": amount},
                    spend_counts,
                    report,
                    f"monthly_spending[{month_row.month.isoformat()}/{category.slug}]",
                )
        if month_row.net_pay is None:
            continue  # no cashflow recorded for this month
        cashflow = existing_cashflow.get(month_row.month)
        if cashflow is None:
            db.add(MonthlyCashflow(month=month_row.month, net_pay=month_row.net_pay))
            cashflow_counts.creates += 1
        else:
            _diff_update(
                cashflow,
                {"net_pay": month_row.net_pay},
                cashflow_counts,
                report,
                f"monthly_cashflow[{month_row.month.isoformat()}]",
            )


async def apply_taxes(db: AsyncSession, parsed: ParsedTaxes, report: SheetReport) -> None:
    year_counts = report.counts("tax_years")
    input_counts = report.counts("tax_inputs")
    bracket_counts = report.counts("tax_brackets")

    # The importer FKs tax_inputs.key -> tax_input_definitions; make sure the (insert-only)
    # seed has run so the Task 2 keys exist on older databases.
    await seed_tax_definitions(db)
    await db.flush()
    known_keys = set((await db.execute(select(TaxInputDefinition.key))).scalars().all())
    for item in parsed.inputs:
        if item.key not in known_keys:
            report.errors.append(
                f"Taxes: input key {item.key!r} is not defined in app/tax_keys.py — "
                "the parser's label sequence and TAX_INPUT_DEFINITIONS have drifted"
            )
            return

    imported_years = sorted({i.year for i in parsed.inputs} | {b.year for b in parsed.brackets})
    existing_years = {y.year for y in (await db.execute(select(TaxYear))).scalars()}
    for year in imported_years:
        if year in existing_years:
            year_counts.skips += 1
        else:
            db.add(TaxYear(year=year))
            year_counts.creates += 1
            report.add_sample(f"tax_years[{year}]: created")
    await db.flush()

    # Sheet wins on re-import WITHIN imported years; other years are never touched.
    existing_inputs = {
        (i.year, i.key): i
        for i in (
            await db.execute(select(TaxInput).where(TaxInput.year.in_(imported_years)))
        ).scalars()
    }
    # The sweep below may only touch keys the workbook itself carries. A key with no value in
    # any year column never reaches parsed.inputs, so hand-entered / UI-only rows (and the
    # per-person keys the married-taxes batch adds) are invisible to the sweep and survive.
    # Union across parsed years on purpose: a cell blanked in ONE year while the same sheet
    # row still carries another year is still a sheet key, and still sync-deletes as today.
    sheet_input_keys = {item.key for item in parsed.inputs}
    incoming_input_keys: set[tuple[int, str]] = set()
    for item in parsed.inputs:
        key = (item.year, item.key)
        incoming_input_keys.add(key)
        row = existing_inputs.get(key)
        if row is None:
            db.add(TaxInput(year=item.year, key=item.key, value=item.value))
            input_counts.creates += 1
        else:
            _diff_update(
                row,
                {"value": item.value},
                input_counts,
                report,
                f"tax_inputs[{item.year}/{item.key}]",
            )
    for key, row in existing_inputs.items():
        if key not in incoming_input_keys and key[1] in sheet_input_keys:
            await db.delete(row)
            input_counts.deletes += 1
            report.add_sample(f"tax_inputs[{key[0]}/{key[1]}]: deleted (cell left sheet)")

    existing_brackets = {
        (b.year, b.jurisdiction, b.bracket_index): b
        for b in (
            await db.execute(select(TaxBracket).where(TaxBracket.year.in_(imported_years)))
        ).scalars()
    }
    # Defensive scoping, mirroring sheet_input_keys above: jurisdictions the workbook never
    # mentions are invisible to the sweep. Today parse_taxes hard-errors unless all six of
    # BRACKET_SECTIONS are present, so this changes nothing for sheet-carried tables.
    sheet_jurisdictions = {item.jurisdiction for item in parsed.brackets}
    incoming_bracket_keys: set[tuple[int, str, int]] = set()
    for item in parsed.brackets:
        key = (item.year, item.jurisdiction, item.bracket_index)
        incoming_bracket_keys.add(key)
        row = existing_brackets.get(key)
        fields = {"rate": item.rate, "threshold": item.threshold}
        if row is None:
            db.add(
                TaxBracket(
                    year=item.year,
                    jurisdiction=item.jurisdiction,
                    bracket_index=item.bracket_index,
                    **fields,
                )
            )
            bracket_counts.creates += 1
        else:
            _diff_update(
                row,
                fields,
                bracket_counts,
                report,
                f"tax_brackets[{item.year}/{item.jurisdiction}/{item.bracket_index}]",
            )
    # Stale brackets are load-bearing wrong data for the Plan 5 engine — sync-delete them,
    # but only within jurisdictions the workbook actually carries (see sheet_jurisdictions).
    for key, row in existing_brackets.items():
        if key not in incoming_bracket_keys and key[1] in sheet_jurisdictions:
            await db.delete(row)
            bracket_counts.deletes += 1
            report.add_sample(f"tax_brackets[{key[0]}/{key[1]}/{key[2]}]: deleted (row left sheet)")


async def apply_espp(db: AsyncSession, parsed: ParsedEspp, report: SheetReport) -> None:
    lot_counts = report.counts("espp_lots")
    period_counts = report.counts("espp_periods")

    existing_lots = {
        lot.purchase_date: lot for lot in (await db.execute(select(EsppLot))).scalars()
    }
    for lot in parsed.lots:
        fields = {
            "qualifying_date": lot.qualifying_date,
            "shares": lot.shares,
            "subscription_price": lot.subscription_price,
            "purchase_fmv": lot.purchase_fmv,
            "purchase_price": lot.purchase_price,
            # sold_date/sold_price/notes are user-owned: the sheet records no real sales
        }
        row = existing_lots.get(lot.purchase_date)
        if row is None:
            db.add(EsppLot(purchase_date=lot.purchase_date, **fields))
            lot_counts.creates += 1
            report.add_sample(f"espp_lots[{lot.purchase_date.isoformat()}]: created")
        else:
            _diff_update(
                row,
                fields,
                lot_counts,
                report,
                f"espp_lots[{lot.purchase_date.isoformat()}]",
            )

    existing_periods = {p.label: p for p in (await db.execute(select(EsppPeriod))).scalars()}
    for period in parsed.periods:
        fields = {
            "period_start": period.period_start,
            "period_end": period.period_end,
            "semi_annual_base": period.semi_annual_base,
            "additional_payments": period.additional_payments,
            "contribution_pct": period.contribution_pct,
        }
        row = existing_periods.get(period.label)
        if row is None:
            db.add(EsppPeriod(label=period.label, **fields))
            period_counts.creates += 1
            report.add_sample(f"espp_periods[{period.label}]: created")
        else:
            _diff_update(row, fields, period_counts, report, f"espp_periods[{period.label}]")

    incoming_labels = {period.label for period in parsed.periods}
    for label in existing_periods:
        if label not in incoming_labels:
            report.warnings.append(
                f"ESPP: period {label!r} exists in the database but is no longer derived "
                "from the sheet — left untouched; delete manually once concluded"
            )


async def apply_focal_history(
    db: AsyncSession, parsed: ParsedFocalHistory, report: SheetReport
) -> None:
    counts = report.counts("comp_events")
    existing = {e.focal_year: e for e in (await db.execute(select(CompEvent))).scalars()}
    for event in parsed.events:
        fields = {
            "current_base": event.current_base,
            "new_base": event.new_base,
            "unvested_rsus": event.unvested_rsus,
            "unvested_price": event.unvested_price,
            "refresh_rsus": event.refresh_rsus,
            "grant_price": event.grant_price,
        }
        row = existing.get(event.focal_year)
        if row is None:
            db.add(CompEvent(focal_year=event.focal_year, **fields))
            counts.creates += 1
            report.add_sample(f"comp_events[{event.focal_year}]: created")
        else:
            _diff_update(row, fields, counts, report, f"comp_events[{event.focal_year}]")


async def apply_paycheck(
    db: AsyncSession,
    parsed: ParsedPaycheck,
    focal: ParsedFocalHistory,
    report: SheetReport,
) -> None:
    counts = report.counts("paycheck_profiles")
    if parsed.profile is None:
        return
    # The sheet has no effective date. Deterministic rule: Jan 1 of the latest focal year
    # with a New Base (comp changes drive paycheck changes). Edit in the UI once Plan 5 lands.
    dated_years = [e.focal_year for e in focal.events if e.new_base is not None]
    if not dated_years:
        report.warnings.append(
            "Paycheck Modeler: no focal year with a New Base — cannot derive "
            "effective_date; profile not imported"
        )
        return
    focal_year = max(dated_years)
    effective_date = date(focal_year, 1, 1)
    report.warnings.append(
        f"Paycheck Modeler: effective_date derived as {effective_date.isoformat()} "
        f"(Jan 1 of latest focal year with a New Base)"
    )
    latest_new_base = next(e.new_base for e in focal.events if e.focal_year == focal_year)
    if latest_new_base != parsed.profile.annual_salary:
        report.warnings.append(
            f"Paycheck Modeler: Annual Salary {parsed.profile.annual_salary} != focal "
            f"{focal_year} New Base {latest_new_base} — derived effective_date may be stale"
        )
    fields = {
        "annual_salary": parsed.profile.annual_salary,
        "trad_401k_pct": parsed.profile.trad_401k_pct,
        "roth_401k_pct": parsed.profile.roth_401k_pct,
        "after_tax_401k_pct": parsed.profile.after_tax_401k_pct,
        "espp_pct": parsed.profile.espp_pct,
        "withholding_pct": parsed.profile.withholding_pct,
        "dental_vision_per_check": parsed.profile.dental_vision_per_check,
        "hsa_per_check": parsed.profile.hsa_per_check,
        # pay_periods_per_year stays at its default (24) on create, user-owned on update
    }
    existing = {p.effective_date: p for p in (await db.execute(select(PaycheckProfile))).scalars()}
    row = existing.get(effective_date)
    if row is None:
        db.add(PaycheckProfile(effective_date=effective_date, **fields))
        counts.creates += 1
        report.add_sample(f"paycheck_profiles[{effective_date.isoformat()}]: created")
    else:
        _diff_update(
            row, fields, counts, report, f"paycheck_profiles[{effective_date.isoformat()}]"
        )
