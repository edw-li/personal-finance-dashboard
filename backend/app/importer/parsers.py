"""Pure sheet parsers: worksheet -> normalized dataclasses + issues. No DB imports here."""

import dataclasses
import datetime
import re
from decimal import Decimal

from app.importer.cells import (
    Q2,
    Q4,
    Q5,
    Q6,
    Q9,
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


def _iter_rows(ws, *, min_row: int, max_col: int, max_row: int = ROW_CAP, min_col: int = 1):
    """Bounded values_only iteration with 1-based row numbers (unsized-worksheet safe)."""
    return enumerate(
        ws.iter_rows(
            min_row=min_row, max_row=max_row, min_col=min_col, max_col=max_col, values_only=True
        ),
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
        if sector is not None and len(sector) > 80:
            issues.error(f"{cell_ref('ReferenceData', rnum, 3)}: Sector too long (max 80)")
            continue
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
        if len(account) > 80:
            issues.error(f"{cell_ref('Positions', rnum, 1)}: platform label too long (max 80)")
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
    terminal_seen = False
    for index, band_cell in enumerate(bands):
        column = index + 1
        band_text = _text(band_cell)
        if band_text is not None and column >= 3:
            current_band = band_text
        if current_band == NET_WORTH_TERMINAL_BAND:
            terminal_seen = True
            break  # computed totals begin — no more account columns
        name = _text(names[index]) if index < len(names) else None
        if column < 3 or name is None or name == "%":
            continue
        if len(name) > 120:
            issues.error(f"{cell_ref('Net Worth', 2, column)}: account name too long (max 120)")
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
    if not terminal_seen:
        issues.warn(
            f"Net Worth: 'NET WORTH' terminal band not found within the first "
            f"{NET_WORTH_HEADER_SCAN_COLS} columns — account columns may be truncated"
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
            if len(text) > 80:
                issues.error(f"{cell_ref('Spending', 1, column)}: category name too long (max 80)")
                continue
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
            if first.strip() == "Average":
                continue  # the sheet's computed summary row
            issues.error(f"{cell_ref('Spending', rnum, 1)}: expected a month date, got {first!r}")
            continue
        if not isinstance(first, datetime.date):  # covers datetime too (subclass)
            continue  # numeric-year rollup row
        month = to_date_strict(first, ctx=cell_ref("Spending", rnum, 1), issues=issues)
        if month is None:
            continue
        month = first_of_month(month, ctx=cell_ref("Spending", rnum, 1), issues=issues)
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


BRACKET_SECTIONS = {
    "FEDERAL INCOME TAX INFO": "federal",
    "STATE INCOME TAX INFO": "state",
    "MEDICARE TAX INFO": "medicare",
    "SOCIAL SECURITY TAX INFO": "social_security",
    "DISABILITY TAX INFO": "disability",
    "CAPITAL GAINS TAX INFO": "capital_gains",
}
STATE_SPECIAL_INPUTS = {
    "Standard/Itemized Deductions": "state_standard_deduction",
    "Exemption Credits": "state_exemption_credits",
}
FEDERAL_DERIVED_ROW = "Standard/Itemized Deductions"  # computed max(std, itemized) — skipped
BRACKET_ROW_RE = re.compile(r"^Bracket (\d+) (Rate|Threshold)$")


@dataclasses.dataclass
class ParsedTaxInput:
    year: int
    key: str
    value: Decimal


@dataclasses.dataclass
class ParsedBracket:
    year: int
    jurisdiction: str
    bracket_index: int
    rate: Decimal
    threshold: Decimal


@dataclasses.dataclass
class ParsedTaxes:
    inputs: list[ParsedTaxInput]
    brackets: list[ParsedBracket]
    issues: CellIssues


def parse_taxes(ws) -> ParsedTaxes:
    issues = CellIssues()
    rows = list(ws.iter_rows(min_row=1, max_row=300, max_col=20, values_only=True))

    year_columns: list[tuple[int, int]] = []  # (0-based index, year)
    for index, cell in enumerate(rows[0]):
        if index >= 2 and isinstance(cell, int | float) and not isinstance(cell, bool):
            year_columns.append((index, int(cell)))

    if not year_columns:
        issues.error("Taxes!r1: no year columns found — years must be numeric cells")
        return ParsedTaxes(inputs=[], brackets=[], issues=issues)

    def collect(row_values, rnum: int, quantum, max_int_digits: int) -> dict[int, Decimal]:
        values: dict[int, Decimal] = {}
        for col_index, year in year_columns:
            cell = row_values[col_index] if col_index < len(row_values) else None
            value = to_decimal(
                cell,
                quantum,
                max_int_digits,
                ctx=cell_ref("Taxes", rnum, col_index + 1),
                issues=issues,
            )
            if value is not None:
                values[year] = value
        return values

    inputs: list[ParsedTaxInput] = []
    cursor = 1  # 0-based index into rows; row 2 of the sheet
    for section_header, sequence in SHEET_TAX_INPUT_SEQUENCE:
        for position, (label, key) in enumerate(sequence):
            if cursor >= len(rows):
                issues.error(f"Taxes: sheet ended before label {label!r}")
                return ParsedTaxes(inputs=[], brackets=[], issues=issues)
            row = rows[cursor]
            found_label = _text(row[1])
            if position == 0 and _text(row[0]) != section_header:
                issues.error(
                    f"{cell_ref('Taxes', cursor + 1, 1)}: expected section "
                    f"{section_header!r}, found {_text(row[0])!r} — sheet layout changed; "
                    "aborting Taxes parse"
                )
                return ParsedTaxes(inputs=[], brackets=[], issues=issues)
            if found_label != label:
                issues.error(
                    f"{cell_ref('Taxes', cursor + 1, 2)}: expected label {label!r}, "
                    f"found {found_label!r} — sheet layout changed; aborting Taxes parse"
                )
                return ParsedTaxes(inputs=[], brackets=[], issues=issues)
            for year, value in collect(row, cursor + 1, Q4, 10).items():
                inputs.append(ParsedTaxInput(year=year, key=key, value=value))
            cursor += 1

    brackets: list[ParsedBracket] = []
    pending: dict[tuple[str, int], dict[str, tuple[dict[int, Decimal], int]]] = {}
    jurisdiction: str | None = None
    seen_jurisdictions: set[str] = set()
    while cursor < len(rows):
        row = rows[cursor]
        header = _text(row[0])
        label = _text(row[1])
        if header is not None:
            if header not in BRACKET_SECTIONS:
                break  # computed output sections begin (FEDERAL INCOME TAX, ...)
            jurisdiction = BRACKET_SECTIONS[header]
            seen_jurisdictions.add(jurisdiction)
        if jurisdiction is None or label is None:
            cursor += 1
            continue
        if jurisdiction == "federal" and label == FEDERAL_DERIVED_ROW:
            cursor += 1
            continue
        if jurisdiction == "state" and label in STATE_SPECIAL_INPUTS:
            for year, value in collect(row, cursor + 1, Q4, 10).items():
                inputs.append(
                    ParsedTaxInput(year=year, key=STATE_SPECIAL_INPUTS[label], value=value)
                )
            cursor += 1
            continue
        match = BRACKET_ROW_RE.match(label)
        if match is None:
            issues.error(
                f"{cell_ref('Taxes', cursor + 1, 2)}: unexpected row {label!r} in "
                f"{jurisdiction} bracket section"
            )
            cursor += 1
            continue
        bracket_index = int(match.group(1))
        kind = match.group(2)
        if kind == "Rate":
            values = collect(row, cursor + 1, Q4, 3)
            for rate in values.values():
                if rate > 1:
                    issues.warn(
                        f"{cell_ref('Taxes', cursor + 1, 1)}: {jurisdiction} bracket "
                        f"{bracket_index} rate {rate} looks like a percentage, not a fraction"
                    )
                elif rate < 0:
                    issues.warn(
                        f"{cell_ref('Taxes', cursor + 1, 1)}: {jurisdiction} bracket "
                        f"{bracket_index} rate {rate} is negative"
                    )
        else:
            values = collect(row, cursor + 1, Q2, 10)
        slot = pending.setdefault((jurisdiction, bracket_index), {})
        if kind in slot:
            issues.error(
                f"{cell_ref('Taxes', cursor + 1, 2)}: duplicate '{label}' row in "
                f"{jurisdiction} section"
            )
        else:
            slot[kind] = (values, cursor + 1)
        cursor += 1

    missing_sections = set(BRACKET_SECTIONS.values()) - seen_jurisdictions
    if missing_sections:
        issues.error(
            "Taxes: bracket section(s) never found: "
            + ", ".join(sorted(missing_sections))
            + " — section header renamed or deleted? All six must be present"
        )

    for (jur, index), parts in pending.items():
        rates, rate_row = parts.get("Rate", ({}, 0))
        thresholds, threshold_row = parts.get("Threshold", ({}, 0))
        for year in sorted(set(rates) | set(thresholds)):
            if year in rates and year in thresholds:
                brackets.append(
                    ParsedBracket(
                        year=year,
                        jurisdiction=jur,
                        bracket_index=index,
                        rate=rates[year],
                        threshold=thresholds[year],
                    )
                )
            else:
                missing = "Threshold" if year in rates else "Rate"
                present_row = rate_row if year in rates else threshold_row
                issues.error(
                    f"Taxes!r{present_row}: {jur} bracket {index} year {year} "
                    f"is missing its {missing} value"
                )
    return ParsedTaxes(inputs=inputs, brackets=brackets, issues=issues)


@dataclasses.dataclass
class ParsedEsppLot:
    purchase_date: datetime.date
    qualifying_date: datetime.date
    shares: Decimal
    subscription_price: Decimal
    purchase_fmv: Decimal
    purchase_price: Decimal
    sold_date: datetime.date | None = None
    sold_price: Decimal | None = None


@dataclasses.dataclass
class ParsedEsppPeriod:
    label: str
    period_start: datetime.date
    period_end: datetime.date
    semi_annual_base: Decimal
    additional_payments: Decimal
    contribution_pct: Decimal


@dataclasses.dataclass
class ParsedEspp:
    lots: list[ParsedEsppLot]
    periods: list[ParsedEsppPeriod]
    issues: CellIssues


ESPP_MODELER_LABELS = {
    "Semi-Annual Base Salary": "base",
    "Additional payments (i.e. bonuses)": "additional",
    "ESPP Contribution Percentage": "pct",
}


def parse_espp(ws) -> ParsedEspp:
    issues = CellIssues()
    rows = list(ws.iter_rows(min_row=1, max_row=80, max_col=14, values_only=True))

    lots: list[ParsedEsppLot] = []
    template_dates: list[datetime.date] = []
    seen_purchases: set[datetime.date] = set()
    for index, row in enumerate(rows[2:], start=3):  # lots table data starts sheet r3
        purchase_raw = row[8] if len(row) > 8 else None
        if purchase_raw is None:
            continue  # modeler-only row (columns B-E) or gap
        purchase = to_date_strict(purchase_raw, ctx=cell_ref("ESPP", index, 9), issues=issues)
        if purchase is None:
            continue
        shares_raw = row[10] if len(row) > 10 else None
        if shares_raw is None:
            template_dates.append(purchase)  # future purchase-date template row
            continue
        if purchase in seen_purchases:
            issues.error(f"{cell_ref('ESPP', index, 9)}: duplicate lot {purchase.isoformat()}")
            continue
        qualifying = to_date_strict(row[9], ctx=cell_ref("ESPP", index, 10), issues=issues)
        shares = to_decimal(shares_raw, Q4, 8, ctx=cell_ref("ESPP", index, 11), issues=issues)
        subscription = to_decimal(row[11], Q5, 9, ctx=cell_ref("ESPP", index, 12), issues=issues)
        fmv = to_decimal(row[12], Q5, 9, ctx=cell_ref("ESPP", index, 13), issues=issues)
        price = to_decimal(row[13], Q5, 9, ctx=cell_ref("ESPP", index, 14), issues=issues)
        if None in (qualifying, shares, subscription, fmv, price):
            issues.error(
                f"{cell_ref('ESPP', index, 9)}: lot {purchase.isoformat()} is missing "
                "qualifying date, shares or one of its prices"
            )
            continue
        seen_purchases.add(purchase)
        lots.append(
            ParsedEsppLot(
                purchase_date=purchase,
                qualifying_date=qualifying,
                shares=shares,
                subscription_price=subscription,
                purchase_fmv=fmv,
                purchase_price=price,
            )
        )

    modeler: dict[str, tuple[Decimal | None, Decimal | None]] = {}
    calculator_present = False
    for index, row in enumerate(rows, start=1):
        label = _text(row[1] if len(row) > 1 else None)
        if label is None:
            continue
        if label == "ESPP Taxation Calculator":
            calculator_present = True
        field = ESPP_MODELER_LABELS.get(label)
        if field is not None:
            quantum, digits = (Q9, 1) if field == "pct" else (Q2, 10)
            feb = to_decimal(row[2], quantum, digits, ctx=cell_ref("ESPP", index, 3), issues=issues)
            aug = to_decimal(row[3], quantum, digits, ctx=cell_ref("ESPP", index, 4), issues=issues)
            if field == "pct":
                for pct_column, pct in ((3, feb), (4, aug)):
                    if pct is not None and pct > 1:
                        issues.warn(
                            f"{cell_ref('ESPP', index, pct_column)}: contribution pct "
                            f"{pct} looks like a percentage, not a fraction"
                        )
            modeler[field] = (feb, aug)

    periods: list[ParsedEsppPeriod] = []
    next_feb = min(
        (d for d in template_dates if d.month == 2 and d not in seen_purchases), default=None
    )
    next_aug = min(
        (d for d in template_dates if d.month == 8 and d not in seen_purchases), default=None
    )
    have_values = all(field in modeler for field in ("base", "pct"))
    if next_feb and next_aug and have_values:
        additional = modeler.get("additional", (None, None))
        for column, (label, start, end) in enumerate(
            [
                (
                    f"February {next_feb.year} Purchase",
                    datetime.date(next_feb.year - 1, 9, 1),
                    next_feb,
                ),
                (f"August {next_aug.year} Purchase", datetime.date(next_aug.year, 3, 1), next_aug),
            ]
        ):
            base = modeler["base"][column]
            pct = modeler["pct"][column]
            if base is None or pct is None:
                issues.warn(f"ESPP: modeler column for {label!r} incomplete — period skipped")
                continue
            periods.append(
                ParsedEsppPeriod(
                    label=label,
                    period_start=start,
                    period_end=end,
                    semi_annual_base=base,
                    additional_payments=additional[column] or Decimal("0.00"),
                    contribution_pct=pct,
                )
            )
        if periods:
            issues.warn(
                "ESPP: period labels and start/end dates derived from the purchase-date "
                "template (the sheet stores none) — edit in the UI once Plan 5 lands"
            )
    else:
        issues.warn(
            "ESPP: modeler values or future purchase-date template rows missing — "
            "espp_periods not imported"
        )
    if calculator_present:
        issues.warn(
            "ESPP: 'ESPP Taxation Calculator' block ignored — it is a hypothetical what-if "
            "(Positions still holds all lot shares; every Taxes ESPP Sale Component is 0), "
            "so no sold_date/sold_price are imported"
        )
    return ParsedEspp(lots=lots, periods=periods, issues=issues)


@dataclasses.dataclass
class ParsedPaycheckProfile:
    annual_salary: Decimal
    trad_401k_pct: Decimal
    roth_401k_pct: Decimal
    after_tax_401k_pct: Decimal
    espp_pct: Decimal
    withholding_pct: Decimal
    dental_vision_per_check: Decimal
    hsa_per_check: Decimal


@dataclasses.dataclass
class ParsedPaycheck:
    profile: ParsedPaycheckProfile | None
    issues: CellIssues


PAYCHECK_AMOUNT_LABELS = {"Annual Salary", "Gross Paycheck", "Dental & Vision", "HSA"}
PAYCHECK_PCT_LABELS = {
    "Traditional 401(k) %": "trad_401k_pct",
    "Roth 401(k) %": "roth_401k_pct",
    "AT 401(k) %": "after_tax_401k_pct",
    "Tax Withholding %": "withholding_pct",
    "ESPP %": "espp_pct",
}
SEMI_MONTHLY_PERIODS = 24


def parse_paycheck(ws) -> ParsedPaycheck:
    issues = CellIssues()
    amounts: dict[str, Decimal] = {}
    percentages: dict[str, Decimal] = {}
    for rnum, row in _iter_rows(ws, min_row=2, max_col=6, max_row=40):
        left_label = _text(row[1])
        if left_label in PAYCHECK_AMOUNT_LABELS:
            digits = 10 if left_label in ("Annual Salary", "Gross Paycheck") else 6
            value = to_decimal(
                row[2], Q2, digits, ctx=cell_ref("Paycheck Modeler", rnum, 3), issues=issues
            )
            if value is not None:
                amounts[left_label] = value
        right_label = _text(row[4])
        if right_label in PAYCHECK_PCT_LABELS:
            value = to_decimal(
                row[5], Q9, 1, ctx=cell_ref("Paycheck Modeler", rnum, 6), issues=issues
            )
            if value is not None and value > 1:
                issues.warn(
                    f"{cell_ref('Paycheck Modeler', rnum, 6)}: {right_label} value "
                    f"{value} looks like a percentage, not a fraction"
                )
            if value is not None:
                percentages[PAYCHECK_PCT_LABELS[right_label]] = value

    salary = amounts.get("Annual Salary")
    if salary is None:
        issues.warn("Paycheck Modeler: 'Annual Salary' not found — profile not imported")
        return ParsedPaycheck(profile=None, issues=issues)
    gross = amounts.get("Gross Paycheck")
    if gross is not None and abs(salary / SEMI_MONTHLY_PERIODS - gross) >= Decimal("0.01"):
        issues.warn(
            f"Paycheck Modeler: Gross Paycheck {gross} != Annual Salary / 24 "
            f"({salary / SEMI_MONTHLY_PERIODS:.2f}) — check pay_periods_per_year after import"
        )
    missing = [k for k in PAYCHECK_PCT_LABELS.values() if k not in percentages]
    for key in missing:
        issues.warn(f"Paycheck Modeler: {key} not found — defaulting to 0")
    zero_pct = Decimal("0.000000000")
    return ParsedPaycheck(
        profile=ParsedPaycheckProfile(
            annual_salary=salary,
            trad_401k_pct=percentages.get("trad_401k_pct", zero_pct),
            roth_401k_pct=percentages.get("roth_401k_pct", zero_pct),
            after_tax_401k_pct=percentages.get("after_tax_401k_pct", zero_pct),
            espp_pct=percentages.get("espp_pct", zero_pct),
            withholding_pct=percentages.get("withholding_pct", zero_pct),
            dental_vision_per_check=amounts.get("Dental & Vision", Decimal("0.00")),
            hsa_per_check=amounts.get("HSA", Decimal("0.00")),
        ),
        issues=issues,
    )


@dataclasses.dataclass
class ParsedCompEvent:
    focal_year: int
    current_base: Decimal
    new_base: Decimal | None
    unvested_rsus: Decimal | None
    unvested_price: Decimal | None
    refresh_rsus: Decimal | None
    grant_price: Decimal | None


@dataclasses.dataclass
class ParsedFocalHistory:
    events: list[ParsedCompEvent]
    issues: CellIssues


def parse_focal_history(ws) -> ParsedFocalHistory:
    issues = CellIssues()
    events: list[ParsedCompEvent] = []
    seen_years: set[int] = set()
    for rnum, row in _iter_rows(ws, min_row=3, max_col=11, max_row=200):
        year_raw = row[1]
        if year_raw is None:
            break
        if isinstance(year_raw, bool) or not isinstance(year_raw, int | float):
            issues.error(f"{cell_ref('Focal History', rnum, 2)}: expected a year")
            continue
        year = int(year_raw)
        current_base = to_decimal(
            row[2], Q2, 10, ctx=cell_ref("Focal History", rnum, 3), issues=issues
        )
        if current_base is None:
            continue  # year-only template row
        if year in seen_years:
            issues.error(f"{cell_ref('Focal History', rnum, 2)}: duplicate focal year {year}")
            continue
        seen_years.add(year)
        ref = cell_ref("Focal History", rnum, 2)
        events.append(
            ParsedCompEvent(
                focal_year=year,
                current_base=current_base,
                new_base=to_decimal(row[3], Q2, 10, ctx=ref, issues=issues),
                unvested_rsus=to_decimal(row[6], Q4, 8, ctx=ref, issues=issues),
                unvested_price=to_decimal(row[7], Q4, 10, ctx=ref, issues=issues),
                refresh_rsus=to_decimal(row[9], Q4, 8, ctx=ref, issues=issues),
                grant_price=to_decimal(row[10], Q4, 10, ctx=ref, issues=issues),
            )
        )
    return ParsedFocalHistory(events=events, issues=issues)


@dataclasses.dataclass
class ParsedValuePoint:
    snapshot_date: datetime.date
    market_value: Decimal
    cost_basis: Decimal
    sp500_value: Decimal


@dataclasses.dataclass
class ParsedPortfolio:
    history: list[ParsedValuePoint]
    issues: CellIssues


def parse_portfolio(ws) -> ParsedPortfolio:
    """Two independent scans of one sheet: the ticker table (warn-only dividends check)
    and the hidden value-history region (cols AB..AH, rows 3+ — the series behind the
    'Portfolio Value over Time' chart). History is strict: errors block the apply."""
    issues = CellIssues()
    blanks = 0
    for rnum, row in _iter_rows(ws, min_row=2, max_col=16, max_row=200):
        if all(v is None for v in row):
            blanks += 1
            if blanks >= BLANK_STREAK_STOP:
                break
            continue
        blanks = 0
        ticker = _text(row[1])
        if ticker is None:
            continue  # totals row
        dividends = to_decimal(row[15], Q2, 10, ctx=cell_ref("Portfolio", rnum, 16), issues=issues)
        if dividends:
            issues.warn(
                f"Portfolio: {ticker} has Dividends Collected {dividends} — NOT imported "
                "(sheet has no payment dates); enter via the UI in Plan 4"
            )

    history: list[ParsedValuePoint] = []
    prev_date: datetime.date | None = None
    blanks = 0
    # The chart's ranges are padded to row 2153, so the region outruns ROW_CAP; 6000 is
    # comfortably above the padding while still bounded (unsized-worksheet law).
    for rnum, row in _iter_rows(ws, min_row=3, min_col=28, max_col=34, max_row=6000):
        if all(v is None for v in row):
            blanks += 1
            if blanks >= BLANK_STREAK_STOP:
                break
            continue
        blanks = 0
        snapshot_date = to_date_strict(row[0], ctx=cell_ref("Portfolio", rnum, 28), issues=issues)
        if snapshot_date is None:
            if row[0] is None:
                issues.error(
                    f"{cell_ref('Portfolio', rnum, 28)}: value-history row has values but no date"
                )
            continue  # non-date cell: to_date_strict already recorded the error
        if prev_date is not None and snapshot_date <= prev_date:
            issues.error(
                f"{cell_ref('Portfolio', rnum, 28)}: value-history date "
                f"{snapshot_date.isoformat()} is not after the previous row "
                f"({prev_date.isoformat()})"
            )
            continue
        prev_date = snapshot_date
        values: dict[int, Decimal] = {}
        for label, col in (("market value", 29), ("S&P 500 baseline", 31), ("cost basis", 33)):
            before = len(issues.errors)
            parsed_value = to_decimal(
                row[col - 28], Q2, 12, ctx=cell_ref("Portfolio", rnum, col), issues=issues
            )
            if parsed_value is None:
                if len(issues.errors) == before:
                    # to_decimal is silent on blank/error-string cells; a hole in a dated
                    # history row is an error here (strict region, unlike the ticker table).
                    issues.error(
                        f"{cell_ref('Portfolio', rnum, col)}: value-history {label} is missing"
                    )
                values.clear()
                break
            values[col] = parsed_value
        if not values:
            continue
        history.append(
            ParsedValuePoint(
                snapshot_date=snapshot_date,
                market_value=values[29],
                sp500_value=values[31],
                cost_basis=values[33],
            )
        )
    if not history:
        issues.warn(
            "Portfolio: no value-history rows found (columns AB+) — the performance chart "
            "stays empty until a workbook carrying the series is imported"
        )
    return ParsedPortfolio(history=history, issues=issues)
