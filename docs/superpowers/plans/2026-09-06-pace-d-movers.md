# Lane D — Net Worth "What moved" → contribution bars (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Net Worth page's "What moved" waterfall with sorted horizontal contribution bars under a from → to header strip, with a Groups · Accounts toggle.

**Architecture:** A pure builder block appended to `netWorthChartOptions.ts` (`netWorthMovers` rows → `netWorthMoversOption` / `netWorthMoversCsv` / `netWorthMoversLede` / `moversHeight`), composed only from the chart grammar (`grid('horizontal')`, `moneyAxis()`, `BAR_MARKS`, `capLabel`, `itemTooltip`). `ChartCard` gains an optional `lede` slot under its header. `NetWorthPage` keeps the card's title and empty sentence and adds a local `moversBy` state exactly like `stackBy`; the bridge builder, fixture and tests are deleted. Frontend-only, no wire changes, independent of lanes A/B/C.

**Tech Stack:** React 19 + TypeScript, ECharts through `src/charts/*`, vitest + @testing-library/react. Spec: `docs/superpowers/specs/2026-09-06-pace-match-settings-movers-design.md` §4; grammar: `docs/superpowers/specs/2026-09-03-chart-grammar-design.md` §6–§9, §14.

**File structure**
- `src/components/ChartCard.tsx` + `panels.css` + `ChartCard.test.tsx` — the `lede?: ReactNode` slot and its style.
- `src/components/networth/netWorthChartOptions.ts` + `.test.ts` — **+** `MoversMode`, `MOVERS_MODES`, `Mover`, `netWorthMovers`, `moversHeight`, `netWorthMoversOption`, `netWorthMoversCsv`, `MoversLede`, `netWorthMoversLede`; **−** `bridgeSteps`, `netWorthBridgeOption`, `netWorthBridgeCsv`.
- `src/charts/fixtures/netWorthMovers.fixture.ts` (new) replaces `netWorthBridge.fixture.ts`, with its `conformance.test.ts` ROSTER entry; `src/pages/NetWorthPage.tsx` + `.test.tsx` carry the card (toggle, lede, height, csv, ghost); `src/charts/waterfall.ts` gets a comment fix only — the tax waterfall keeps the module.

---
### Task 1: ChartCard's `lede` slot
**Files:** Modify `src/components/ChartCard.tsx`, `src/components/panels.css` (after the `.chart-card-controls` rule, ~L727); Test `src/components/ChartCard.test.tsx`
- [ ] **Step 1: Write the failing tests** — append inside `describe('ChartCard chrome', …)`:
```tsx
  it('renders an optional lede under the header, above the export row and the plot', () => {
    render(<ChartCard {...base} option={OPTION} lede={<>Jul 2026 <b>$170.00</b> → Aug 2026 <b>$230.00</b></>} />)
    const lede = document.querySelector('.chart-lede') as HTMLElement
    expect(lede.textContent).toBe('Jul 2026 $170.00 → Aug 2026 $230.00')
    expect(lede.previousElementSibling?.className).toBe('chart-card-header')
    expect(document.querySelector('.chart-lede + .chart-card-row-export')).toBeTruthy()
  })
  it('draws no lede element at all for the cards that pass none', () => {
    render(<ChartCard {...base} option={OPTION} />)
    expect(document.querySelector('.chart-lede')).toBeNull()
  })
```
- [ ] **Step 2: Run — expect FAIL** (`lede` is not a prop; `.chart-lede` is null): `npx vitest run src/components/ChartCard.test.tsx`
- [ ] **Step 3: Add the prop** — in `ChartCardProps`, right after `footer?: ReactNode`:
```tsx
  /** A header strip under the title: the movers card's "from → to" line (spec §4.2). */
  lede?: ReactNode
```
Add `lede` to the destructuring line (after `footer,`), and render it immediately after the `</div>` that closes `.chart-card-header`, above the `{/* Rows the card reserves … */}` comment:
```tsx
      {lede !== undefined && <div className="chart-lede">{lede}</div>}
```
- [ ] **Step 4: Style it** — in `panels.css`, directly after the `.chart-card-controls { … }` rule:
```css
/* The optional header strip (spec §4.2): muted prose with the figures in text ink. Only a card
   that passes a `lede` renders it, so no other card's box — nor the ghost chartCardBox reports
   for it — changes. */
.chart-lede { margin: -0.25rem 0 0.6rem; font-size: 0.82rem; color: var(--muted); }
.chart-lede b { color: var(--text); font-weight: 600; }
```
- [ ] **Step 5: Run — expect PASS:** `npx vitest run src/components/ChartCard.test.tsx`
- [ ] **Step 6: Commit:** `git add src/components/ChartCard.tsx src/components/ChartCard.test.tsx src/components/panels.css && git commit -m "feat(charts): ChartCard takes an optional lede strip under its title"`

### Task 2: The movers builder — Groups mode
**Files:** Modify `src/components/networth/netWorthChartOptions.ts` (imports L5/L12/L16, new block at end of file); Test `src/components/networth/netWorthChartOptions.test.ts` (append at end)
- [ ] **Step 1: Write the failing tests.** `ts()`, `tooltipRows`, `GROUP_COLORS` and `OTHER_SERIES_COLOR` are already imported by this file — do not re-import them. (The grid and the axis formatter are the conformance fixture's job in Task 6, not this file's.)
```ts
import { moversHeight, netWorthMovers, netWorthMoversOption } from './netWorthChartOptions'

// Jul → Aug, four groups moving unequally: taxable +100, liability −40 (more debt is a LOSS bar), cash +30, pre-tax +10 → net +100.
const MOVED = ts({
  group_totals: { ...ts().group_totals, cash: ['100.00', '110.00', '140.00'], taxable: ['300.00', '310.00', '410.00'], liability: ['-50.00', '-40.00', '-80.00'] },
  net_worth: ['550.00', '590.00', '690.00'],
})
type MoversRead = { yAxis: { data: string[]; inverse: boolean }; tooltip: { formatter: (p: unknown) => string }
  series: { name: string; barMaxWidth: number; label: { formatter: (p: { dataIndex: number }) => string }
    data: { value: number; itemStyle: { color: string }; label: { position: string } }[] }[] }
const movers = (option: unknown) => option as MoversRead

describe('netWorthMoversOption — Groups', () => {
  it('draws one bar per group that moved, largest first, signed at its outer end', () => {
    const option = movers(netWorthMoversOption(MOVED, 2, 'group'))
    // Four rows, not seven: a group that did not move is a label with no bar.
    expect(option.yAxis.data).toEqual(['Taxable', 'Liabilities', 'Cash', 'Pre-tax'])
    expect(option.yAxis.inverse).toBe(true) // the largest mover on TOP
    const [bars] = option.series
    expect([bars.name, bars.barMaxWidth]).toEqual(['Change', 24])
    expect(bars.data.map((d) => d.value)).toEqual([100, -40, 30, 10])
    expect(bars.data.map((d) => d.itemStyle.color)).toEqual([GROUP_COLORS.taxable, GROUP_COLORS.liability, GROUP_COLORS.cash, GROUP_COLORS.pre_tax])
    expect(bars.data.map((d) => d.label.position)).toEqual(['right', 'left', 'right', 'right'])
    expect([0, 1].map((i) => bars.label.formatter({ dataIndex: i }))).toEqual(['+$100', '-$40'])
  })
  it('tells each bar its share of the move, and refuses the months it cannot compare', () => {
    const option = movers(netWorthMoversOption(MOVED, 2, 'group'))
    const gain = tooltipRows(option.tooltip.formatter({ dataIndex: 0 }))
    expect([gain.lead, gain.label, gain.sub]).toEqual(['$100.00', 'Taxable', '100% of the change'])
    const loss = tooltipRows(option.tooltip.formatter({ dataIndex: 1 }))
    expect([loss.lead, loss.label, loss.sub]).toEqual(['-$40.00', 'Liabilities', '-40% of the change'])
    // Nothing to compare WITH, and nothing that moved: both are the card's empty sentence.
    expect([netWorthMoversOption(MOVED, 0, 'group'), netWorthMoversOption(MOVED, -1, 'group'), netWorthMoversOption(ts(), 2, 'account')]).toEqual([null, null, null])
    expect([moversHeight(1), moversHeight(6), moversHeight(20)]).toEqual([200, 228, 420])
  })
})
```
- [ ] **Step 2: Run — expect FAIL** (`netWorthMoversOption` is not exported): `npx vitest run src/components/networth`
- [ ] **Step 3: Widen three imports** at the top of `netWorthChartOptions.ts`, and add the tone pair:
```ts
import { BAR_MARKS, LINE, STACK_WASH, capLabel, cents, grid, moneyAxis, monthAxis, pctAxis } from '../../charts/grammar'
import { axisTooltip, itemTooltip } from '../../charts/tooltip'
import { escapeHtml, formatCurrency, formatCurrencyCompact, formatMonth, formatPct } from '../../utils/format'
import { toneOf } from '../../utils/tone'
import type { Tone } from '../../utils/tone'
```
- [ ] **Step 4: Append the builder** at the END of the file (below `netWorthBridgeCsv`, which Task 7 deletes):
```ts
// ── "What moved": contribution bars (2026-09-06 spec §4) ────────────────────────────────
/** Which entity the bars measure. */
export type MoversMode = 'group' | 'account'
export const MOVERS_MODES: { value: MoversMode; label: string }[] = [{ value: 'group', label: 'Groups' }, { value: 'account', label: 'Accounts' }]

/** One bar: what moved, by how much, in whose colour. `groupLabel` is null only for the
 *  folded remainder; `share` is the bar's part of the month's net change, null when net
 *  worth did not move at all. */
export interface Mover { label: string; groupLabel: string | null; delta: number; color: string; share: number | null }

/** A missing column is zero, not NaN: an account that starts mid-history still moved the total. */
const num = (value: string | null | undefined): number => (value == null ? 0 : Number(value))
/** The movers between index−1 and index, largest first. Empty when there is nothing to
 *  compare with and when nothing moved — both render the card's empty sentence. Ties keep
 *  source order: Array.prototype.sort is stable, so GROUP_ORDER breaks them. */
export function netWorthMovers(ts: NetWorthTimeseries, index: number, mode: MoversMode): Mover[] {
  if (index < 1 || index >= ts.months.length) return []
  const net = cents(num(ts.net_worth[index]) - num(ts.net_worth[index - 1]))
  const share = (delta: number) => (net === 0 ? null : delta / net)
  const rows: Mover[] =
    mode === 'group'
      ? GROUP_ORDER.flatMap((g) => {
          const delta = cents(num(ts.group_totals[g][index]) - num(ts.group_totals[g][index - 1]))
          // Liability deltas keep their stored sign: more debt is a NEGATIVE bar.
          return delta === 0
            ? []
            : [{ label: GROUP_LABELS[g], groupLabel: GROUP_LABELS[g], delta, color: GROUP_COLORS[g], share: share(delta) }]
        })
      : []
  return rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
}

/** One 28px row each, floored so a lone mover is not a sliver and capped so a long Accounts
 *  list is not a page (spec §4.2). */
export function moversHeight(rows: number): number {
  return Math.min(420, Math.max(200, 60 + 28 * rows))
}
/** "+$1.2K" / "-$840" — on a contribution bar the sign is the whole point. */
const signedCompact = (value: number): string => (value > 0 ? `+${formatCurrencyCompact(value)}` : formatCurrencyCompact(value))
/** "83%" — ONE spelling of the share, for the tooltip and the table twin alike. */
const sharePct = (share: number | null): string | null => (share === null ? null : formatPct(share, { signed: false, decimals: 0 }))

/** "What moved — {month}": sorted contribution bars between two snapshots (spec §4.2).
 *  Null on the first month and on a month where nothing moved. */
export function netWorthMoversOption(ts: NetWorthTimeseries, index: number, mode: MoversMode): EChartsOption | null {
  const movers = netWorthMovers(ts, index, mode)
  if (movers.length === 0) return null
  return {
    grid: grid('horizontal'),
    tooltip: itemTooltip<{ dataIndex?: number }>({
      // Account names are user text — itemTooltip escapes every label and sub it renders.
      body: (p) => {
        const mover = movers[p.dataIndex ?? -1]
        if (mover === undefined) return null
        const pct = sharePct(mover.share)
        const sub = [pct === null ? null : `${pct} of the change`, mode === 'account' ? mover.groupLabel : null].filter((part): part is string => part !== null).join(' · ')
        return { value: mover.delta, label: mover.label, sub: sub === '' ? undefined : sub }
      },
    }),
    xAxis: moneyAxis(),
    yAxis: { type: 'category' as const, data: movers.map((m) => m.label), inverse: true, axisLabel: { width: 118, overflow: 'truncate' as const } },
    series: [
      { type: 'bar' as const, name: 'Change', ...BAR_MARKS, barMaxWidth: 24,
        // capLabel carries show/colour/size/formatter; each item overrides only the POSITION,
        // so the amount sits at the bar's outer end instead of over the axis (spec §4.2).
        label: capLabel((p) => signedCompact(movers[p.dataIndex]?.delta ?? 0)),
        data: movers.map((m) => ({ value: m.delta, itemStyle: { color: m.color }, label: { position: m.delta > 0 ? ('right' as const) : ('left' as const) } })) },
    ],
  }
}
```
- [ ] **Step 5: Run — expect PASS** (both new cases and every pre-existing one): `npx vitest run src/components/networth`
- [ ] **Step 6: Commit:** `git add src/components/networth && git commit -m "feat(networth): contribution bars for What moved, Groups mode"`

### Task 3: Accounts mode and the fold at ten
**Files:** Modify `src/components/networth/netWorthChartOptions.ts` (`netWorthMovers`); Test `src/components/networth/netWorthChartOptions.test.ts`
- [ ] **Step 1: Write the failing tests** — widen the existing type import near the top of the test file to `import type { AccountGroup, AccountOut, NetWorthTimeseries, PersonOut } from '../../types/api'`, then append at the end:
```ts
const acc = (id: number, name: string, group: AccountGroup, is_component = false): AccountOut => ({
  id, name, slug: `a${id}`, group, sort_order: id, is_active: true, is_component, parent_account_id: null, person_id: null,
})
// MOVED's deltas on accounts, plus a component (already folded into its parent by the server) and an account that did not move.
const ACCOUNTS = ts({
  accounts: [acc(1, 'Checking', 'cash'), acc(2, 'Brokerage', 'taxable'), acc(3, 'Card', 'liability'), acc(4, 'Vanguard sleeve', 'taxable', true), acc(5, 'Sock drawer', 'cash')],
  series: [
    { account_id: 1, values: ['100.00', '110.00', '140.00'] }, { account_id: 2, values: ['300.00', '310.00', '410.00'] },
    { account_id: 3, values: ['-50.00', '-40.00', '-80.00'] }, { account_id: 4, values: ['10.00', '10.00', '99.00'] },
    { account_id: 5, values: ['5.00', '5.00', '5.00'] },
  ],
  net_worth: ['550.00', '590.00', '690.00'],
})
// Twelve cash accounts moving +12 … +1: ten bars and one folded remainder of +3.
const MANY = ts({
  accounts: Array.from({ length: 12 }, (_, i) => acc(i + 1, `A${i + 1}`, 'cash')),
  series: Array.from({ length: 12 }, (_, i) => ({ account_id: i + 1, values: ['0.00', '0.00', `${12 - i}.00`] })),
  net_worth: ['0.00', '0.00', '78.00'],
})

describe('netWorthMoversOption — Accounts', () => {
  it('bars every non-component account that moved, coloured by its group and named in the tooltip', () => {
    const rows = netWorthMovers(ACCOUNTS, 2, 'account')
    expect(rows.map((m) => [m.label, m.groupLabel, m.color])).toEqual([['Brokerage', 'Taxable', GROUP_COLORS.taxable], ['Card', 'Liabilities', GROUP_COLORS.liability], ['Checking', 'Cash', GROUP_COLORS.cash]])
    const option = movers(netWorthMoversOption(ACCOUNTS, 2, 'account'))
    const first = tooltipRows(option.tooltip.formatter({ dataIndex: 0 }))
    expect([first.lead, first.label, first.sub]).toEqual(['$100.00', 'Brokerage', '100% of the change · Taxable'])
  })
  it('keeps the ten largest and folds the rest into one grey remainder — unless it cancels', () => {
    const rows = netWorthMovers(MANY, 2, 'account')
    expect(rows.map((m) => m.label)).toEqual(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'Other accounts'])
    expect(rows[10]).toMatchObject({ delta: 3, color: OTHER_SERIES_COLOR, groupLabel: null })
    expect(moversHeight(rows.length)).toBe(368)
    // A remainder that nets to zero is no bar at all (the rule every other row follows).
    const cancels = { ...MANY, series: MANY.series.map((s, i) => (i === 11 ? { ...s, values: ['0.00', '0.00', '-2.00'] } : s)) }
    expect(netWorthMovers(cancels, 2, 'account')).toHaveLength(10)
  })
})
```
- [ ] **Step 2: Run — expect FAIL** (Accounts mode returns `[]`): `npx vitest run src/components/networth`
- [ ] **Step 3: Implement the account branch.** Declare the cap just above `netWorthMovers`:
```ts
/** Accounts mode draws the ten largest movers and folds the rest into one row. */
const MAX_ACCOUNT_MOVERS = 10
```
Then replace the ternary's `: []` arm **and** the `return rows.sort(…)` line (through the function's closing brace) with:
```ts
      : (() => {
          const byId = new Map(ts.series.map((s) => [s.account_id, s.values]))
          // Components are already folded into their parents by the timeseries (spec §4.1);
          // drawing them too would count the same money twice.
          return ts.accounts.flatMap((a) => {
            if (a.is_component) return []
            const values = byId.get(a.id) ?? []
            const delta = cents(num(values[index]) - num(values[index - 1]))
            return delta === 0
              ? []
              : [{ label: a.name, groupLabel: GROUP_LABELS[a.group], delta, color: GROUP_COLORS[a.group], share: share(delta) }]
          })
        })()
  rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
  if (mode === 'group' || rows.length <= MAX_ACCOUNT_MOVERS) return rows
  const kept = rows.slice(0, MAX_ACCOUNT_MOVERS)
  const folded = cents(rows.slice(MAX_ACCOUNT_MOVERS).reduce((sum, r) => sum + r.delta, 0))
  // The remainder is a TAIL, not a mover: last even when its sum outweighs the tenth bar, and dropped when it cancels to zero.
  return folded === 0
    ? kept
    : [...kept, { label: 'Other accounts', groupLabel: null, delta: folded, color: OTHER_SERIES_COLOR, share: share(folded) }]
}
```
- [ ] **Step 4: Run — expect PASS:** `npx vitest run src/components/networth`
- [ ] **Step 5: Commit:** `git add src/components/networth && git commit -m "feat(networth): Accounts mode for the movers, folded past ten"`

### Task 4: The CSV twin and the header lede
**Files:** Modify `src/components/networth/netWorthChartOptions.ts`; Test `src/components/networth/netWorthChartOptions.test.ts`
- [ ] **Step 1: Write the failing tests** — append at the end of the test file:
```ts
import { netWorthMoversCsv, netWorthMoversLede } from './netWorthChartOptions'

// Cash +10 against taxable −10: the month's NET change is zero, so no bar has a share OF
// it — an "∞% of the change" would be a lie.
const FLAT = ts({
  group_totals: { ...ts().group_totals, pre_tax: ['200.00', '210.00', '210.00'], taxable: ['300.00', '310.00', '300.00'], liability: ['-50.00', '-40.00', '-40.00'] },
  net_worth: ['550.00', '590.00', '590.00'],
})

describe('netWorthMoversCsv', () => {
  it('exports the drawn rows under the four spec columns', () => {
    const csv = netWorthMoversCsv(MOVED, 2, 'group')
    expect(csv.headers).toEqual(['Mover', 'Group', 'Change', 'Share of change'])
    expect(csv.rows).toEqual([['Taxable', 'Taxable', '100.00', '100%'], ['Liabilities', 'Liabilities', '-40.00', '-40%'],
      ['Cash', 'Cash', '30.00', '30%'], ['Pre-tax', 'Pre-tax', '10.00', '10%']])
    expect(netWorthMoversCsv(MOVED, 0, 'group').rows).toEqual([])
  })
  it('leaves the group blank for the folded remainder, and the share blank on a flat month', () => {
    expect(netWorthMoversCsv(MANY, 2, 'account').rows.at(-1)).toEqual(['Other accounts', '', '3.00', '4%'])
    expect(netWorthMoversCsv(FLAT, 2, 'group').rows).toEqual([['Cash', 'Cash', '10.00', ''], ['Taxable', 'Taxable', '-10.00', '']])
    expect(tooltipRows(movers(netWorthMoversOption(FLAT, 2, 'group')).tooltip.formatter({ dataIndex: 0 })).sub).toBeUndefined()
  })
})

describe('netWorthMoversLede', () => {
  it('reads the two totals and the percent off the payload, and tones the move', () => {
    expect(netWorthMoversLede(MOVED, 2)).toEqual({
      fromLabel: 'Jul 2026', fromValue: '$590.00', toLabel: 'Aug 2026', toValue: '$690.00',
      // The SERVER's mom_pct — deliberately NOT 100/590, what re-deriving it here would print.
      delta: '+$100.00', pct: '+6.8%', tone: 'positive',
    })
    expect(netWorthMoversLede(MOVED, 0)).toBeNull()
    expect(netWorthMoversLede(ts({ mom_pct: [null, null, null] }), 2)?.pct).toBeNull()
    expect(netWorthMoversLede(FLAT, 2)?.tone).toBe('neutral')
  })
})
```
- [ ] **Step 2: Run — expect FAIL** (`netWorthMoversCsv` is not exported): `npx vitest run src/components/networth`
- [ ] **Step 3: Implement both** — append at the end of `netWorthChartOptions.ts`:
```ts
/** The bars as a table (spec §4.2). `Change` is the plain number the bar drew; the share
 *  carries its % sign because that column is a ratio, not money. */
export function netWorthMoversCsv(ts: NetWorthTimeseries, index: number, mode: MoversMode): ExportTable {
  return {
    headers: ['Mover', 'Group', 'Change', 'Share of change'],
    rows: netWorthMovers(ts, index, mode).map((m) => [m.label, m.groupLabel ?? '', m.delta.toFixed(2), sharePct(m.share) ?? '']),
  }
}

/** "+$100.00" — the lede's move, signed like the bars' own labels. */
const signedCurrency = (value: number): string => (value > 0 ? `+${formatCurrency(value)}` : formatCurrency(value))
export interface MoversLede {
  fromLabel: string; fromValue: string; toLabel: string; toValue: string
  delta: string // the difference of the two SERVER totals, signed
  pct: string | null // the server's own mom_pct — null when it sent none for this month
  tone: Tone
}

/** The card's header strip (spec §4.2): from → to, then the move. Null on the first month.
 *  Every figure is the server's — the two totals and the percent are printed verbatim and
 *  the delta is the difference of those totals, never a client-recomputed percentage. */
export function netWorthMoversLede(ts: NetWorthTimeseries, index: number): MoversLede | null {
  if (index < 1 || index >= ts.months.length) return null
  const delta = cents(num(ts.net_worth[index]) - num(ts.net_worth[index - 1]))
  const pct = ts.mom_pct[index]
  return {
    fromLabel: formatMonth(ts.months[index - 1]), fromValue: formatCurrency(ts.net_worth[index - 1]),
    toLabel: formatMonth(ts.months[index]), toValue: formatCurrency(ts.net_worth[index]),
    delta: signedCurrency(delta), pct: pct == null ? null : formatPct(pct), tone: toneOf(delta),
  }
}
```
- [ ] **Step 4: Run — expect PASS:** `npx vitest run src/components/networth`
- [ ] **Step 5: Commit:** `git add src/components/networth && git commit -m "feat(networth): movers CSV twin and the from-to lede"`

### Task 5: Wire the card on the Net Worth page
**Files:** Modify `src/pages/NetWorthPage.tsx` (imports L19-28, state L111, memo L354-358, ghost L425, card L568-580); Test `src/pages/NetWorthPage.test.tsx`
- [ ] **Step 1: Write the failing test.** First give the page's EChart mock a category read-out: add `yAxis?: { data?: string[] }` to the `option` type inside `vi.mock('../components/EChart', …)` and this attribute after `'data-stacks'`:
```tsx
        'data-categories': (option.yAxis?.data ?? []).join('|'),
```
Update the existing mount test's aria line (~L578) to `expect(screen.getByLabelText(/Horizontal bar chart of how each account group moved/)).toBeTruthy()` and the stale comment at ~L259 to `// The drill card is the page's last chart: the What-moved movers sit between it and`, then append inside `describe('NetWorthPage — chart cards', …)`:
```tsx
  it('breaks the movers down by group, then by account, with the lede and the table twin', async () => {
    renderPage()
    await screen.findByText(/What moved — Aug 2026/)
    const card = screen.getByRole('group', { name: 'Export net-worth-movers' }).closest('section') as HTMLElement
    expect(card.querySelector('.chart-lede')?.textContent).toBe('Jul 2026 $170.00 → Aug 2026 $230.00 · +$60.00 · +35.3%')
    expect(within(card).getByTestId('echart').getAttribute('data-categories')).toBe('Cash')
    fireEvent.click(within(card).getByRole('button', { name: 'Accounts' }))
    expect(within(card).getByTestId('echart').getAttribute('data-categories')).toBe('My Checking|Joint Savings')
    expect(within(card).getByLabelText(/Horizontal bar chart of how each account moved/)).toBeTruthy()
    fireEvent.click(within(card).getByRole('button', { name: 'Table' }))
    const rows = [...card.querySelectorAll('tbody tr')].map((r) => [...r.querySelectorAll('td')].map((td) => td.textContent))
    expect(rows).toEqual([['My Checking', 'Cash', '50.00', '83%'], ['Joint Savings', 'Cash', '10.00', '17%']])
  })
```
- [ ] **Step 2: Run — expect FAIL** (no `Export net-worth-movers` group; the waterfall aria is still mounted): `npx vitest run src/pages/NetWorthPage.test.tsx`
- [ ] **Step 3: Swap the imports.** In the multi-line `../components/networth/netWorthChartOptions` import (L19-28) delete `netWorthBridgeCsv` and `netWorthBridgeOption` and add, keeping its order (uppercase constants first, then alphabetical): `MOVERS_MODES`, `moversHeight`, `netWorthMovers`, `netWorthMoversCsv`, `netWorthMoversLede`, `netWorthMoversOption`. Extend the type import below it to `import type { MoversMode, StackMode } from '../components/networth/netWorthChartOptions'`.
- [ ] **Step 4: Add the mode state** directly under the `stackBy` state (L111):
```tsx
  // Groups is the default reading (spec §4.2): "which part of the portfolio moved" comes
  // before "which account did it". Local state like stackBy — one payload feeds both.
  const [moversBy, setMoversBy] = useState<MoversMode>('group')
```
- [ ] **Step 5: Replace the `bridgeOption` memo** (L354-358):
```tsx
  // The viewed month against the one before it — null on the first snapshot, where there is
  // nothing to compare WITH, and on a month where nothing moved.
  const movers = useMemo(() => (data === null ? [] : netWorthMovers(data, viewedIndex, moversBy)), [data, viewedIndex, moversBy])
  const moversOption = useMemo(() => (data === null ? null : netWorthMoversOption(data, viewedIndex, moversBy)), [data, viewedIndex, moversBy])
  const moversLede = useMemo(() => (data === null ? null : netWorthMoversLede(data, viewedIndex)), [data, viewedIndex])
```
- [ ] **Step 6: Re-measure the card's ghost** (L425) — it now carries a Segmented control and a lede line over a six-row plot. Replace that entry, and reword the comment above the `skeleton={{` block from "the What-moved waterfall (280, bare)" to "the What-moved movers (a six-row plot plus its lede line, one Segmented control)":
```tsx
            { span: 12, height: ghostCardBody(chartCardBox(255, { controls: true })) },
```
- [ ] **Step 7: Replace the card** (L568-580):
```tsx
          {data !== null && viewedIndex >= 1 && (
            <ChartCard
              title={`What moved — ${formatMonth(months[viewedIndex])}`}
              hint="How each account group — or account — moved net worth from the prior snapshot to this one, largest first. Groups that did not move are left out."
              // The aria follows the TOGGLE: a sentence saying "group" over a chart of
              // accounts is the one reading a screen-reader user cannot check.
              ariaLabel={`Horizontal bar chart of how each ${moversBy === 'account' ? 'account' : 'account group'} moved net worth from the prior month to this one`}
              option={moversOption}
              empty="Nothing moved between these two months."
              exportName="net-worth-movers"
              csv={() => netWorthMoversCsv(data, viewedIndex, moversBy)}
              height={moversHeight(movers.length)}
              controls={
                <Segmented variant="toggle" size="sm" ariaLabel="Break down by" options={MOVERS_MODES} value={moversBy} onChange={setMoversBy} />
              }
              lede={
                moversLede === null ? undefined : (
                  <>
                    {`${moversLede.fromLabel} `}<b>{moversLede.fromValue}</b>{` → ${moversLede.toLabel} `}
                    <b>{moversLede.toValue}</b>{' · '}
                    <span className={`stat-delta-${moversLede.tone}`}>{moversLede.delta}</span>
                    {moversLede.pct !== null && (
                      <>{' · '}<span className={`stat-delta-${moversLede.tone}`}>{moversLede.pct}</span></>
                    )}
                  </>
                )
              }
            />
          )}
```
- [ ] **Step 8: Run — expect PASS** (every case in the file): `npx vitest run src/pages/NetWorthPage.test.tsx`
- [ ] **Step 9: Commit:** `git add src/pages/NetWorthPage.tsx src/pages/NetWorthPage.test.tsx && git commit -m "feat(networth): What moved becomes contribution bars with a Groups/Accounts toggle"`

### Task 6: Swap the conformance fixture
**Files:** Create `src/charts/fixtures/netWorthMovers.fixture.ts`; Delete `src/charts/fixtures/netWorthBridge.fixture.ts`; Modify `src/charts/conformance.test.ts:27`
- [ ] **Step 1: Write the fixture**
```ts
import type { ChartFixture } from './_types'
import { netWorthMoversOption } from '../../components/networth/netWorthChartOptions'
import { TS } from './netWorthStack.fixture'

const fixture: ChartFixture = {
  name: 'netWorthMovers',
  kind: 'cartesian',
  ariaLabel: 'Horizontal bar chart of how each account group moved net worth from the prior month to this one',
  // Groups mode: TS carries group_totals but no per-account series, so it is the branch this data can draw.
  build: () => netWorthMoversOption(TS, 2, 'group'),
}
export default fixture
```
- [ ] **Step 2: Retire the bridge fixture by RENAMING, not deleting** (overnight rule: no file deletions — a `git rm` can stall on the permission gate for hours). Run `git mv src/charts/fixtures/netWorthBridge.fixture.ts src/charts/fixtures/netWorthMovers.fixture.ts`, then overwrite the renamed file with Step 1's content (Step 1 therefore writes INTO the renamed file, not a fresh one). Change the ROSTER's `'netWorthBridge',` line in `src/charts/conformance.test.ts` to `'netWorthMovers',`. If even `git mv` is refused: write Step 1's content to the NEW path, replace the old file's whole content with the same fixture module (same `name: 'netWorthMovers'` — the roster is keyed by name, so two files with one name pass the two-way pin and simply conform twice), and append `src/charts/fixtures/netWorthBridge.fixture.ts` to `docs/superpowers/plans/2026-09-06-pace-retire-list.md` for the coordinator's end-of-night deletion pass.
- [ ] **Step 3: Run — expect PASS** (a `netWorthMovers conforms` case appears, the roster's two-way pin is satisfied, no `netWorthBridge` case remains): `npx vitest run src/charts/conformance.test.ts`
- [ ] **Step 4: Commit:** `git add src/charts/fixtures src/charts/conformance.test.ts && git commit -m "test(charts): movers fixture replaces the net-worth bridge"`

### Task 7: Delete the bridge builder
**Files:** Modify `src/components/networth/netWorthChartOptions.ts` (import L13; `bridgeSteps` + `netWorthBridgeOption` + `netWorthBridgeCsv`, ~L363-405), `src/components/networth/netWorthChartOptions.test.ts`, `src/charts/waterfall.ts:5`
- [ ] **Step 1: Remove the builder** — delete the line `import { waterfallCsv, waterfallSeries, waterfallSteps, waterfallTooltip } from '../../charts/waterfall'` and everything from the `/** The bridge's steps: …` comment through the closing brace of `netWorthBridgeCsv`. Nothing else in the file references them.
- [ ] **Step 2: Remove their tests** — delete the line `import { netWorthBridgeCsv, netWorthBridgeOption } from './netWorthChartOptions'` and the whole `describe('netWorthBridgeOption', () => { … })` block. **Keep** the `import { OTHER_SERIES_COLOR } from '../../charts/theme'` line between them: the movers tests use that binding, and re-importing it lower down would redeclare it.
- [ ] **Step 3: Correct the waterfall's header comment** — `src/charts/waterfall.ts` line 5 becomes `// waterfall. Depends on: grammar.ts, tooltip.ts, theme.ts.`
- [ ] **Step 4: Run — expect PASS, and `git grep -n netWorthBridge -- src` prints nothing:** `npx vitest run src/components/networth src/pages/NetWorthPage.test.tsx src/charts/conformance.test.ts`
- [ ] **Step 5: Commit:** `git add src/components/networth src/charts/waterfall.ts && git commit -m "refactor(networth): drop the What-moved waterfall builder"`

### Task 8: Types, lint and the full suite
**Files:** none — verification only.
- [ ] **Step 1: Typecheck** (a leftover `bridgeOption` reference or an unused import fails here) — expect exit 0, no output: `npx tsc -b`
- [ ] **Step 2: Lint** — expect exit 0, no output: `npx eslint src/components/networth src/pages/NetWorthPage.tsx src/components/ChartCard.tsx src/charts/fixtures/netWorthMovers.fixture.ts`
- [ ] **Step 3: Full frontend suite** — expect no failures, one fewer test file than before (the bridge fixture is gone): `npx vitest run`
- [ ] **Step 4: Commit only if a run corrected something:** `git status --short`, then `git commit -am "chore(networth): lane D verification fixes"`

---
**Decisions this plan locks in — raise them, do not silently change them.** (1) `netWorthMoversOption` returns null both on `index < 1` and when nothing moved: the card's existing empty sentence is exactly that state's copy. (2) The aria sentence follows the toggle — the spec's sentence verbatim for Groups, the word "group" dropped for Accounts. (3) The lede's totals and percent are `net_worth` / `mom_pct` verbatim; the delta is the difference of the two server totals (`cents()`, display-only) because this wire carries no per-month delta, and the tone spans reuse the colour-only `stat-delta-{tone}` classes. (4) One `sharePct` helper serves the tooltip and the CSV, printing blank — not `∞%` — when the month's net change is zero. (5) The folded "Other accounts" row is a tail: always last, `groupLabel: null`, dropped when its sum cancels. (6) No `zeroLine` markLine — §4.2 enumerates the form and does not ask for one.
