# Audit bug fixes (2026-09-09) — design record

**Status:** implementing, 2026-09-09. Source: the 2026-09-08 fresh-eyes audit (reports under the
gitignored `scratchpad/audit-2026-09-08/`). The user picked items 1–15, 18, 20, 23, 27, 29, 31, 39,
53, 54 and 60 of the audit's bug list. Each item below records the verified root cause, the
decision, and the behavior the end user should see. The plan that executes it is
`docs/superpowers/plans/2026-09-09-audit-bug-fixes.md`.

House rules that hold everywhere: money math lives on the server (the client subtracts two rates
only where this record says so); every write that touches money goes through a `ChangeBatch`;
absent ≠ zero; percents are percents in the UI and fractions on the wire; copy names the noun and
the reason ("Couldn't load the summary — the request timed out").

---

## 1. Phantom `$0.00` spending rows (wizard + `PUT /spending/months/{m}`)

**Root cause.** `MonthlyUpdatePage` seeds every active category with `"0.00"` and its save body
always lists every active category (`amounts: categories.map(...)`). The server's empty-month guard
(`spending_guard.records_something`) only asks whether the body records *anything*, which a net-pay
figure satisfies, and the upsert loop in `put_month` then inserts a row for every category id it
receives, zeros included. The same path writes a phantom zero when an older month is edited after a
new category was created. `MonthlyUpdatePage.test.tsx` ("net pay alone saves the cashflow row, with
every blank category as $0.00") currently pins the wrong behavior.

**Decision.**
- Client: the spending body carries (a) every category that already has a stored row for the month
  (so a real correction to zero persists), plus (b) any category whose current value is non-zero.
  Blank/zero categories with no stored row are omitted. When "Record this month as $0" is ticked the
  body carries every category at `0.00` with `confirm_zero`, exactly as today.
- Server: in `put_month`, a zero amount for a category with **no existing row** is not inserted
  unless `confirm_zero` is set; it is counted as `skipped_blank` in the result.
- Receipt: "Spending: 3 rows (2 added, 1 changed) · 16 categories left blank."
- Health: the existing zero-filled-month check also flags months whose stored rows are all `0.00`
  **with** a net-pay row, offering the same "delete the zero rows" repair.

**Expected.** Entering only the take-home writes the cashflow row and nothing else; averages,
movers, heatmap, typical-spend and the budget seed never see a fabricated zero.

## 2. Money formatting on non-money tax inputs

**Root cause.** `InputsForm` renders every tax key through `AmountInput` with the default `money`
kind; `TAX_INPUT_DEFINITIONS` carries no unit. The engine multiplies `pay_periods` by the gross
paycheck as a count and multiplies `unq_div_state_exempt_pct` directly as a fraction.

**Decision.** `tax_keys.py` gains a unit per key (`money` default, `count` for `pay_periods`,
`percent` for `unq_div_state_exempt_pct`), returned on each `TaxInputsOut` item as `unit`. The form
passes the matching kind: a count renders as an integer, a percent renders as "98%" and stores
`0.98`. Server validation: `pay_periods` integer 0–53, percent keys 0–1. Labels: "Pay periods
(checks received so far this year)", "Treasury-fund dividends — state-exempt share (%)".

## 3. One combined withholding balance; remedy aimed at the wrong form

**Root cause.** `withholding_estimate` sums federal + California + Medicare + Social Security + SDI
+ capital gains + NIIT into one liability and one all-in withholding (the profile's single
`withholding_pct` plus vest legs), and the panel divides the combined gap by the remaining checks
into "W-4 line 4c".

**Decision.**
- `paycheck_profiles` gains two nullable `Numeric(10,9)` columns, `fed_withholding_pct` and
  `state_withholding_pct` (alembic migration; model, `ProfileIn/Out`, validators, profile form). The
  existing all-in `withholding_pct` is unchanged and still drives the per-check breakdown.
- When both rates are set, `withholding_estimate` reports per-jurisdiction legs: federal withheld =
  fed rate × taxable per check over the grid + vest 22 % (37 % above $1M cumulative, item 4d) + bonus
  22 %; state withheld = state rate × taxable + vest 10.23 % + bonus 6.6 %; payroll (FICA) withheld
  = all-in − fed − state (informational). Liabilities per jurisdiction come from the engine summary.
  `WithholdingOut` gains `jurisdictions: {federal, state, payroll}` each with `liability`,
  `withheld_ytd`, `withheld_projected`, `balance`, `safe_harbor` (federal: lesser of 100/110 % prior
  federal tax and 90 % current; California: lesser of 100/110 % prior CA tax and 90 % current, and
  90 % current only when current CA AGI ≥ $1M) and `remedy_per_check`. All existing fields stay and
  keep their combined meaning (the calendar and the assistant read them).
- Panel: with the split available, three tiles — Federal balance, California balance, Payroll taxes
  (informational) — each with its own owe/refund words, harbor sentence and remedy line ("Add $X per
  remaining paycheck on W-4 line 4c", "Add $Y per remaining paycheck on DE 4"); a fourth line keeps
  the combined total. Without the split, today's combined card plus one nudge: "Enter the federal
  and state rates from a paystub on your paycheck profile to split this."

## 4. Tax-engine gaps

- **4a Unused deduction vs preferential income.** `fed_ti = agi − deduction` is clamped at zero by
  `walk`, and `stack` clamps the base at zero, so excess deduction never reduces gains. Decision:
  `ordinary_ti = max(agi − deduction, 0)`, `excess = max(deduction − agi, 0)`, stack
  `max(gains − excess, 0)` on `ordinary_ti`.
- **4b California Treasury interest.** `state_agi` subtracts only the exempt slice of Treasury-fund
  dividends. Decision: also subtract `interest_us_treasuries`.
- **4c Bonus withholding leg** (built in the withholding lane). `w2_bonuses` raises the liability but
  the estimate has salary and vest legs only. Decision: a bonus leg at 22 % federal + 6.6 % California
  + marginal FICA, overridden by the new optional input `w2_bonus_withholding` when entered. The leg
  is the PRIMARY's alone — their `w2_bonuses` minus the partner's — because its marginal FICA stacks
  on the primary's wage base and its supplemental tier is theirs, and a partner's withholding is
  already counted once from their own two tracker keys.
- **4d Supplemental rate tier** (withholding lane). Decision: federal supplemental switches from 22 %
  to 37 % for the portion of cumulative supplemental wages (vests + bonuses, in date order) above $1M
  in the calendar year; a warning names the crossing.
- **4e Standard deduction defaults to zero.** Decision: `GET .../inputs` offers `standard_deduction`,
  `state_standard_deduction` and `state_exemption_credits` as suggestions from the prior year when
  the current year's key is absent (chip labelled "last year's"); the Totals card shows an amber
  warning "No standard or itemized deduction entered for {year} — federal tax is overstated" while
  both deduction keys are absent, instead of burying the key in the muted defaulted-to-zero list.
- **4f "AGI" is ordinary AGI.** The federal Base and effective rate use `_federal_agi`, which
  excludes long-term gains and qualified dividends. Decision: the federal Base is true AGI (ordinary
  AGI + LTCG + qualified dividends); the effective rate divides by it; goldens move accordingly.
- **4g Single years never refuse.** `EngineFeed.computable` returns True for `single` regardless of
  tables. Decision: single years before the current calendar year keep computing (imported history);
  the current and future years refuse like married years do (tiles "—", the existing call to action).
- **4h Section 199A.** Treated as an itemized component, so it vanishes under the standard deduction.
  Decision: a below-the-line deduction applied regardless of itemizing; removed from the itemized
  suggestion; relabelled "Sec 199A QBI deduction (20 % of qualified REIT/PTP dividends)".
- **4i Long-term test.** `> 365 days`. Decision: long-term when the sale date is strictly after the
  purchase date's first anniversary (Feb 29 → Mar 1 in a non-leap year).

## 5. Paycheck presets that produce false "over" verdicts

**Root cause.** Max 401(k) sets the traditional percentage to `limit ÷ salary` without subtracting
Roth and without regard to what the payday walk has already counted; Max HSA sets the per-check
amount to `limit ÷ periods` and ignores the employer deposit the same row counts.

**Decision.** `PaceItemOut` gains `remaining_checks`, `remaining_gross`, `to_cap_rate` (the total
elective rate over the remaining checks that lands exactly on the cap, 401(k) row) and
`to_cap_per_check` (HSA row), each computed server-side from the walk, floored so the projection is
≤ the cap and the 4 dp ratio reads 1.0000. Max 401(k) applies `max(0, to_cap_rate − roth_pct)` where
`roth_pct` is the scenario's Roth (this subtraction of two rates is the one client-side operation);
Max HSA applies `to_cap_per_check`. A chip whose target exceeds its slider is disabled with a title
saying so.

## 6. Credit-card weights understated by unentered months

**Root cause.** `suggestedAnnualSpend` annualizes as `sum × 12 ÷ n` with `n = min(12, months)`, and
`n` counts months whose value is null.

**Decision.** Divide by the count of non-null months in the window; the Categories & weights caption
reads "auto · from N entered months".

## 7. January estimated payment loses its amount

**Root cause.** `_tax_facts` returns facts only for `today.year`; the Jan 15 event maps to tax year
`year − 1` and finds nothing.

**Decision.** When the prior year's Q4 date is on or after today and inside the window, build a
`TaxFacts` for `year − 1` from the prior-year estimate already computed for the April filing branch
and return both years. The payment keeps its shortfall share until the date passes.

## 8. The assistant explains the wrong month

**Root cause.** The URL carries `month=YYYY-MM`; `_spending_builder` parses it with
`date.fromisoformat`, which rejects the reduced form on Python 3.12 and falls back to the latest
month; `_net_worth_builder` ignores the month; the drawer's "Seeing:" chip prints raw keys and never
the month; the Projection page publishes nothing.

**Decision.** Normalize `YYYY-MM` to the first of the month before parsing; honor the month in the
net-worth builder (summary for that month, `viewed_month` in the payload); ProjectionPage publishes
its `whatif` entries through `useAssistantView`, and `_projection` decodes them into knob and
retirement parameters (the same grammar `sandbox_links` encodes); the chip is humanized: page label,
then the month ("Mar 2026"), owner ("Household" / a person's name), year and filing status in words.

## 9. Live price dot on the wrong series

**Root cause.** `OverviewPage` passes owner-filtered holdings into the household-wide history chart
unconditionally; `PortfolioPage` guards with `owner === null`.

**Decision.** The same guard on Overview.

## 10. One failed request blanks a page with raw server text

**Root cause.** Pages load feeds in one `Promise.all`, store `ApiError.message` (the server detail),
and `PageFrame` prints `resource.error` verbatim when no data is present.

**Decision.** Net worth and Spending load their two feeds independently: a failed summary (or yearly
rollup) shows a `FeedBanner` naming the noun and reason with Retry while everything else renders; a
failed primary feed shows the frame alert through `describeError(err, 'net worth')`. Every other
page's load catch that stores a raw message goes through `describeError` with its noun.

## 11. Zero walls and a nonsense axis for an owner with no accounts

**Root cause.** The summary returns zero totals for an owner with no accounts; the chart receives an
all-zero series and ECharts picks a 0..1 range; `formatCurrencyCompact` rounds fractional ticks to
"$0"/"$1".

**Decision.** Net worth: when the scoped timeseries has no accounts, render "No accounts for {name}
yet — add one in Settings → Accounts" in place of tiles, charts and table. Overview: the net-worth
tile reads "—" with the same note under it and the trend card shows the note. `formatCurrencyCompact`
renders values under one dollar with two decimals so no axis can print that ladder again.

## 12. Contradictory Portfolio header under an empty scope

**Root cause.** `as_of` is the oldest quote among scoped holdings, null when the scope holds nothing,
so the header says "prices never refreshed" above a refresh line that says otherwise.

**Decision.** With zero holdings in the view the header reads "no priced holdings in this view";
"prices never refreshed" is shown only when the refresh status has no last run.

## 13. Calendar keyboard cursor lost after mouse navigation

**Root cause.** `showMonth` changes the scope but not `activeDay`; only the active day's cell is
tabbable.

**Decision.** Previous/Next move the active day to the same day-of-month in the target month
(clamped); Today sets it to today; the month box sets the first of the month.

## 14. Overview 12-month average counts missing months as zero

**Root cause.** `spendStats` averages matrix totals whose months include net-pay-only months stored
as `"0.00"`; the RATIFIED comment predates `/coverage`, which now distinguishes them and is already
on the page.

**Decision.** `spendStats` and `recentSpendOption` receive the set of not-entered months
(`spending_missing` ∪ `net_pay_without_spending`); those months are excluded from the average and
drawn as hollow bars whose tooltip says "not entered".

## 15. "Today" on a stale quote

**Decision.** The Portfolio tile's delta reads "today" only when the newest quote date is today
(browser-local); otherwise "on Sep 4".

## 18. Month switch resets the wizard to Balances

**Decision.** `selectMonth` keeps the current step unless the target month has no balances yet.

## 20. Wizard savings rate disagrees with the Spending page

**Decision.** The live and review savings rate is `(net pay − living − tax) ÷ net pay` using the
category kinds on the wire; the footer label reads "Savings rate (cash)".

## 23. Quarterly view shows monthly tiles

**Root cause.** `GET /net-worth/summary` has no granularity parameter; the timeseries drops to
quarter ends while tiles, the change line and the movers stay monthly.

**Decision.** The summary accepts `granularity=quarterly`: the viewed snapshot is the latest
quarter-end (or the quarter-end at or before `month`), the prior is the previous quarter-end,
`SummaryOut.period` is `"month" | "quarter"` and the tiles say "vs prior quarter". Under quarterly a
ribbon pick snaps to its quarter end.

## 27. Typed account label silently creates an owner-tagged account

**Decision.** The Transactions and Dividends forms offer the existing portfolio account labels in a
datalist; when the typed label matches none, an inline note reads "New account 'X' will be created
and assigned to {primary} — re-tag it in Settings → Accounts". Submission is unchanged.

## 29. Employer HSA sentence ignores coverage

**Decision.** `employerHsaWords` reads the coverage select: family coverage names the dependents
clause; self-only or none omits it.

## 31. Two clocks decide "today"

**Decision.** `app/services/clock.py` owns `product_today()`; every "user's calendar day" in the API
and services calls it (`clock.product_today()` so tests patch one symbol); deliberate UTC timestamps
stay UTC.

## 39. Footer theme button silently abandons "System"

**Decision.** The two-state toggle stays; when the stored choice is `system`, the click shows a toast
"Theme set to light — no longer following your system" with Undo restoring `system`.

## 53 / 54. Calendar list raw amount; chips truncate the amount first

**Decision.** The list item summary formats through `formatCurrency`. Chips become a flex row: the
label ellipsizes, the amount never does.

## 60. Three product names

**Decision.** One name, "Personal finance": login heading, `index.html` title, tab titles
"{label} · Personal finance", "Sign in · Personal finance", "Not found · Personal finance".
