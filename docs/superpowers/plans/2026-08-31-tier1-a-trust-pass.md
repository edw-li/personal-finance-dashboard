# Tier 1 Plan A: Trust Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the eight "numbers that can render wrong" findings ratified in the 2026-08-31 Tier-1 spec, Workstream A (A1–A8): the wizard's liability-sign trap gets an advisory amber cue with a one-click flip (never a gate); the net-worth page stops sharing one legend map between two charts whose series names can collide; the portfolio live ping stops drawing a fake cliff on person-scoped views; the "prices as of" header wears the app's stale treatment and names both quote clocks; the budget editor defaults its effective date to the month the meters actually read; spending charts stop painting absent months as $0 stacks (nulls flow through, the tooltip says "no spending entered", the 12-month average stops being diluted); the savings-rate axis floor expands to the data instead of silently clipping a −180% month; and the wizard's two-PUT save tells the truth about a half-landed save and retries only the failed leg. No schema migrations and **no server changes anywhere in Plan A** — A4 reuses the `latest_quote_at` clock the holdings payload already carries.

**Architecture:** Every fix is a pinned-regression-test-first edit to an existing surface — no new components, no new endpoints, no new dependencies. A1/A8 live in `src/pages/MonthlyUpdatePage.tsx` (A8 adds one page-state slot remembering the committed balances leg, keyed by month + the exact canonical payload it shipped, so a *pure* retry skips the balances PUT while an edited retry honestly re-sends it). A2 splits `NetWorthPage`'s single `legendSelected` map into `stackedLegend`/`drillLegend`, each fed only to its own `<EChart>`. A3 is a call-site change: `portfolioHistoryOption(history, owner === null ? liveFromHoldings(holdings) : null, events)` — the builder stays pure and shared with Overview. A4 is frontend-only: the payload already carries both clocks (`as_of` oldest, `latest_quote_at` newest — `portfolio.py:629–630`), so the header's tooltip reads `latest_quote_at` for its "newest" clause and the styling reuses `isStaleQuote` + the `--warn` token every other stale cue wears (orchestrator amendment 2026-08-31: no twin field, no server changes anywhere in Plan A). A5 is a one-line default change in `BudgetPanel` plus promoting the past-dating hint into the editor's control row. A6/A7 land together in `SpendingPage`'s option memos + `spendingChartOptions.ts` (the tooltip already carries the null-skip `finite` filter — what changes is the *data* passing nulls through, the "no spending entered" line, the non-null-months average, and the axis floor). CSV output is deliberately untouched and pinned so. jsdom never renders echarts (house law): page tests extend the existing `EChart` marker mocks with additive `data-*` attributes and synthetic event hooks.

**Tech Stack:** React 19 + TypeScript 5 (strict) + Vitest 3 + @testing-library/react 16 + ECharts 6 on the frontend; FastAPI + pytest on the backend for **verification only** — Plan A ships zero backend changes. No new dependencies, no migrations.

**Spec:** `docs/superpowers/specs/2026-08-31-tier1-trust-lifecycle-tax-planning-design.md`, Workstream A. Its decisions are ratified — in particular: A1 is advisory (Next/Save never disabled), A2 is *two separate state objects*, A3 renders the ping only when `owner === null`, A4 is display-only with **zero server changes** (the spec's original "additive nullable `as_of_newest`" instruction was amended 2026-08-31 by the orchestrator to reuse the existing `latest_quote_at` — plan and spec agree), A5 defaults to the focused month and keeps (promotes) the past-dating hint, A6 keeps the CSV byte-identical, A7 keeps the +100% ceiling with the spec's exact floor formula `Math.min(-1, Math.floor(extent.min))`, A8 adds **no new endpoint**.

**Branch:** all work happens on the existing `tier1-batch` (off `main` @ `e57a9bd`). Never push.

**House rules that bind every task:**
- Decimal **strings** on the wire — `Number()` only at chart/format boundaries.
- echarts is never rendered in jsdom; page tests mock `../components/EChart` with a marker div and pin option slices via `data-*` attributes.
- `npx vitest run <file>` is run bare (no `--`) from the repo root; backend commands run from `backend/` with `.venv/Scripts/python.exe` (Windows Git Bash).
- Comments explain constraints, not narration. Frequent small commits, conventional messages. **Never push.**

**Verified anchors vs the spec (drift notes for the implementer):**
- `MonthlyUpdatePage.tsx`: liability hint at **:824–826**, balances card **:662–859** (per-row `<td className="num entry-cell-col">` at :752–766), save flow **:370–438** (balances PUT :386, spending PUT :405, catch :433–435) — spec's :386/:434 anchors are inside this span.
- `NetWorthPage.tsx`: legend state is **:139–147** (spec said :139–145 — the merge handler spills two lines); `legend.selected` consumed at :282 (stacked) and :399 (drill); `<EChart>` usages :590–598 and :640–647.
- `PortfolioPage.tsx`: live ping **:394**, memo deps :406, header **:428–441**, owner caveat `<p className="hint">` :576–582, `asOf` derivation :365.
- `backend/app/api/portfolio.py`: `as_of=min(quote_times, ...)` at **:629**, `latest_quote_at=max(quote_times, ...)` at :630 — **read-only reference** for A4's reuse decision; no backend file is modified by this plan.
- `BudgetPanel.tsx`: default **:45–48**, hint **:156–159** — both exact.
- `SpendingPage.tsx`: null coercion **:214–219** (`otherPerMonth`) and **:258** (per-category bar data); savings axis **:484–491** (the min/max functions sit at :488–489); 12-mo average **:567–568**.
- Null-skipping tooltip house pattern: `src/components/portfolio/historyChartOptions.ts:203–230` — confirmed.

**Where the current code already differs from the spec's assumptions (resolved, do not re-litigate):**
1. **A4:** the holdings payload *already* carries the newest quote as `latest_quote_at` (`portfolio.py:630`, added for the live-ping dating fix) — the spec's "additive nullable `as_of_newest`" line predates that field surfacing. **Resolved by orchestrator amendment, 2026-08-31: reuse `latest_quote_at`; no twin field.** The repo's one-definition-two-consumers law outweighs speculative-divergence grounds for a duplicate value, and `latest_quote_at`'s documented meaning ("the NEWEST quote") is exactly the header tooltip's clock. The spec is amended to match, so plan and spec agree; A4 is frontend-only.
2. **A6 (average):** `matrix.totals` is `string[]`, never null — the server sums an absent month to `"0.00"` (`backend/app/api/spending.py:288–294`). "Divides by the count of non-null months" is therefore implemented as *months where any category series value is non-null* — the exact rule `filledMonths` already uses for the ribbon.
3. **A6 (tooltip):** `spendingBarsTooltipFormatter` already skips non-finite rows (the `finite` filter, 2026-08-25). What Task 6 adds is the data-level null pass-through, the "no spending entered" line, and the average fix.
4. **A8:** there is no dedicated Retry button today — the review step's primary is the retry path. Task 7 relabels it **"Retry spending"** while the balances leg is remembered, and updates the one existing test that clicks "Save month" after a failure.

---

## Task 0: Baseline

**Files:** none (verification only).

- [ ] Confirm the branch: `git rev-parse --abbrev-ref HEAD` → expect `tier1-batch`; `git status --short` → clean (the spec doc commit `a429af7` is already on the branch).
- [ ] Record the frontend baseline: `npm test` → expect green, ≈1284 passed at branch point. Write the actual count into the journal/notes for the final task's comparison.
- [ ] Record the backend baseline: `cd backend && .venv/Scripts/python.exe -m pytest -q` → expect green, ≈1206 passed. Record the actual count.
- [ ] No commit.

---

## Task 1: A1 — Wizard liability sign: warn + one-click flip

**Files:**
- Modify: `src/pages/MonthlyUpdatePage.tsx` (flip helper near `committed` at :581; cue inside the balance cell `<td>` at :752–766; the :824–826 hint line **stays**)
- Modify: `src/pages/MonthlyUpdatePage.css` (append the cue rule after `.entry-budget.delta-negative` at :208–210)
- Test: `src/pages/MonthlyUpdatePage.test.tsx`

### Steps

- [ ] **Write the failing tests.** In `src/pages/MonthlyUpdatePage.test.tsx`, add a liability fixture next to `jointSavings` (:45–49) and three tests at the end of the file:

```tsx
// After the jointSavings fixture (:45-49):
const creditCard = {
  id: 5, name: 'Visa', slug: 'visa', group: 'liability' as const,
  sort_order: 5, is_active: true, is_component: false, parent_account_id: null,
  person_id: 1,
}
```

```tsx
// --- liability sign cue (2026-08-31 tier-1 A1) --------------------------------------------

it('cues a positive liability inline and Flip sign negates it in place', async () => {
  vi.mocked(netWorthApi.fetchAccounts).mockResolvedValue([account, creditCard])
  renderWizard()
  const visa = (await screen.findByLabelText('Visa')) as HTMLInputElement
  // Seeded 0.00 (no prior row for Visa): no cue — zero is not a positive balance.
  expect(screen.queryByText(/liabilities are entered negative/i)).toBeNull()

  fireEvent.change(visa, { target: { value: '500' } })
  expect(screen.getByText(/liabilities are entered negative/i)).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: 'Flip sign on Visa' }))
  // The blurred cell echoes the negated committed value; the cue folds away.
  expect(visa.value).toBe('-$500.00')
  expect(screen.queryByText(/liabilities are entered negative/i)).toBeNull()
})

it('a positive liability is advisory only — Next and Save stay enabled and the value ships', async () => {
  vi.mocked(netWorthApi.fetchAccounts).mockResolvedValue([account, creditCard])
  renderWizard()
  fireEvent.change(await screen.findByLabelText('Visa'), { target: { value: '500' } })
  // Ratified: a card can legitimately go positive after a refund — never a gate.
  const next = screen.getByRole('button', { name: /next: spending/i }) as HTMLButtonElement
  expect(next.disabled).toBe(false)
  fireEvent.click(next)
  await screen.findByLabelText('Food')
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save month/i }))
  await waitFor(() => {
    expect(netWorthApi.putMonthBalances).toHaveBeenCalledWith(
      '2026-08-01',
      expect.objectContaining({
        balances: [
          { account_id: 1, balance: '1500.00' },
          { account_id: 5, balance: '500' },
        ],
      }),
    )
  })
})

it('renders the cue for a server-seeded positive liability and Flip marks the draft dirty', async () => {
  vi.mocked(netWorthApi.fetchAccounts).mockResolvedValue([account, creditCard])
  vi.mocked(netWorthApi.fetchMonthBalances).mockImplementation(async (month: string) => ({
    month,
    exists: month === '2026-07-01',
    recorded_on: null,
    notes: null,
    balances:
      month === '2026-07-01'
        ? [
            { account_id: 1, balance: '1500.00' },
            { account_id: 5, balance: '500.00' }, // mis-signed on the server already
          ]
        : [],
  }))
  renderWizard()
  await screen.findByLabelText('Visa')
  expect(screen.getByText(/liabilities are entered negative/i)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Flip sign on Visa' }))
  // Flip is an edit like any other: the draft machinery files it immediately.
  expect(sessionStorage.getItem('finance-update-draft:2026-08-01')).not.toBeNull()
  expect((screen.getByLabelText('Visa') as HTMLInputElement).value).toBe('-$500.00')
})
```

- [ ] **Run them, expect failure:** `npx vitest run src/pages/MonthlyUpdatePage.test.tsx` → the three new tests fail with `TestingLibraryElementError: Unable to find an element with the text: /liabilities are entered negative/i` (and the flip-button lookups fail); every pre-existing test still passes.

- [ ] **Implement.** In `src/pages/MonthlyUpdatePage.tsx`, insert the flip helper directly after the `committed` helper (:581–582):

```tsx
  // Committed value of one cell for the live columns — the preview memo's rule.
  const committed = (raw: string | undefined) => Number(canonicalAmount(raw ?? '')) || 0

  // A1: negate a liability cell in place — a STRING flip on the canonical form, never
  // float round-tripping (a re-serialized double could alter digits). Only reachable
  // while the committed value is > 0, so the result is always the negative twin; the
  // setBalances write marks the draft dirty exactly like typing would.
  const flipSign = (accountId: number) =>
    setBalances((cur) => {
      const canon = canonicalAmount(cur[accountId] ?? '')
      return { ...cur, [accountId]: canon.startsWith('-') ? canon.slice(1) : `-${canon}` }
    })
```

Then, inside the balance cell `<td className="num entry-cell-col">` (:752–766), add the cue right after the `<AmountInput ... />` closing `/>`:

```tsx
                                <td className="num entry-cell-col">
                                  <AmountInput
                                    id={`bal-${account.id}`}
                                    className={
                                      `${isAmount(value) ? '' : 'invalid'}${
                                        flashIds.has(`bal-${account.id}`) ? ' pasted-flash' : ''
                                      }`.trim() || undefined
                                    }
                                    autoFocus={account.id === firstBalanceId}
                                    value={value}
                                    onValueChange={(next) =>
                                      setBalances((cur) => ({ ...cur, [account.id]: next }))
                                    }
                                  />
                                  {/* A1 (2026-08-31 tier-1): advisory amber, NEVER a gate —
                                      a card can legitimately go positive after a refund, so
                                      Next/Save stay enabled and the table hint below keeps
                                      stating the sign convention. */}
                                  {account.group === 'liability' && committed(value) > 0 && (
                                    <span className="entry-liability-cue" role="status">
                                      liabilities are entered negative
                                      <button
                                        type="button"
                                        className="button"
                                        aria-label={`Flip sign on ${account.name}`}
                                        onClick={() => flipSign(account.id)}
                                      >
                                        Flip sign
                                      </button>
                                    </span>
                                  )}
                                </td>
```

Append to `src/pages/MonthlyUpdatePage.css` (after the `.entry-budget.delta-negative` rule at :208–210):

```css
/* A1: the liability-sign cue — the app's one advisory register (--warn, PALETTE[3] amber,
   the .draft-note family). Words + a button, never colour alone; advice, never a gate. */
.entry-liability-cue {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 2px;
  font-size: 0.7rem;
  color: var(--warn);
}
```

- [ ] **Run the tests, expect pass:** `npx vitest run src/pages/MonthlyUpdatePage.test.tsx` → all tests green (39 existing + 3 new = 42).
- [ ] **Commit:** `git add src/pages/MonthlyUpdatePage.tsx src/pages/MonthlyUpdatePage.css src/pages/MonthlyUpdatePage.test.tsx && git commit -m "fix(wizard): amber cue + one-click flip for positive liabilities (A1)"`

---

## Task 2: A2 — Net-worth legend collision: two separate legend maps

**Files:**
- Modify: `src/pages/NetWorthPage.tsx` (state :139–147; `legend` at :282 and :399; memo deps :390 and :422; `<EChart onLegendChange=...>` at :593 and :643)
- Test: `src/pages/NetWorthPage.test.tsx` (mock at :13–41 gains legend plumbing; one new test)

### Steps

- [ ] **Write the failing test.** In `src/pages/NetWorthPage.test.tsx`, replace the `EChart` mock (:13–41) with this extended version (additive attributes only — every existing assertion keeps working):

```tsx
// echarts needs a real canvas and is NEVER rendered in jsdom (house law) — what each chart
// DRAWS is pinned in netWorthChartOptions.test.ts; this marker exposes only the option
// slices this page owns: series names, their stack ids, any markLine anchor, and (A2) the
// legend.selected map THIS chart was fed. mouseEnter stands in for a legendselectchanged
// on this chart, since jsdom cannot raise echarts events.
vi.mock('../components/EChart', async () => {
  const { createElement } = await import('react')
  return {
    default: ({
      option,
      onLegendChange,
      animateEntrance = true,
    }: {
      option: {
        legend?: { selected?: Record<string, boolean> }
        series?: {
          name?: string
          stack?: string
          markLine?: { data?: { xAxis?: string }[] }
        }[]
      }
      onLegendChange?: (selected: Record<string, boolean>) => void
      animateEntrance?: boolean
    }) =>
      createElement('div', {
        'data-testid': 'echart',
        'data-series': (option.series ?? []).map((s) => s.name ?? '').join('|'),
        'data-stacks': (option.series ?? []).map((s) => s.stack ?? '-').join('|'),
        'data-marriage': (option.series ?? [])
          .flatMap((s) => s.markLine?.data ?? [])
          .map((d) => d.xAxis ?? '')
          .join('|'),
        'data-legend-selected': JSON.stringify(option.legend?.selected ?? null),
        // A cached paint must render still (2026-08-27 spec §1).
        'data-animate': String(animateEntrance),
        // An account literally named "Cash" toggled off — the A2 collision case.
        onMouseEnter: () => onLegendChange?.({ Cash: false }),
      }),
  }
})
```

Then append the new test at the end of the file:

```tsx
// ── Legend collision (2026-08-31 tier-1 A2) ───────────────────────────────────────────────
// One merged legend map let an account literally named "Cash" toggle the stacked chart's
// Cash GROUP off from the drill chart — silently hiding the group and shrinking the
// tooltip's Assets subtotal. The two charts now hold separate maps.
it('keeps a drill toggle on an account named "Cash" out of the stacked chart', async () => {
  vi.mocked(fetchTimeseries).mockResolvedValue(
    timeseriesOut({
      accounts: [
        {
          id: 1, name: 'Cash', slug: 'cash-account', group: 'cash', sort_order: 1,
          is_active: true, is_component: false, parent_account_id: null, person_id: 1,
        },
      ],
      series: [{ account_id: 1, values: ['100.00', '150.00'] }],
    }),
  )
  renderPage()
  await screen.findByRole('group', { name: 'Owner' })
  // The drill seeds to the biggest account — the one wearing the colliding name.
  await waitFor(() =>
    expect(screen.getAllByTestId('echart')[1].getAttribute('data-series')).toBe('Cash'),
  )

  fireEvent.mouseEnter(screen.getAllByTestId('echart')[1]) // drill legend: { Cash: false }

  expect(
    JSON.parse(screen.getAllByTestId('echart')[1].getAttribute('data-legend-selected') ?? '{}'),
  ).toEqual({ Cash: false })
  // The stacked chart's own map never saw the toggle — its Cash GROUP series (and the
  // Assets subtotal the tooltip builds over it) stay untouched.
  expect(
    JSON.parse(screen.getAllByTestId('echart')[0].getAttribute('data-legend-selected') ?? '{}'),
  ).toEqual({})
})
```

- [ ] **Run it, expect failure:** `npx vitest run src/pages/NetWorthPage.test.tsx` → the new test fails on the last assertion: the stacked chart's `data-legend-selected` is `{"Cash":false}` (one shared map today). All pre-existing tests pass.

- [ ] **Implement.** In `src/pages/NetWorthPage.tsx`, replace lines :135–147 (the mirrors comment through `onZoomWindow` — the block sits right after `const [range, setRange] = ...`):

```tsx
  // Mirrors of the charts' own events (2026-08-25 spec §2e): legend picks and a manual
  // ctrl+wheel window become page state, fed back through the memoized options, so a
  // granularity refetch or notMerge rebuild no longer resets them — and both charts
  // share one window, like they share the chips.
  const [legendSelected, setLegendSelected] = useState<Record<string, boolean>>({})
  // MERGED, never replaced: echarts hands over the FIRING chart's whole name→shown map,
  // and the stacked chart's groups are not the drill chart's accounts — replacing would
  // let a toggle on one resurrect a series hidden on the other. A stale key is inert in
  // legend.selected (echarts ignores names no series claims), so merging is the safe way.
  const onLegendChange = (selected: Record<string, boolean>) =>
    setLegendSelected((current) => ({ ...current, ...selected }))
  const onZoomWindow = (nextWindow: ZoomWindow) =>
    setRange((current) => ({ preset: current.preset, window: nextWindow }))
```

with:

```tsx
  // Mirrors of the charts' own events (2026-08-25 spec §2e), fed back through the
  // memoized options so a granularity refetch or notMerge rebuild no longer resets them.
  // The ZOOM window stays shared — both charts ride one month axis and one set of chips.
  // Legend picks are one map PER CHART (2026-08-31 tier-1 A2): an account literally named
  // "Cash"/"Other"/"Taxable"/"Net worth" collides with a group series' name, and one
  // merged map let a drill toggle silently hide the same-named GROUP in the stacked chart
  // (and shrink the tooltip's Assets subtotal). Each chart feeds and reads only its own.
  // Still MERGED within a chart: echarts hands over the firing chart's whole name→shown
  // map, and a stale key is inert in legend.selected (echarts ignores unclaimed names).
  const [stackedLegend, setStackedLegend] = useState<Record<string, boolean>>({})
  const [drillLegend, setDrillLegend] = useState<Record<string, boolean>>({})
  const onStackedLegendChange = (selected: Record<string, boolean>) =>
    setStackedLegend((current) => ({ ...current, ...selected }))
  const onDrillLegendChange = (selected: Record<string, boolean>) =>
    setDrillLegend((current) => ({ ...current, ...selected }))
  const onZoomWindow = (nextWindow: ZoomWindow) =>
    setRange((current) => ({ preset: current.preset, window: nextWindow }))
```

Then four one-line swaps:
- :282 (stacked option) `legend: { top: 0, selected: legendSelected },` → `legend: { top: 0, selected: stackedLegend },`
- :390 (stacked deps) `}, [data, range, legendSelected, stackBy, household, orderedPeople])` → `}, [data, range, stackedLegend, stackBy, household, orderedPeople])`
- :399 (drill option) `legend: { top: 0, selected: legendSelected },` → `legend: { top: 0, selected: drillLegend },`
- :422 (drill deps) `}, [data, drill, range, legendSelected])` → `}, [data, drill, range, drillLegend])`

And the two `<EChart>` wiring lines:
- :593 (stacked chart) `onLegendChange={onLegendChange}` → `onLegendChange={onStackedLegendChange}`
- :643 (drill chart) `onLegendChange={onLegendChange}` → `onLegendChange={onDrillLegendChange}`

- [ ] **Run the tests, expect pass:** `npx vitest run src/pages/NetWorthPage.test.tsx` → all green (13 existing + 1 new = 14).
- [ ] **Commit:** `git add src/pages/NetWorthPage.tsx src/pages/NetWorthPage.test.tsx && git commit -m "fix(net-worth): one legend map per chart — name collisions stay local (A2)"`

---

## Task 3: A3 — Portfolio live ping renders only on the All view

**Files:**
- Modify: `src/pages/PortfolioPage.tsx` (live call :394 + memo deps :406; caveat sentence :576–582)
- Test: `src/pages/PortfolioPage.test.tsx` (update the verbatim `HOUSEHOLD_HINT` at :554–556; one new test)

### Steps

- [ ] **Write the failing test.** In `src/pages/PortfolioPage.test.tsx`, first update the pinned caveat constant (:554–556) — the page copy gains a clause, and the pin must move with it or it fails for the wrong reason:

```tsx
// Pinned verbatim: this sentence is the page's only defence against reading the weekly
// performance line as one person's (spec §5) — and, since A3, against wondering where the
// live dot went on a person view.
const HOUSEHOLD_HINT =
  'Performance, sparklines and price refresh always cover the whole household — the owner ' +
  'chips scope holdings, allocation, dividends, transactions and realized gains. Person ' +
  'views omit the live price dot because the history is household-wide.'
```

Then append the new test at the end of the file:

```tsx
// ── Live ping owner scope (2026-08-31 tier-1 A3) ──────────────────────────────────────────
// /portfolio/history is household-wide by design (no owner param), but the ping is derived
// from the OWNER-FILTERED holdings — plotting a person's total at the end of the household
// series drew a fake cliff. The ping (and its dashed connector, which rides the Live
// series' markLine) renders only on the All view.
it('renders the live ping only on the All view', async () => {
  renderPage()
  await screen.findByRole('group', { name: 'Owner' })
  const performance = () => screen.getAllByTestId('echart')[0]
  // holdingsOut()'s latest_quote_at (2026-08-27) is past HISTORY's last bar (2026-08-24),
  // so the household view bridges the series to a live ping. (Both ledger fixtures date
  // before the history window, so no Events series muddies the name list.)
  await waitFor(() =>
    expect(performance().getAttribute('data-series')).toBe(
      'Portfolio value|Cost basis|S&P 500 baseline|VOO (your contributions)|Live',
    ),
  )

  fireEvent.click(chip('Sam'))
  // The scoped holdings still carry a quote — the OWNER is what retires the ping.
  await waitFor(() =>
    expect(performance().getAttribute('data-series')).toBe(
      'Portfolio value|Cost basis|S&P 500 baseline|VOO (your contributions)',
    ),
  )

  fireEvent.click(chip('All'))
  await waitFor(() => expect(performance().getAttribute('data-series')).toContain('|Live'))
})
```

- [ ] **Run it, expect failure:** `npx vitest run src/pages/PortfolioPage.test.tsx` → the new test fails at the Sam step (`data-series` still ends `|Live`), and `says the performance card is household-wide only while a scope is active` fails on the changed `HOUSEHOLD_HINT` (the page copy hasn't grown the clause yet). Everything else passes.

- [ ] **Implement.** In `src/pages/PortfolioPage.tsx`, change the builder call at :394:

```tsx
    const base = portfolioHistoryOption(history, liveFromHoldings(holdings), events)
```

to:

```tsx
    // A3 (2026-08-31 tier-1): the ping is derived from the OWNER-FILTERED holdings, but
    // /portfolio/history is household-wide by design — plotting a person's total at the
    // end of the household series drew a fake cliff. Only the All view bridges to "now";
    // null also suppresses the dashed connector and the "Live" legend entry (both live
    // inside the builder's livePt branch).
    const base = portfolioHistoryOption(
      history,
      owner === null ? liveFromHoldings(holdings) : null,
      events,
    )
```

and extend the memo deps at :406:

```tsx
  }, [history, holdings, securities, transactions, dividends, dividendEvents, range, legendSelected, owner])
```

Then grow the caveat paragraph (:576–582):

```tsx
            {owner !== null && (
              <p className="hint">
                Performance, sparklines and price refresh always cover the whole household —
                the owner chips scope holdings, allocation, dividends, transactions and
                realized gains. Person views omit the live price dot because the history is
                household-wide.
              </p>
            )}
```

- [ ] **Run the tests, expect pass:** `npx vitest run src/pages/PortfolioPage.test.tsx` → all green.
- [ ] **Commit:** `git add src/pages/PortfolioPage.tsx src/pages/PortfolioPage.test.tsx && git commit -m "fix(portfolio-ui): live ping renders only on the All view (A3)"`

---

## Task 4: A4 — Header staleness styling, frontend-only (reuse `latest_quote_at`)

> **Orchestrator revision (2026-08-31), recorded per instruction:** the spec's "additive
> nullable `as_of_newest`" line was written before the audit surfaced that the payload
> ALREADY carries the newest quote as `latest_quote_at`
> (`backend/app/api/portfolio.py:630`, documented "the NEWEST quote" — exactly the header
> tooltip's clock). The repo's "one definition, two consumers" law argues against a twin
> field carrying an identical value on speculative-divergence grounds, so the spec is
> amended to match this decision: **reuse `latest_quote_at`; A4 is frontend-only with zero
> backend changes.**

**Files:**
- Modify: `src/pages/PortfolioPage.tsx` (header :428–441; `asOf` derivation :365; staleness import after :55)
- Modify: `src/pages/PortfolioPage.css` (append `.as-of.stale` after the `.as-of` rule at :8)
- Test: `src/pages/PortfolioPage.test.tsx`
- Read-only references, NO edits: `backend/app/api/portfolio.py:629–630` (both clocks already computed) and `src/types/api.ts:330–339` (`HoldingsResponse.latest_quote_at: string | null` already typed and documented as the NEWEST quote)

### Steps

- [ ] **Write the failing tests.** In `src/pages/PortfolioPage.test.tsx`, add `formatDate` to the imports (there are no `utils/format` imports yet — add a new line after the `../api/prices` import at :74):

```tsx
import { formatDate } from '../utils/format'
```

Append two tests at the end of the file. Dates are computed from the run's own today (`OverviewPage.test.tsx`'s lesson — a hard-coded quote date quietly goes stale and takes the file down with it):

```tsx
// ── Header staleness (2026-08-31 tier-1 A4, frontend-only) ────────────────────────────────
// as_of is the OLDEST quote across holdings, so one manual-priced straggler pins the header
// to an ancient date. Display-only fix: the same stale treatment Overview uses (amber via
// isStaleQuote) + a tooltip naming the clock the header is NOT showing — which the payload
// already carries as latest_quote_at (no new field; orchestrator amendment 2026-08-31).
const isoDaysAgo = (daysAgo: number) => {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - daysAgo)
  return `${d.toISOString().slice(0, 10)}T20:00:00Z`
}

it('tones the header amber when the oldest quote is stale and names both clocks', async () => {
  vi.mocked(fetchHoldings).mockResolvedValue({
    ...holdingsOut(),
    as_of: isoDaysAgo(9),
    latest_quote_at: isoDaysAgo(1),
  })
  renderPage()
  await screen.findByText('Portfolio value')
  const header = screen.getByText(/^prices as of /)
  expect(header.className).toBe('as-of stale')
  expect(header.getAttribute('title')).toBe(
    `oldest quote across holdings — newest ${formatDate(isoDaysAgo(1))}`,
  )
})

it('leaves a fresh header untoned and still names the newest clock', async () => {
  vi.mocked(fetchHoldings).mockResolvedValue({
    ...holdingsOut(),
    as_of: isoDaysAgo(1),
    latest_quote_at: isoDaysAgo(0),
  })
  renderPage()
  await screen.findByText('Portfolio value')
  const header = screen.getByText(/^prices as of /)
  expect(header.className).toBe('as-of')
  expect(header.getAttribute('title')).toBe(
    `oldest quote across holdings — newest ${formatDate(isoDaysAgo(0))}`,
  )
})
```

- [ ] **Run them, expect failure:** `npx vitest run src/pages/PortfolioPage.test.tsx` → both new tests fail: `className` is `'as-of'` in the stale case and `getAttribute('title')` is `null` in both. (No type changes are needed — `latest_quote_at` is already on `HoldingsResponse`.) Everything else passes.

- [ ] **Implement.** In `src/pages/PortfolioPage.tsx` (no `src/types/api.ts` change: `HoldingsResponse.latest_quote_at: string | null` already exists at :336, documented as the NEWEST quote), add the import (:55 currently reads `import { formatCurrency, formatDate, formatDateTime, formatPct } from '../utils/format'` — `formatDate` is already there; add the staleness import on the next line):

```tsx
import { formatCurrency, formatDate, formatDateTime, formatPct } from '../utils/format'
import { isStaleQuote } from '../utils/staleness'
```

Extend the derivation at :365:

```tsx
  const totals = holdings?.totals
  const asOf = holdings?.as_of ?? null
  // A4: the tooltip's second clock. latest_quote_at IS "the newest quote across holdings"
  // (one definition, two consumers — it also dates the live ping); the spec's original
  // as_of_newest twin was amended away 2026-08-31 once the audit surfaced this field.
  const newestQuote = holdings?.latest_quote_at ?? null
```

Replace the header span (:431–435):

```tsx
          {asOf ? (
            <span className="as-of">prices as of {formatDate(asOf)}</span>
          ) : (
            <span className="as-of">prices never refreshed</span>
          )}
```

with:

```tsx
          {asOf ? (
            // A4 (2026-08-31 tier-1): as_of is the OLDEST quote — one manual-priced
            // straggler pins it — so the header wears the same stale treatment Overview's
            // freshness cue uses (isStaleQuote → --warn amber) and the tooltip names the
            // clock it is NOT showing. Display-only: as_of itself is unchanged. The
            // no-newest fallback is stale-tab armor only — server-side both clocks derive
            // from one quote list, so they are null (or set) together.
            <span
              className={isStaleQuote(asOf) ? 'as-of stale' : 'as-of'}
              title={
                newestQuote
                  ? `oldest quote across holdings — newest ${formatDate(newestQuote)}`
                  : 'oldest quote across holdings'
              }
            >
              prices as of {formatDate(asOf)}
            </span>
          ) : (
            <span className="as-of">prices never refreshed</span>
          )}
```

Append to `src/pages/PortfolioPage.css` (after the `.portfolio-page .as-of` rule at :8):

```css
/* A4: the stale variant of the header clock — the shared amber advisory token (--warn,
   PALETTE[3]) every other stale cue already wears; the title attribute carries the words. */
.portfolio-page .as-of.stale { color: var(--warn); }
```

- [ ] **Run the tests, expect pass:** `npx vitest run src/pages/PortfolioPage.test.tsx` → all green.
- [ ] **Commit:** `git add src/pages/PortfolioPage.tsx src/pages/PortfolioPage.css src/pages/PortfolioPage.test.tsx && git commit -m "fix(portfolio-ui): stale styling + two-clock tooltip on the prices-as-of header (A4)"`

---

## Task 5: A5 — Budget editor defaults to the focused month

**Files:**
- Modify: `src/components/spending/BudgetPanel.tsx` (default :45–48; hint :156–159; imports :6–7)
- Modify: `src/components/spending/budgets.css` (append one rule)
- Test: `src/components/spending/BudgetPanel.test.tsx` (rewrite the default-pinning test; one new test; imports :12)

### Steps

- [ ] **Write the failing tests.** In `src/components/spending/BudgetPanel.test.tsx`, replace the test `saves through the PUT (editor defaults to next month) and renders the returned history` (:85–107) with:

```tsx
it('saves through the PUT (editor defaults to the FOCUSED month) and renders the returned history', async () => {
  renderPanel(0)
  // A5: the default is the month the meters read — matrix.months[monthIndex] — so a first
  // budget saved with the default visibly lands on the meters. (Fixture-dated, so this
  // test no longer depends on the day the suite runs.)
  const monthBox = screen.getByLabelText('Food budget effective from') as HTMLInputElement
  expect(monthBox.value).toBe('2026-01')
  // The amount box prefills with the month's resolved budget.
  const amountBox = screen.getByLabelText('Food budget amount') as HTMLInputElement
  expect(amountBox.value).toBe('$400.00') // AmountInput's blurred echo of '400.00'
  fireEvent.change(amountBox, { target: { value: '425.00' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save Food budget' }))
  await waitFor(() =>
    expect(putCategoryBudget).toHaveBeenCalledWith(1, {
      amount: '425.00',
      effective_month: '2026-01-01',
    }),
  )
  // The response's history renders, null amount reading as the end marker.
  expect(await screen.findByText('Mar 2026 — $425.00')).toBeDefined()
  expect(screen.getByText('Sep 2026 — budget ends')).toBeDefined()
  expect(onBudgetsChanged).toHaveBeenCalled()
  // The re-dating hint is the editor's contract with history (spec §4.2) — since A5 it
  // rides IN the editor's control row, one line, naming the new default.
  expect(screen.getAllByText(/re-writes what that era/).length).toBeGreaterThan(0)
  expect(screen.getAllByText(/Defaults to Jan 2026/).length).toBeGreaterThan(0)
})
```

Append one new test after it (pins that the default *follows* the focused month, the meters' month):

```tsx
it('follows the focused month when the page drills elsewhere', () => {
  renderPanel(1)
  const monthBox = screen.getByLabelText('Food budget effective from') as HTMLInputElement
  expect(monthBox.value).toBe('2026-02')
  expect(screen.getAllByText(/Defaults to Feb 2026/).length).toBeGreaterThan(0)
})
```

And since the rewritten tests no longer use them, delete the now-unused import at :12 (`noUnusedLocals` would fail the build):

```tsx
import { addMonths, currentMonthIso } from '../../utils/months'
```

- [ ] **Run them, expect failure:** `npx vitest run src/components/spending/BudgetPanel.test.tsx` → both fail: `monthBox.value` is the run-relative next calendar month (e.g. `'2026-09'`), not `'2026-01'`/`'2026-02'`, and `/Defaults to Jan 2026/` finds nothing.

- [ ] **Implement.** In `src/components/spending/BudgetPanel.tsx`:

Replace :45–48:

```tsx
  const month = matrix.months[monthIndex]
  // Next calendar month: the forward-looking default — changing a budget mid-month
  // usually means "from now on", and past months' verdicts stay frozen.
  const defaultEffectiveFrom = addMonths(currentMonthIso(), 1).slice(0, 7)
```

with:

```tsx
  const month = matrix.months[monthIndex]
  // A5 (2026-08-31 tier-1): default to the FOCUSED month — the month the meters read.
  // The old next-calendar-month default made a first budget save successfully and
  // visibly do nothing (the meters were reading a month the budget hadn't reached).
  // months entries are YYYY-MM-01 (or YYYY-MM in old fixtures); the input wants YYYY-MM.
  const defaultEffectiveFrom = month.slice(0, 7)
```

Delete the now-unused import at :7 (`formatCurrency, formatMonth` at :6 stay):

```tsx
import { addMonths, currentMonthIso } from '../../utils/months'
```

Move the hint INTO the editor's control row and reword it. Replace the form + hint block (:126–159):

```tsx
        <div className="budget-editor-form">
          <label>
            Monthly budget
            <AmountInput
              value={editor.amount}
              onValueChange={(next) => setEditor({ amount: next })}
              placeholder="blank ends the budget"
              aria-label={`${category.name} budget amount`}
            />
          </label>
          <label>
            Effective from
            <input
              type="month"
              className="field-input"
              aria-label={`${category.name} budget effective from`}
              value={editor.effectiveFrom}
              onChange={(e) => setEditor({ effectiveFrom: e.target.value })}
            />
          </label>
          <button
            type="button"
            className="button"
            aria-label={`Save ${category.name} budget`}
            disabled={busy}
            onClick={() => save(category, editor)}
          >
            Save
          </button>
        </div>
        <p className="drill-hint">
          Defaults to next month. Dating it in the past deliberately re-writes what that
          era&apos;s budget was — past months&apos; meters will re-judge against it.
        </p>
```

with:

```tsx
        <div className="budget-editor-form">
          <label>
            Monthly budget
            <AmountInput
              value={editor.amount}
              onValueChange={(next) => setEditor({ amount: next })}
              placeholder="blank ends the budget"
              aria-label={`${category.name} budget amount`}
            />
          </label>
          <label>
            Effective from
            <input
              type="month"
              className="field-input"
              aria-label={`${category.name} budget effective from`}
              value={editor.effectiveFrom}
              onChange={(e) => setEditor({ effectiveFrom: e.target.value })}
            />
          </label>
          <button
            type="button"
            className="button"
            aria-label={`Save ${category.name} budget`}
            disabled={busy}
            onClick={() => save(category, editor)}
          >
            Save
          </button>
          {/* A5: promoted into the control row (was parked between the form and the
              history list) — the past-dating warning must be read at the moment the date
              is chosen, one short line. */}
          <p className="drill-hint budget-editor-hint">
            Defaults to {formatMonth(month)} — the month the meters read. Dating it in the
            past re-writes what that era&apos;s budget was.
          </p>
        </div>
```

Append to `src/components/spending/budgets.css` (after `.budget-editor-form .field-input` at :96–98):

```css
/* A5: the past-dating warning rides IN the editor row, wrapping onto its own full-width
   line directly under the controls it warns about. */
.budget-editor-form .budget-editor-hint {
  flex-basis: 100%;
  margin: 0;
}
```

- [ ] **Run the tests, expect pass:** `npx vitest run src/components/spending/BudgetPanel.test.tsx` → all green (8 tests: 6 untouched + 1 rewritten + 1 new).
- [ ] **Commit:** `git add src/components/spending/BudgetPanel.tsx src/components/spending/budgets.css src/components/spending/BudgetPanel.test.tsx && git commit -m "fix(budgets): default effectiveFrom to the focused month (A5)"`

---

## Task 6: A6 + A7 — Spending: absent ≠ zero; savings-rate axis honesty

Shared task per the spec's allowance — both items live in `SpendingPage.tsx`'s option memos and the shared `spendingChartOptions.ts` helpers.

**Files:**
- Modify: `src/components/spending/spendingChartOptions.ts` (formatter :28–53; `spendingCsv` UNCHANGED)
- Modify: `src/pages/SpendingPage.tsx` (`otherPerMonth` :214–219; bar data :258; savings axis :484–491; `kpis` :563–576)
- Test: `src/components/spending/spendingChartOptions.test.ts` (two tests rewritten, one added)
- Test: `src/pages/SpendingPage.test.tsx` (mock at :17–63 gains three additive attributes; three new tests)

### Steps

- [ ] **Write the failing unit tests (formatter + CSV pin).** In `src/components/spending/spendingChartOptions.test.ts`, replace the two tests at :36–47:

```tsx
  it('lists reference lines without a Total when no category row is under the pointer', () => {
    const html = format([
      { seriesName: 'Net pay', marker: '', axisValueLabel: 'Jun 2026', value: 6000 },
    ])
    expect(html).toContain('Net pay: $6,000.00')
    expect(html).not.toContain('Total:')
  })

  it('returns an empty string when nothing under the pointer is finite', () => {
    expect(format([{ seriesName: 'Net pay', value: null }])).toBe('')
    expect(format([])).toBe('')
  })
```

with:

```tsx
  it('says "no spending entered" on a cashflow-only month, reference lines after it', () => {
    // A6: a month whose category rows are all null is ABSENT — the tooltip must say so
    // instead of listing every category at $0.00; net pay still lists (it is real).
    const html = format([
      { seriesName: 'Rent', marker: '', axisValueLabel: 'Jun 2026', value: null },
      { seriesName: 'Net pay', marker: '[n]', value: 6000 },
    ])
    expect(html).toBe(
      '<strong>Jun 2026</strong><br/>no spending entered<br/>[n]Net pay: $6,000.00',
    )
    expect(html).not.toContain('Total:')
  })

  it('names a fully-absent month instead of going silent', () => {
    expect(format([{ seriesName: 'Rent', axisValueLabel: 'Aug 2026', value: null }])).toBe(
      '<strong>Aug 2026</strong><br/>no spending entered',
    )
    // No params at all: still nothing to say.
    expect(format([])).toBe('')
  })
```

And append a CSV pin inside the `spendingCsv` describe (after the existing test at :51–69) — A6 explicitly leaves the CSV byte-identical:

```tsx
  it('keeps an absent month byte-identical — CSV output is deliberately unchanged by A6', () => {
    const matrix = {
      months: ['2026-08-01'],
      series: [
        { category_id: 1, values: [null], budgets: [null] },
        { category_id: 2, values: [null], budgets: [null] },
      ],
      totals: ['0.00'],
      net_pay: ['6000.00'],
    }
    expect(spendingCsv(matrix, [1], new Map([[1, 'Rent']])).rows).toEqual([
      ['2026-08-01', '', '0.00', '0.00', '6000.00'],
    ])
  })
```

- [ ] **Run them, expect failure:** `npx vitest run src/components/spending/spendingChartOptions.test.ts` → the two rewritten formatter tests fail (`no spending entered` never appears; the null-only case returns `''`); the CSV pin passes as-is (that is the point — it must keep passing after the implementation too).

- [ ] **Write the failing page tests.** In `src/pages/SpendingPage.test.tsx`, extend the `EChart` mock (:17–63) with three additive attributes. Replace the mock's `option` type and the `createElement` attribute list:

```tsx
    default: ({
      option,
      onClick,
      ariaLabel,
      onLegendChange,
      onDataZoom,
      exportConfig,
      animateEntrance = true,
    }: {
      option: {
        series?: {
          type?: string
          data?: unknown[]
          links?: { source?: string; target?: string; value?: number }[]
        }[]
        legend?: { selected?: Record<string, boolean> }
        dataZoom?: { startValue?: number; endValue?: number }[]
        tooltip?: { valueFormatter?: (value: unknown) => string }
        yAxis?: {
          min?: number | ((extent: { min: number; max: number }) => number)
          max?: number | ((extent: { min: number; max: number }) => number)
        }
      }
      onClick?: (params: { dataIndex?: number }) => void
      ariaLabel?: string
      onLegendChange?: (selected: Record<string, boolean>) => void
      onDataZoom?: (window: { startValue: number; endValue: number }) => void
      exportConfig?: { name: string }
      animateEntrance?: boolean
    }) =>
      createElement('div', {
        'data-testid': 'echart',
        'aria-label': ariaLabel,
        // A cached paint must render still (2026-08-27 spec §1).
        'data-animate': String(animateEntrance),
        'data-links': (option.series?.[0]?.links ?? [])
          .map((l) => `${l.source}>${l.target}=${l.value}`)
          .join('|'),
        'data-legend-selected': JSON.stringify(option.legend?.selected ?? null),
        'data-zoom': JSON.stringify(option.dataZoom?.[0] ?? null),
        'data-pct-sample': option.tooltip?.valueFormatter?.(0.35) ?? '',
        'data-export-name': exportConfig?.name ?? '',
        // A6: the bar stacks' raw data arrays — the absent-month gap pin reads them.
        'data-bar-data': JSON.stringify(
          (option.series ?? []).filter((s) => s.type === 'bar').map((s) => s.data ?? []),
        ),
        // A7: the y-axis clamps, sampled at a fixed extent so the pin reads numbers.
        'data-y-floor':
          typeof option.yAxis?.min === 'function'
            ? String(option.yAxis.min({ min: -1.8, max: 0.6 }))
            : '',
        'data-y-ceiling':
          typeof option.yAxis?.max === 'function'
            ? String(option.yAxis.max({ min: -1.8, max: 0.6 }))
            : '',
        onClick: () => onClick?.({ dataIndex: 0 }),
        onMouseEnter: () => onLegendChange?.({ 'Net pay': false, '4% rule': true }),
        // A SECOND legendselectchanged shape, carrying a map disjoint from mouseEnter's:
        // echarts hands each chart its OWN full name→shown map, so this is what a toggle
        // on a sibling chart (different series entirely) looks like arriving at the page.
        onDoubleClick: () => onLegendChange?.({ Rent: false }),
        onMouseLeave: () => onDataZoom?.({ startValue: 1, endValue: 1 }),
      }),
```

Then append a new describe at the end of the file:

```tsx
describe('SpendingPage — absent ≠ zero and axis honesty (2026-08-31 tier-1 A6/A7)', () => {
  // August is cashflow-only: net pay entered, no spending rows at all. The server's
  // matrix sums an absent month's total to "0.00" (never null), which is exactly why the
  // page must judge enteredness on the SERIES.
  const withAbsentMonth = () =>
    matrixFixture({
      months: ['2026-06', '2026-07', '2026-08'],
      series: [
        { category_id: 1, values: ['2000.00', '2000.00', null], budgets: [null, null, null] },
        { category_id: 2, values: ['600.00', '580.00', null], budgets: [null, null, null] },
        { category_id: 3, values: ['150.00', '0.00', null], budgets: [null, null, null] },
      ],
      totals: ['2750.00', '2580.00', '0.00'],
      net_pay: ['6000.00', '6000.00', '6000.00'],
      savings_rate: ['0.541666667', '0.57', '1.000000'],
      four_pct_rule: [null, null, null],
      total_budget: [null, null, null],
    })

  it('gaps the bars on a net-pay-only month instead of drawing a $0 stack (A6)', async () => {
    vi.mocked(fetchMatrix).mockResolvedValue(withAbsentMonth())
    renderPage()
    await screen.findByText('Where Aug 2026 went')
    const bars = screen.getAllByTestId('echart')[0]
    const data = JSON.parse(bars.getAttribute('data-bar-data') ?? '[]') as (number | null)[][]
    // Three categories + Other, each with a NULL (not 0) in August's slot → echarts gaps.
    expect(data).toHaveLength(4)
    expect(data.every((serie) => serie[2] === null)).toBe(true)
    // Entered months keep their numbers (Rent is the biggest all-time total → series 0).
    expect(data[0][0]).toBe(2000)
  })

  it('excludes absent months from the 12-month average (A6)', async () => {
    vi.mocked(fetchMatrix).mockResolvedValue(withAbsentMonth())
    renderPage()
    await screen.findByText('Where Aug 2026 went')
    // (2750 + 2580) / 2 — the cashflow-only August no longer dilutes it to a /3.
    expect(screen.getByText('$2,665.00')).toBeTruthy()
  })

  it('lets the savings-rate floor follow the data below −100%, ceiling capped (A7)', async () => {
    renderPage()
    await screen.findByText('Where Jul 2026 went')
    const savings = screen
      .getAllByTestId('echart')
      .find((el) => (el.getAttribute('data-y-floor') ?? '') !== '')
    // Sampled at extent {min: −1.8, max: 0.6}: the floor expands to the whole −200% step
    // (Math.min(−1, Math.floor(−1.8))); the ceiling keeps hugging the data under +100%.
    expect(savings?.getAttribute('data-y-floor')).toBe('-2')
    expect(savings?.getAttribute('data-y-ceiling')).toBe('0.6')
  })
})
```

- [ ] **Run them, expect failure:** `npx vitest run src/pages/SpendingPage.test.tsx` → the gap test fails (`serie[2]` is `0`, not `null`), the average test fails (tile shows `$1,776.67` = ÷3), the A7 test fails (`data-y-floor` is `'-1'` — today's `Math.max(extent.min, -1)`). All pre-existing tests still pass (the mock changes are additive).

- [ ] **Implement the formatter.** In `src/components/spending/spendingChartOptions.ts`, replace the formatter body (:28–53):

```ts
export function spendingBarsTooltipFormatter(
  categoryNames: string[],
): (params: unknown) => string {
  const categories = new Set(categoryNames)
  return (params: unknown) => {
    const list = (Array.isArray(params) ? params : [params]) as AxisTooltipParam[]
    if (list.length === 0) return ''
    const finite = list.flatMap((p) =>
      typeof p.value === 'number' && Number.isFinite(p.value) ? [{ p, value: p.value }] : [],
    )
    const catRows = finite.filter(({ p }) => categories.has(p.seriesName ?? ''))
    const refRows = finite.filter(({ p }) => !categories.has(p.seriesName ?? ''))
    const total = catRows.reduce((sum, { value }) => sum + value, 0)
    const line = ({ p, value }: { p: AxisTooltipParam; value: number }, share: boolean) => {
      // A zero-or-below total cannot scale a share (a refund month) — rows go bare.
      const pct = share && total > 0 ? ` (${((value / total) * 100).toFixed(1)}%)` : ''
      return `${p.marker ?? ''}${escapeHtml(p.seriesName ?? '')}: ${formatCurrency(value)}${pct}`
    }
    return [
      `<strong>${list.find((p) => p.axisValueLabel)?.axisValueLabel ?? ''}</strong>`,
      // A6: with the series passing nulls through, an absent month has NO finite category
      // rows — say so instead of fabricating $0.00 rows, and close real rows (only) with
      // the Total. (A month with every category legend-hidden reads the same line; that
      // is a deliberate user act, and the reference rows still print below.)
      ...(catRows.length > 0
        ? [
            ...catRows.map((row) => line(row, true)),
            `<strong>Total: ${formatCurrency(total)}</strong>`,
          ]
        : ['no spending entered']),
      ...refRows.map((row) => line(row, false)),
    ].join('<br/>')
  }
}
```

(`spendingCsv` is NOT touched — the doc-comment's "Null cells go empty" contract and the byte-identical pin above are the guarantee.)

- [ ] **Run the unit tests, expect pass:** `npx vitest run src/components/spending/spendingChartOptions.test.ts` → all green (6 tests: 3 untouched + 2 rewritten + 1 new CSV pin).

- [ ] **Implement the page.** In `src/pages/SpendingPage.tsx`:

Replace `otherPerMonth` (:214–219):

```tsx
    const otherPerMonth = matrix.months.map((_, i) =>
      matrix.series.reduce((acc, s) => {
        if (topSet.has(s.category_id)) return acc
        const v = s.values[i]
        return acc + (v === null ? 0 : Number(v))
      }, 0),
    )
```

with:

```tsx
    // A6 (2026-08-31 tier-1): absent ≠ zero. Nulls flow THROUGH to the series — echarts
    // gaps the bar — so a month with no spending entered draws nothing instead of a $0
    // stack whose tooltip lists every category at $0.00. Other sums the folded rows'
    // non-null values and is itself null when none exist that month.
    const otherPerMonth = matrix.months.map((_, i) =>
      matrix.series.reduce<number | null>((acc, s) => {
        if (topSet.has(s.category_id)) return acc
        const v = s.values[i]
        if (v === null) return acc
        return (acc ?? 0) + Number(v)
      }, null),
    )
```

Replace the per-category bar data line (:258):

```tsx
          data: (valuesById.get(id) ?? []).map((v) => (v === null ? 0 : Number(v))),
```

with:

```tsx
          // A6: null passes through — a gap, never a fabricated $0 segment.
          data: (valuesById.get(id) ?? []).map((v) => (v === null ? null : Number(v))),
```

Replace the savings-rate yAxis (:484–491):

```tsx
      yAxis: {
        type: 'value',
        // Clamp the frame to ±100%; early months have wild negatives that would
        // squash the whole series otherwise.
        min: (extent: { min: number }) => Math.max(extent.min, -1),
        max: (extent: { max: number }) => Math.min(Math.max(extent.max, 0.1), 1),
        axisLabel: { formatter: (value: number) => formatPct(value, { signed: false }) },
      },
```

with:

```tsx
      yAxis: {
        type: 'value',
        // A7 (2026-08-31 tier-1): the ceiling stays +100% (rates above 1 are impossible),
        // but the FLOOR expands to the data — a −180% month must render inside the frame,
        // not silently leave it. floor() lands the min on a whole −100% gridline step; the
        // Math.min(-1, …) keeps at least the −100% floor when the data never goes there.
        min: (extent: { min: number }) => Math.min(-1, Math.floor(extent.min)),
        max: (extent: { max: number }) => Math.min(Math.max(extent.max, 0.1), 1),
        axisLabel: { formatter: (value: number) => formatPct(value, { signed: false }) },
      },
```

Replace the `kpis` memo (:563–576):

```tsx
  // KPI row: latest data month + trailing-12 average + latest savings rate.
  const kpis = useMemo(() => {
    if (!matrix || matrix.months.length === 0) return null
    const last = matrix.months.length - 1
    const window = matrix.totals.slice(-12).map(Number)
    const average = window.reduce((a, b) => a + b, 0) / window.length
    return {
      month: matrix.months[last],
      total: matrix.totals[last],
      average,
      savings: matrix.savings_rate[last],
      netPay: matrix.net_pay[last],
    }
  }, [matrix])
```

with:

```tsx
  // KPI row: latest data month + trailing-12 average + latest savings rate.
  const kpis = useMemo(() => {
    if (!matrix || matrix.months.length === 0) return null
    const last = matrix.months.length - 1
    // A6: a month no category reported (cashflow-only) is ABSENT, not a $0 month — it
    // must not dilute the average. totals[] itself carries "0.00" for such months (the
    // server sums over an empty set), so enteredness is judged on the SERIES — the same
    // rule filledMonths uses for the ribbon below.
    const entered = matrix.months.map((_, i) => matrix.series.some((s) => s.values[i] !== null))
    const window = matrix.totals
      .map((total, i) => ({ total: Number(total), entered: entered[i] }))
      .slice(-12)
      .filter((cell) => cell.entered)
    const average =
      window.length === 0
        ? null
        : window.reduce((acc, cell) => acc + cell.total, 0) / window.length
    return {
      month: matrix.months[last],
      total: matrix.totals[last],
      average,
      savings: matrix.savings_rate[last],
      netPay: matrix.net_pay[last],
    }
  }, [matrix])
```

(No render change needed for the tile: `formatCurrency(kpis.average)` already renders `'—'` for `null` — `formatCurrency` accepts `string | number | null | undefined`, `src/utils/format.ts:9`.)

- [ ] **Run both files, expect pass:** `npx vitest run src/pages/SpendingPage.test.tsx src/components/spending/spendingChartOptions.test.ts` → all green (18 existing + 3 new = 21 page tests; 6 unit tests).
- [ ] **Commit:** `git add src/pages/SpendingPage.tsx src/components/spending/spendingChartOptions.ts src/pages/SpendingPage.test.tsx src/components/spending/spendingChartOptions.test.ts && git commit -m "fix(spending): absent months gap the bars, honest 12-mo average, savings floor follows data (A6, A7)"`

---

## Task 7: A8 — Wizard partial-save truth: retry only the failed leg

**Files:**
- Modify: `src/pages/MonthlyUpdatePage.tsx` (types import :23; new state after `saved` at :138; load `.then` reset near :203; `save()` :370–438; save button :1033–1041)
- Test: `src/pages/MonthlyUpdatePage.test.tsx` (three new tests; one existing test's button name updated at :517)

### Steps

- [ ] **Write the failing tests.** In `src/pages/MonthlyUpdatePage.test.tsx`, first update the existing retry test `keeps sending the clear on the retry after a failed save` — its second click (:517) targets a button that A8 relabels:

```tsx
  fireEvent.click(screen.getByRole('button', { name: /retry spending/i }))
```

(the first click at :514 stays `/save month/i` — the label only changes after the spending leg fails). Then append three tests at the end of the file:

```tsx
// --- split-save truth (2026-08-31 tier-1 A8) -----------------------------------------------

it('names the half-landed save and retries only the spending leg', async () => {
  vi.mocked(spendingApi.putSpendingMonth).mockRejectedValueOnce(new Error('boom'))
  renderWizard()
  fireEvent.change(await screen.findByLabelText('Checking'), { target: { value: '1600.00' } })
  fireEvent.click(screen.getByRole('button', { name: /next: spending/i }))
  await screen.findByLabelText('Food')
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save month/i }))

  // The balances PUT COMMITTED before the failure — "nothing was lost" would be a lie in
  // both directions, so the banner names the split.
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toBe('Balances saved. Spending failed — Retry saves only spending.')
  expect(vi.mocked(netWorthApi.putMonthBalances).mock.calls.length).toBe(1)

  // The primary is now the honest retry: only the failed leg goes out again.
  fireEvent.click(screen.getByRole('button', { name: /retry spending/i }))
  await screen.findByText(/month saved/i)
  expect(vi.mocked(netWorthApi.putMonthBalances).mock.calls.length).toBe(1) // never re-sent
  expect(vi.mocked(spendingApi.putSpendingMonth).mock.calls.length).toBe(2)
})

it('keeps the accurate old message when the balances leg itself fails', async () => {
  vi.mocked(netWorthApi.putMonthBalances).mockRejectedValueOnce(new Error('db down'))
  renderWizard()
  await screen.findByLabelText('Checking')
  fireEvent.click(screen.getByRole('button', { name: /next: spending/i }))
  await screen.findByLabelText('Food')
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save month/i }))

  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toBe('Saving failed — nothing was lost, retry')
  // Nothing committed: the spending PUT was never attempted, the primary stays a full save.
  expect(spendingApi.putSpendingMonth).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: /save month/i }))
  await screen.findByText(/month saved/i)
  expect(vi.mocked(netWorthApi.putMonthBalances).mock.calls.length).toBe(2)
  expect(vi.mocked(spendingApi.putSpendingMonth).mock.calls.length).toBe(1)
})

it('re-sends balances on retry when they were edited after the partial failure', async () => {
  vi.mocked(spendingApi.putSpendingMonth).mockRejectedValueOnce(new Error('boom'))
  renderWizard()
  fireEvent.change(await screen.findByLabelText('Checking'), { target: { value: '1600.00' } })
  fireEvent.click(screen.getByRole('button', { name: /next: spending/i }))
  await screen.findByLabelText('Food')
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save month/i }))
  await screen.findByRole('alert')

  // Back to balances, change a figure: the remembered leg no longer describes the boxes,
  // so a "retry" that skipped balances would silently drop this edit under a green banner.
  fireEvent.click(screen.getByRole('button', { name: /^1\s*balances$/i }))
  fireEvent.change(await screen.findByLabelText('Checking'), { target: { value: '1700.00' } })
  fireEvent.click(screen.getByRole('button', { name: /next: spending/i }))
  await screen.findByLabelText('Food')
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /retry spending/i }))
  await screen.findByText(/month saved/i)
  expect(vi.mocked(netWorthApi.putMonthBalances).mock.calls.length).toBe(2)
  expect(vi.mocked(netWorthApi.putMonthBalances).mock.calls[1][1]).toEqual(
    expect.objectContaining({ balances: [{ account_id: 1, balance: '1700.00' }] }),
  )
})
```

- [ ] **Run them, expect failure:** `npx vitest run src/pages/MonthlyUpdatePage.test.tsx` → the three new tests fail (`alert.textContent` is `'Saving failed — nothing was lost, retry'` on a spending failure; no button named `/retry spending/i` exists) and the UPDATED existing retry test fails on the missing `/retry spending/i` button. All other tests pass.

- [ ] **Implement.** In `src/pages/MonthlyUpdatePage.tsx`:

Add the type to the imports at :23:

```tsx
import type {
  AccountOut,
  CategoryOut,
  HouseholdOut,
  MonthUpsertResult,
  SpendingMatrix,
} from '../types/api'
```

Add the state slot directly after `const [saved, setSaved] = useState<string | null>(null)` (:138):

```tsx
  // A8 (2026-08-31 tier-1): the balances leg that already COMMITTED while its spending
  // sibling failed — the month, the exact canonical payload it shipped, and the server's
  // counts. A retry whose payload still matches skips the balances PUT (retry-only-the-
  // failed-leg, no new endpoint); an edit in between changes the payload string and
  // honestly re-sends balances instead of dropping the edit under a "saved" banner.
  // Cleared on month load and on a full save.
  const [balancesLeg, setBalancesLeg] = useState<{
    month: string
    payload: string
    result: MonthUpsertResult
  } | null>(null)
```

In the load effect's `.then` (:202–204), reset it alongside the other per-month state:

```tsx
        setError(null)
        setSaved(null)
        setBalancesLeg(null)
```

Replace the whole `save` function (:370–438) with:

```tsx
  const save = async () => {
    setSaving(true)
    setError(null)
    // canonicalAmount, not .trim(): a cell committed by blur is already canonical, but a save
    // reached without one (Ctrl+Enter, or a click in jsdom) must not ship "$1,600.00" or
    // "=200+50" to a Decimal column. Computed ONCE, then spent three ways — the wire, the
    // boxes and the baseline — which is what keeps those three from drifting apart below.
    // `?? ''` so a key missing from the record can never throw inside the payload builder.
    const canonBalances: Record<number, string> = Object.fromEntries(
      accounts.map((a) => [a.id, canonicalAmount(balances[a.id] ?? '')]),
    )
    const canonAmounts: Record<number, string> = Object.fromEntries(
      categories.map((c) => [c.id, canonicalAmount(amounts[c.id] ?? '')]),
    )
    const canonNetPay = netPay.trim() === '' ? '' : canonicalAmount(netPay)
    // A8: everything the balances PUT would ship, serialized — the "is this a PURE retry?"
    // comparison. Numeric keys serialize in ascending order (snapshotOf's law), so equal
    // values always compare equal.
    const balancesPayload = JSON.stringify({ balances: canonBalances, recordedOn, notes })
    // Which PUT is in flight — the catch words the banner by the leg that actually failed.
    let leg: 'balances' | 'spending' = 'balances'
    try {
      let balanceResult: MonthUpsertResult
      if (
        balancesLeg !== null &&
        balancesLeg.month === month &&
        balancesLeg.payload === balancesPayload
      ) {
        // The balances PUT already landed for exactly this payload — skip it and reuse
        // its counts (they describe the PUT that actually ran).
        balanceResult = balancesLeg.result
      } else {
        balanceResult = await putMonthBalances(month, {
          recorded_on: recordedOn === '' ? undefined : recordedOn,
          // null (not undefined): blanking the field must CLEAR a previously saved note.
          notes: notes.trim() === '' ? null : notes,
          balances: accounts.map((a) => ({ account_id: a.id, balance: canonBalances[a.id] })),
        })
        setBalancesLeg({ month, payload: balancesPayload, result: balanceResult })
      }
      leg = 'spending'
      const body: {
        net_pay?: string | null
        amounts: { category_id: number; amount: string }[]
      } = {
        amounts: categories.map((c) => ({ category_id: c.id, amount: canonAmounts[c.id] })),
      }
      if (netPay.trim() !== '') {
        body.net_pay = canonNetPay
      } else if (hadNetPay) {
        // Tri-state rider (spec §4.2): blanking a previously saved net pay must CLEAR it —
        // omitting would silently keep the stale figure in every savings-rate denominator.
        body.net_pay = null
      }
      const spendResult = await putSpendingMonth(month, body)
      setBalancesLeg(null)
      setSaved(
        `Balances: ${balanceResult.created} added, ${balanceResult.updated} changed, ` +
          `${balanceResult.unchanged} unchanged. Spending: ${spendResult.created} added, ` +
          `${spendResult.updated} changed, ${spendResult.unchanged} unchanged.` +
          // A DELETION the user asked for by blanking a box: the counts sentence above
          // never mentions the cashflow row that just went away, so the confirmation says
          // it — and says it from the server's own flag, not from what we hoped we sent.
          (spendResult.net_pay_cleared ? ' Household take-home cleared.' : ''),
      )
      // What the wire received IS what the boxes now hold. Adopting the canonical values
      // into the STATE as well as the baseline is load-bearing: a cell advanced past by
      // clicks still held raw text ("9,000"), and a baseline taken from that raw state
      // would differ from the "9000" the next focus+blur commits — filing a draft for
      // fully saved work, so the following visit announced "Restored unsaved entries —
      // they are not saved yet" about nothing. Canonical on both sides makes that blur a
      // no-op, and the draft effect deletes the stored copy on the same render.
      setBalances(canonBalances)
      setAmounts(canonAmounts)
      setNetPay(canonNetPay)
      // The server's state is now what we just sent: a cleared month has no net pay to
      // clear twice, and a freshly typed one becomes clearable without a reload.
      setHadNetPay(canonNetPay !== '')
      setBaseline({
        month,
        data: snapshotOf(canonBalances, canonAmounts, canonNetPay, recordedOn, notes),
      })
      setRestored(false)
    } catch (err) {
      if (leg === 'spending') {
        // Truth-telling (A8): the balances PUT COMMITTED before this failure — the old
        // "nothing was lost" banner lied in both directions. State remembers the landed
        // leg, so the primary (now "Retry spending") re-attempts only what failed.
        setError('Balances saved. Spending failed — Retry saves only spending.')
      } else {
        setError(err instanceof ApiError ? err.message : 'Saving failed — nothing was lost, retry')
      }
    } finally {
      setSaving(false)
    }
  }
```

Update the review step's primary button label (:1033–1041):

```tsx
            <button
              className="button button-primary"
              disabled={
                saving || loading || accounts.length === 0 || !balancesValid || !amountsValid
              }
              onClick={() => void save()}
            >
              {/* A8: while a committed balances leg is remembered, the primary IS the
                  retry the banner promised. (After an in-between balance edit the click
                  re-sends balances too — save() compares the payload, not the label.) */}
              {saving ? 'Saving…' : balancesLeg !== null ? 'Retry spending' : 'Save month'}
            </button>
```

- [ ] **Run the tests, expect pass:** `npx vitest run src/pages/MonthlyUpdatePage.test.tsx` → all green (42 after Task 1, one of them updated in place, + 3 new = 45).
- [ ] **Commit:** `git add src/pages/MonthlyUpdatePage.tsx src/pages/MonthlyUpdatePage.test.tsx && git commit -m "fix(wizard): truth-telling split save — retry re-attempts only the failed leg (A8)"`

---

## Task 8: Full-suite verification

**Files:** none (verification only).

- [ ] Frontend, full: `npm test` → expect green, baseline count + **15 new tests** (3 A1, 1 A2, 1 A3, 2 A4-frontend, 1 A5, 4 A6/A7 incl. the CSV byte-identity pin, 3 A8 — the rewritten/retitled ones replace, not add).
- [ ] Frontend lint: `npm run lint` → clean (watch for: the removed `addMonths, currentMonthIso` imports in `BudgetPanel.tsx` and its test; the `owner` dep added to `performanceOption`; the renamed legend handlers in `NetWorthPage.tsx`).
- [ ] Backend, full: `cd backend && .venv/Scripts/python.exe -m pytest -q` → expect green, count byte-identical to Task 0's baseline (Plan A ships zero backend changes — this run proves it).
- [ ] Backend lint: `cd backend && .venv/Scripts/python.exe -m ruff check app tests` → clean.
- [ ] Compare counts against Task 0's recorded baseline; investigate ANY regression before declaring done. No commit (the branch's task commits are the deliverable; merging `tier1-batch` → local `main` happens after Plans B–D per the spec's execution order).

---

## Self-Review

**Spec coverage, A1–A8 → tasks:**

| Spec item | Task | Pinned regression test |
|---|---|---|
| A1 warn + one-click flip (advisory, never blocks) | Task 1 | cue renders on positive liability (typed AND server-seeded); Flip negates in place + marks draft dirty; unflipped positive still ships in the PUT with Next enabled |
| A2 two separate legend state objects | Task 2 | drill toggle on an account named "Cash" leaves the stacked chart's map empty |
| A3 ping only when `owner === null` | Task 3 | All → series list ends `\|Live`; person scope → no Live series; caveat clause pinned verbatim |
| A4 display-only, frontend-only — reuse `latest_quote_at` (spec amended 2026-08-31 by the orchestrator; no `as_of_newest` twin, zero backend changes) | Task 4 | amber class when stale + untoned when fresh; `title` names both clocks from the payload's existing fields |
| A5 default = focused month + promoted hint | Task 5 | `monthBox.value === matrix.months[monthIndex].slice(0,7)` for two indices; PUT ships `-01`-suffixed focused month (this is what makes the meter appear for that month); hint text pinned in the editor row |
| A6 nulls flow through, tooltip skip + "no spending entered", 12-mo average over non-null months, CSV unchanged | Task 6 | every bar series null (not 0) at the absent index; tooltip unit tests for cashflow-only and fully-absent months; average `$2,665.00` (÷2 not ÷3); CSV byte-identical pin |
| A7 floor expands to data, ceiling stays +100% | Task 6 | sampled `min({min:-1.8})` = `-2` (was `-1`), `max` unchanged at `0.6` |
| A8 truth-telling banner + retry-only-failed-leg, no new endpoint | Task 7 | banner text exact; retry issues only the spending PUT; balances-leg failure keeps the old accurate message; in-between edit re-sends balances |

**Placeholder scan:** performed over this document — zero placeholder markers (no to-be-determined stubs, no "handle it appropriately" hand-waves, no cross-task "repeat what an earlier task did" references) and no elided code bodies: every code step shows complete, paste-ready code (the A8 `save()` is reproduced in full rather than described). Re-run after the 2026-08-31 A4 revision: still clean, and no orphaned `as_of_newest` references remain outside the amendment-history notes.

**Type-name consistency check (frontend types ↔ backend schema ↔ usage):**
- `MonthUpsertResult` (`src/types/api.ts:111`) — the A8 `balancesLeg.result` type; matches `putMonthBalances`'s declared return (`src/api/netWorth.ts:68`).
- `HoldingsResponse.latest_quote_at: string | null` (`src/types/api.ts:336`) ↔ `HoldingsOut.latest_quote_at: datetime | None` (`schemas/portfolio.py:176`) — REUSED as the header tooltip's "newest" clock; no twin field is added and neither wire type is touched. `PortfolioPage` reads it with `?? null` into `newestQuote`.
- `EditorState.effectiveFrom` stays `YYYY-MM` with `-01` appended at save — `month.slice(0, 7)` preserves that contract for both `YYYY-MM-01` (production) and `YYYY-MM` (old fixtures) month strings.
- `otherPerMonth` is `(number | null)[]` via `reduce<number | null>` — matches the bar series' `(number | null)[]` data shape echarts accepts and the other line series already use.
- Legend maps are `Record<string, boolean>` on both charts and in the `EChart` `onLegendChange` prop signature — unchanged shape, split ownership.
- No `Number()` crosses a wire boundary anywhere in this plan: flips are string-negations of `canonicalAmount` output; averages/axis math are display-only.

**Known judgment calls (documented, not hidden):**
1. A4 reuses `latest_quote_at` instead of adding the spec's original `as_of_newest` twin — orchestrator amendment, 2026-08-31: the "one definition, two consumers" law outweighs speculative-divergence grounds for a duplicate value, and the field's documented meaning ("the NEWEST quote") is exactly the tooltip's clock. The spec is amended to match, so plan and spec agree.
2. A5's "promoted out of the collapsed `<details>` into the editor row" is implemented as the one-line hint moving *into* `.budget-editor-form` (the editor's control row) — the row only exists inside the `<details>`, so the promotion is within it, visible the moment the editor opens and adjacent to the date it warns about.
3. A8's payload-snapshot guard means a retry after an in-between balances edit re-sends balances — this refines, not contradicts, "retry only the failed leg": a changed payload is a new save, and skipping it would replace the old lie with a new one.
4. A6's "no spending entered" line also appears if the user legend-hides every category on an entered month — a deliberate user act, noted in the formatter comment; the reference rows still print.
