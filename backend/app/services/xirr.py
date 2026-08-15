"""Irregular-cashflow IRR: Newton with bisection fallback (spec §5 portfolio_service).

Pure module — no DB, no HTTP. Floats internally (XIRR is display-only, never stored
money); Decimal at the boundary. Sign convention: money in (buys) negative, money
out/terminal value positive.
"""

from datetime import date
from decimal import Decimal

from app.services.money import quantize_pct

MAX_NEWTON_ITERATIONS = 100
MAX_BISECT_ITERATIONS = 200
# Search domain: -99.99%..+1000% annualized covers any sane personal-portfolio flow.
RATE_LO = -0.9999
RATE_HI = 10.0
# Beyond ~80 years the (1 + RATE_LO)**t discount factor underflows to exactly 0.0
# (ZeroDivisionError) and huge future spans overflow (1 + RATE_HI)**t — a mistyped
# txn_date year must never 500 /holdings. 70 years bounds every real portfolio.
MAX_SPAN_DAYS = 25550


def xnpv(rate: float, flows: list[tuple[date, float]]) -> float:
    """NPV at `rate`. Reference date is flows[0][0] — pass date-sorted, non-empty
    flows (rescaling by the reference date never moves the root)."""
    t0 = flows[0][0]
    return sum(amount / (1.0 + rate) ** ((d - t0).days / 365.0) for d, amount in flows)


def _dxnpv(rate: float, flows: list[tuple[date, float]]) -> float:
    t0 = flows[0][0]
    total = 0.0
    for d, amount in flows:
        t = (d - t0).days / 365.0
        total += -t * amount / (1.0 + rate) ** (t + 1.0)
    return total


def _finish(rate: float) -> Decimal:
    return quantize_pct(Decimal(str(rate)))


def xirr(flows: list[tuple[date, Decimal]]) -> Decimal | None:
    """Annualized IRR of dated flows.

    None when underdetermined, when the span exceeds MAX_SPAN_DAYS, or when NPV does
    not change sign across the search domain (no root there, or an even number of
    them — with sells the sequence can have multiple sign changes and multiple IRRs;
    Newton from 0.1 returns the root nearest a plausible rate, like Excel's
    guess-based XIRR).
    """
    if len(flows) < 2:
        return None
    ordered = sorted(((d, float(a)) for d, a in flows), key=lambda f: f[0])
    if not any(a > 0 for _, a in ordered) or not any(a < 0 for _, a in ordered):
        return None
    if ordered[0][0] == ordered[-1][0]:
        return None
    if (ordered[-1][0] - ordered[0][0]).days > MAX_SPAN_DAYS:
        return None
    tol = sum(abs(a) for _, a in ordered) * 1e-9

    rate = 0.1
    for _ in range(MAX_NEWTON_ITERATIONS):
        f = xnpv(rate, ordered)
        if abs(f) < tol:
            return _finish(rate)
        df = _dxnpv(rate, ordered)
        if df == 0.0:
            break
        nxt = rate - f / df
        if nxt != nxt or nxt <= RATE_LO or nxt > RATE_HI:  # NaN or out of domain
            break
        if abs(nxt - rate) < 1e-12:
            return _finish(nxt)
        rate = nxt

    lo, hi = RATE_LO, RATE_HI
    f_lo, f_hi = xnpv(lo, ordered), xnpv(hi, ordered)
    if f_lo == 0.0:
        return _finish(lo)
    if f_hi == 0.0:
        return _finish(hi)
    if (f_lo > 0) == (f_hi > 0):
        return None
    for _ in range(MAX_BISECT_ITERATIONS):
        mid = (lo + hi) / 2.0
        f_mid = xnpv(mid, ordered)
        if abs(f_mid) < tol or hi - lo < 1e-10:
            return _finish(mid)
        if (f_mid > 0) == (f_lo > 0):
            lo, f_lo = mid, f_mid
        else:
            hi = mid
    return _finish((lo + hi) / 2.0)
