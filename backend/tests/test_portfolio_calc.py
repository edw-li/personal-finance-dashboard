from datetime import UTC, date, datetime
from decimal import Decimal

from app.models import DividendPayment, LatestPrice, PositionTransaction, PriceHistory, Security
from app.services.portfolio_calc import allocation, build_holdings, fold_transactions

D = Decimal


def txn(
    id,
    sec=1,
    account="Acct",
    type="buy",
    shares="1",
    price="10",
    fees=None,
    split_factor=None,
    sort_index=0,
    txn_date=None,
):
    return PositionTransaction(
        id=id,
        security_id=sec,
        account=account,
        type=type,
        shares=D(shares),
        price=D(price),
        fees=None if fees is None else D(fees),
        split_factor=None if split_factor is None else D(split_factor),
        sort_index=sort_index,
        txn_date=txn_date,
        source="ui",
    )


def sec(id, ticker, industry="Tech", holding_type="stock", annual_dividend=None):
    return Security(
        id=id,
        ticker=ticker,
        name=f"{ticker} Inc",
        industry=industry,
        holding_type=holding_type,
        is_manual_priced=False,
        is_active=True,
        annual_dividend=None if annual_dividend is None else D(annual_dividend),
    )


def lp(sec_id, price, day=14):
    return LatestPrice(
        security_id=sec_id,
        price=D(price),
        quoted_at=datetime(2026, 8, day, tzinfo=UTC),
        source="yfinance",
    )


class TestFolding:
    def test_buys_accumulate_shares_and_cost_with_fees(self):
        positions = fold_transactions(
            [
                txn(1, shares="10", price="100", fees="1", sort_index=10),
                txn(2, shares="5", price="130", sort_index=20),
            ]
        )
        pos = positions[(1, "Acct")]
        assert pos.shares == D("15")
        assert pos.cost_basis == D("1651")  # 10*100+1 + 5*130
        assert pos.realized_gl == 0

    def test_sell_realizes_at_average_cost(self):
        positions = fold_transactions(
            [
                txn(1, shares="10", price="100", sort_index=10),
                txn(2, type="sell", shares="4", price="150", fees="2", sort_index=20),
            ]
        )
        pos = positions[(1, "Acct")]
        assert pos.shares == D("6")
        assert pos.realized_gl == D("198")  # 4*(150-100) - 2
        assert pos.cost_basis == D("600")
        assert pos.warnings == []

    def test_split_multiplies_shares_only(self):
        positions = fold_transactions(
            [
                txn(1, shares="10", price="100", sort_index=10),
                txn(2, type="split", shares="0", price="0", split_factor="3", sort_index=20),
            ]
        )
        pos = positions[(1, "Acct")]
        assert pos.shares == D("30")
        assert pos.cost_basis == D("1000")

    def test_fold_order_is_sort_index_then_id_not_input_order(self):
        # ids ANTI-correlated with sort_index: sorting by id (or input order) would
        # fold the sell first and warn — only (sort_index, id) folds clean.
        positions = fold_transactions(
            [
                txn(1, type="sell", shares="5", price="20", sort_index=20),
                txn(2, shares="10", price="10", sort_index=10),
            ]
        )
        pos = positions[(1, "Acct")]
        assert pos.realized_gl == D("50")
        assert pos.warnings == []

    def test_fold_ties_on_sort_index_break_by_id(self):
        # The accepted UI/import sort_index collision: lower id folds first.
        positions = fold_transactions(
            [
                txn(2, type="sell", shares="5", price="20", sort_index=10),
                txn(1, shares="10", price="10", sort_index=10),
            ]
        )
        pos = positions[(1, "Acct")]
        assert pos.realized_gl == D("50")
        assert pos.warnings == []

    def test_partial_oversell_resets_basis_and_warns_exceeds(self):
        positions = fold_transactions(
            [
                txn(1, shares="10", price="100", sort_index=10),
                txn(2, type="sell", shares="15", price="150", sort_index=20),
            ]
        )
        pos = positions[(1, "Acct")]
        assert pos.shares == D("-5")
        assert pos.cost_basis == 0  # liquidation floor — a live row must never go negative
        assert pos.realized_gl == D("750")  # 15*(150-100)
        assert any("exceeds held shares" in w for w in pos.warnings)

    def test_dated_sell_flow_is_positive_net_of_fees(self):
        positions = fold_transactions(
            [
                txn(1, shares="10", price="100", sort_index=10, txn_date=date(2025, 1, 1)),
                txn(
                    2,
                    type="sell",
                    shares="4",
                    price="150",
                    fees="2",
                    sort_index=20,
                    txn_date=date(2025, 6, 1),
                ),
            ]
        )
        pos = positions[(1, "Acct")]
        assert pos.dated_flows == [
            (date(2025, 1, 1), D("-1000")),
            (date(2025, 6, 1), D("598")),
        ]

    def test_oversell_and_orphan_sell_warn_but_never_raise(self):
        positions = fold_transactions(
            [
                txn(1, type="sell", shares="5", price="10", sort_index=10),
            ]
        )
        pos = positions[(1, "Acct")]
        assert pos.shares == D("-5")
        assert pos.cost_basis == 0
        assert any("no held shares" in w for w in pos.warnings)

    def test_invalid_split_factor_warns_and_skips(self):
        positions = fold_transactions(
            [
                txn(1, shares="10", price="10", sort_index=10),
                txn(2, type="split", shares="0", price="0", split_factor=None, sort_index=20),
            ]
        )
        pos = positions[(1, "Acct")]
        assert pos.shares == D("10")
        assert any("split" in w for w in pos.warnings)

    def test_accounts_fold_separately_and_dateless_flag(self):
        positions = fold_transactions(
            [
                txn(
                    1, account="A", shares="1", price="10", sort_index=10, txn_date=date(2026, 1, 2)
                ),
                txn(2, account="B", shares="2", price="10", sort_index=20),
            ]
        )
        assert positions[(1, "A")].has_dateless_txn is False
        assert positions[(1, "B")].has_dateless_txn is True
        assert positions[(1, "A")].dated_flows == [(date(2026, 1, 2), D("-10"))]


class TestHoldings:
    def _one_holding(self, **overrides):
        securities = {
            1: sec(
                1,
                "VOO",
                holding_type="etf",
                annual_dividend=overrides.pop("annual_dividend", "6.5"),
            )
        }
        positions = fold_transactions(
            [
                txn(
                    1,
                    shares="10",
                    price="400",
                    sort_index=10,
                    txn_date=overrides.pop("txn_date", None),
                ),
            ]
        )
        latest = {1: lp(1, "500")}
        history = {
            1: [
                PriceHistory(security_id=1, price_date=date(2026, 8, 13), close=D("490")),
                PriceHistory(security_id=1, price_date=date(2026, 8, 14), close=D("500")),
            ]
        }
        dividends = overrides.pop("dividends", [])
        return build_holdings(
            positions, securities, latest, history, dividends, today=date(2026, 8, 14)
        )

    def test_market_value_unrealized_and_day_change(self):
        (h,) = self._one_holding()
        assert h.market_value == D("5000.00")
        assert h.cost_basis == D("4000.00")
        assert h.unrealized_gl == D("1000.00")
        assert h.unrealized_gl_pct == D("0.250000")
        assert h.day_change_pct == D("0.020408")  # (500-490)/490
        assert h.day_change_amount == D("100.00")
        assert h.avg_cost == D("400.0000")

    def test_yield_yoc_and_annual_income(self):
        (h,) = self._one_holding()
        assert h.annual_income == D("65.00")
        assert h.yield_pct == D("0.013000")
        assert h.yoc_pct == D("0.016250")

    def test_xirr_null_when_dateless_and_set_when_dated(self):
        (h,) = self._one_holding()
        assert h.xirr_pct is None  # dateless buy
        (h2,) = self._one_holding(txn_date=date(2025, 8, 14))
        assert h2.xirr_pct is not None
        assert h2.xirr_pct == D("0.250000")  # 4000 -> 5000 in exactly 365 days

    def test_xirr_null_when_any_cash_flow_txn_is_dateless(self):
        # Mid-backfill state: a dated buy plus a dateless buy — dated_flows exist,
        # but the dateless flag must still veto XIRR (spec Risk #1). The dateless leg
        # lives in a DIFFERENT account: any-account dateless-ness must veto the whole
        # security (all() would compute a wrong XIRR from one account's flows).
        securities = {1: sec(1, "VOO")}
        positions = fold_transactions(
            [
                txn(1, shares="10", price="400", sort_index=10, txn_date=date(2025, 8, 14)),
                txn(2, account="Schwab", shares="1", price="400", sort_index=20),
            ]
        )
        (h,) = build_holdings(
            positions, securities, {1: lp(1, "500")}, {}, [], today=date(2026, 8, 14)
        )
        assert h.xirr_pct is None

    def test_multi_account_positions_collapse_to_one_holding(self):
        securities = {1: sec(1, "VOO")}
        positions = fold_transactions(
            [
                # Schwab folds FIRST (lower sort_index) so the sorted-accounts
                # assertion pins sorting, not fold order.
                txn(1, account="Robinhood", shares="10", price="400", sort_index=20),
                txn(2, account="Schwab", shares="5", price="440", sort_index=10),
            ]
        )
        (h,) = build_holdings(
            positions, securities, {1: lp(1, "500")}, {}, [], today=date(2026, 8, 14)
        )
        assert h.shares == D("15.000000")
        assert h.cost_basis == D("6200.00")
        assert h.accounts == ["Robinhood", "Schwab"]

    def test_money_quantization_rounds_half_up(self):
        # 1 share x $0.1250 -> $0.13 (HALF_EVEN/DOWN would give $0.12) — pins the
        # Global rules rounding mode at the cost-basis quantize.
        securities = {1: sec(1, "PENNY")}
        positions = fold_transactions([txn(1, shares="1", price="0.1250", sort_index=10)])
        (h,) = build_holdings(
            positions, securities, {1: lp(1, "0.1250")}, {}, [], today=date(2026, 8, 14)
        )
        assert h.cost_basis == D("0.13")

    def test_shares_quantize_to_6dp_half_up(self):
        positions = fold_transactions(
            [
                txn(1, shares="1.0000005", price="10", sort_index=10),
            ]
        )
        securities = {1: sec(1, "FRAC")}
        (h,) = build_holdings(
            positions, securities, {1: lp(1, "10")}, {}, [], today=date(2026, 8, 14)
        )
        assert h.shares == D("1.000001")

    def test_dividends_collected_feeds_xirr_flows(self):
        div = DividendPayment(
            id=1, security_id=1, account="Acct", pay_date=date(2026, 2, 1), amount=D("30")
        )
        (h,) = self._one_holding(txn_date=date(2025, 8, 14), dividends=[div])
        assert h.dividends_collected == D("30.00")
        assert h.xirr_pct is not None and h.xirr_pct > D("0.250000")

    def test_priceless_security_yields_null_money_fields(self):
        securities = {1: sec(1, "ZI")}
        positions = fold_transactions([txn(1, shares="2", price="10", sort_index=10)])
        (h,) = build_holdings(positions, securities, {}, {}, [], today=date(2026, 8, 14))
        assert h.market_value is None and h.unrealized_gl is None
        assert h.day_change_pct is None and h.xirr_pct is None
        assert h.cost_basis == D("20.00")

    def test_zero_share_positions_are_excluded(self):
        securities = {1: sec(1, "VOO")}
        positions = fold_transactions(
            [
                txn(1, shares="10", price="400", sort_index=10),
                txn(2, type="sell", shares="10", price="450", sort_index=20),
            ]
        )
        holdings = build_holdings(
            positions, securities, {1: lp(1, "500")}, {}, [], today=date(2026, 8, 14)
        )
        assert holdings == []

    def test_holdings_sorted_by_market_value_desc(self):
        securities = {1: sec(1, "AAA"), 2: sec(2, "BBB")}
        positions = fold_transactions(
            [
                txn(1, sec=1, shares="1", price="10", sort_index=10),
                txn(2, sec=2, shares="100", price="10", sort_index=20),
            ]
        )
        holdings = build_holdings(
            positions, securities, {1: lp(1, "10"), 2: lp(2, "10")}, {}, [], today=date(2026, 8, 14)
        )
        assert [h.security.ticker for h in holdings] == ["BBB", "AAA"]


class TestAllocation:
    def _fixture(self):
        securities = {
            1: sec(1, "VOO", industry="ETF", holding_type="etf"),
            2: sec(2, "NVDA", industry="Semis", holding_type="stock"),
            3: sec(3, "MYST", industry=None, holding_type="stock"),
        }
        positions = fold_transactions(
            [
                txn(1, sec=1, account="Robinhood", shares="1", price="1", sort_index=10),
                txn(2, sec=2, account="Schwab", shares="2", price="1", sort_index=20),
                txn(3, sec=2, account="Robinhood", shares="1", price="1", sort_index=30),
                txn(4, sec=3, account="Schwab", shares="1", price="1", sort_index=40),
            ]
        )
        latest = {1: lp(1, "100"), 2: lp(2, "200"), 3: lp(3, "50")}
        return positions, securities, latest

    def test_allocation_by_type_and_industry(self):
        positions, securities, latest = self._fixture()
        by_type = allocation(positions, securities, latest, "type")
        assert by_type == [("stock", D("650.00"), 2), ("etf", D("100.00"), 1)]
        by_industry = allocation(positions, securities, latest, "industry")
        assert by_industry[0] == ("Semis", D("600.00"), 1)
        assert ("Uncategorized", D("50.00"), 1) in by_industry

    def test_allocation_by_account_uses_position_grain(self):
        positions, securities, latest = self._fixture()
        by_account = allocation(positions, securities, latest, "account")
        assert by_account == [("Schwab", D("450.00"), 2), ("Robinhood", D("300.00"), 2)]
