"""THE yfinance touchpoint (spec §5: provider isolated so an alternative can swap in).

Nothing else in the app may import yfinance or curl_cffi, and both are imported lazily
inside functions: tests inject fakes via sys.modules, and app/pytest startup never pays
the pandas import. Verified against yfinance 1.6.0 (plan probes 1-3)."""

import math
from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Protocol

PRICE_QUANTUM = Decimal("0.0001")


def yahoo_symbol(ticker: str) -> str:
    """Yahoo spells class shares with a dash: BRK.B -> BRK-B (probe 3)."""
    return ticker.replace(".", "-")


@dataclass(frozen=True)
class DailyBar:
    bar_date: date
    close: Decimal
    dividend: Decimal


class PriceProvider(Protocol):
    def fetch_daily(self, ticker: str, start: date) -> list[DailyBar]: ...


def build_session(ca_bundle: str | None):
    """curl_cffi session impersonating a browser. `ca_bundle` works around
    TLS-intercepting proxies (dev box); None uses curl_cffi's default trust."""
    from curl_cffi import requests as curl_requests

    # A whitespace-only env value would pass `or True` truthiness and hand curl a
    # bogus CA path — normalize to None first (Task 1 review).
    normalized = ca_bundle.strip() if ca_bundle else None
    return curl_requests.Session(impersonate="chrome", verify=normalized or True)


class YFinanceProvider:
    def __init__(self, ca_bundle: str | None = None):
        self._session = build_session(ca_bundle)

    def fetch_daily(self, ticker: str, start: date) -> list[DailyBar]:
        """Daily bars from `start` through today (Close + dividend events). Raises on
        transport errors (caller isolates per ticker); returns [] when Yahoo has no data."""
        import yfinance as yf

        frame = yf.Ticker(yahoo_symbol(ticker), session=self._session).history(
            start=start.isoformat(), interval="1d", auto_adjust=False, actions=True
        )
        if frame is None or frame.empty:
            return []
        bars: list[DailyBar] = []
        for idx, row in frame.iterrows():
            close = row.get("Close")
            if close is None or (isinstance(close, float) and math.isnan(close)):
                continue
            dividend = row.get("Dividends", 0.0) or 0.0
            bars.append(
                DailyBar(
                    bar_date=idx.date(),
                    close=Decimal(str(float(close))).quantize(
                        PRICE_QUANTUM, rounding=ROUND_HALF_UP
                    ),
                    dividend=Decimal(str(float(dividend))).quantize(
                        PRICE_QUANTUM, rounding=ROUND_HALF_UP
                    ),
                )
            )
        return bars
