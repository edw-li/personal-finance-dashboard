# Rich Dividend Tracking — Design Spec

**Date:** 2026-08-20
**Status:** Feature and ownership rule approved by user in chat; design details settled autonomously in-session.
**Feature branch:** `feature/rich-dividends`

## 1. Context & Goals

`dividend_payments` is a manual-entry-only log today, and it feeds five displayed figures
(dividends collected, annual income, the Overview YTD card, yield-on-cost, XIRR flows).
Meanwhile every price refresh already downloads per-day dividend events for every
auto-priced ticker (`DailyBar.dividend`) — and keeps only the TTM sum as
`securities.annual_dividend` metadata. The events themselves are discarded.

**User decision (2026-08-20, binding):** the dashboard is the **system of record for
dividends**. The spreadsheet was lax about dividends; on import, sheet data must never
override dashboard dividend data. Dividend tracking should be implemented "richly and
correctly" in the dashboard, with live sources doing the bulk of the work.

Goals:
1. Every refresh ingests real dividend events — per-share amount × shares held on the
   event date, attributed per account — idempotently and self-healing.
2. The importer's existing never-writes-dividends behavior becomes a **pinned contract**.
3. Manual entry remains as the supplement for what Yahoo cannot see (private funds,
   manual-priced tickers, historical payments older than the refresh window).
4. The Portfolio page's Dividends tab grows income analytics worthy of the data.

## 2. Ownership Contract (the user's rule, made precise)

| Actor | May touch which rows | Rule |
|---|---|---|
| **Importer** | none | Never creates, updates, or deletes `dividend_payments` rows. (Already true — the Portfolio sheet's "Dividends Collected" column is warned about and skipped because the sheet has no payment dates.) NEW: pinned by a test so no future importer change can regress it. |
| **Price refresh** | `source='auto'` rows whose `ex_date` falls inside the 370-day refresh window, and only for securities that returned bars **this run** | Upserts them to match the current book and feed; deletes in-window auto rows whose event/holding no longer exists (self-healing after a transaction fix). Auto rows older than the window freeze as history and are never touched again. |
| **User** | `source='manual'` rows | Never touched by refresh or import. Deleting an in-window `auto` row resurrects it on the next refresh (same class as sheet-owned transactions; the panel hint says so). |

## 3. Schema — one migration, chained on head `705ec03f614f`

`dividend_payments` gains four columns and one partial unique index:

- `source: String(10) NOT NULL server_default 'manual'` — `'manual' | 'auto'`
  (`DIVIDEND_SOURCES` tuple beside `TRANSACTION_SOURCES` in `models/portfolio.py`).
- `ex_date: Date NULL` — the event date. Auto rows always set it; manual rows may not know it.
- `per_share: Numeric(10, 6) NULL` — the declared per-share amount (auto rows).
- `shares_held: Numeric(16, 6) NULL` — shares on the ex-date (auto rows), so every auto
  row is self-auditing: `amount = (per_share × shares_held)` quantized to cents.
- Partial unique index `ux_dividend_auto_event` on `(security_id, account, ex_date)`
  `WHERE source = 'auto'` — the idempotency key. `account` is always non-null on auto rows.

`pay_date` on auto rows is set to the ex-date — an honest, documented approximation
(Yahoo's chart feed carries no payment date). Downgrade drops the index and all four
columns. Purely additive; order-safe both directions.

## 4. Ingest service — `backend/app/services/dividend_ingest.py`

```
async def ingest_dividends(db, events_by_security: dict[int, list[DailyBar]],
                           *, today: date) -> DividendIngestResult
# DividendIngestResult: ingested, updated, removed, skipped_manual_overlap (ints)
```

- **Events:** bars with `dividend > 0` inside the window, de-duped by date (last wins),
  bounded `0 < dividend < DIVIDEND_MAX_ABS` (price_service's constant).
- **Shares held on a date:** `fold_transactions` over the subset
  `{txn | txn.txn_date is None OR txn.txn_date <= event_date}`. Dateless (sheet-era) rows
  count as held-from-the-beginning — they predate the import by construction; dated rows
  apply from their date; splits follow the same rule (a dated split after the ex-date does
  not retroactively scale that dividend — correct, dividends pay on pre-split shares).
  Implemented as a filter + the existing fold; the fold itself is untouched, and its
  warnings are ignored here (only share counts matter). Transactions load once via
  `load_portfolio(with_history=False, with_dividends=False)`; fold once per distinct
  event date across all securities (cheap: a handful of dates × ~40 txns).
- **Row shape:** per `(security, account)` with folded shares > 0 at 6dp:
  `amount = (shares × per_share).quantize(cent, HALF_UP)`; skip zero-cent dust; one row
  per account so multi-account holdings attribute income correctly (per-account cents may
  disagree with the whole-position product by a cent — each row quantizes independently,
  documented).
- **Manual-overlap dedupe (conservative):** if ANY `source='manual'` row for the same
  security has `pay_date` within ±14 days of the event's ex-date, skip the whole event for
  that security and count it in `skipped_manual_overlap`. The user's hand-entered payment
  most likely IS this event (quarterly spacing ~91 days makes ±14 safe); deleting the
  manual row lets auto take over on the next run. Never double-count.
- **Upsert:** `ON CONFLICT (security_id, account, ex_date) WHERE source='auto'
  DO UPDATE amount/per_share/shares_held/pay_date` — a re-run with corrected bars or a
  fixed transaction history rewrites the row (price_history's posture).
- **Self-heal (deletes):** scoped to (a) securities that returned bars this run, (b)
  in-window ex_dates, (c) auto rows whose key was NOT produced this run (event vanished
  from the feed, or shares on that date became 0 after a data fix). A ticker that FAILED
  this refresh has no bars and its rows are untouched. Manual-priced and inactive
  securities are never in `events_by_security` (refresh skips them), so their rows are
  untouched too.
- **Failure posture:** runs inside `run_refresh` after the price commit, guarded exactly
  like `append_value_snapshot` — an ingest failure logs, rolls back only itself, degrades
  to zero counts; the price refresh stands.

## 5. `run_refresh` wiring

- `refresh_prices` collects `events_by_security` while it already iterates bars (only for
  tickers that end in `updated`) and returns it on `RefreshResult` (new field, default
  empty — additive).
- `run_refresh` order becomes: prices → value snapshot → **dividend ingest** → record →
  commit. The `last_refresh` payload gains `dividends_ingested`, `dividends_removed`,
  `dividends_skipped_overlap` (additive keys; the status reader already degrades on
  unknown shapes, and the schema treats them as optional for stale-tab armor).
- `POST /prices/refresh` response (`RefreshOut`) gains `dividends_ingested` so the
  Portfolio header note can say "· N dividends logged".

## 6. API & schemas

- `DividendOut` gains `source`, `ex_date`, `per_share`, `shares_held` (nullable, Decimal
  strings per pydantic convention).
- `POST /portfolio/dividends` unchanged — creates manual rows (`source` defaults
  `'manual'`; the create schema does NOT accept `source`: auto rows are the refresh's
  alone).
- `DELETE /portfolio/dividends/{id}` unchanged — auto rows are deletable; in-window ones
  resurrect next refresh (documented in the panel hint, the sheet-transactions precedent).
- No new analytics endpoint: income-by-period is presentation math over the full list the
  page already fetches (the `spendStats` class).

## 7. Frontend

- `types/api.ts`: `DividendOut` extension; `LastRefresh` gains the three optional counts;
  `RefreshResult` gains optional `dividends_ingested`.
- **DividendsPanel:** source badge per row (`auto`/`manual` — the transactions panel's
  badge idiom), per-share/shares shown when present (no separate ex-date column —
  `pay_date == ex_date` on auto rows by construction, so it would duplicate Pay date on
  every auto row; the hint carries the fact instead — branch-review-ratified), hint
  rewritten: refreshes
  log dividends automatically for auto-priced tickers; auto rows are rewritten by
  refreshes and deleting one brings it back; manual entry remains for private/manual-priced
  holdings and pre-window history.
- **Income analytics (top of the Dividends tab):** an income-by-month bar chart (sums of
  `amount` by `pay_date` month, last 24 months, one series — PALETTE[0], no new hues) via
  a new pure builder `components/portfolio/dividendChartOptions.ts` (null under one
  point, house floor), plus tiles: trailing-12 income and YTD income (client sums,
  `ytdStats`' sanctioned class) and projected annual income (`totals.annual_income`,
  verbatim).
- **PortfolioPage** refresh note appends "· N dividends logged" when the count is > 0.
- The Overview YTD dividends figure fills automatically from auto rows — no change needed.

## 8. Testing

- **pytest:** ingest unit tests (dateless+dated as-of fold; per-account attribution;
  cents quantization; idempotent rerun = 0 new; manual-overlap skip; self-heal delete
  scoped to bars-returning securities only; failed-ticker rows untouched; zero-share and
  zero-cent skips; window boundary). `run_refresh` integration (counts recorded and
  echoed by `/prices/refresh-status`). **Importer pin:** a workbook fixture whose
  Portfolio sheet carries "Dividends Collected" applies cleanly and writes ZERO dividend
  rows — the ownership contract's regression gate. Migration exercised by conftest.
- **vitest:** DividendsPanel badges/hint/new columns; `dividendChartOptions` (month sums,
  null floor, 24-month window); PortfolioPage note extension; refresh-status tolerance
  for absent counts (stale-deploy armor).

## 9. Non-goals

- No pay-date prediction or upcoming-dividend calendar — Yahoo's chart feed gives ex-dates
  only; inventing payment schedules fails the honesty bar.
- No qualified/ordinary classification of dividend income (the tax module owns that
  vocabulary; its inputs remain hand-fed or sandbox-fed).
- No FX and no DRIP modeling (a reinvestment is a buy transaction the user records).
- No backfill beyond the 370-day refresh window — older history stays manual.
  > **Amended 2026-08-28:** still true for the LEDGER (`dividend_payments` amounts stay
  > manual before the window — shares held on old ex-dates are unknowable from the dateless
  > imported book). But the performance chart now gets display-only historical ex-dividend
  > MARKERS from a one-time deep provider fetch (`security_dividend_events` table, per-share
  > only, never a dollar amount, never a ledger row) — see the 2026-08-25 five-feature spec
  > §2c addendum.
