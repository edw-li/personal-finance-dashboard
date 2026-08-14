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
    to_date_lenient,
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
