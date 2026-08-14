"""Pure sheet parsers: worksheet -> normalized dataclasses + issues. No DB imports here."""

import dataclasses
import datetime
from decimal import Decimal

from app.importer.cells import (
    Q2,
    Q4,
    Q6,
    CellIssues,
    cell_ref,
    first_of_month,
    is_placeholder_balance,
    to_date_lenient,
    to_date_strict,
    to_decimal,
)

ROW_CAP = 2000  # unsized Google-Sheets export: never trust ws.max_row (see plan notes)
BLANK_STREAK_STOP = 5

# The Taxes sheet's input labels in exact row order per section. The parser walks this
# sequence and hard-errors on any mismatch — it is the layout-drift detector. Keys must
# exist in app.tax_keys (asserted by tests).
SHEET_TAX_INPUT_SEQUENCE: list[tuple[str, list[tuple[str, str]]]] = [
    (
        "ORDINARY INCOME",
        [
            ("Annual Salary", "annual_salary"),
            ("Gross Paycheck", "gross_paycheck"),
            ("Pay Periods", "pay_periods"),
            ("Latest W2 Income", "latest_w2_income"),
            ("Other W2 Income", "other_w2_income"),
            ("(Stock/RSUs Sold)", "w2_stock_rsus_sold"),
            ("(Bonuses)", "w2_bonuses"),
            ("(Salary Checkpoint)", "w2_salary_checkpoint"),
            ("(ESPP Sale Component)", "w2_espp_sale_component"),
            ("(Employer HSA Contribution)", "w2_employer_hsa"),
            ("(Other, specify)", "w2_other"),
            ("Short Term Capital Gain/Loss", "stcg_total"),
            ("(Standard Gain/Loss)", "stcg_standard"),
            ("(ESPP Sale Component)", "stcg_espp_component"),
            ("Unqualified Dividends", "unqualified_dividends"),
            ("(US Treasuries ETF)", "unq_div_us_treasuries_etf"),
            ("(State Exempt Percentage)", "unq_div_state_exempt_pct"),
            ("(Other Dividends)", "unq_div_other"),
            ("Interest", "interest_total"),
            ("(Standard Interest)", "interest_standard"),
            ("(US Treasuries)", "interest_us_treasuries"),
            ("Other Income, eg. 1099 MISC", "other_income_1099"),
        ],
    ),
    (
        "DEDUCTIONS",
        [
            ("Traditional 401k Contributions", "trad_401k_contributions"),
            ("HSA Contributions", "hsa_contributions"),
            ("HSA Contributions (Employer)", "hsa_contributions_employer"),
            ("Capital Loss Deductions", "capital_loss_deductions"),
            ("Other Pre-tax Deductions", "other_pretax_deductions"),
            ("(Dental)", "pretax_dental"),
            ("(Vision)", "pretax_vision"),
            ("Standard Deduction", "standard_deduction"),
            ("Itemized Deduction", "itemized_deduction"),
            ("(SALT Amount)", "itemized_salt"),
            ("(Donations/Tithes)", "itemized_donations"),
            ("(Vehicle Registration Fees)", "itemized_vehicle_reg"),
            ("(Sec 199A Div - [20%])", "itemized_sec199a_div"),
            ("(Other Items)", "itemized_other"),
        ],
    ),
    (
        "CAPITAL GAINS",
        [
            ("Long Term Capital Gain/Loss", "ltcg_total"),
            ("(Brokerage Gain/Loss)", "ltcg_brokerage"),
            ("(ESPP Sale Component)", "ltcg_espp_component"),
            ("Qualified Dividends", "qualified_dividends"),
            ("Other Capital Gains", "other_capital_gains"),
        ],
    ),
]


@dataclasses.dataclass
class ParsedSecurity:
    ticker: str
    name: str
    industry: str | None
    holding_type: str
    annual_dividend: Decimal | None
    ex_div_date: datetime.date | None
    last_price: Decimal | None


@dataclasses.dataclass
class ParsedReferenceData:
    securities: list[ParsedSecurity]
    issues: CellIssues


def _iter_rows(ws, *, min_row: int, max_col: int, max_row: int = ROW_CAP):
    """Bounded values_only iteration with 1-based row numbers (unsized-worksheet safe)."""
    return enumerate(
        ws.iter_rows(min_row=min_row, max_row=max_row, max_col=max_col, values_only=True),
        start=min_row,
    )


def _text(value: object) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


HOLDING_TYPE_BY_SECTOR = {"ETF": "etf", "Mutual Fund": "mutual_fund"}


def parse_reference_data(ws) -> ParsedReferenceData:
    issues = CellIssues()
    securities: list[ParsedSecurity] = []
    seen_tickers: set[str] = set()
    seen_names: set[str] = set()
    blanks = 0
    for rnum, row in _iter_rows(ws, min_row=2, max_col=9, max_row=500):
        if all(v is None for v in row):
            blanks += 1
            if blanks >= BLANK_STREAK_STOP:
                break
            continue
        blanks = 0
        ticker = _text(row[0])
        name = _text(row[1])
        if ticker is None or name is None:
            issues.error(f"{cell_ref('ReferenceData', rnum, 1)}: row needs Symbol and Name")
            continue
        if len(ticker) > 20 or len(name) > 200:
            issues.error(f"{cell_ref('ReferenceData', rnum, 1)}: Symbol/Name too long")
            continue
        if ticker in seen_tickers:
            issues.error(f"{cell_ref('ReferenceData', rnum, 1)}: duplicate ticker {ticker}")
            continue
        if name in seen_names:
            issues.error(f"{cell_ref('ReferenceData', rnum, 2)}: duplicate name {name!r}")
            continue
        seen_tickers.add(ticker)
        seen_names.add(name)
        sector = _text(row[2])
        last_price = to_decimal(
            row[4], Q4, 10, ctx=cell_ref("ReferenceData", rnum, 5), issues=issues
        )
        if last_price is None and row[4] is not None:
            issues.warn(
                f"{cell_ref('ReferenceData', rnum, 5)}: last price unavailable "
                f"({row[4]!r}); latest_prices row skipped for {ticker}"
            )
        securities.append(
            ParsedSecurity(
                ticker=ticker,
                name=name,
                industry=sector,
                holding_type=HOLDING_TYPE_BY_SECTOR.get(sector, "stock"),
                annual_dividend=to_decimal(
                    row[6], Q4, 6, ctx=cell_ref("ReferenceData", rnum, 7), issues=issues
                ),
                ex_div_date=to_date_lenient(row[8]),
                last_price=last_price,
            )
        )
    return ParsedReferenceData(securities=securities, issues=issues)


@dataclasses.dataclass
class ParsedTransaction:
    account: str
    type: str
    name: str  # security NAME (ReferenceData resolves it to a ticker at apply time)
    txn_date: datetime.date | None
    shares: Decimal
    price: Decimal
    fees: Decimal | None
    split_factor: Decimal | None
    sort_index: int


@dataclasses.dataclass
class ParsedPositions:
    transactions: list[ParsedTransaction]
    issues: CellIssues


TRANSACTION_TYPE_MAP = {"buy": "buy", "sell": "sell", "split": "split"}


def parse_positions(ws) -> ParsedPositions:
    issues = CellIssues()
    transactions: list[ParsedTransaction] = []
    zero_share_rows = 0
    blanks = 0
    for rnum, row in _iter_rows(ws, min_row=2, max_col=7, max_row=500):
        if all(v is None for v in row):
            blanks += 1
            if blanks >= BLANK_STREAK_STOP:
                break
            continue
        blanks = 0
        account = _text(row[0])
        type_text = _text(row[1])
        name = _text(row[2])
        if account is None or type_text is None or name is None:
            issues.error(f"{cell_ref('Positions', rnum, 1)}: row needs Platforms, Type and Stock")
            continue
        txn_type = TRANSACTION_TYPE_MAP.get(type_text.lower())
        if txn_type is None:
            issues.error(f"{cell_ref('Positions', rnum, 2)}: unknown type {type_text!r}")
            continue
        fees = to_decimal(row[5], Q2, 8, ctx=cell_ref("Positions", rnum, 6), issues=issues)
        if fees is None and row[5] is not None:
            issues.warn(
                f"{cell_ref('Positions', rnum, 6)}: fees value {row[5]!r} unreadable — "
                "transaction imported without fees"
            )
        split_factor = to_decimal(row[6], Q4, 6, ctx=cell_ref("Positions", rnum, 7), issues=issues)
        if txn_type == "split":
            if split_factor is None:
                issues.error(f"{cell_ref('Positions', rnum, 7)}: split row needs Stock Split")
                continue
            # shares/price are NOT NULL; split rows carry dummy zeros (Plan 1 convention —
            # Plan 4's folding reads only split_factor on splits).
            shares, price = Decimal("0"), Decimal("0")
        else:
            shares = to_decimal(row[3], Q6, 10, ctx=cell_ref("Positions", rnum, 4), issues=issues)
            price = to_decimal(row[4], Q4, 10, ctx=cell_ref("Positions", rnum, 5), issues=issues)
            if shares is None or price is None:
                issues.error(
                    f"{cell_ref('Positions', rnum, 4)}: buy/sell row needs shares and price"
                )
                continue
            if shares < 0 or price < 0:
                issues.warn(
                    f"{cell_ref('Positions', rnum, 4)}: negative shares/price on "
                    f"{txn_type} row (sheet convention is positive values + type)"
                )
            if shares == 0:
                zero_share_rows += 1
                continue
        transactions.append(
            ParsedTransaction(
                account=account,
                type=txn_type,
                name=name,
                txn_date=None,  # the sheet has no date column (spec Risks)
                shares=shares,
                price=price,
                fees=fees,
                split_factor=split_factor,
                sort_index=rnum * 10,
            )
        )
    if zero_share_rows:
        issues.warn(
            f"Positions: skipped {zero_share_rows} zero-share placeholder row(s) "
            "(sheet running-total chain artifacts)"
        )
    return ParsedPositions(transactions=transactions, issues=issues)


GROUP_BY_BAND = {
    "CASH": "cash",
    "PRE-TAX": "pre_tax",
    "POST-TAX": "post_tax",
    "TAXABLE": "taxable",
    "EQUITY": "equity",
    "OTHER": "other",
    "LIABILITIES": "liability",
}
NET_WORTH_TERMINAL_BAND = "NET WORTH"
NET_WORTH_HEADER_SCAN_COLS = 120


# frozen=True: instances key the per-row raw-cell dicts below (plain dataclasses with
# eq=True are unhashable); these are pure value records, never mutated downstream.
@dataclasses.dataclass(frozen=True)
class ParsedAccountColumn:
    name: str
    group: str
    sort_order: int  # sheet column index — stable, sheet-ordered
    column: int


@dataclasses.dataclass
class ParsedSnapshot:
    month: datetime.date
    recorded_on: datetime.date | None
    balances: dict[str, Decimal]  # account name -> signed balance


@dataclasses.dataclass
class ParsedNetWorth:
    accounts: list[ParsedAccountColumn]
    snapshots: list[ParsedSnapshot]
    issues: CellIssues


def parse_net_worth(ws) -> ParsedNetWorth:
    issues = CellIssues()
    header = list(
        ws.iter_rows(min_row=1, max_row=2, max_col=NET_WORTH_HEADER_SCAN_COLS, values_only=True)
    )
    bands, names = header[0], header[1]
    accounts: list[ParsedAccountColumn] = []
    current_band: str | None = None
    for index, band_cell in enumerate(bands):
        column = index + 1
        band_text = _text(band_cell)
        if band_text is not None and column >= 3:
            current_band = band_text
        if current_band == NET_WORTH_TERMINAL_BAND:
            break  # computed totals begin — no more account columns
        name = _text(names[index]) if index < len(names) else None
        if column < 3 or name is None or name == "%":
            continue
        group = GROUP_BY_BAND.get(current_band or "")
        if group is None:
            issues.warn(
                f"{cell_ref('Net Worth', 1, column)}: unknown group band "
                f"{current_band!r} for account {name!r} — falling back to 'other'"
            )
            group = "other"
        if any(a.name == name for a in accounts):
            issues.error(f"{cell_ref('Net Worth', 2, column)}: duplicate account {name!r}")
            continue
        accounts.append(
            ParsedAccountColumn(name=name, group=group, sort_order=column, column=column)
        )

    snapshots: list[ParsedSnapshot] = []
    seen_months: set[datetime.date] = set()
    sentinel_count = 0
    negated_liabilities = False
    max_col = max((a.column for a in accounts), default=2)
    for rnum, row in _iter_rows(ws, min_row=3, max_col=max_col):
        if row[0] is None:
            break  # months run out — template region ends the sheet
        month = to_date_strict(row[0], ctx=cell_ref("Net Worth", rnum, 1), issues=issues)
        if month is None:
            continue
        month = first_of_month(month, ctx=cell_ref("Net Worth", rnum, 1), issues=issues)
        raw_cells = {account: row[account.column - 1] for account in accounts}
        if all(value is None for value in raw_cells.values()):
            continue  # future template row (Month/Date filled, balances empty)
        if month in seen_months:
            issues.error(f"{cell_ref('Net Worth', rnum, 1)}: duplicate month {month.isoformat()}")
            continue
        seen_months.add(month)
        recorded_on = to_date_strict(row[1], ctx=cell_ref("Net Worth", rnum, 2), issues=issues)
        balances: dict[str, Decimal] = {}
        for account, raw in raw_cells.items():
            if raw is None:
                continue  # sparse cell: no balance recorded for this account/month
            if is_placeholder_balance(raw):
                sentinel_count += 1
                value = Decimal("0.00")
            else:
                value = to_decimal(
                    raw, Q2, 12, ctx=cell_ref("Net Worth", rnum, account.column), issues=issues
                )
                if value is None:
                    continue
            if account.group == "liability" and value != 0:
                value = -value  # sheet stores debt positive; schema stores it signed
                negated_liabilities = True
            balances[account.name] = value
        snapshots.append(ParsedSnapshot(month=month, recorded_on=recorded_on, balances=balances))
    if sentinel_count:
        issues.warn(f"Net Worth: normalized {sentinel_count} placeholder 0.001 balance(s) to 0.00")
    if negated_liabilities:
        issues.warn(
            "Net Worth: liability balances negated on import "
            "(sheet stores debt positive; schema stores signed balances)"
        )
    return ParsedNetWorth(accounts=accounts, snapshots=snapshots, issues=issues)


@dataclasses.dataclass(frozen=True)  # dict key in parse_spending, same as ParsedAccountColumn
class ParsedCategoryColumn:
    name: str
    sort_order: int  # sheet column index
    column: int


@dataclasses.dataclass
class ParsedSpendingMonth:
    month: datetime.date
    amounts: dict[str, Decimal]  # category name -> amount (explicit sheet zeros kept)
    net_pay: Decimal | None


@dataclasses.dataclass
class ParsedSpending:
    categories: list[ParsedCategoryColumn]
    months: list[ParsedSpendingMonth]
    issues: CellIssues


def parse_spending(ws) -> ParsedSpending:
    issues = CellIssues()
    header = next(iter(ws.iter_rows(min_row=1, max_row=1, max_col=40, values_only=True)))
    categories: list[ParsedCategoryColumn] = []
    total_column: int | None = None
    net_pay_column: int | None = None
    for index, cell in enumerate(header):
        column = index + 1
        text = _text(cell)
        if column < 2 or text is None:
            continue
        if text == "TOTAL":
            total_column = column
            continue
        if text == "Net Pay":
            net_pay_column = column
            continue
        if total_column is None:  # category columns all precede TOTAL
            categories.append(ParsedCategoryColumn(name=text, sort_order=column, column=column))
    if total_column is None or net_pay_column is None:
        issues.error("Spending!r1: TOTAL and Net Pay header columns are required")
        return ParsedSpending(categories=categories, months=[], issues=issues)

    months: list[ParsedSpendingMonth] = []
    seen_months: set[datetime.date] = set()
    for rnum, row in _iter_rows(ws, min_row=2, max_col=net_pay_column):
        first = row[0]
        if first is None:
            break
        if isinstance(first, str):
            continue  # 'Average' summary row
        if not isinstance(first, datetime.date):  # covers datetime too (subclass)
            continue  # numeric-year rollup row
        month = first_of_month(
            to_date_strict(first, ctx=cell_ref("Spending", rnum, 1), issues=issues),
            ctx=cell_ref("Spending", rnum, 1),
            issues=issues,
        )
        raw_amounts = {category: row[category.column - 1] for category in categories}
        raw_net_pay = row[net_pay_column - 1]
        if all(value is None for value in raw_amounts.values()) and raw_net_pay is None:
            continue  # future template month
        if month in seen_months:
            issues.error(f"{cell_ref('Spending', rnum, 1)}: duplicate month {month.isoformat()}")
            continue
        seen_months.add(month)
        amounts: dict[str, Decimal] = {}
        for category, raw in raw_amounts.items():
            if raw is None:
                continue
            value = to_decimal(
                raw, Q2, 10, ctx=cell_ref("Spending", rnum, category.column), issues=issues
            )
            if value is not None:
                amounts[category.name] = value
        net_pay = to_decimal(
            raw_net_pay, Q2, 10, ctx=cell_ref("Spending", rnum, net_pay_column), issues=issues
        )
        total = to_decimal(
            row[total_column - 1],
            Q2,
            10,
            ctx=cell_ref("Spending", rnum, total_column),
            issues=issues,
        )
        if total is not None and amounts and abs(sum(amounts.values()) - total) >= Decimal("0.01"):
            issues.warn(
                f"Spending {month.isoformat()[:7]}: category sum {sum(amounts.values())} "
                f"!= sheet TOTAL {total} (imported category values anyway)"
            )
        months.append(ParsedSpendingMonth(month=month, amounts=amounts, net_pay=net_pay))
    return ParsedSpending(categories=categories, months=months, issues=issues)
