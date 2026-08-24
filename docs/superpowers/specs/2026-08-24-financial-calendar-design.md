# Financial Calendar (+ Announced Ex-Dividend Capture) — Design Spec

**Date:** 2026-08-24 · **Status:** approved, not yet implemented
**Touches:** one additive migration (`securities.next_ex_div_date`), `services/price_provider.py` (forward-calendar fetch), `services/price_service.py` (refresh integration), new pure services (`services/business_days.py`, `services/calendar_events.py`), new router (`api/calendar.py`), new `/calendar` page + nav item, Overview "Up next" strip, ICS export (client-side).

## 1. Context & goals

The app computes or stores nearly every date that matters — RSU vest tranches, ESPP purchase/qualifying dates, paydays, ex-dividends, tax deadlines — but surfaces them only inside their own pages, and never forward-looking in one place. One month-grid calendar + an "Up next" strip on Overview + ICS export makes the dashboard the household's financial datebook.

### User-confirmed decisions (2026-08-24 Q&A)

- **Confirmed dates only** — no projected/estimated ex-dividend dates. Instead, the daily refresh learns announced ex-div dates from the provider (§3). Cadence note: the refresh is **already daily on weekdays** (seeded cron `10 13 * * mon-fri`); no cadence change is needed. Weekend-published announcements are picked up Monday — acceptable, ex-dividend dates are trading days.
- Event types: RSU vests, ESPP purchase dates, ESPP qualifying dates, ex-dividend dates, semi-monthly paydays (15th + last day, adjusted around weekends/holidays), plus: ESPP offering starts, estimated-tax/filing deadlines, and the monthly-update-due reminder.

## 2. Why the provider must be extended (verified 2026-08-24)

`securities.ex_div_date` is maintained by `_update_dividend_metadata` from **historical** daily bars (`price_service.py`): it is `max(event dates in the TTM window)` — always a *past* date. The provider's only method, `fetch_daily`, returns history; the pipeline therefore learns an ex-div date **the day it occurs**, never in advance. Without §3, "confirmed upcoming ex-dividends" would be permanently empty.

## 3. Announced ex-dividend capture

### 3.1 Data model — one additive migration

`securities.next_ex_div_date` — `Date, nullable`. A **new column, not an overload**: `ex_div_date` keeps its "most recent past event" semantics and its existing consumers (SecuritiesPanel display, TTM metadata) unchanged. Chain onto the alembic head current at implementation time (README §4.3).

### 3.2 Provider (`price_provider.py`, the sole yfinance touchpoint)

New method on `YFinanceProvider` (+ the `PriceProvider` Protocol): `fetch_next_ex_div(ticker) -> date | None`, reading Yahoo's forward calendar (`yf.Ticker(...).calendar` / quote-summary ex-dividend field; lazy import, shared curl_cffi session, same malformed-data-skipping posture — a non-date or absurd value returns None, never raises past the per-ticker isolation). Fakes in tests inject via `sys.modules` exactly like `fetch_daily`.

**Data honesty (goes in the settings/help copy, not code):** announcement lead time varies — stocks typically 2–6 weeks ahead; ETFs (VOO/SCHD-class) often only days ahead; anything Yahoo hasn't announced simply has no upcoming event. That is the confirmed-only contract working as intended.

### 3.3 Refresh integration (`price_service.py`)

In `refresh_prices`, after `_update_dividend_metadata`, for securities that are **active, auto-priced, and dividend-paying** (`annual_dividend > 0`): call `fetch_next_ex_div`; store the result when it is `>= today`, else NULL. Independently of the fetch (and for skipped securities too): a stored `next_ex_div_date < today` is **cleared** — the event has occurred and the historical bars now own it. Per-ticker failures degrade to "leave the stored value" (last-good posture) and never fail the run; count fetches/failures into the `LAST_REFRESH_KEY` bookkeeping blob. Cost: ≤ ~1 extra HTTP call per dividend payer per run (~15–25 of ~37 tickers) on an already-sequential refresh — accepted at personal scale; rides any future async-refresh work unchanged.

## 4. Business-day service — `services/business_days.py` (new, pure)

No holiday logic exists in the app today (verified; only weekend arithmetic). This module owns it:

- `us_bank_holidays(year) -> set[date]` — the 11 Federal Reserve holidays, computed (fixed dates + nth-weekday rules), with the Fed observation rule: a Sunday holiday observes Monday; a Saturday holiday observes nothing (banks already closed).
- `previous_business_day(d)` / `next_business_day(d)` — step over weekends + holidays; return `d` itself when it qualifies.
- `semi_monthly_paydays(year, month) -> (date, date)` — the 15th and the last day of month, each adjusted **backward** via `previous_business_day` (payroll convention).

Known simplification, stated in a comment: employer holiday calendars differ from Fed holidays; DC Emancipation Day occasionally moves Tax Day. Both are accepted v1 approximations.

## 5. Event composition — `services/calendar_events.py` + `GET /calendar`

New router `api/calendar.py`: `GET /calendar?start=YYYY-MM-DD&end=YYYY-MM-DD` (auth'd like every router; 422 unless `start <= end` and the span ≤ 400 days). Response `{events: [...]}`, each event `{date, type, label, detail | null, href}` sorted by (date, type). Composition is a pure function over loaded inputs (pytest drives it with literals); the router does the loading. GET-never-rejects law: a degradable source (e.g. a bad grant row) drops its events with a logged warning, never a 500.

| type | source | detail / href |
|---|---|---|
| `rsu_vest` | `rsu_vesting.schedule()` per grant, tranches in range | "{n} sh — {grant label}"; `/comp` (unpriced in v1 — /comp prices) |
| `espp_purchase` | `espp_calc.plan_year_rows` stored + derived periods' `period_end` | period label; `/espp` |
| `espp_qualify` | `espp_lots.qualifying_date`, **unsold** lots | "{purchase_date} lot qualifies"; `/espp` |
| `ex_dividend` | `securities.next_ex_div_date` (§3), active holdings | ticker; `/portfolio` |
| `payday` | `business_days.semi_monthly_paydays`, months in range | none; `/paycheck`. **Only when** the latest paycheck profile has `pay_periods_per_year == 24`; other cadences omit paydays (a worded note in the page legend), never guess |
| `offering_start` | `espp_offerings.offering_start` (stored rows only) | subscription price; `/espp` |
| `tax_deadline` | static rules: Apr 15 (filing + Q1), Jun 15 (Q2), Sep 15 (Q3), Jan 15 (Q4), Oct 15 (extension), each adjusted **forward** via `next_business_day` | which payment; `/taxes` |
| `update_due` | first-of-current-month when the previous month lacks a net-worth snapshot; single event, at max(1st, today) | "Enter {month}"; `/update` |

## 6. Frontend

- **`/calendar` page** (new lazy route + nav item, `CalendarDays` icon — also the moment to give ESPP its own icon and end the Banknote duplicate). Plain HTML/CSS month grid (7-col CSS grid — **not** ECharts: chips need links and multi-event days), ‹ prev / Today / next › controls, fetching a 3-month window around the shown month. Event chips colored by a **fixed type→PALETTE-slot map** (a legend names them; type identity never rides color alone — each chip carries its label text). Below the grid, the same month as an accessible list (`<ul>`, date-grouped) — this is also the mobile rendering when the grid gets cramped.
- **Overview "Up next" strip:** the next 5 events within 45 days (same endpoint), one line each, linked. Sits with the existing freshness footer; starts fixing the audit's "Overview has no forward-looking view" finding.
- **ICS export:** client-side blob download ("Add to calendar"), `VCALENDAR/PUBLISH`, one all-day `VEVENT` per event in the fetched range, `UID = {type}-{date}-{slugified label}@finance-dashboard` — stable across exports so calendar apps update instead of duplicating; `SUMMARY` = label, `DESCRIPTION` = detail + href.

## 7. Testing

- **pytest:** `business_days` golden tables for 2026–2027 (all 11 holidays incl. Sunday-observation years; paydays for months where the 15th/EOM hits Sat/Sun/holiday); composition per type incl. range clipping, unsold-lot filter, cadence≠24 omission, update-due presence/absence; provider fake for `fetch_next_ex_div` (announced / none / malformed); refresh integration (store, clear-on-past, per-ticker failure degrades, bookkeeping counts); endpoint span validation.
- **vitest:** grid placement (month boundaries, multi-event days), type→color map fixedness, list view parity, ICS text (UID stability across two exports, escaping), Up-next strip ordering/limit.

## 8. Out of scope (v2 candidates)

- User-entered custom events (needs a table; deliberately deferred), estimated/projected ex-dividends (**rejected** — confirmed-only), dividend *pay*-date events, per-employer holiday calendars, vest-value pricing on chips, push/email reminders (pairs with a future weekly-digest job), recurring-bill detection (needs transactions).
