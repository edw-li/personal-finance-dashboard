# Category Budgets with Progress Meters — Design Spec

**Date:** 2026-08-24 · **Status:** approved, not yet implemented
**Touches:** one additive migration (`category_budgets`), `models/spending.py`, `api/spending.py` (matrix enrichment + budget PUT + drive-by N+1 fix), `schemas/spending.py`, `/spending` page (Budget panel + chart reference lines), monthly-update wizard step 2, `src/types/api.ts`.

## 1. Context & goals

Spending today is entirely retrospective — the only reference line is the 4%-rule. Budgets convert the page from recording to steering: a target per category, meters against completed months, and live feedback at the moment of entry (the wizard). Monarch-class budget UX fits this app's monthly-aggregate model exactly (its budgets are monthly-per-category too).

**Stated constraint:** with no transaction layer there is no mid-month pacing. Meters describe **completed months** plus the **live wizard entry** — that is the honest version of "progress bars" for this architecture, and the spec deliberately promises nothing else.

### User-confirmed decisions (2026-08-24 Q&A)

- **Effective-dated budgets** (option B), not a column on the category: a budget change must never rewrite history. Last March's over/under verdict is frozen at what the budget *was* in March — the app's historical-parity ethos (tax drifts, sheet-cadence series) applied to budgets.

## 2. Data model — one additive migration

`category_budgets` (chain onto the alembic head current at implementation time; README §4.3 law):

| column | type | notes |
|---|---|---|
| `id` | int PK | |
| `category_id` | FK → spending_categories, `ondelete="CASCADE"` | |
| `effective_month` | Date | first-of-month CHECK (the `monthly_spending` constraint's pattern) |
| `amount` | Numeric(12, 2), **nullable** | NULL = "no budget from this month on" (an explicit end-of-budget marker, so clearing is itself dated history) |

UNIQUE `(category_id, effective_month)`. Resolution rule: the budget for month M is the `amount` of the row with the greatest `effective_month <= M`; no row ⇒ unbudgeted. Dashboard-only, importer-immune (the `rsu_grants` posture — the workbook has no budgets concept; pinned by an importer test).

## 3. API

- **`PUT /spending/categories/{id}/budget`** — body `{amount: Decimal | null, effective_month: date}`. Upserts the `(category, month)` row (last write wins; single-user TOCTOU posture). Validation: first-of-month, `quantize_money` at `MONEY_MAX_ABS_12_2`, `amount >= 0` when non-null, 404 unknown category. Response: the category's full budget history (list of `{effective_month, amount}`) so the editor can render it without a second fetch. A `DELETE .../budget/{effective_month}` removes a history row (fixing a mis-dated entry; distinct from the NULL-amount "budget ended" marker).
- **Matrix enrichment** (`GET /spending/matrix`): each `CategorySeries` gains `budgets: list[Decimal | None]` aligned with `months` (resolved per month via one query over `category_budgets` + in-Python resolution — the table is tiny); `MatrixOut` gains `total_budget: list[Decimal | None]` (sum of resolved budgets per month; None when no category has one).
- **Drive-by (sanctioned targeted fix):** replace the per-month `investable_base` await loop in `matrix` (`api/spending.py` four-pct block — the 2026-08-24 audit's N+1, ~2 queries × months) with one grouped query resolving all months' bases; behavior identical, pinned by the existing endpoint tests.

## 4. Frontend

### 4.1 Wizard step 2 (the highest-value integration)

Each category row with a resolved budget for the month being entered shows "of {budget}" as muted subtext under the amount cell, and the row's Δ/amount tone compares **amount vs budget** (over ⇒ negative tone) alongside the existing vs-last-month signal. Unbudgeted rows are unchanged. No new inputs, no gating — budgets never block a save (they are advice, not validation).

### 4.2 `/spending` Budget panel

New card, wired to the page's focused month (default: latest month with data):

- One meter row per **budgeted** category: thin 4 px rounded bar (marks spec), fill = min(spent/budget, 1), NEGATIVE-toned overflow tick beyond 100%; label = category name (INK), right-aligned "spent / budget" in text tokens. Unbudgeted active categories listed collapsed below ("no budget — set one").
- Summary line: "{n} of {m} budgeted categories over in {month}".
- **Inline budget editor** (this doubles as the app's first budget-management surface): per category, current budget `AmountInput` + an effective-from month input (defaults to next month; entering a past month deliberately re-writes what that era's budget was — the editor says so in a hint). Save per row via the PUT; the response's history renders in a small expandable per-category list with the DELETE affordance.
- Meters are plain HTML/CSS (StatTile family), not ECharts.

### 4.3 Chart reference lines

- Category-trend chart: when a picked category has a budget, draw it as a dashed MUTED step line (budget changes are steps, not slopes) — the 4%-rule line's exact styling grammar.
- Stacked monthly chart: optional `total_budget` dashed line, same grammar, legend-toggleable.
- Movers table: a "vs budget" delta column for budgeted categories in months where both exist.

## 5. Testing

- **pytest:** model/migration round-trip (CI's alembic gate covers downgrade); resolution rule (no row / one row / step change / NULL end-marker / re-dated past row); PUT validation matrix (non-first-of-month 422, negative 422, unknown 404); matrix `budgets`/`total_budget` alignment incl. None gaps; importer pin (budgets untouched by re-import); N+1 fix keeps four-pct values byte-identical on the existing fixtures.
- **vitest:** wizard row shows budget subtext + over-budget tone and never blocks save; meter math (fill clamp, overflow tick); editor save→history render; step-line option builder; movers column presence rules.

## 6. Out of scope (v2 candidates)

- Mid-month pacing (needs transactions), budget alerts/digests (pairs with a future weekly-recap job), category groups, rollover budgets, income budgets. Category rename/archive management UI beyond the budget editor stays with the existing categories CRUD surface.
