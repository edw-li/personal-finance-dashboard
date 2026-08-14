"""Load-compare-write appliers: parsed dataclasses -> ORM upserts + report counts.

No openpyxl imports. Every applier preloads existing rows by natural key in one query,
diffs in memory, and mutates/creates through the ORM (row volumes are ~2k total). The
caller (service.py) owns the transaction: nothing here commits.
"""

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.importer.cells import slugify, synthetic_ticker
from app.importer.parsers import (
    ParsedNetWorth,
    ParsedPositions,
    ParsedReferenceData,
    ParsedSpending,
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
            "annual_dividend": row.annual_dividend,
            "ex_div_date": row.ex_div_date,
        }
        security = existing.get(row.ticker)
        if security is None:
            # is_manual_priced/is_active stay user-owned after creation
            security = Security(ticker=row.ticker, **fields)
            db.add(security)
            security_counts.creates += 1
            report.add_sample(f"securities[{row.ticker}]: created")
        else:
            _diff_update(security, fields, security_counts, report, f"securities[{row.ticker}]")
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
            await db.execute(select(PositionTransaction).where(PositionTransaction.sort_index > 0))
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
            db.add(PositionTransaction(sort_index=txn.sort_index, **fields))
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
    # Sync: importer-owned rows (sort_index > 0) whose sheet row disappeared are deleted;
    # UI-created rows keep the default sort_index 0 and are never touched (Plan 4 contract).
    for sort_index, row in existing.items():
        if sort_index not in incoming_indexes:
            await db.delete(row)
            txn_counts.deletes += 1
            report.add_sample(f"position_transactions[{sort_index}]: deleted (row left sheet)")


async def apply_net_worth(db: AsyncSession, parsed: ParsedNetWorth, report: SheetReport) -> None:
    account_counts = report.counts("accounts")
    snapshot_counts = report.counts("net_worth_snapshots")
    balance_counts = report.counts("account_balances")

    existing_accounts = {a.slug: a for a in (await db.execute(select(Account))).scalars()}
    accounts_by_name: dict[str, Account] = {}
    seen_slugs: set[str] = set()
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
            account = Account(slug=slug, **fields)  # is_active default True, user-owned after
            db.add(account)
            account_counts.creates += 1
            report.add_sample(f"accounts[{slug}]: created ({column.group})")
        else:
            _diff_update(account, fields, account_counts, report, f"accounts[{slug}]")
        accounts_by_name[column.name] = account

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


async def apply_spending(db: AsyncSession, parsed: ParsedSpending, report: SheetReport) -> None:
    category_counts = report.counts("spending_categories")
    spend_counts = report.counts("monthly_spending")
    cashflow_counts = report.counts("monthly_cashflow")

    existing_categories = {
        c.slug: c for c in (await db.execute(select(SpendingCategory))).scalars()
    }
    categories_by_name: dict[str, SpendingCategory] = {}
    for column in parsed.categories:
        slug = slugify(column.name)
        if not slug:
            report.errors.append(
                f"Spending: category name {column.name!r} has no ASCII alphanumeric "
                "characters — cannot derive a slug; rename it in the sheet"
            )
            continue
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
