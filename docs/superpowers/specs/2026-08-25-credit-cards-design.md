# Credit Cards — Rewards Optimizer & Credit-Line Tracker — Design Spec

**Date:** 2026-08-25 · **Status:** implemented 2026-08-26 (branch credit-cards, merged to local main @586d6ad)
**Touches:** one additive migration (5 tables), new `models/credit_cards.py` + `schemas/credit_cards.py` + `api/credit_cards.py`, `main.py` router registration, new `/credit-cards` page + `src/components/creditcards/*` (matrix, drill-in, roster, math module, chart options), `navItems.ts`, `App.tsx`, `src/api/creditCards.ts`, `src/types/api.ts`.

## 1. Context & goals

The workbook's **Credit Card Matrix** sheet (6 cards × 14 categories, hand-maintained "Use Which Card?" column) becomes a first-class page: a rewards-optimization matrix with best-in-category highlighting, per-card economics (is this card worth its fee?), cardholder/limit metadata, and credit-line history over time.

**Stated constraint:** spending data is category-aggregate with **no card attribution**, so actually-earned rewards are unknowable. The page is an **optimization calculator** — every dollar figure is an estimate of what the optimal lineup *would* earn, and the UI labels them as estimates throughout (user's explicit condition).

**The core elevation over the sheet:** the sheet compares raw multipliers across different currencies (3x miles vs 3% cash). Here each card carries a point valuation (¢/point; cash = 1.0), and "best" is decided by **effective return = multiplier × point value**. This changes real answers: at 2.05¢ BILT's "3x dining tie" with SavorOne is an outright win (6.2% vs 3.0%), and Venture X's 2x-everything (3.4%) quietly beats 3% cash cells.

### User-confirmed decisions (2026-08-25 Q&A + mockup rounds)

- **Spend-weighted optimizer** (not spend-agnostic): each matrix category carries an annual-spend weight — auto-suggested from the trailing 12 months of a mapped spending category, manually overridable — powering $/yr estimates. Clearly labeled estimates.
- **No actual-earned tracking** — impossible without card attribution; explicitly out of scope.
- **Tie math: allocate + marginal.** Co-best cells all get green + a "tie" badge. For the "use which card" answer and $/yr footer, a category's spend is allocated to ONE winner: manual pin → lower annual fee → most categories won outright → name. Per-card keep/cancel value is **marginal**: optimal lineup earnings with the card minus without it (a card that only ties contributes $0 — the "droppable" signal).
- **Cardholders: simple fields** — free-text primary holder + free-form authorized-users list. No people registry. One row = one real card account.
- **Economics: AF + recurring credits** — per-card credits list (label, annual value, "counts for me" toggle). No signup-bonus tracker (v2).
- **Layout: single scrolling page** (house style) **+ column-click drill-in**: clicking a card's column header swaps the page content for that card's detail view, closed via ✕ back to the matrix — the SpendingPage `detailMonth` pattern, deep-linkable as `?card=<slug>` via `useSearchParams` (`{replace: true}`).
- **Matrix cells: segmented toggle [Multiplier | Effective %], default Multiplier** (spreadsheet parity). Green always follows effective return in both views.
- **Architecture: frontend math.** Backend is pure CRUD; all derived numbers come from a pure, unit-tested TS module. Estimates → JS number precision is acceptable.

## 2. Data model — one additive migration, 5 tables

Chain onto the alembic head current at implementation time (README §4.3 law). All tables are **dashboard-only / importer-immune** (the `rsu_grants` posture; pinned by an importer test). Money columns are quantized to 2 decimals via `quantize_money` (widths per table below); `rewards_currency` is a validated tuple (`ACCOUNT_GROUPS` pattern), not a DB enum.

**`credit_cards`**

| column | type | notes |
|---|---|---|
| `id` | int PK | |
| `name` / `slug` | String(120) / String(120) | both UNIQUE; slugified like `spending_categories` |
| `annual_fee` | Numeric(8,2), default 0 | ≥ 0 |
| `rewards_currency` | String(20) | one of `cash` / `points` / `miles` |
| `point_value_cents` | Numeric(6,4), default 1.0 | > 0; cash stays 1.0 |
| `primary_holder` | String(80), nullable | |
| `authorized_users` | String(200), nullable | free-form, comma-separated chips in UI |
| `opened_on` | Date, nullable | |
| `is_active` | bool, default true | archived cards keep history |
| `account_id` | FK → accounts, nullable, `ondelete="SET NULL"` | link to a `liability` account for utilization |
| `notes` | String(300), nullable | |
| `sort_order` | int, default 0 | |

**`card_credits`** — `id`, `card_id` FK CASCADE, `label` String(120), `annual_value` Numeric(8,2) ≥ 0, `counts` bool default true.

**`reward_categories`** (matrix rows) — `id`, `name` String(80) UNIQUE, `slug` UNIQUE, `sort_order`, `is_active`, `annual_spend` Numeric(12,2) nullable (manual weight override), `spending_category_id` FK → spending_categories nullable `SET NULL` (weight auto-suggestion source), `pinned_card_id` FK → credit_cards nullable `SET NULL` (allocation override).

**`reward_rates`** (cells) — `id`, `card_id` FK CASCADE, `category_id` FK CASCADE, `multiplier` Numeric(6,2) > 0, `note` String(120) nullable (⁺ tooltip: "portal", "Uber only", "no txn fee on rent"), `monthly_cap` Numeric(10,2) nullable (bonus-rate spend cap, e.g. Citi Custom Cash $500/mo). UNIQUE `(card_id, category_id)`. **No row = N/A** (card unusable/irrelevant for the category).

**`credit_limit_events`** (credit-line history) — `id`, `card_id` FK CASCADE, `effective_date` Date, `limit_amount` Numeric(12,2) > 0, `note` String(120) nullable. UNIQUE `(card_id, effective_date)`. Current limit = row with the greatest `effective_date`. Deliberately event-shaped (not a column on the card) so v2's non-card credit lines (mortgage/HELOC) are a small generalization, not a redesign.

## 3. API — `/api/v1/credit-cards`, router-level auth, thin handlers

- **Cards:** `GET /credit-cards` (nested `credits`, `current_limit`, `limit_events`), `POST`, `PATCH /{id}` (full-object, house style), `DELETE /{id}`. 409 on duplicate name/slug; 404 unknown; 422 on negative fee / non-positive point value / bad currency.
- **Credits:** `POST /credit-cards/{id}/credits`, `PATCH /credit-cards/credits/{credit_id}`, `DELETE /credit-cards/credits/{credit_id}`.
- **Limit events:** `POST /credit-cards/{id}/limits` (upsert on same date is a 409 — delete then re-add to correct), `DELETE /credit-cards/{id}/limits/{event_id}`.
- **Categories:** `GET/POST/PATCH/DELETE /credit-cards/categories` — name, sort_order, is_active, `annual_spend`, `spending_category_id`, `pinned_card_id`. Delete cascades its rates. 409 duplicates.
- **Rates (matrix save):** `GET /credit-cards/rates` (flat list of all cells) and **bulk `PUT /credit-cards/rates`** — array of `{card_id, category_id, multiplier | null, note, monthly_cap}`; `multiplier: null` deletes the cell (back to N/A); unknown card/category → 404, nothing partially applied (single transaction). Last write wins (single-user TOCTOU posture).
- No optimizer endpoints — math is client-side. Weight suggestions reuse the existing spending endpoints (`fetchMatrix`) client-side; utilization reuses the existing net-worth endpoints (`fetchMonthBalances` for the linked account's latest balance).

## 4. Frontend

**Registration:** `navItems.ts` Tracking group, label "Credit cards" (sentence-case law), lucide `CreditCard`; lazy route `/credit-cards` in `App.tsx` before the 404 route. Title + command-palette entry come free from `NAV_ITEMS`.

**Page (single scroll):**
1. Header: h1 + "+ Add card".
2. KPI row: Total credit line · Optimal rewards (est.)/yr · Net after fees (est.)/yr · Active cards.
3. **Rewards matrix** (span-12): segmented `[Multiplier | Effective %]` toggle defaulting to Multiplier; category rows show name + weight (`$36k`); column headers show card name + AF + currency/valuation and are clickable (→ drill-in); green best cells (in both views), tie badges, ⁺ note markers with tooltips (`escapeHtml`), N/A dashes, footer "Est. $/yr won" row. "Edit multipliers" flips cells into inputs (BracketsEditor idiom; save = bulk PUT). "Categories & weights" opens a house-style panel: CRUD rows, weight override `AmountInput`, spending-category mapping `<select>`, pin `<select>`, with the auto-suggested trailing-12-mo figure shown when unoverridden.
4. **Worth-keeping panel**: horizontal bars per active card — net = marginal + counted credits − AF; positive = POSITIVE tone, ≤ 0 = NEGATIVE tone + "droppable" annotation.
5. **Card roster**: table (card, holder, AUs, opened, current limit, linked account, edit/archive) + house add/edit form panel (raw-string form state, single-flight `busy`, delete = instant + Undo toast).
6. **Credit line history** (span-12): ECharts step lines (`step: 'end'`) per active card + a Total line, house palette/theme.

**Drill-in (`?card=<slug>`):** replaces sections 2–6 while open; ✕ returns. Contents: meta chips (holder, AUs, opened, AF, valuation, linked account), marginal-value stat tile, credits editor (rows + counts toggles + add), "its rewards" summary line (cells + categories won), limit-history editor (date/amount/note + add/delete) with step sparkline, utilization line ("$X of $Y = Z%" from the linked liability's balance in the latest snapshot month via the existing `fetchMonthBalances`; balances are stored negative — use |balance|) when linked.

**Math module `src/components/creditcards/rewardsMath.ts`** (pure, no React):
- `effectiveRate = multiplier × point_value_cents / 100` (%; ties compared with ε = 1e-6).
- Weight per category: `annual_spend` override ?? trailing-12-month sum of the mapped spending category ?? none → **excluded from all $ math** (footer shows "—"), but green/ties still render.
- Allocation per category: pinned card (if it has a cell) else best rate; ties broken lower AF → most outright wins → name. `monthly_cap`: winner earns its rate on `min(weight, cap×12)`; overflow re-allocates to the next-best card, recursively.
- `optimalTotal(cards)` = Σ allocated earnings; `marginal(card) = optimalTotal(all) − optimalTotal(all \ card)`; `net(card) = marginal + Σ counted credits − AF`. KPI mapping: "Optimal rewards (est.)" = `optimalTotal(active)`; "Net after fees (est.)" = `optimalTotal(active) + Σ counted credits − Σ AF` over active cards (not Σ `net(card)` — marginals don't sum to the total).
- Inactive cards are invisible to the matrix and all math; archived in roster only.

**Charts:** option builders as pure tested modules — `creditLineChartOptions.ts`, `cardValueChartOptions.ts` (+ drill-in sparkline reusing the former). Line/bar are already registered in `charts/echarts.ts`; no new registrations expected (verify chunk limit anyway).

**Empty state:** no cards → empty-note card with "+ Add card" and a **"Start with the spreadsheet's categories"** button that POSTs the 14 workbook rows (Rent/Utilities … Gifts) as `reward_categories`.

## 5. Testing

- **pytest:** migration round-trip (CI alembic gate); CRUD + validation matrices per resource (401 unauth, 422 bounds, 409 duplicates/same-date limit, 404s); bulk rates PUT (upsert, null-delete, atomicity on partial 404); cascades (card delete → credits/rates/limits gone; category delete → rates gone; account delete → card `account_id` NULL); current-limit resolution; importer pin (tables untouched by re-import).
- **vitest:** `rewardsMath` (effective rates across currencies, green/tie sets, pin override, AF/wins/name tie-breaks, cap overflow chains, marginal with and without ties, missing weights excluded, inactive cards excluded); both option builders; page tests (mocked API + EChart stub): default-Multiplier toggle, green cells via data attrs, `?card=` drill-in open/close/deep-link, roster edit flow, credits toggle recomputes net, seed button, estimates labeling present.

## 6. Out of scope (v2 candidates)

Signup-bonus tracking; non-card credit lines (mortgage/HELOC — generalize `credit_limit_events` ownership then); point pooling across cards/programs; actually-earned rewards (needs transactions); AF-renewal events on the calendar page; per-person filtering; utilization-history chart beyond the current-ratio line.
