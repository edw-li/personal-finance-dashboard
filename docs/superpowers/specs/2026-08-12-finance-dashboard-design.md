# Personal Finance Dashboard — Design Spec

**Date:** 2026-08-12
**Status:** Approved (pending final user review)
**Repo:** `personal-finance-dashboard`

## 1. Context & Goals

Replace a comprehensive, well-automated Google Sheet ("Personal Finance Dashboard") with a
self-hosted web dashboard offering richer, interactive, customized visualizations. The sheet's
charting limitations are the primary motivation; the sheet's data model and calculators are the
functional specification.

- Single user (no registration, no roles, no multi-account support).
- Hosted on a new OCI Always Free Ampere A1 instance, architecture modeled on the existing
  `photography-webpage` project (React SPA + FastAPI + host PostgreSQL + Docker Compose + Nginx
  + Cloudflare).
- Periodic manual data entry (monthly balances/spending; ad-hoc transactions) plus automated
  market prices from a free finance API (replacing GOOGLEFINANCE).
- Existing spreadsheet data is ported via a repeatable importer; the Google Sheet may run in
  parallel until the dashboard is trusted, then is retired.

### Source spreadsheet inventory (from `Personal Finance Dashboard.xlsx`)

| Sheet | Content | Disposition |
|---|---|---|
| Net Worth | ~36 monthly snapshots × ~26 accounts in groups (CASH, PRE-TAX, POST-TAX, TAXABLE, EQUITY, OTHER, LIABILITIES) + MoM % | v1 module |
| Spending | Monthly totals × 19 categories + TOTAL, Net Pay, 4% Portfolio, Savings Rate; yearly rollup rows | v1 module |
| Positions | Buy/sell ledger (~30 rows): platform, ticker, shares, price, running cost basis, realized G/L | v1 module |
| Portfolio | ~25 holdings: live price, daily Δ, market value, weight, unrealized/realized G/L, XIRR, dividends, yield, YOC; rollups by industry/type/source | v1 module (computed views) |
| Taxes | Full bracket-based calculator, years as columns (2023+): ~40 income/deduction inputs; federal/CA-state/Medicare/SS/SDI/capital-gains bracket tables as data; computed liability + effective rates | v1 module (full engine port) |
| ESPP | Semi-annual purchase modeler ($25k IRS limit) + purchase lots (dates, subscription price, FMV, qualifying date) | v1 module |
| Paycheck Modeler | Salary → semi-monthly paycheck breakdown (401k trad/Roth/after-tax %, HSA, dental/vision, ESPP %, withholding %) → net pay | v1 module |
| Focal History | Yearly comp events: base changes, RSU refreshers, unvested equity, TC trajectory | v1 module |
| Credit Card Matrix | Static category × card rewards lookup | **Deferred to v2** |
| ReferenceData | 37 tickers: name, sector, price, dividend metadata | Seeds `securities` |
| *Summary sheets | Chart-feeding pivots (Spending/Net Worth/Taxes/Portfolio Summary) | Replaced by computed API views |

## 2. Decision Log

| Decision | Choice |
|---|---|
| Spending granularity | Monthly category totals (schema leaves room for per-transaction later) |
| v1 scope | Core four (net worth, spending, portfolio, taxes) + ESPP + paycheck + focal history; credit-card matrix deferred |
| Hosting | Separate new OCI Always Free instance (not co-hosted with photography site) |
| Auth | Single-user JWT login (password seeded via env; no registration) |
| Tax module | Full calculation-engine port with golden tests vs sheet outputs |
| Market data | yfinance + manual price override for private/NAV assets |
| Import | Repeatable, idempotent xlsx importer (dry-run diff + transactional apply) |
| Charting | Apache ECharts with a central theme and thin React wrapper |
| Stack | FastAPI + async SQLAlchemy + Alembic + PostgreSQL 16 (host) + React 19/TS/Vite, Docker Compose + Nginx, mirroring photography-webpage |

## 3. Architecture Overview

```
Browser ── Cloudflare (TLS, proxy) ── Nginx container (SPA static + /api proxy, 80/443)
                                          │
                                          ▼
                                  FastAPI container (uvicorn)
                                   ├─ REST API /api/v1/*  (JWT auth)
                                   ├─ APScheduler: price refresh job → yfinance
                                   ├─ Tax engine (pure Python service)
                                   └─ Importer service (openpyxl; CLI + upload endpoint)
                                          │ asyncpg (Docker bridge → host)
                                          ▼
                              PostgreSQL 16 on instance host
                                          │ nightly cron: pg_dump
                                          ▼
                              OCI Object Storage bucket (backups)
```

Two containers (backend internal-only; Nginx public) exactly like photography-webpage's
`docker-compose.prod.yml`. PostgreSQL runs on the host with docker-bridge `listen_addresses` +
`pg_hba.conf` entries and iptables lockdown of 5432, per the photography README runbook.

## 4. Data Model

Conventions: integer PKs; `NUMERIC` for all money (14,2) / shares (16,6) / prices (14,4) /
rates (7,4); `DATE` months normalized to first-of-month; timestamps `timestamptz`. **All derived
values (totals, MoM %, gains, weights, XIRR, tax liability) are computed at query time — never
stored** — so imports and edits can't create inconsistency.

### Net worth
- `accounts` — id, name, slug (unique), `group` enum(`cash|pre_tax|post_tax|taxable|equity|other|liability`), sort_order, is_active. (~26 seeded from sheet.)
- `net_worth_snapshots` — id, month (unique, first-of-month), recorded_on (the sheet's actual "Date" column), notes.
- `account_balances` — id, snapshot_id FK, account_id FK, balance. Unique (snapshot_id, account_id).

### Spending
- `spending_categories` — id, name, slug (unique), sort_order, is_active. (19 seeded.)
- `monthly_spending` — id, month, category_id FK, amount. Unique (month, category_id).
- `monthly_cashflow` — month PK, net_pay.
- Computed: monthly TOTAL, yearly rollups, savings rate `(net_pay − total) / net_pay`, and
  "4% rule" line `(total investable assets × swr_pct) / 12` (swr_pct in `app_settings`).

### Portfolio
- `securities` — id, ticker (unique), name, industry, holding_type (`etf|mutual_fund|stock|private`), is_manual_priced, is_active, dividend metadata (annual_dividend, ex_div_date — refreshed or manual).
- `position_transactions` — id, security_id FK, account (text label, e.g. "RH Taxable"), type enum(`buy|sell|split`), txn_date (nullable — see Risks), shares, price, fees, split_factor, notes.
- `dividend_payments` — id, security_id FK, account, pay_date, amount. (Sums to "Dividends Collected".)
- `latest_prices` — security_id PK, price, quoted_at, source enum(`yfinance|manual`).
- `price_history` — id, security_id FK, date, close. Unique (security_id, date). Backfilled ~1yr for held tickers; feeds sparklines/charts.
- Computed per security × account and rolled up: cumulative shares (split-adjusted), cost basis,
  market value, weight, unrealized/realized G/L, XIRR (own implementation, unit-tested), yield,
  yield-on-cost; allocation rollups by industry / holding type / account.

### Taxes
- `tax_years` — year PK, notes.
- `tax_brackets` — id, year FK, jurisdiction enum(`federal|state|medicare|social_security|disability|capital_gains`), bracket_index, rate, threshold. Unique (year, jurisdiction, bracket_index).
- `tax_input_definitions` — key PK, label, section enum(`ordinary_income|deductions|capital_gains`), sort_order, is_derived (marks line items the sheet grays out as auto-computed, e.g. Latest W2 Income = gross paycheck × pay periods; the UI offers the derived value as a suggestion but the stored input stays editable). Seeded with the sheet's ~40 line items: annual salary, gross paycheck, pay periods, latest/other W2, RSUs sold, bonuses, salary checkpoint, ESPP sale components (ordinary/STCG/LTCG), employer HSA, STCG standard, unqualified dividends (treasury ETF %, state-exempt %, other), interest (standard, US treasuries), 1099-MISC, trad-401k, HSA (self/employer), capital-loss deduction, dental, vision, standard deduction, itemized items (SALT, donations, vehicle reg fees, Sec 199A, other), LTCG (brokerage/ESPP), qualified dividends, other capital gains.
- `tax_inputs` — id, year FK, key FK, value. Unique (year, key).
- Computed by the engine per year: federal/state AGI + taxable income, per-jurisdiction tax +
  effective rate, capital-gains stacking, total liability, post-tax take-home, overall effective
  rate. Endpoint returns full breakdown; multi-year endpoint feeds trend charts.

### Comp modules
- `espp_lots` — id, purchase_date, qualifying_date, shares, subscription_price, purchase_fmv, purchase_price, sold_date/sold_price (nullable), notes. Disposition status (qualified/unqualified) computed vs today/sale date. ESPP ticker (NVDA) in `app_settings` links current price.
- `espp_periods` — id, label (e.g. "2026 Feb purchase"), period_start/end, semi_annual_base, additional_payments, contribution_pct. Computed: eligible earnings, contributions, estimated shares, $25k-subscription-limit check.
- `paycheck_profiles` — id, effective_date, annual_salary, pay_periods_per_year (default 24), trad_401k_pct, roth_401k_pct, after_tax_401k_pct, espp_pct, withholding_pct, dental_vision_per_check, hsa_per_check, notes. Computed: full per-paycheck waterfall → net pay. History preserved (one profile per comp change).
- `comp_events` — id, focal_year (unique), current_base, new_base, unvested_rsus, unvested_price, refresh_rsus, grant_price, notes. Computed: base/equity deltas ($, %), TC before/after.

### System
- `users` — id, email, password_hash. Single row seeded from env (`ADMIN_EMAIL`/`ADMIN_PASSWORD`).
- `app_settings` — key PK, value (JSON): espp_ticker, swr_pct, price_refresh_cron, etc.

## 5. Backend Design (FastAPI)

Layout mirrors photography-webpage: `backend/app/{api,models,schemas,services}`, `config.py`,
`database.py` (async SQLAlchemy + asyncpg), `rate_limit.py`, `seed.py`, `alembic/`.

### API surface (`/api/v1`, JWT-protected except login/health)
- `auth` — POST `login` (rate-limited), POST `change-password`. 24h HS256 JWT; bcrypt/argon2 hash.
- `net-worth` — accounts CRUD; GET timeseries (by group/account, monthly + quarterly); PUT `months/{month}` bulk balance upsert (the wizard endpoint); GET latest summary.
- `spending` — categories CRUD; GET matrix/timeseries/yearly rollups; PUT `months/{month}` bulk amounts + net_pay.
- `portfolio` — securities CRUD; transactions CRUD; dividends CRUD; GET `holdings` (computed table); GET `allocation?by=industry|type|account`; GET realized-G/L.
- `prices` — POST `refresh` (manual trigger); GET `history/{ticker}`; PUT `{ticker}` (manual override; guarded for non-manual securities).
- `taxes` — GET/PUT `years/{year}/inputs` (bulk); GET/PUT `years/{year}/brackets`; GET `years/{year}/summary` (computed breakdown); GET `summary` (all years, for trends); POST `years/{year}/clone-brackets-from/{prev}` (start a new tax year quickly).
- `espp` — lots CRUD; periods CRUD; GET computed modeler view.
- `paycheck` — profiles CRUD; GET `current/breakdown`.
- `comp` — events CRUD; GET computed history.
- `dashboard` — GET `overview`: latest net worth + MoM Δ, portfolio value + day Δ, MTD/YTD spend vs average, current-year estimated effective tax rate, net-worth sparkline series, allocation summary, data-freshness stamps. One call renders the home page.
- `import` — POST `xlsx?dry_run=true|false` (multipart upload) → per-sheet diff report (creates/updates/skips/warnings); apply is transactional per run.

### Services
- **`tax_service`** — pure function `(inputs: dict[str, Decimal], brackets) → TaxBreakdown` implementing the
  sheet's model: progressive bracket walker per jurisdiction, W2/Medicare/SS/SDI wage bases,
  standard-vs-itemized selection, capital-gains stacking on top of ordinary taxable income,
  state-exempt treasury dividend handling. **Golden tests assert exact match with the sheet's
  computed 2023–2026 outputs** (fixtures captured from the xlsx during implementation).
- **`price_service`** — yfinance quotes for active tickers (batch); daily-close backfill;
  writes `latest_prices` + `price_history`; skips `is_manual_priced`. On failure: keep last
  good price, log, expose `quoted_at` so the UI shows staleness. Never fetches inline with a
  page request.
- **`scheduler`** — APScheduler in the FastAPI process: price refresh weekdays after US market
  close (~13:10 PT) + optional midday tick; cron string in `app_settings`.
- **`portfolio_service`** — transaction folding (split adjustment, average-cost basis matching the
  sheet's method, realized G/L), holdings + allocation computation, XIRR (Newton with bisection
  fallback; dateless-transaction fallback documented in Risks).
- **`importer_service`** — openpyxl parsing of the source data sheets (Net Worth, Spending,
  Positions, Taxes, ESPP, Paycheck Modeler, Focal History, ReferenceData; Portfolio's
  "Dividends Collected" seeded as aggregate `dividend_payments` entries with a warning) →
  normalized upserts keyed on natural keys (month, account slug, category slug, ticker, year,
  input key, focal_year, purchase_date). Unknown accounts/categories/tickers are auto-created
  active, with a warning in the report. Dry-run returns the diff without writing. Callable as CLI
  (`python -m app.importer path.xlsx [--dry-run]`) and via the upload endpoint (same code path).

### Error handling
- Money parsing is strict Decimal; importer rejects non-numeric cells with row/col context in the report.
- Sheet quirks handled explicitly: placeholder `0.001`/`-0.001` balances normalized to 0 with a
  warning; yearly-rollup rows and far-future empty template rows (sheet pre-fills months to 2065) skipped.
- API errors: consistent problem-JSON; validation via Pydantic schemas; 401 on missing/expired JWT.

## 6. Frontend Design (React 19 + TS + Vite)

Layout mirrors photography-webpage: `src/{api,components,pages,hooks,contexts,types,utils}`,
plain per-component CSS, lucide-react icons, react-router v7, AuthContext + protected routes,
hand-rolled typed fetch client (no react-query).

### Pages
| Route | Content |
|---|---|
| `/login` | Password login |
| `/` Overview | Hero stat tiles (net worth + MoM, portfolio + daily Δ, MTD spend vs avg, YTD effective tax); net-worth area sparkline; allocation donut; recent-months spend bars; freshness indicators |
| `/net-worth` | Stacked area by group over time; quarterly toggle; per-account table with MoM %; account drill-down lines; **monthly balance entry (wizard step 1)** |
| `/spending` | Interactive month × category matrix (heatmap); stacked monthly bars; category trends; savings-rate + 4%-rule overlay; yearly rollups; **month entry (wizard step 2)** |
| `/portfolio` | Holdings table (sortable; per-row 1yr sparkline; shares/price/day Δ/value/weight/unrealized G/L/XIRR/yield/YOC); allocation treemap + donut (industry/type/account); transactions ledger + entry form; dividends log; manual price entry for private assets |
| `/taxes` | Year selector; sectioned input form (mirrors sheet's white cells); bracket-table editor per jurisdiction; computed liability waterfall (gross → taxable → per-tax → take-home); effective-rate + composition trends across years |
| `/espp` | Lots table with qualifying-date countdown + disposition status and gain vs purchase; current-period modeler with $25k-limit gauge |
| `/paycheck` | Active profile form; per-paycheck gross→net waterfall; profile history |
| `/comp` | TC trajectory (base vs equity stacked); focal events table; refresh-grant timeline |
| `/settings` | Password change; app settings; **xlsx import: upload → dry-run diff preview → apply** |

- **Monthly update wizard**: guided flow (balances grid pre-filled from prior month → spending
  amounts + net pay → confirmation summary). This replaces the spreadsheet ritual and is the
  most important UX in the app.
- **Charting**: Apache ECharts via a thin in-repo `<EChart option={...}>` wrapper (~50 lines,
  ResizeObserver-aware; `echarts-for-react` is unmaintained). One central theme file (palette,
  typography, dark mode) so all charts read as one system. Apply `dataviz` +
  `frontend-design` skills during implementation for the visual pass.
- Number formatting utilities (currency, %, compact) shared in `utils`.

## 7. Security

- Whole app behind auth; no public routes beyond login + health.
- Login rate-limited (reuse photography `rate_limit.py`); JWT `SECRET_KEY` from env.
- HTTPS via Cloudflare proxy + origin certs (as photography); HSTS at Nginx.
- Postgres bound to localhost + docker bridge only; iptables drop on 5432; OCI security list
  allows 80/443/22 only.
- Secrets in `.env` (gitignored); repo private; no financial values in logs.
- Backups bucket private; pg_dump artifacts compressed (optionally GPG-encrypted — decide at
  deploy time).

## 8. Infrastructure & Deployment

- **Instance**: new OCI Always Free Ampere A1, Ubuntu 24.04. Size after checking tenancy-wide
  free-tier usage against the photography instance (cap: 4 OCPU / 24 GB total). Target 1–2 OCPU,
  6–12 GB — generous for this workload.
- **Host setup**: replay photography README — Docker Engine + Compose, PostgreSQL 16 on host
  (`listen_addresses` for docker bridge, `pg_hba.conf` 172.16.0.0/12 scram, iptables), new
  `finance` DB/user.
- **Compose**: `backend` (internal) + `frontend` Nginx (SPA + `/api` proxy, 80/443, Cloudflare
  origin certs mounted read-only).
- **DNS/TLS**: subdomain on the existing Cloudflare-managed domain (e.g. `finance.<domain>`),
  proxied. (Open item: confirm domain.)
- **Backups**: adapted `backup_db.sh` → nightly cron pg_dump → new OCI Object Storage bucket via
  boto3 (S3-compat endpoint), retention ~30 days.
- **CI**: GitHub Actions modeled on photography `ci.yml` — backend: ruff + pytest; frontend:
  eslint + tsc + vite build. Private GitHub repo.
- **Runbook**: README documents full instance bring-up, deploy (`docker compose up -d --build`),
  update flow, backup restore drill.

## 9. Testing Strategy

- **Tax engine golden tests** — fixtures of the sheet's exact 2023–2026 inputs and computed
  outputs; engine must reproduce them to the cent. This is the acceptance gate for the module.
- **Portfolio math unit tests** — cost-basis folding (buys/sells/splits), realized G/L, XIRR vs
  known-good values (spot-checked against sheet).
- **Importer tests** — small synthetic xlsx fixture built in-test with openpyxl (the real
  workbook contains personal data and stays out of the repo); asserts idempotency (import twice
  → no diff) and quirk handling (0.001 placeholders, rollup rows, future template rows).
- **API tests** — pytest + httpx AsyncClient per router (auth, CRUD, bulk upserts, computed
  endpoints), against a test Postgres (photography pattern).
- **Frontend** — tsc + eslint gates; component tests optional (vitest) — charts verified
  visually during the design pass.
- **Reconciliation (pre-cutover)** — with real data imported, compare dashboard-computed
  net worth / holdings / tax values against the sheet; investigate all mismatches. Parallel-run
  for ≥1 monthly cycle before retiring the sheet.

## 10. Build Phases

1. **Scaffold** — repo layout (frontend root + `backend/`), FastAPI skeleton + health, Vite
   skeleton, Docker/Compose, CI, `.env.example`.
2. **Auth** — user model/seed, login, JWT middleware, protected-route frontend shell + login page.
3. **Schema + importer** — all Alembic migrations; importer for all sheets with dry-run diff;
   first real import (CLI) against the xlsx; reconcile counts.
4. **Net worth module** — API + page (charts, tables, balance entry).
5. **Spending module** — API + page (matrix, trends, entry) + monthly-update wizard tying 4+5 together.
6. **Portfolio + prices** — securities/transactions/dividends APIs, price service + scheduler,
   holdings/allocation computation, portfolio page.
7. **Tax engine + page** — engine with golden tests, brackets/inputs APIs, taxes page.
8. **Comp modules** — ESPP, paycheck, focal history (APIs + pages).
9. **Overview dashboard** — aggregate endpoint + home page; visual/theming pass across all charts.
10. **Deploy** — OCI instance bring-up, Cloudflare, backups, runbook; production import.
11. **Parallel-run & cutover** — ≥1 month dual-entry, reconciliation, then retire the sheet.

Each phase lands independently deployable and reviewed; detailed task breakdown to follow in the
implementation plan (superpowers:writing-plans).

## 11. Risks & Open Items

| Risk / item | Mitigation |
|---|---|
| Positions sheet has no transaction dates, but XIRR needs dates | Importer flags dateless rows; XIRR computed only where dates exist (backfill dates manually post-import, or accept approximation; decide during phase 6) |
| yfinance is unofficial and occasionally breaks | Stored last-good prices + staleness display; provider isolated behind `price_service` so an alternative can be swapped in; manual override always available |
| Institutional fund tickers (VFFSX/VIEIX) coverage | Verify via yfinance early in phase 6; fallback: mark manual-priced |
| Tax-engine fidelity (CA SDI caps, CG stacking, exemption credits) | Golden tests vs sheet are the gate; engine keeps brackets/wage-bases as data, matching sheet structure |
| OCI free-tier capacity shared with photography instance | Capacity check before provisioning (phase 10 prep); can downsize/resize within cap |
| Domain/subdomain not yet confirmed | Open item for user before phase 10; Cloudflare origin-cert pattern assumed |
| Sheet quirks (placeholder 0.001 values, merged headers, future template rows) | Importer normalizes with warnings; dry-run diff reviewed before apply |
| Single instance = single point of failure | Nightly off-instance backups + documented restore drill; acceptable for personal tool |

## 12. Out of Scope (v2+ candidates)

- Credit Card Matrix page (deferred by decision).
- Per-transaction spending ledger + CSV import/categorization.
- Live Google Sheets sync; bank/brokerage aggregators (Plaid etc.).
- Multi-user support, sharing, mobile app.
- Automated dividend ingestion; options/crypto tracking.
- Monte Carlo retirement projections (the Spending sheet's 2065 horizon hints at interest — good v2 candidate).
