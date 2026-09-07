# Budgets seeded from averages — design (2026-09-07)

Budgets shipped on 2026-08-24 as effective-dated targets with meters, wizard subtext and chart
reference lines — and production still held **zero** budget rows at the 2026-09-06 census. The
card's first-run state is nineteen collapsed "Set budget" disclosures, each wanting an amount, a
month and a save. This design removes that lift without changing what a budget *is*: one click
writes every living category's typical spend as a real, dated, editable budget row, and every
editor row shows the same figures as one-click chips. A second, smaller part lets the Projection
page run on those budgets, which is what the user asked the defaults for.

**Touches:** `api/spending.py` (two routes; the resolver moves out), a new `services/budgets.py`,
`schemas/spending.py`, `api/projection.py` + `schemas/projection.py` (one echoed field),
`src/components/spending/BudgetPanel.tsx` + `budgets.css`, `src/components/projection/
ScenarioPanel.tsx`, `src/api/spending.ts`, `src/types/api.ts`. **No migration** — the seed writes
ordinary `category_budgets` rows.
**Builds on:** `2026-08-24-category-budgets-design.md` (the effective-dated model, §2; the editor,
§4.2), `2026-09-04-honest-numbers-design.md` §3 (the ONE definition of an entered month in
`services/coverage.py`; the A6 rule *absent ≠ zero*), the change-batch/Undo machinery
(`2026-09-03-data-lifecycle-design.md` §9), and `services/scheduler.product_today` as the clock.
**Answers:** the 2026-09-02 fresh-eyes audit's Spending idea #4 ("set all from 12-mo avg") and
pass-2 item #5 (a Suggested column from the typical-spend figures).

## 0. Decisions (user Q&A, 2026-09-07)

| Question | Decision |
|---|---|
| Should a category's budget *default to* its 12-month average (a live derived value)? | **No.** Investigated against production: with budget = own average, 4–7 of 16 living categories read "over" in every complete month of 2026 by construction; the average lags a fixed cost that stepped up (Housing, CV 1%, over in 5 of 12 months after a rent increase); six of thirteen non-zero categories have a **$0 median** (Travel, Pets, Fees, Business Services, Health & Fitness, Personal Care), so a flat monthly line reads empty ten months a year and then blows out; and a rolling value moves after the fact, breaking the frozen-history rule the budgets spec confirmed. The vs-average reading already exists on the movers table, the heatmap and the assistant. |
| Then how does the first run stop being blank? | **A materialized seed.** "Start from my averages" writes one effective-dated row per seedable category, from the focused month. Budgets stay explicit stored targets; the user edits from there. |
| Which months feed the averages? | The last **12 complete** entered months. The preview showed the current, seven-day-old month inside an "entered months" window, dragging every mean down by a twelfth and handing nine categories a fake $0 minimum — so the current calendar month is never in the window. |
| Which statistic? | The **mean** for variable categories: it conserves the annual total, which is what modeling needs (twelve medians would under-count Shopping and Auto & Transport by a third or more). The **latest complete month** for fixed categories (swing under 10%). Categories that averaged nothing are skipped. |
| Episodic categories (median $0)? | **Seed the mean and flag them.** The user's goal is a modeling baseline, so the total stays honest; the editor says plainly that a monthly meter for these reads empty, then over, and that an annual envelope (rollover, the budgets spec's §6 v2 item) is the real fix. |
| Which kinds? | `living` only. `tax` (one $5,044 payment in the window) and `transfer` are never spending targets; they are listed with the reason. |
| Re-seeding later? | Same action, same endpoint, writes new dated rows from the chosen month — history before it is untouched. Because it rewrites budgets that already resolve for that month, it asks once, inline, and the whole batch is one Undo. |
| Modeling hook? | **Yes, small:** the Projection knobs card gets "Use my budgets" under the annual-spend knob — twelve times the living budgets resolved for the projection's start month, echoed by the server. Nothing else in the projection changes. |

## 1. The suggestion model (`services/budgets.py`)

One pure module owns every budget arithmetic the app has, so the seed, the chips and the
projection hook cannot drift:

- `resolve_budgets(rows, months)` — **moved** verbatim from `api/spending._resolve_budgets`
  (the spec §2 rule: the amount of the row with the greatest `effective_month <= M`). The router
  imports it; the two call sites and their tests are unchanged in behavior.
- `seed_window(entered, without_spending, current_month, limit=12)` — the months the averages
  read: the last `limit` months `m < current_month` that are in `coverage.entered` and **not** in
  `coverage.net_pay_without_spending` (a take-home-only month has nothing to average). Empty
  months (all-$0 rows, no take-home) are not entered, so they never dilute a mean — the
  2026-09-04 Sep-2026 lesson, applied.
- `summarize(amounts)` over a category's **non-null** amounts inside the window (`n`):
  `mean` (exact for rounding; echoed at cents HALF_UP), `median` (cents), `latest` + `latest_month`
  (the last window month that carries a row for this category), `cv` = sample standard deviation
  ÷ mean as a 4-dp ratio (None unless `n >= 2` and `mean > 0`). A window month with **no row**
  for the category is absent, not zero (A6); a `0.00` row is a real zero — the wizard writes
  every active category together.
- `profile` and `seed`, decided in this order:

  | order | profile | rule | seed |
  |---|---|---|---|
  | 1 | `dormant` | `n == 0` or `mean <= 0` | none — "nothing spent in the window" |
  | 2 | `sparse` | `n < 3` | none — "only {n} complete months" |
  | 3 | `fixed` | `cv < 0.10` | `ceil_dollars(latest)` |
  | 4 | `episodic` | `median == 0` | `ceil_dollars(mean)` |
  | 5 | `variable` | otherwise | `ceil_dollars(mean)` |

  `ceil_dollars` rounds **up** to the next whole dollar (`ROUND_CEILING`, then cents): a target
  reads as a chosen number, and a fixed cost never shows "over by $0.80". A non-`living` category
  gets its profile and figures for display but `seed = None` with `skip_reason = "kind"`.
  Constants: `SEED_WINDOW_MONTHS = 12`, `MIN_SEED_MONTHS = 3`, `FIXED_CV = Decimal("0.10")`.
- `load_suggestions(db, today)` — one coverage load, one categories query (active only — the card
  lists only active categories), one `monthly_spending` query bounded to the window; returns the
  window and one `Suggestion` per active category in the categories' sort order.

## 2. API (`api/spending.py`)

- **`GET /spending/budgets/suggestions`** → `BudgetSuggestionsOut { window_from, window_to,
  months, suggestions: [BudgetSuggestion] }` with `BudgetSuggestion { category_id, profile, months,
  mean, median, latest, latest_month, cv, seed, skip_reason }` (`skip_reason ∈ kind | dormant |
  sparse | null`). `window_*` are None and `months = 0` when nothing is entered. Read-only; no
  batch.
- **`POST /spending/budgets/seed`** body `{ effective_month: date }` →
  `BudgetSeedOut { effective_month, window_from, window_to, months, written: [AmountEntry],
  skipped: [{ category_id, reason }], batch_id }`.
  - Validation: `require_first_of_month`; **422** when the window has fewer than
    `MIN_SEED_MONTHS` months ("needs at least three complete months of spending").
  - For every suggestion with a non-null `seed`: if the budget already **resolved** for
    `effective_month` equals the seed, skip it with `reason = "unchanged"` (no redundant history
    step); else upsert the `(category, effective_month)` row exactly as the PUT does
    (`record_insert` after flush / `record_update` with the before-image). Non-seedable
    categories are echoed in `skipped` with their `skip_reason`.
  - One `ChangeBatch`, label `Seeded {n} budgets from averages, from {Mon YYYY}`, `month =
    effective_month`; `batch_id` is the batch's id or None when nothing changed (the wizard's
    contract — the client then offers no Undo). The Activity card's undo replays every row of the
    batch in one transaction, so a seed reverts as a unit.
  - `today` is `product_today()`, read at the route (the calendar/comp routes' posture) so the
    tests can pin it.

## 3. Budget card (`BudgetPanel.tsx`)

The card fetches `GET /spending/budgets/suggestions` once on mount, independently of the matrix.
A failed fetch degrades: meters and the editor keep working, the chips are absent, and the seed
button is disabled with "couldn't load suggestions".

**3.1 Empty state (no category has a resolved budget for the focused month).** The current
`empty-note` becomes a short block: "No budgets yet." · a `button-primary` **Start from my
averages** · one hint sentence: "Writes a budget for the {n} living categories with three or
more complete months, effective from {focused month}: the mean of {window words}, or the latest
month for steady costs like rent. Everything stays editable; one Undo reverts it all." The button
is disabled with the reason when `months < 3`. The nineteen disclosures stay below, as now.

**3.2 Seeded.** The click POSTs with the **focused month** (the A5 rule: the month the meters
read), then calls `onBudgetsChanged()` so the meters, the movers column and the chart steps
redraw from the refetched matrix, and raises the shell toast — `Seeded 13 budgets from averages,
from Jul 2026` — with an **Undo** action that calls `undoBatch(batch_id)` and refetches (the
wizard's pattern; no action when `batch_id` is null). A status line under the summary keeps the
skip detail until the next seed: "skipped 6 — 3 never spent, 3 not living spend".

**3.3 Re-seed (budgets exist).** A plain `button` **Re-seed from averages** sits right-aligned
in the summary row. First click shows an inline confirm line — "Rewrites {k} existing budgets and
sets {n − k} new ones from {focused month}. [Confirm] [Cancel]" — where `k` counts categories
whose seed is non-null and whose resolved budget for the focused month is non-null (both known
client-side). Confirm POSTs as in 3.2. Nothing before the focused month changes; the editor hint
already says so.

**3.4 Suggestion chips in every editor.** Under the amount box, one `budget-suggest` line:
`suggested $2,073` (the seed, or "no suggestion" with the skip reason) followed by three chips —
`mean $2,043.40 · median $2,030.00 · last $2,072.80` — each a button (aria-label "Use {category}
12-month mean $…") that sets the editor's amount to that figure. Chips render only for statistics
that exist. One profile cue, muted, under the chips:

| profile | cue |
|---|---|
| `fixed` | Steady — within 10% every month; the latest month is the honest target. |
| `episodic` | $0 most months, then spikes — the mean keeps the year honest, but a monthly meter reads empty, then over. An annual envelope is the real fix. |
| `variable`, `cv ≥ 1` | Varies a lot — the median is the typical month; the mean keeps the yearly total honest. |
| `variable` otherwise | *(none)* |
| `sparse` | Only {n} complete months in the window — not enough to suggest. |
| `dormant` | Nothing spent in the window. |
| non-living kind | Not living spend — the seed leaves tax payments and transfers unbudgeted. |

Grammar: no new colors — figures in the monospace `budget-figures` family, chips in the `.button`
family at the editor's font size, the suggested value in INK. Nothing here is a chart.

## 4. Modeling hook — Projection "Use my budgets"

- `ProjectionOut` gains `budget_annual_spend: Decimal | None = None` and `budget_month: date |
  None = None`: twelve times the sum of the **living** categories' budgets resolved
  (`resolve_budgets`) for `start_month` (the projection's t0, already echoed); None when no
  living category resolves a budget that month. Nullable-with-default, so stored older payloads
  validate (the `bands` posture). The projection's own derivation of `annual_spend` is unchanged.
- `ScenarioPanel.tsx`: under the `annual_spend` knob's "derived over …" line, when
  `baseline.budget_annual_spend` is non-null, a `button` **Use my budgets · $61,752/yr** calls
  `knob('annual_spend')(value, true)`. When the knob already holds that value the button reads
  "using your budgets" and is disabled. Hint text: "12 × the living-category budgets resolved for
  {budget_month}." The knob remains a knob — Reset to derived clears it as before.

## 5. Errors and edges

- Seed POST failures surface in the card's `FeedBanner` (the editor's pattern); the matrix is not
  refetched on failure.
- A category created recently has few rows in the window → `sparse`, skipped, chips show what
  exists. A category ended with a NULL marker at or before the focused month is re-opened by a
  seed — that is what re-seeding everything seedable means; Undo reverts it.
- A later-dated row (e.g. a hand-set budget from Oct 2026) survives a seed effective Jul 2026: the
  resolution rule hands the months from Oct back to it. No special casing.
- A refund-heavy category with `mean <= 0` is `dormant`. A window month with a take-home row and
  no spending rows is excluded from the window entirely (§1), so it neither counts as a month nor
  fabricates zeros.
- `cv` for `n < 2` is None; the `fixed` test needs `cv`, so a two-month category falls to `sparse`
  first anyway.

## 6. Testing

- **pytest, pure (`tests/test_budgets_service.py`):** `seed_window` skips the current month,
  skips take-home-only months, takes the last 12, handles fewer; `summarize` mean/median/latest/cv
  on odd and even `n`, absent-vs-zero rows; profile matrix (dormant incl. `mean <= 0`, sparse at
  `n = 2`, fixed at `cv < 0.10` with a step change → latest, episodic at `median == 0`,
  variable), kind skip, `ceil_dollars` (`2072.80 → 2073.00`, `1007.61 → 1008.00`, exact dollars
  unchanged). Every expected figure computed with the module before the plan is written.
- **pytest, routes (`tests/test_spending_api.py`):** GET shape and window echo with
  `product_today` pinned; POST writes inserts and updates in ONE batch with the label and
  `month`, echoes `written`/`skipped` with reasons incl. `unchanged` and `kind`, returns
  `batch_id`; matrix reflects the seeded budgets from the effective month; 422 on a
  non-first-of-month; 422 under three window months; an identical re-seed records no rows and
  returns `batch_id = None`. **`tests/test_changelog_routes.py`:** undoing the seed's batch
  removes every row it wrote. **`tests/test_projection_api.py`:** `budget_annual_spend` = 12 ×
  living budgets for `start_month`, ignores `tax`/`transfer`, None without budgets.
- **vitest (`BudgetPanel.test.tsx`):** empty state shows the primary button and POSTs the
  focused month, then refetches and toasts with Undo; disabled with the reason under three
  months; suggestions failure degrades; chips fill the amount box; the cue per profile; the
  re-seed confirm counts `k` and only POSTs on Confirm; `written`/`skipped` status line.
  `SpendingPage.test.tsx` and every other test mocking `api/spending` that mounts the panel gain
  the two new functions with resolved values. **`ScenarioPanel.test.tsx`:** the budgets button
  appears only with a non-null echo, sets the knob, reads "using your budgets" once set.
- Gates before merge: full pytest, ruff, vitest, `tsc -b`, eslint, `vite build`.

## 7. Out of scope (later)

Rollover / annual envelopes for the episodic categories (the honest fix for their meters), a
budget-history GET and a whole-table editor, seasonality-aware seeds (month-of-year), budgets on
`tax`/`transfer` kinds, a scheduled auto re-seed, budget-vs-actual charts, and an assistant tool
that seeds.

## 8. Amendments to prior specs

- `2026-08-24-category-budgets-design.md` §4.2: the empty state gains the seed action and the
  editor gains the suggestion chips; §6 keeps rollover as v2 and now names the episodic profile
  as its motivation.
- `2026-09-02-fresh-eyes-dashboard-audit.md` Spending idea #4 and pass-2 item #5: the bootstrap
  half is delivered here; the total-budget meter, variance bars and group budgets remain open.
