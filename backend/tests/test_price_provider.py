"""Provider tests NEVER touch the network: a fake `yfinance` module is injected into
sys.modules before fetch_daily's lazy import runs."""

import sys
from datetime import date
from decimal import Decimal
from types import SimpleNamespace

from app.services.price_provider import DailyBar, YFinanceProvider, yahoo_symbol


def test_yahoo_symbol_maps_dots_to_dashes():
    assert yahoo_symbol("BRK.B") == "BRK-B"
    assert yahoo_symbol("NVDA") == "NVDA"


class FakeFrame:
    """Duck-typed pandas frame: .empty and .iterrows() are all fetch_daily uses."""

    def __init__(self, rows):
        self._rows = rows

    @property
    def empty(self):
        return not self._rows

    def iterrows(self):
        return iter(self._rows)


class FakeRow(dict):
    def get(self, key, default=None):
        return super().get(key, default)


def _fake_yf(frame, seen):
    class FakeTicker:
        def __init__(self, symbol, session=None):
            seen["symbol"] = symbol
            seen["session"] = session

        def history(self, **kwargs):
            seen["history_kwargs"] = kwargs
            return frame

    return SimpleNamespace(Ticker=FakeTicker)


def _ts(day):
    return SimpleNamespace(date=lambda d=day: d)


def test_fetch_daily_maps_bars_and_kwargs(monkeypatch):
    seen = {}
    frame = FakeFrame(
        [
            (_ts(date(2026, 8, 13)), FakeRow({"Close": 490.1234567, "Dividends": 0.0})),
            (_ts(date(2026, 8, 14)), FakeRow({"Close": 500.5, "Dividends": 1.75})),
        ]
    )
    monkeypatch.setitem(sys.modules, "yfinance", _fake_yf(frame, seen))
    provider = YFinanceProvider.__new__(YFinanceProvider)  # skip session build
    provider._session = "SENTINEL"
    bars = provider.fetch_daily("BRK.B", date(2026, 8, 1))
    assert seen["symbol"] == "BRK-B"
    assert seen["session"] == "SENTINEL"
    assert seen["history_kwargs"] == {
        "start": "2026-08-01",
        "interval": "1d",
        "auto_adjust": False,
        "actions": True,
    }
    assert bars == [
        DailyBar(bar_date=date(2026, 8, 13), close=Decimal("490.1235"), dividend=Decimal("0.0000")),
        DailyBar(bar_date=date(2026, 8, 14), close=Decimal("500.5000"), dividend=Decimal("1.7500")),
    ]


def test_fetch_daily_skips_nan_and_none_closes(monkeypatch):
    frame = FakeFrame(
        [
            (_ts(date(2026, 8, 12)), FakeRow({"Close": float("nan"), "Dividends": 0.0})),
            (_ts(date(2026, 8, 13)), FakeRow({"Close": None, "Dividends": 0.0})),
            (_ts(date(2026, 8, 14)), FakeRow({"Close": 10.0})),  # Dividends column absent
        ]
    )
    monkeypatch.setitem(sys.modules, "yfinance", _fake_yf(frame, {}))
    provider = YFinanceProvider.__new__(YFinanceProvider)
    provider._session = None
    bars = provider.fetch_daily("NVDA", date(2026, 8, 1))
    assert bars == [
        DailyBar(bar_date=date(2026, 8, 14), close=Decimal("10.0000"), dividend=Decimal("0"))
    ]


def test_fetch_daily_empty_frame_returns_empty(monkeypatch):
    monkeypatch.setitem(sys.modules, "yfinance", _fake_yf(FakeFrame([]), {}))
    provider = YFinanceProvider.__new__(YFinanceProvider)
    provider._session = None
    assert provider.fetch_daily("ZI", date(2026, 8, 1)) == []
