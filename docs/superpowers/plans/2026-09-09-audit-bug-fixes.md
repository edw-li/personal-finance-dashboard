# Audit bug fixes (2026-09-09) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. One
> implementer per lane in its own worktree, TDD per task, then a spec-compliance + code-quality
> review per lane, then merge to local main (never pushed) behind the full gates.

**Goal:** land the 25 audit items recorded in
`docs/superpowers/specs/2026-09-09-audit-bug-fixes-design.md` without changing any behavior the
record does not name.

**Architecture:** nine lanes cut along file ownership so worktrees merge cleanly. Lane I (the
product clock) runs first and alone because it touches files every other lane edits; lanes A–D and
E–H run in two waves of four. Each task below names the files, the decision it implements, the tests
that prove it and the acceptance check a reviewer applies. Implementers are trusted to write the
test and production code from the spec; the plan fixes behavior, not keystrokes.

**Tech stack:** React 19 + TypeScript + Vitest (jsdom) in `src/`; FastAPI + SQLAlchemy async +
pytest in `backend/`; ECharts 6; Alembic for the one migration (lane C).

**Gates at merge:** `npm run lint`, `npx tsc -b`, `npm test`, `npm run build`; backend
`ruff check app tests`, `ruff format --check`, `pytest` (own test DB per lane:
`FINANCE_TEST_DB=finance_test_<lane>`).

---

## Lane I — product clock (item 31) — FIRST, alone

**Files:** create `backend/app/services/clock.py`; modify every `date.today()` site in
`backend/app/api/*.py` and `backend/app/services/{assistant_chat,assistant_context,dividend_events,
espp_calc,price_service,scheduler,value_history}.py`; test `backend/tests/test_clock.py`.

- [x] `clock.product_today()` owns the Pacific calendar day; `scheduler.py` re-exports it.
- [x] Every "user's calendar day" call site becomes `clock.product_today()` (module attribute, one
      patch point). Deliberate UTC timestamps stay and are listed in the report.
- [x] Tests: `test_clock.py` (17:00+ PT instant → Pacific date; Dec 31 late PT → the year); existing
      tests that patched module-level `date` are updated. Full backend suite green.

**Acceptance:** `grep -rn "date.today()" backend/app` returns only sites the report justifies.

## Lane A — wizard spending (items 1, 18, 20)

**Files:** `src/pages/MonthlyUpdatePage.tsx` (+ `.test.tsx`), `backend/app/api/spending.py`,
`backend/app/schemas/spending.py`, `backend/app/services/health_checks.py` (+ tests).

- [x] Task A1 (server): `put_month` skips inserting a zero for a category with no existing row
      unless `confirm_zero`; result gains `skipped_blank`. Tests: body with net pay + all zeros creates
      the cashflow row and zero spending rows; body with one non-zero creates exactly one row; existing
      row + zero updates it to zero; `confirm_zero` still writes every zero.
- [x] Task A2 (client): the spending body includes stored-row categories plus non-zero entries only
      (all categories when the $0 box is ticked). Receipt sentence adds "· N categories left blank".
      Update the test that pinned the old behavior; add tests for the three body shapes.
- [x] Task A3 (health): zero-filled check also catches months with net pay and all-zero rows; same
      repair. Test with a seeded month.
- [x] Task A4 (item 18): `selectMonth` keeps the step unless the target has no balances. Test.
- [x] Task A5 (item 20): live/review savings rate uses `(net pay − living − tax) ÷ net pay` from
      category kinds; footer "Savings rate (cash)". Test with a transfer-kind category present.

**Acceptance:** take-home-only save → one cashflow row, zero spending rows; ribbon month switch from
the Spending step lands on Spending; wizard rate equals the server's for a month with transfers.

## Lane B — tax engine (items 2, 4a, 4b, 4e, 4f, 4g, 4h, 4i)

**Files:** `backend/app/tax_keys.py`, `backend/app/services/tax_service.py`,
`backend/app/services/tax_whatif.py`, `backend/app/api/taxes.py` (inputs suggestions,
`EngineFeed.computable`, `TaxInputsOut.unit`), `backend/app/schemas/taxes.py`;
`src/components/taxes/InputsForm.tsx`, `src/components/taxes/SummaryPanel.tsx`, `src/types/api.ts`;
tests beside each.

- [x] Task B1 (item 2): unit per key on the wire; form kinds (count / percent ↔ fraction); server
      ranges; relabels. Tests: count renders "20", percent renders "98%" and saves `0.98`; server 422
      outside range.
- [x] Task B2 (4a): excess deduction reduces stacked gains. Golden: agi < deduction with LTCG.
- [x] Task B3 (4b): `state_agi` subtracts `interest_us_treasuries`. Golden.
- [x] Task B4 (4h): §199A below the line; out of the itemized suggestion; relabel. Golden.
- [x] Task B5 (4f): federal Base = true AGI; effective rate divides by it. Goldens move; the
      By-jurisdiction hint says "AGI including gains and qualified dividends".
- [x] Task B6 (4g): `computable` refuses current/future single years with missing tables;
      grandfathers earlier single years. Tests for both.
- [x] Task B7 (4e): prior-year suggestions for the three deduction keys; amber Totals warning while
      both deduction keys are absent. Tests: suggestion present/absent; warning renders.
- [x] Task B8 (4i): anniversary-based long-term test with Feb 29 handling. Tests.

**Acceptance:** each golden documents the before/after figure in its docstring.

## Lane C — withholding split (items 3, 4c, 4d)

**Files:** `backend/alembic/versions/2026MMDD_HHMM_<rev>_paycheck_profile_withholding_split.py`,
`backend/app/models/comp.py`, `backend/app/schemas/paycheck.py`, `backend/app/api/paycheck.py`
(validators, fence table), `backend/app/services/withholding_calc.py`, `backend/app/api/taxes.py`
(withholding route, harbors), `backend/app/schemas/taxes.py`, `backend/app/tax_keys.py`
(`w2_bonus_withholding`); `src/pages/PaycheckPage.tsx` (profile form + table columns),
`src/components/taxes/WithholdingPanel.tsx`, `src/types/api.ts`; tests beside each.

- [x] Task C1: migration + model + schemas + validators for `fed_withholding_pct` /
      `state_withholding_pct` (nullable, 0–1). Profile form fields with the paystub hint; history
      table columns. Tests: round-trip, validation.
- [x] Task C2: `withholding_calc.estimate` computes per-jurisdiction legs when both rates exist;
      bonus leg (4c) at 22 % + 6.6 % + marginal FICA, overridden by `w2_bonus_withholding`; 37 % tier
      (4d) with warning. Existing combined fields unchanged. Tests per leg and for the tier crossing.
- [x] Task C3: `withholding_estimate` fills `WithholdingOut.jurisdictions` with liabilities from the
      engine, federal and California harbors, balances and per-check remedies; null when the split is
      unavailable. Tests: split available / unavailable; CA ≥ $1M rule.
- [x] Task C4: `WithholdingPanel` renders the three tiles, harbor sentences and remedies, or the
      combined card plus the nudge. Tests for both states.

**Acceptance:** with rates entered, the card shows a federal and a California balance that sum with
payroll to the combined figure; calendar tests still pass (they read the combined fields).

## Lane D — calendar and cards (items 6, 7, 13, 53, 54)

**Files:** `src/components/creditcards/rewardsMath.ts`, `src/components/creditcards/CategoriesPanel.tsx`;
`backend/app/api/calendar.py` (`_tax_facts`); `src/pages/CalendarPage.tsx`, `src/pages/CalendarPage.css`,
`src/components/calendar/CalendarGrid.tsx`, `src/components/calendar/calendarView.ts`; tests beside each.

- [x] Task D1 (item 6): non-null denominator; caption "auto · from N entered months". Test with a
      null month.
- [x] Task D2 (item 7): prior-year facts when the prior Q4 date is ahead and in the window. Test with
      today = Jan 5.
- [x] Task D3 (item 13): `showMonth` moves `activeDay` (clamped same day / today / first). Test that
      a tabbable cell exists after each navigation.
- [x] Task D4 (item 53): formatted list amounts. Test.
- [x] Task D5 (item 54): chip = label span (ellipsis) + amount span (never clipped); `chipText` split.
      Test that the amount text node is present and separate.

## Lane E — assistant grounding (item 8)

**Files:** `backend/app/services/assistant_context.py`, `src/components/assistant/AssistantDrawer.tsx`,
`src/pages/ProjectionPage.tsx`, `src/components/assistant/viewState.ts` (if the view type grows);
tests beside each.

- [x] Task E1: month normalization (`YYYY-MM` → first of month) in the spending builder; the
      net-worth builder honors the month. Tests with a short month.
- [x] Task E2: ProjectionPage publishes `whatif` entries; `_projection` decodes knob and retire
      entries into `projection()` parameters. Tests: a knob entry changes the payload.
- [x] Task E3: humanized "Seeing:" chip (page · month · owner · year/status in words). Tests.

## Lane F — overview and shell (items 9, 12, 14, 15, 39, 60)

**Files:** `src/pages/OverviewPage.tsx`, `src/components/overview/overviewChartOptions.ts`,
`src/pages/PortfolioPage.tsx` (header only), `src/components/shell/SidebarFooter.tsx`,
`src/components/Layout.tsx`, `src/pages/LoginPage.tsx`, `src/components/usePageTitle.ts`,
`index.html`; tests beside each.

- [x] Task F1 (item 9): owner guard on the live ping. Test.
- [x] Task F2 (item 14): not-entered months excluded from `avg12`, drawn hollow. Tests.
- [x] Task F3 (item 15): "today" vs "on {date}". Test.
- [x] Task F4 (item 11, Overview half): "—" tile + note for an owner with no accounts. Test.
- [x] Task F5 (item 12): header wording for an empty scope. Test.
- [x] Task F6 (item 39): toast with Undo when leaving `system`. Test.
- [x] Task F7 (item 60): one product name in five places; title tests updated.

## Lane G — net worth and spending feeds (items 10, 11, 23)

**Files:** `src/pages/NetWorthPage.tsx`, `src/pages/SpendingPage.tsx`, `src/utils/format.ts`,
other pages' load catches (sweep), `backend/app/api/net_worth.py`, `backend/app/schemas/net_worth.py`,
`src/api/netWorth.ts`, `src/types/api.ts`; tests beside each.

- [x] Task G1 (item 10): independent feeds on Net worth and Spending with a `FeedBanner` for the
      secondary feed; `describeError` in every page's catch. Tests: summary 500 leaves charts up.
- [x] Task G2 (item 11): empty-scope note on Net worth; `formatCurrencyCompact` sub-dollar decimals.
      Tests.
- [x] Task G3 (item 23): `granularity` on the summary; `period` on the wire; tiles say "vs prior
      quarter"; ribbon snap. Tests server and client.

## Lane H — paycheck presets and portfolio accounts (items 5, 27, 29)

**Files:** `backend/app/services/limit_check.py`, `backend/app/services/pace_walk.py`,
`backend/app/api/paycheck.py` (`_pace_rows`), `backend/app/schemas/paycheck.py` (`PaceItemOut`);
`src/components/paycheck/paycheckScenario.ts`, `src/components/paycheck/TryItPanel.tsx`,
`src/pages/PaycheckPage.tsx` (`employerHsaWords`), `src/components/portfolio/TransactionsPanel.tsx`,
`src/components/portfolio/DividendsPanel.tsx`, `src/pages/PortfolioPage.tsx` (accounts fetch);
tests beside each.

- [x] Task H1 (item 5, server): `remaining_checks`, `remaining_gross`, `to_cap_rate`,
      `to_cap_per_check` on pace rows, floored to land at ratio 1.0000. Tests: mid-year profile lands
      exactly; already-over row yields 0.
- [x] Task H2 (item 5, client): presets read the server figures; Max 401(k) subtracts the scenario
      Roth; disabled chips explain. Tests.
- [x] Task H3 (item 29): coverage-aware employer HSA sentence. Test.
- [x] Task H4 (item 27): datalist of labels + "new account" note in both forms. Tests.

---

## Merge order and verification

1. Lane I → main. 2. Lanes A–D (parallel) → main, each after review. 3. Lanes E–H (parallel) → main.
4. Full gates on merged main; a short integration pass fixes fallout. 5. Update this plan's checkboxes
and the spec status; record the merge in memory.
