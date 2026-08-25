"""Provider tests NEVER touch the network: a fake `yfinance` module is injected into
sys.modules before fetch_daily's lazy import runs."""

import sys
from datetime import date
from decimal import Decimal
from types import SimpleNamespace

from app.services.price_provider import DailyBar, YFinanceProvider, build_session, yahoo_symbol


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


def test_fetch_daily_rounds_ties_half_up(monkeypatch):
    frame = FakeFrame(
        [
            (_ts(date(2026, 8, 14)), FakeRow({"Close": 1.00005, "Dividends": 0.00005})),
        ]
    )
    monkeypatch.setitem(sys.modules, "yfinance", _fake_yf(frame, {}))
    provider = YFinanceProvider.__new__(YFinanceProvider)
    provider._session = None
    (bar,) = provider.fetch_daily("NVDA", date(2026, 8, 1))
    assert bar.close == Decimal("1.0001")  # banker's rounding would give 1.0000
    assert bar.dividend == Decimal("0.0001")


def test_fetch_daily_skips_absurd_bars_and_zeroes_bad_dividends(monkeypatch):
    frame = FakeFrame(
        [
            (_ts(date(2026, 8, 11)), FakeRow({"Close": float("inf"), "Dividends": 0.0})),
            (_ts(date(2026, 8, 12)), FakeRow({"Close": 1e25, "Dividends": 0.0})),
            (_ts(date(2026, 8, 13)), FakeRow({"Close": 100.0, "Dividends": float("nan")})),
            (_ts(date(2026, 8, 14)), FakeRow({"Close": 101.0, "Dividends": 0.5})),
        ]
    )
    monkeypatch.setitem(sys.modules, "yfinance", _fake_yf(frame, {}))
    provider = YFinanceProvider.__new__(YFinanceProvider)
    provider._session = None
    bars = provider.fetch_daily("NVDA", date(2026, 8, 1))
    assert bars == [
        DailyBar(bar_date=date(2026, 8, 13), close=Decimal("100.0000"), dividend=Decimal("0.0000")),
        DailyBar(bar_date=date(2026, 8, 14), close=Decimal("101.0000"), dividend=Decimal("0.5000")),
    ]


def test_build_session_normalizes_bundle_and_impersonates(monkeypatch):
    calls = {}

    class FakeSession:
        def __init__(self, impersonate=None, verify=None):
            calls["impersonate"] = impersonate
            calls["verify"] = verify

    fake_requests = SimpleNamespace(Session=FakeSession)
    monkeypatch.setitem(sys.modules, "curl_cffi", SimpleNamespace(requests=fake_requests))
    monkeypatch.setitem(sys.modules, "curl_cffi.requests", fake_requests)
    build_session("   ")
    assert calls == {"impersonate": "chrome", "verify": True}
    build_session("  C:/certs/corp.pem  ")
    assert calls == {"impersonate": "chrome", "verify": "C:/certs/corp.pem"}


def _fake_yf_calendar(calendar_value, seen=None):
    seen = seen if seen is not None else {}

    class FakeTicker:
        def __init__(self, symbol, session=None):
            seen["symbol"] = symbol
            seen["session"] = session
            self.calendar = calendar_value

    return SimpleNamespace(Ticker=FakeTicker)


def test_fetch_next_ex_div_reads_the_forward_calendar(monkeypatch):
    seen = {}
    monkeypatch.setitem(
        sys.modules,
        "yfinance",
        _fake_yf_calendar({"Ex-Dividend Date": date(2026, 9, 3)}, seen),
    )
    provider = YFinanceProvider.__new__(YFinanceProvider)  # skip session build
    provider._session = "SENTINEL"
    assert provider.fetch_next_ex_div("BRK.B") == date(2026, 9, 3)
    assert seen["symbol"] == "BRK-B"  # yahoo_symbol mapping, same as fetch_daily
    assert seen["session"] == "SENTINEL"


def test_fetch_next_ex_div_coerces_timestamp_datetime_and_iso(monkeypatch):
    from datetime import datetime

    provider = YFinanceProvider.__new__(YFinanceProvider)
    provider._session = None
    # pandas Timestamp duck-type: anything with a callable .date().
    stamp = SimpleNamespace(date=lambda: date(2026, 9, 3))
    for value in (stamp, datetime(2026, 9, 3, 12, 30), "2026-09-03"):
        monkeypatch.setitem(sys.modules, "yfinance", _fake_yf_calendar({"Ex-Dividend Date": value}))
        assert provider.fetch_next_ex_div("NVDA") == date(2026, 9, 3), value


def test_fetch_next_ex_div_returns_none_on_missing_or_malformed(monkeypatch):
    provider = YFinanceProvider.__new__(YFinanceProvider)
    provider._session = None
    cases = [
        None,  # no calendar published
        object(),  # not even dict-like (no .get)
        {},  # key absent
        {"Ex-Dividend Date": None},
        {"Ex-Dividend Date": "not a date"},
        {"Ex-Dividend Date": 20260903},  # a number is not an announcement
        {"Ex-Dividend Date": [date(2026, 9, 3)]},  # a list is not an announcement
        {"Ex-Dividend Date": date(1888, 1, 1)},  # absurd year — the century fence
        {"Ex-Dividend Date": date(9999, 12, 31)},
    ]
    for value in cases:
        monkeypatch.setitem(sys.modules, "yfinance", _fake_yf_calendar(value))
        assert provider.fetch_next_ex_div("NVDA") is None, value
