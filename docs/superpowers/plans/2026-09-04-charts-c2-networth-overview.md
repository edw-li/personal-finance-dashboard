# Charts C2 — Net worth + Overview onto the grammar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the Net worth and Overview charts onto the grammar built in C1 (`docs/superpowers/plans/2026-09-04-charts-c1-primitives.md`): lift the two inline Net worth options out of `NetWorthPage.tsx` into `netWorthChartOptions.ts`, put every mount on `ChartCard`, and land the spec's fixes for these pages — F2 (zero-floored stack, immaterial liabilities hidden from the legend, `Share %` mode, the "What moved" bridge), F8 (the stack/drill pair aligned on the `endLabel` grid and linked through one `group`), F14 (a 12-month average reference on the Overview spend bars), plus F7/F9/F11/F12 for every chart here (grammar tooltips, persisted legends, house `ariaLabel`s, export + Table on all six mounts).

**Architecture:** Builders stay pure and move into `src/components/networth/netWorthChartOptions.ts` and `src/components/overview/overviewChartOptions.ts`; each gains a `<builder>.fixture.ts` under `src/charts/fixtures/` so `conformance.test.ts` enforces the grammar structurally. Pages keep their state (range, legends, stackBy, drill) and hand the builders plain inputs. `ChartCard` owns the chrome: the old `networth-chart-header` markup, `ChartZoomHint`, `empty-note` fallbacks and `animateEntrance={!fromCache}` all disappear from the pages (the CSS rules stay in place, unused — C7 lists them). Dark options are byte-identical to today's except where a spec section is cited in the commit message (§8 grid variants and `monthAxis` labels, §9 `emphasis.focus` + legend rule, F2, F7, F14).

**Tech Stack:** React 19, TypeScript 5.9, vitest 3 + @testing-library/react (jsdom; `EChart` is mocked in page tests exactly as today — `ChartCard` imports the same module, so the existing `vi.mock('../components/EChart')` keeps working), ECharts 6.1 types via `src/charts/echarts.ts`.

**Worktree / commands:** Branch `charts-c2` from `main` AFTER C1 has merged (`git worktree add .worktrees/charts-c2 -b charts-c2 main`); junction deps once: `cmd //c "mklink /J node_modules ..\\..\\node_modules"`. Commands from the worktree root: `npx vitest run <file>`, `npx tsc -b`, `npx eslint <files>`. Local commits only. Read the C1 modules before starting (`src/charts/grammar.ts`, `tooltip.ts`, `legend.ts`, `reference.ts`, `markLine.ts`, `entities.ts`, `waterfall.ts`, `src/components/ChartCard.tsx`, `src/charts/fixtures/_types.ts`, `src/testing/tooltipRows.ts`) — every helper used below is defined there.

**Done when:** no `<EChart` sits outside `ChartCard` in `NetWorthPage.tsx`, `OverviewPage.tsx`, `MoneyFlowCard.tsx`; `npx vitest run src/charts/conformance.test.ts` is green with the eight fixtures this lane adds; `npx tsc -b`, `npx eslint`, and the full `npx vitest run` pass.

---

## File structure

| File | Responsibility |
|---|---|
| `src/components/networth/netWorthChartOptions.ts` (modify) | + `STACK_MODES`, `liabilitiesMaterial`, `netWorthStackOption(input)`, `netWorthDrillOption(input)`, `netWorthDrillCsv`, `netWorthBridgeOption`, `netWorthBridgeCsv`; `netWorthStackedTooltipFormatter` left in place (unused — C7 retires) |
| `src/components/networth/netWorthChartOptions.test.ts` (modify) | Pins for the three new builders (series names/colors/data lifted from the page test, F2 floor/immaterial/share, tooltip row order via `tooltipRows`) |
| `src/charts/fixtures/netWorthStack.fixture.ts`, `netWorthStackShare.fixture.ts`, `netWorthDrill.fixture.ts`, `netWorthBridge.fixture.ts` (new) | Conformance fixtures |
| `src/pages/NetWorthPage.tsx` (modify) | Stack card (controls: Stack by `By group · By owner · Share %`, Granularity; `group="net-worth"`), Bridge card, Drill card — all `ChartCard`; inline options, `ChartZoomHint`, `EChart`, `networth-chart-header` gone |
| `src/pages/NetWorthPage.test.tsx` (modify) | Mock unchanged; assertions follow the new card structure |
| `src/components/overview/overviewChartOptions.ts` (modify) | `netWorthTrendOption` + `recentSpendOption` on the grammar (F14 reference line), `netWorthTrendCsv`, `recentSpendCsv` |
| `src/components/overview/overviewChartOptions.test.ts` (modify) | Grid/legend/tooltip pins updated where §8/§9/F7/F14 name a change |
| `src/charts/fixtures/overviewNetWorthTrend.fixture.ts`, `overviewRecentSpend.fixture.ts`, `moneyFlow.fixture.ts` (new) | Conformance fixtures |
| `src/components/overview/moneyFlowOptions.ts` (modify) | + `moneyFlowCsv(flow)` via `sankeyCsv` |
| `src/components/overview/MoneyFlowCard.tsx` (modify) | `ChartCard` with the year `Segmented` in `controls`, Retry in `actions`, `error`/`empty` from the payload |
| `src/components/overview/MoneyFlowCard.test.tsx` (modify) | Card structure |
| `src/pages/OverviewPage.tsx` (modify) | Three `ChartCard`s (trend, performance, recent spend) with the "Open … →" links as footers; the performance card mounts C4's builder as-is (`portfolioHistoryOption` / `portfolioHistoryCsv` — this lane does not edit `historyChartOptions.ts`) |
| `src/pages/OverviewPage.test.tsx` (modify) | Card structure |

Not touched here (other lanes): `src/components/portfolio/*` (C4), `src/charts/*` primitives (C1 — read-only; if a helper is missing, add it in THIS lane's `netWorthChartOptions.ts` privately and note it for C7 rather than editing `src/charts/`).

---

### Task 1: `netWorthStackOption` — the stack lifted out of the page, with F2

**Files:**
- Modify: `src/components/networth/netWorthChartOptions.ts`
- Modify: `src/components/networth/netWorthChartOptions.test.ts`
- Create: `src/charts/fixtures/netWorthStack.fixture.ts`, `src/charts/fixtures/netWorthStackShare.fixture.ts`

Today the option lives in `NetWorthPage.tsx:315-445` (`stackedOption` memo). It moves here verbatim, then takes the grammar. Named changes: F2 (zero floor, immaterial liabilities out of the legend, `Share %` mode), F7 (`axisTooltip`), §9 (`FOCUS`, `legendFor`), §8 (`grid('endLabel')` is the same `{70,84,40,28}`; `monthAxis` labels every month at ≤ 12). The `Married` rule keeps using `marriageMarkLine` (already pinned).

- [ ] **Step 1: Write the failing tests**

Append to `src/components/networth/netWorthChartOptions.test.ts`:

```ts
import { tooltipRows } from '../../testing/tooltipRows'
import { GRID_VARIANTS, compactMoney, percentLabel } from '../../charts/grammar'
import { GROUP_COLORS, INK, MUTED, PALETTE } from '../../charts/theme'
import type { NetWorthTimeseries, PersonOut } from '../../types/api'
import { liabilitiesMaterial, netWorthStackOption } from './netWorthChartOptions'

const PEOPLE: PersonOut[] = [
  { id: 2, name: 'Sam', is_primary: false },
  { id: 1, name: 'Me', is_primary: true },
]

function ts(over: Partial<NetWorthTimeseries> = {}): NetWorthTimeseries {
  return {
    months: ['2026-06-01', '2026-07-01', '2026-08-01'],
    accounts: [],
    series: [],
    group_totals: {
      cash: ['100.00', '110.00', '120.00'],
      pre_tax: ['200.00', '210.00', '220.00'],
      post_tax: ['0.00', '0.00', '0.00'],
      taxable: ['300.00', '310.00', '320.00'],
      equity: ['0.00', '0.00', '0.00'],
      other: ['0.00', '0.00', '0.00'],
      liability: ['-50.00', '-40.00', '-30.00'],
    },
    net_worth: ['550.00', '590.00', '630.00'],
    mom_pct: [null, '0.072727', '0.067797'],
    notes: [null, 'sold <em>car</em>', null],
    owner_series: [
      { person_id: 1, name: 'Me', values: ['400.00', '430.00', '460.00'] },
      { person_id: 2, name: 'Sam', values: ['100.00', '110.00', '120.00'] },
      { person_id: null, name: null, values: ['50.00', '50.00', '50.00'] },
    ],
    ...over,
  }
}

const base = { people: PEOPLE, marriageDate: null, range: { preset: 'all' as const }, selected: {} }

interface SeriesLike {
  name?: string
  type?: string
  stack?: string
  color?: string
  z?: number
  lineStyle?: { width?: number }
  areaStyle?: { opacity?: number }
  emphasis?: { focus?: string }
  markLine?: unknown
  data?: unknown[]
}
const read = (option: unknown) =>
  option as {
    grid: unknown
    legend: { type: string; selected: Record<string, boolean>; data?: string[] }
    yAxis: { type: string; min?: (e: { min: number }) => number; axisLabel: { formatter: unknown } }
    xAxis: { data: string[]; boundaryGap?: boolean; axisLabel?: { interval?: number } }
    tooltip: { formatter: (p: unknown) => string; axisPointer?: unknown }
    series: SeriesLike[]
  }

describe('netWorthStackOption — By group', () => {
  it('lifts the page option: seven stacked/lined groups, the INK net-worth line, the notes layer', () => {
    const option = read(netWorthStackOption({ ts: ts(), mode: 'group', ...base }))
    expect(option.series.map((s) => s.name)).toEqual([
      'Cash', 'Pre-tax', 'Post-tax', 'Taxable', 'Equity', 'Other', 'Liabilities', 'Net worth', 'Notes',
    ])
    expect(option.series.slice(0, 6).every((s) => s.stack === 'assets')).toBe(true)
    expect(option.series[0].color).toBe(GROUP_COLORS.cash)
    expect(option.series[0].lineStyle).toEqual({ width: 1 })
    expect(option.series[0].areaStyle).toEqual({ opacity: 0.5 })
    expect(option.series[0].emphasis).toEqual({ focus: 'series' }) // §9
    expect(option.series[6].stack).toBeUndefined()
    expect(option.series[7]).toMatchObject({ color: INK, z: 10, lineStyle: { width: 2.5 } })
    expect(option.series[7].data).toEqual([550, 590, 630])
    expect(option.series[8]).toMatchObject({ type: 'scatter', color: MUTED, z: 11 })
    expect(option.grid).toEqual(GRID_VARIANTS.endLabel)
    expect(option.xAxis).toEqual({ type: 'category', data: ['Jun 2026', 'Jul 2026', 'Aug 2026'], boundaryGap: false, axisLabel: { interval: 0 } })
    expect(option.yAxis.axisLabel.formatter).toBe(compactMoney)
    expect(option.legend.type).toBe('plain')
    expect(option.legend.selected).toEqual({})
  })

  it('F2: the value axis floors at zero unless the data goes below it', () => {
    const option = read(netWorthStackOption({ ts: ts(), mode: 'group', ...base }))
    expect(option.yAxis.min?.({ min: 100 })).toBe(0)
    expect(option.yAxis.min?.({ min: -5 })).toBe(-5)
  })

  it('F2: material liabilities draw; immaterial ones leave the legend but keep a tooltip row', () => {
    // 50 against 600 of assets at the latest month = 8.3% → material (drawn, in the legend).
    expect(liabilitiesMaterial(ts())).toBe(true)
    const drawn = read(netWorthStackOption({ ts: ts(), mode: 'group', ...base }))
    expect(drawn.legend.data).toBeUndefined()
    expect(drawn.series[6].lineStyle).toEqual({ width: 1 })
    // 3 against 660 = 0.45% → immaterial: no legend entry, zero-width series, still a row.
    const thin = ts({ group_totals: { ...ts().group_totals, liability: ['-5.00', '-4.00', '-3.00'] } })
    expect(liabilitiesMaterial(thin)).toBe(false)
    const hidden = read(netWorthStackOption({ ts: thin, mode: 'group', ...base }))
    expect(hidden.legend.data).toEqual(['Cash', 'Pre-tax', 'Post-tax', 'Taxable', 'Equity', 'Other', 'Net worth', 'Notes'])
    expect(hidden.series[6]).toMatchObject({ name: 'Liabilities', lineStyle: { width: 0 }, areaStyle: { opacity: 0 } })
    const rows = tooltipRows(hidden.tooltip.formatter([
      { seriesName: 'Cash', seriesType: 'line', axisValueLabel: 'Aug 2026', value: 120, color: GROUP_COLORS.cash },
      { seriesName: 'Liabilities', seriesType: 'line', value: -3, color: GROUP_COLORS.liability },
    ]))
    expect(rows.rows.map((r) => r.label)).toEqual(['Cash', 'Assets', 'Liabilities'])
  })

  it('F7: tooltip rows — asset groups by value, an Assets total, then liabilities, net worth and the escaped note', () => {
    const option = read(netWorthStackOption({ ts: ts(), mode: 'group', ...base }))
    const html = option.tooltip.formatter([
      { seriesName: 'Cash', seriesType: 'line', axisValueLabel: 'Jul 2026', dataIndex: 1, value: 110, color: GROUP_COLORS.cash },
      { seriesName: 'Taxable', seriesType: 'line', value: 310, color: GROUP_COLORS.taxable },
      { seriesName: 'Liabilities', seriesType: 'line', value: -40, color: GROUP_COLORS.liability },
      { seriesName: 'Net worth', seriesType: 'line', value: 590, color: INK },
      { seriesName: 'Notes', seriesType: 'scatter', value: ['Jul 2026', 590], data: { note: 'sold <em>car</em>' } },
    ])
    const parsed = tooltipRows(html)
    expect(parsed.head).toBe('Jul 2026')
    expect(parsed.rows.map((r) => [r.kind, r.label, r.value])).toEqual([
      ['row', 'Taxable', '$310.00'],
      ['row', 'Cash', '$110.00'],
      ['total', 'Assets', '$420.00'],
      ['row', 'Liabilities', '-$40.00'],
      ['row', 'Net worth', '$590.00'],
    ])
    expect(parsed.notes).toEqual(['sold &lt;em&gt;car&lt;/em&gt;'])
    expect(option.tooltip.axisPointer).toBeUndefined() // lines keep the default rule
  })

  it('anchors the Married rule on the net-worth line', () => {
    const option = read(netWorthStackOption({ ts: ts(), mode: 'group', ...base, marriageDate: '2026-07-14' }))
    expect(option.series[7].markLine).toMatchObject({ data: [{ xAxis: 'Jul 2026' }] })
    expect(option.series.filter((s) => s.markLine !== undefined)).toHaveLength(1)
  })

  it('returns null with no months', () => {
    expect(netWorthStackOption({ ts: ts({ months: [], net_worth: [] }), mode: 'group', ...base })).toBeNull()
  })
})

describe('netWorthStackOption — By owner and Share %', () => {
  it('owner mode colours by HOUSEHOLD slot (primary 0, others by id, Joint last), stacked with strategy all', () => {
    const option = read(netWorthStackOption({ ts: ts(), mode: 'owner', ...base }))
    expect(option.series.map((s) => s.name)).toEqual(['Me', 'Sam', 'Joint', 'Net worth', 'Notes'])
    expect(option.series.slice(0, 3).map((s) => s.color)).toEqual([PALETTE[0], PALETTE[1], PALETTE[2]])
    expect(option.series[0]).toMatchObject({ stack: 'owner', stackStrategy: 'all' })
    // No Assets subtotal: owner columns already sum to the net-worth row.
    const rows = tooltipRows(option.tooltip.formatter([
      { seriesName: 'Me', seriesType: 'line', axisValueLabel: 'Aug 2026', value: 460, color: PALETTE[0] },
      { seriesName: 'Net worth', seriesType: 'line', value: 630, color: INK },
    ]))
    expect(rows.rows.map((r) => r.kind)).toEqual(['row', 'row'])
  })

  it('share mode stacks each asset group as its share of that month's assets on a 0–100% axis', () => {
    const option = read(netWorthStackOption({ ts: ts(), mode: 'share', ...base }))
    expect(option.series.map((s) => s.name)).toEqual(['Cash', 'Pre-tax', 'Post-tax', 'Taxable', 'Equity', 'Other'])
    // Jun: cash 100 of 600 assets.
    expect((option.series[0].data as number[])[0]).toBeCloseTo(100 / 600, 6)
    expect(option.series[0].stack).toBe('share')
    expect(option.yAxis.axisLabel.formatter).toBe(percentLabel)
    expect(option.yAxis.min?.({ min: 0 })).toBe(0)
    const rows = tooltipRows(option.tooltip.formatter([
      { seriesName: 'Cash', seriesType: 'line', axisValueLabel: 'Jun 2026', value: 100 / 600, color: GROUP_COLORS.cash },
      { seriesName: 'Taxable', seriesType: 'line', value: 300 / 600, color: GROUP_COLORS.taxable },
    ]))
    expect(rows.rows.map((r) => [r.kind, r.label, r.value])).toEqual([
      ['row', 'Taxable', '50.0%'],
      ['row', 'Cash', '16.7%'],
    ])
  })
})
```

Run: `npx vitest run src/components/networth/netWorthChartOptions.test.ts`
Expected: FAIL — `netWorthStackOption` / `liabilitiesMaterial` not exported.

- [ ] **Step 2: Write the builder**

Add to `src/components/networth/netWorthChartOptions.ts` (new imports at the top; the existing exports stay):

```ts
import type { EChartsOption } from '../../charts/echarts'
import { personSlot, slotColor } from '../../charts/entities'
import { FOCUS, legendFor } from '../../charts/legend'
import { LINE, STACK_WASH, compactMoney, grid, moneyAxis, monthAxis, pctAxis } from '../../charts/grammar'
import { GROUP_COLORS, GROUP_LABELS, GROUP_ORDER, INK, MUTED } from '../../charts/theme'
import { rangeZoom } from '../../charts/timeZoom'
import type { RangeState } from '../../charts/timeZoom'
import { axisTooltip } from '../../charts/tooltip'
import type { AccountGroup, NetWorthTimeseries, PersonOut } from '../../types/api'
import { escapeHtml, formatCurrencyCompact, formatMonth } from '../../utils/format'

export type StackMode = 'group' | 'owner' | 'share'

/** The Stack-by control's options, in the order the card shows them. */
export const STACK_MODES: { value: StackMode; label: string }[] = [
  { value: 'group', label: 'By group' },
  { value: 'owner', label: 'By owner' },
  { value: 'share', label: 'Share %' },
]

const ASSET_GROUPS = GROUP_ORDER.filter((g): g is AccountGroup => g !== 'liability')
const ASSET_LABELS = ASSET_GROUPS.map((g) => GROUP_LABELS[g])

/** F2: liabilities are DRAWN only when they are at least 1% of assets at the latest month —
 *  a −$300 balance under $600K of assets is a hairline nobody can read, and its legend entry
 *  costs a row. The series still rides the option (zero-width) so the tooltip keeps its row. */
export function liabilitiesMaterial(ts: Pick<NetWorthTimeseries, 'months' | 'group_totals'>): boolean {
  const last = ts.months.length - 1
  if (last < 0) return false
  const assets = ASSET_GROUPS.reduce((sum, g) => sum + Number(ts.group_totals[g][last] ?? 0), 0)
  const liabilities = Math.abs(Number(ts.group_totals.liability[last] ?? 0))
  return assets <= 0 ? liabilities > 0 : liabilities >= assets * 0.01
}

export interface NetWorthStackInput {
  ts: NetWorthTimeseries
  mode: StackMode
  /** The household roster (any order) — colours follow the HOUSEHOLD slot, not the response. */
  people: readonly PersonOut[]
  marriageDate: string | null
  range: RangeState
  /** The page's mirrored legend picks (legendselectchanged → state → here). */
  selected: Record<string, boolean>
}

/**
 * The page's first chart: asset groups stacked to their total with liabilities and net worth
 * as their own lines (By group), the same total split per owner (By owner), or each group's
 * share of that month's assets on a 0–100% axis (Share %). Lifted from NetWorthPage's
 * `stackedOption` memo; F2/F7/§8/§9 name every byte that differs from that memo.
 */
export function netWorthStackOption({
  ts,
  mode,
  people,
  marriageDate,
  range,
  selected,
}: NetWorthStackInput): EChartsOption | null {
  if (ts.months.length === 0) return null
  const labels = ts.months.map(formatMonth)
  const noted = ts.months
    .map((_, i) => ({ label: labels[i], value: Number(ts.net_worth[i]), note: (ts.notes ?? [])[i] }))
    .filter((p): p is { label: string; value: number; note: string } => !!p.note)
  const marriageMark = marriageMarkLine(ts.months, marriageDate)
  const material = liabilitiesMaterial(ts)

  const stackMember = (name: string, stack: string, color: string, data: (number | null)[]) => ({
    name,
    type: 'line' as const,
    stack,
    symbol: 'none' as const,
    ...STACK_WASH,
    ...FOCUS,
    color,
    data,
  })

  const netWorthLine = {
    ...LINE,
    name: 'Net worth',
    lineStyle: { width: 2.5 },
    color: INK,
    z: 10,
    endLabel: {
      show: true,
      color: INK,
      fontWeight: 600,
      formatter: (params: { value?: unknown }) => formatCurrencyCompact(params.value as number),
    },
    // The wedding rule rides the net-worth line: one annotation, on the series present in
    // both money modes.
    ...(marriageMark ? { markLine: marriageMark } : {}),
    data: ts.net_worth.map(Number),
  }

  const notesSeries =
    noted.length > 0
      ? [
          {
            name: NOTES_SERIES,
            // Plain scatter, not effectScatter: a note is history; the ripple is the live
            // ping's reserved signal. Diamond + MUTED = identity by SHAPE, an annotation
            // layer rather than a fourth data hue.
            type: 'scatter' as const,
            symbol: 'diamond' as const,
            symbolSize: 9,
            color: MUTED,
            itemStyle: { borderColor: INK, borderWidth: 1 },
            emphasis: { itemStyle: { borderColor: INK } },
            z: 11,
            data: noted.map((p) => ({ value: [p.label, p.value], note: p.note })),
          },
        ]
      : []

  const noteLines = (p: { data?: unknown }) => [
    escapeHtml((p.data as { note?: string } | undefined)?.note ?? ''),
  ]

  if (mode === 'share') {
    const assetsPerMonth = ts.months.map((_, i) =>
      ASSET_GROUPS.reduce((sum, g) => sum + Number(ts.group_totals[g][i] ?? 0), 0),
    )
    const series = ASSET_GROUPS.map((g) =>
      stackMember(
        GROUP_LABELS[g],
        'share',
        GROUP_COLORS[g],
        ts.group_totals[g].map((v, i) => (assetsPerMonth[i] > 0 ? Number(v) / assetsPerMonth[i] : null)),
      ),
    )
    return {
      dataZoom: rangeZoom(ts.months, range),
      grid: grid('endLabel'),
      legend: legendFor(series.length, selected),
      tooltip: axisTooltip({ unit: 'percent', groups: ASSET_LABELS, totalLabel: false }),
      xAxis: monthAxis(labels),
      yAxis: pctAxis({ floor: 0, ceiling: 1 }),
      series,
    }
  }

  const stacked =
    mode === 'owner'
      ? (ts.owner_series ?? []).map((s) => ({
          ...stackMember(
            s.name ?? 'Joint',
            'owner',
            slotColor(personSlot(people, s.person_id)),
            s.values.map(Number),
          ),
          // Owner columns are NET and one can go negative; 'samesign' would park it on the
          // baseline and the stack would stop meeting the net-worth line.
          stackStrategy: 'all' as const,
        }))
      : [
          ...ASSET_GROUPS.map((g) =>
            stackMember(GROUP_LABELS[g], 'assets', GROUP_COLORS[g], ts.group_totals[g].map(Number)),
          ),
          {
            ...stackMember(GROUP_LABELS.liability, '', GROUP_COLORS.liability, ts.group_totals.liability.map(Number)),
            stack: undefined,
            ...(material ? {} : { lineStyle: { width: 0 }, areaStyle: { opacity: 0 }, showSymbol: false }),
          },
        ]
  const series = [...stacked, netWorthLine, ...notesSeries]
  const shown = series.map((s) => s.name)
  return {
    // Windowed, not sliced: dataZoom keeps the whole series loaded so a chip flip never
    // refetches, and the y-axis re-scales to the visible window.
    dataZoom: rangeZoom(ts.months, range),
    grid: grid('endLabel'),
    legend: {
      ...legendFor(series.length, selected),
      // Immaterial liabilities leave the legend (F2) but not the option — see above.
      ...(mode === 'group' && !material ? { data: shown.filter((n) => n !== GROUP_LABELS.liability) } : {}),
    },
    tooltip: axisTooltip({
      unit: 'money',
      // Owner columns sum to the net-worth row, so an Assets subtotal would print the same
      // number twice: no groups (and no total) in owner mode.
      groups: mode === 'group' ? ASSET_LABELS : [],
      totalLabel: 'Assets',
      annotationSeries: [NOTES_SERIES],
      annotations: noteLines,
    }),
    xAxis: monthAxis(labels),
    // F2: the floor is zero unless the data goes below it — a stack whose axis starts at a
    // six-figure minimum makes a dip read as a collapse.
    yAxis: { ...moneyAxis(), min: (extent: { min: number }) => Math.min(0, extent.min) },
    series,
  }
}
```

(`stackMember` with `stack: ''` then `stack: undefined` for liabilities: the liabilities line is NOT stacked; spreading `stack: undefined` after removes the key from echarts' point of view — `JSON.stringify` drops undefined, so the fingerprint is stable too.)

- [ ] **Step 3: Add the fixtures**

```ts
// src/charts/fixtures/netWorthStack.fixture.ts
import type { ChartFixture } from './_types'
import { netWorthStackOption } from '../../components/networth/netWorthChartOptions'
import type { NetWorthTimeseries } from '../../types/api'

export const TS: NetWorthTimeseries = {
  months: ['2026-06-01', '2026-07-01', '2026-08-01'],
  accounts: [],
  series: [],
  group_totals: {
    cash: ['100.00', '110.00', '120.00'], pre_tax: ['200.00', '210.00', '220.00'],
    post_tax: ['50.00', '50.00', '50.00'], taxable: ['300.00', '310.00', '320.00'],
    equity: ['10.00', '10.00', '10.00'], other: ['0.00', '0.00', '0.00'],
    liability: ['-50.00', '-40.00', '-30.00'],
  },
  net_worth: ['610.00', '650.00', '690.00'],
  mom_pct: [null, '0.06', '0.06'],
  notes: [null, 'sold car', null],
  owner_series: [],
}

const fixture: ChartFixture = {
  name: 'netWorthStack',
  kind: 'cartesian',
  ariaLabel: 'Stacked area chart of asset groups over time with liabilities and net worth as lines',
  build: () =>
    netWorthStackOption({
      ts: TS, mode: 'group', people: [{ id: 1, name: 'Me', is_primary: true }],
      marriageDate: '2026-07-01', range: { preset: 'all' }, selected: {},
    }),
}
export default fixture
```

```ts
// src/charts/fixtures/netWorthStackShare.fixture.ts
import type { ChartFixture } from './_types'
import { netWorthStackOption } from '../../components/networth/netWorthChartOptions'
import { TS } from './netWorthStack.fixture'

const fixture: ChartFixture = {
  name: 'netWorthStackShare',
  kind: 'cartesian',
  ariaLabel: 'Stacked area chart of each asset group as a share of assets per month',
  build: () =>
    netWorthStackOption({
      ts: TS, mode: 'share', people: [], marriageDate: null, range: { preset: 'all' }, selected: {},
    }),
}
export default fixture
```

Run: `npx vitest run src/components/networth/netWorthChartOptions.test.ts src/charts/conformance.test.ts`
Expected: PASS (the conformance walk picks the two fixtures up automatically).

- [ ] **Step 4: Commit**

```bash
git add src/components/networth/netWorthChartOptions.ts src/components/networth/netWorthChartOptions.test.ts src/charts/fixtures/netWorthStack.fixture.ts src/charts/fixtures/netWorthStackShare.fixture.ts
git commit -m "feat(net-worth): netWorthStackOption lifted onto the grammar — zero floor, immaterial liabilities out of the legend, Share % mode, grammar tooltip (F2, F7, §8, §9)"
```

---

### Task 2: `netWorthDrillOption` + `netWorthDrillCsv`

**Files:**
- Modify: `src/components/networth/netWorthChartOptions.ts`, `src/components/networth/netWorthChartOptions.test.ts`
- Create: `src/charts/fixtures/netWorthDrill.fixture.ts`

Source: `NetWorthPage.tsx:447-478` (`drillOption`). Named changes: F8 (`grid('endLabel')` — right inset 24 → 84 so the drill's x-axis aligns with the stack above it), F7 (`axisTooltip`), §9 (`LINE` focus, `legendFor`), F12 (CSV). Colours come from `slotColor(slot)` (`PALETTE[slot]` for the eight slots the page hands out).

- [ ] **Step 1: Write the failing tests**

Append to `netWorthChartOptions.test.ts`:

```ts
import { netWorthDrillCsv, netWorthDrillOption } from './netWorthChartOptions'

const DRILL_TS = ts({
  accounts: [
    { id: 10, name: 'Checking', slug: 'checking', group: 'cash', is_active: true, is_component: false } as never,
    { id: 11, name: '401(k) <b>', slug: 'k401', group: 'pre_tax', is_active: true, is_component: false } as never,
  ],
  series: [
    { account_id: 10, values: ['100.00', '110.00', '120.00'] },
    { account_id: 11, values: ['200.00', null, '220.00'] },
  ],
})

describe('netWorthDrillOption', () => {
  it('one line per picked account on its slot colour, gaps kept, aligned on the end-label grid', () => {
    const option = read(netWorthDrillOption({ ts: DRILL_TS, drill: [{ accountId: 11, slot: 2 }, { accountId: 10, slot: 0 }], range: { preset: 'all' }, selected: { Checking: false } }))
    expect(option.series.map((s) => s.name)).toEqual(['401(k) <b>', 'Checking'])
    expect(option.series.map((s) => s.color)).toEqual([PALETTE[2], PALETTE[0]])
    expect(option.series[0]).toMatchObject({ type: 'line', symbol: 'circle', symbolSize: 8, showSymbol: false, connectNulls: false, lineStyle: { width: 2 }, emphasis: { focus: 'series' } })
    expect(option.series[0].data).toEqual([200, null, 220])
    expect(option.grid).toEqual(GRID_VARIANTS.endLabel) // F8: aligned with the stack
    expect(option.legend.selected).toEqual({ Checking: false })
    const rows = tooltipRows(option.tooltip.formatter([
      { seriesName: '401(k) <b>', seriesType: 'line', axisValueLabel: 'Jul 2026', value: null, color: PALETTE[2] },
      { seriesName: 'Checking', seriesType: 'line', value: 110, color: PALETTE[0] },
    ]))
    expect(rows.rows.map((r) => [r.label, r.value])).toEqual([['Checking', '$110.00']]) // the null row is dropped
  })
  it('returns null with nothing picked', () => {
    expect(netWorthDrillOption({ ts: DRILL_TS, drill: [], range: { preset: 'all' }, selected: {} })).toBeNull()
  })
  it('exports the picked accounts month by month, blanks for gaps', () => {
    expect(netWorthDrillCsv(DRILL_TS, [{ accountId: 10, slot: 0 }, { accountId: 11, slot: 1 }])).toEqual({
      headers: ['Month', 'Checking', '401(k) <b>'],
      rows: [
        ['2026-06-01', '100.00', '200.00'],
        ['2026-07-01', '110.00', ''],
        ['2026-08-01', '120.00', '220.00'],
      ],
    })
  })
})
```

Run: `npx vitest run src/components/networth/netWorthChartOptions.test.ts`
Expected: FAIL — exports missing.

- [ ] **Step 2: Write the builder and the CSV**

Append to `netWorthChartOptions.ts`:

```ts
export interface DrillPick {
  accountId: number
  /** The palette slot assigned when the account was picked — colour follows the entity. */
  slot: number
}

export interface NetWorthDrillInput {
  ts: NetWorthTimeseries
  drill: DrillPick[]
  range: RangeState
  selected: Record<string, boolean>
}

/** Individual account balances over time — up to eight picks on their own slots. Aligned
 *  with the stack above it (F8: same `endLabel` grid, same month axis, one `group`). */
export function netWorthDrillOption({ ts, drill, range, selected }: NetWorthDrillInput): EChartsOption | null {
  if (drill.length === 0 || ts.months.length === 0) return null
  const byId = new Map(ts.series.map((s) => [s.account_id, s.values]))
  const nameById = new Map(ts.accounts.map((a) => [a.id, a.name]))
  return {
    dataZoom: rangeZoom(ts.months, range),
    grid: grid('endLabel'),
    legend: legendFor(drill.length, selected),
    tooltip: axisTooltip({ unit: 'money' }),
    xAxis: monthAxis(ts.months.map(formatMonth)),
    yAxis: moneyAxis(),
    series: drill.map(({ accountId, slot }) => ({
      ...LINE,
      name: nameById.get(accountId) ?? String(accountId),
      // Circles on hover only: the line is the data, the dots are the hover affordance.
      symbol: 'circle' as const,
      symbolSize: 8,
      showSymbol: false,
      color: slotColor(slot),
      connectNulls: false,
      data: (byId.get(accountId) ?? []).map((v) => (v === null ? null : Number(v))),
    })),
  }
}

/** The drill-down as a table (F12): month rows × the picked accounts, verbatim strings. */
export function netWorthDrillCsv(ts: NetWorthTimeseries, drill: DrillPick[]): ExportTable {
  const byId = new Map(ts.series.map((s) => [s.account_id, s.values]))
  const nameById = new Map(ts.accounts.map((a) => [a.id, a.name]))
  return {
    headers: ['Month', ...drill.map((d) => nameById.get(d.accountId) ?? String(d.accountId))],
    rows: ts.months.map((month, i) => [month, ...drill.map((d) => byId.get(d.accountId)?.[i] ?? '')]),
  }
}
```

- [ ] **Step 3: Add the fixture**

```ts
// src/charts/fixtures/netWorthDrill.fixture.ts
import type { ChartFixture } from './_types'
import { netWorthDrillOption } from '../../components/networth/netWorthChartOptions'
import { TS } from './netWorthStack.fixture'

const fixture: ChartFixture = {
  name: 'netWorthDrill',
  kind: 'cartesian',
  ariaLabel: 'Line chart of the selected accounts’ balances over time',
  build: () =>
    netWorthDrillOption({
      ts: {
        ...TS,
        accounts: [
          { id: 10, name: 'Checking', slug: 'checking', group: 'cash', is_active: true, is_component: false } as never,
        ],
        series: [{ account_id: 10, values: ['100.00', '110.00', '120.00'] }],
      },
      drill: [{ accountId: 10, slot: 0 }],
      range: { preset: 'all' },
      selected: {},
    }),
}
export default fixture
```

(`as never` on the account literal: `AccountOut` carries more fields than a chart reads; the fixture is about the option shape, not the wire type — the same shortcut `NetWorthPage.test.tsx` takes.)

Run: `npx vitest run src/components/networth/netWorthChartOptions.test.ts src/charts/conformance.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/networth/netWorthChartOptions.ts src/components/networth/netWorthChartOptions.test.ts src/charts/fixtures/netWorthDrill.fixture.ts
git commit -m "feat(net-worth): netWorthDrillOption lifted onto the grammar, aligned with the stack, with CSV (F8, F7, F12, §9)"
```

---

### Task 3: The "What moved — {month}" bridge (F2, droppable)

**Files:**
- Modify: `src/components/networth/netWorthChartOptions.ts`, `src/components/networth/netWorthChartOptions.test.ts`
- Create: `src/charts/fixtures/netWorthBridge.fixture.ts`

A waterfall from last month's net worth to this month's, one floating step per account group that moved (`charts/waterfall.ts`). If the night runs short this task can be dropped without touching the others — nothing later depends on it.

- [ ] **Step 1: Write the failing tests**

```ts
import { netWorthBridgeCsv, netWorthBridgeOption } from './netWorthChartOptions'
import { OTHER_SERIES_COLOR } from '../../charts/theme'

describe('netWorthBridgeOption', () => {
  it('walks from the prior month to the viewed month, one step per group that moved, landing on the month’s net worth', () => {
    const option = netWorthBridgeOption(ts(), 2) as unknown as {
      xAxis: { data: string[] }
      series: { data: unknown[] }[]
      tooltip: { formatter: (p: unknown) => string }
    }
    // Jul → Aug: cash +10, pre-tax +10, taxable +10, liabilities +10 (−40 → −30); the three
    // zero groups are omitted — a $0 step is a label with no bar.
    expect(option.xAxis.data).toEqual(['Jul 2026', 'Cash', 'Pre-tax', 'Taxable', 'Liabilities', 'Aug 2026'])
    const [placeholder, amount] = option.series
    expect(placeholder.data).toEqual([0, 590, 600, 610, 620, 0])
    expect((amount.data as { value: number; itemStyle: { color: string } }[]).map((d) => d.value)).toEqual([590, 10, 10, 10, 10, 630])
    expect((amount.data as { itemStyle: { color: string } }[])[1].itemStyle.color).toBe(GROUP_COLORS.cash)
    expect((amount.data as { itemStyle: { color: string } }[])[0].itemStyle.color).toBe(OTHER_SERIES_COLOR)
    const parsed = tooltipRows(option.tooltip.formatter({ dataIndex: 1 }))
    expect([parsed.lead, parsed.label, parsed.sub]).toEqual(['$10.00', 'Cash', 'Left: $600.00'])
  })
  it('draws a fall as a step down', () => {
    const down = ts({ group_totals: { ...ts().group_totals, taxable: ['300.00', '310.00', '250.00'] }, net_worth: ['550.00', '590.00', '560.00'] })
    const [placeholder, amount] = (netWorthBridgeOption(down, 2) as unknown as { series: { data: unknown[] }[] }).series
    // Taxable −60: the segment spans [560+…]: base is the LOWER remainder.
    expect(placeholder.data).toEqual([0, 590, 600, 550, 550, 0])
    expect((amount.data as { value: number }[]).map((d) => d.value)).toEqual([590, 10, 10, 60, 10, 560])
  })
  it('is null for the first month (nothing to bridge from) and exports the steps', () => {
    expect(netWorthBridgeOption(ts(), 0)).toBeNull()
    expect(netWorthBridgeOption(ts(), -1)).toBeNull()
    expect(netWorthBridgeCsv(ts(), 2).rows[1]).toEqual(['Cash', '10.00', '600.00'])
    expect(netWorthBridgeCsv(ts(), 0).rows).toEqual([])
  })
})
```

Run: `npx vitest run src/components/networth/netWorthChartOptions.test.ts`
Expected: FAIL — exports missing.

- [ ] **Step 2: Write the builder**

```ts
import { cents } from '../../charts/grammar'
import { OTHER_SERIES_COLOR } from '../../charts/theme'
import { waterfallCsv, waterfallSeries, waterfallSteps, waterfallTooltip } from '../../charts/waterfall'

/** The bridge's steps: prior net worth → each group's month-over-month change → this month's
 *  net worth. Groups that did not move are omitted (a $0 step is a label without a bar). */
function bridgeSteps(ts: Pick<NetWorthTimeseries, 'months' | 'group_totals' | 'net_worth'>, index: number) {
  if (index < 1 || index >= ts.months.length) return null
  const items = GROUP_ORDER.flatMap((g) => {
    const delta = cents(Number(ts.group_totals[g][index]) - Number(ts.group_totals[g][index - 1]))
    return delta === 0 ? [] : [{ label: GROUP_LABELS[g], amount: delta, delta, color: GROUP_COLORS[g] }]
  })
  return waterfallSteps(
    { label: formatMonth(ts.months[index - 1]), amount: Number(ts.net_worth[index - 1]), color: OTHER_SERIES_COLOR },
    items,
    { label: formatMonth(ts.months[index]), amount: Number(ts.net_worth[index]), color: OTHER_SERIES_COLOR },
  )
}

/** "What moved — {month}": a waterfall by group between two snapshots (F2). Null on the first
 *  month or an out-of-range index. */
export function netWorthBridgeOption(ts: Pick<NetWorthTimeseries, 'months' | 'group_totals' | 'net_worth'>, index: number): EChartsOption | null {
  const steps = bridgeSteps(ts, index)
  if (steps === null) return null
  return {
    grid: grid(),
    tooltip: waterfallTooltip(steps),
    xAxis: monthAxis(steps.map((s) => s.label), { gap: true }),
    yAxis: moneyAxis(),
    series: waterfallSeries(steps),
  }
}

export function netWorthBridgeCsv(ts: Pick<NetWorthTimeseries, 'months' | 'group_totals' | 'net_worth'>, index: number): ExportTable {
  const steps = bridgeSteps(ts, index)
  return steps === null ? { headers: ['Step', 'Amount', 'Remaining'], rows: [] } : waterfallCsv(steps)
}
```

- [ ] **Step 3: Add the fixture**

```ts
// src/charts/fixtures/netWorthBridge.fixture.ts
import type { ChartFixture } from './_types'
import { netWorthBridgeOption } from '../../components/networth/netWorthChartOptions'
import { TS } from './netWorthStack.fixture'

const fixture: ChartFixture = {
  name: 'netWorthBridge',
  kind: 'cartesian',
  ariaLabel: 'Waterfall chart of how each account group moved net worth from the prior month to this one',
  build: () => netWorthBridgeOption(TS, 2),
}
export default fixture
```

Run: `npx vitest run src/components/networth/netWorthChartOptions.test.ts src/charts/conformance.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/networth/netWorthChartOptions.ts src/components/networth/netWorthChartOptions.test.ts src/charts/fixtures/netWorthBridge.fixture.ts
git commit -m "feat(net-worth): What-moved bridge — a group waterfall between snapshots on charts/waterfall.ts, with CSV (F2)"
```

---

### Task 4: NetWorthPage onto `ChartCard`

**Files:**
- Modify: `src/pages/NetWorthPage.tsx`, `src/pages/NetWorthPage.test.tsx`

The three cards (stack, bridge, drill) mount through `ChartCard`; the inline options, `EChart`, `ChartZoomHint`, the `networth-chart-header` markup and `animateEntrance={!fromCache}` leave the page. F8: both time charts carry `group="net-worth"` so their axis pointers and zoom move together. The bridge card is skipped if Task 3 was dropped.

- [ ] **Step 1: Extend the page test**

In `src/pages/NetWorthPage.test.tsx` add, using the file's existing render helper and fixtures (two months, `ME`/`SAM`):

```ts
  it('mounts the stack, the bridge and the drill through ChartCard: labels, export rows, Share %, one group', async () => {
    renderPage()
    await screen.findByText('By group over time')
    expect(screen.getByLabelText(/Stacked area chart of asset groups over time/)).toBeTruthy()
    expect(screen.getByLabelText(/Line chart of the selected accounts/)).toBeTruthy()
    expect(screen.getByText(/What moved — Aug 2026/)).toBeTruthy()
    expect(screen.getByLabelText(/Waterfall chart of how each account group moved/)).toBeTruthy()
    expect(screen.getAllByRole('group', { name: /Export/ })).toHaveLength(3)
    expect(screen.getAllByText('ctrl+scroll to zoom · drag to pan')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Share %' })).toBeTruthy()
  })

  it('Share % swaps the stack to composition and drops the net-worth line', async () => {
    renderPage()
    await screen.findByText('By group over time')
    fireEvent.click(screen.getByRole('button', { name: 'Share %' }))
    expect(stacked().getAttribute('data-series')).toBe('Cash|Pre-tax|Post-tax|Taxable|Equity|Other')
    expect(screen.getByLabelText(/share of assets per month/)).toBeTruthy()
  })
```

(`stacked()` is the file's existing helper for the first mocked chart.) Keep every existing assertion — `data-series`, `data-stacks`, `data-marriage`, `data-legend-selected`, `data-animate` all still read the option the mock receives from `ChartCard`.

Run: `npx vitest run src/pages/NetWorthPage.test.tsx`
Expected: FAIL — no export groups on the drill, no `Share %`, no bridge.

- [ ] **Step 2: Rewrite the page's chart half**

Imports — remove `ChartZoomHint`, `EChart`, `EChartsOption`, `rangeZoom`, `GROUP_COLORS`, `INK`, `MUTED`, `NOTES_SERIES`, `marriageMarkLine`, `netWorthStackedTooltipFormatter`, `formatCurrencyCompact`; add:

```ts
import ChartCard from '../components/ChartCard'
import {
  STACK_MODES,
  netWorthBridgeCsv,
  netWorthBridgeOption,
  netWorthCsv,
  netWorthDrillCsv,
  netWorthDrillOption,
  netWorthStackOption,
} from '../components/networth/netWorthChartOptions'
import type { StackMode } from '../components/networth/netWorthChartOptions'
```

State: `const [stackBy, setStackBy] = useState<StackMode>('group')`. Move the `months` / `selectedIndex` / `viewedIndex` / `viewedLabel` block ABOVE the option memos (the bridge reads `viewedIndex`). Replace the two option memos with:

```ts
  const stackedOption = useMemo(
    () =>
      data === null
        ? null
        : netWorthStackOption({
            ts: data,
            mode: stackBy,
            people: orderedPeople,
            marriageDate: household?.marriage_date ?? null,
            range,
            selected: stackedLegend,
          }),
    [data, stackBy, orderedPeople, household, range, stackedLegend],
  )
  const drillOption = useMemo(
    () => (data === null ? null : netWorthDrillOption({ ts: data, drill, range, selected: drillLegend })),
    [data, drill, range, drillLegend],
  )
  const bridgeOption = useMemo(
    () => (data === null ? null : netWorthBridgeOption(data, viewedIndex)),
    [data, viewedIndex],
  )
```

Replace the first two `<div className="card span-12">` blocks in the `card-grid` with:

```tsx
          <ChartCard
            title="By group over time"
            hint={
              stackBy === 'share'
                ? 'Each asset group as a share of that month’s assets — composition, not size.'
                : 'Asset groups stacked to their combined total, with liabilities and net worth as their own lines. Diamonds mark months with a saved note. Liabilities under 1% of assets stay in the tooltip but are not drawn.'
            }
            ariaLabel={
              stackBy === 'owner'
                ? 'Stacked area chart of net worth by owner over time'
                : stackBy === 'share'
                  ? 'Stacked area chart of each asset group as a share of assets per month'
                  : 'Stacked area chart of asset groups over time with liabilities and net worth as lines'
            }
            option={stackedOption}
            empty="No snapshots yet — enter your first month to start the chart."
            exportName="net-worth"
            csv={data === null ? undefined : () => netWorthCsv(data)}
            height={360}
            zoomable
            group="net-worth"
            onLegendChange={onStackedLegendChange}
            onDataZoom={onZoomWindow}
            zoomWindow={zoomWindow}
            controls={
              <>
                <Segmented
                  variant="toggle"
                  size="sm"
                  ariaLabel="Stack by"
                  // One person means "whose" has nothing to choose between — By owner hides.
                  options={ownerScopes.length > 0 ? STACK_MODES : STACK_MODES.filter((m) => m.value !== 'owner')}
                  value={stackBy}
                  onChange={setStackBy}
                />
                <Segmented
                  variant="toggle"
                  size="sm"
                  ariaLabel="Granularity"
                  options={[
                    { value: 'monthly', label: 'Monthly' },
                    { value: 'quarterly', label: 'Quarterly' },
                  ]}
                  value={granularity}
                  onChange={(g) => {
                    /* unchanged body: the same-value guard, the warm-snapshot peek, setGranularity(g) */
                  }}
                />
              </>
            }
          />

          {data !== null && viewedIndex >= 1 && (
            <ChartCard
              title={`What moved — ${formatMonth(months[viewedIndex])}`}
              hint="How each account group moved net worth from the prior snapshot to this one — a waterfall from last month’s total to this month’s. Groups that did not move are left out."
              ariaLabel="Waterfall chart of how each account group moved net worth from the prior month to this one"
              option={bridgeOption}
              empty="Nothing moved between these two months."
              exportName="net-worth-bridge"
              csv={() => netWorthBridgeCsv(data, viewedIndex)}
              height={280}
            />
          )}

          <ChartCard
            title="Account drill-down"
            hint="Individual account balances over time — toggle accounts below or by clicking table rows."
            ariaLabel="Line chart of the selected accounts’ balances over time"
            option={drillOption}
            empty="No accounts selected."
            exportName="net-worth-accounts"
            csv={data === null ? undefined : () => netWorthDrillCsv(data, drill)}
            height={280}
            zoomable
            group="net-worth"
            onLegendChange={onDrillLegendChange}
            onDataZoom={onZoomWindow}
            zoomWindow={zoomWindow}
            footer={
              <>
                <p className="drill-hint">
                  Pick up to {MAX_DRILL} accounts to compare their history. Clicking rows in the
                  accounts table below toggles them here too.
                </p>
                <Segmented
                  variant="chips"
                  multiple
                  ariaLabel="Accounts to compare"
                  options={/* unchanged: the swatch-labelled account chips */}
                  value={drill.map((d) => String(d.accountId))}
                  onChange={syncDrill}
                />
              </>
            }
          />
```

Delete the `!loading && !error && <div className="empty-note">…` fallbacks — `ChartCard` renders `empty` when the option is null, and the frame's skeleton covers the first load.

Run: `npx vitest run src/pages/NetWorthPage.test.tsx && npx tsc -b && npx eslint src/pages/NetWorthPage.tsx`
Expected: PASS. (`tsc` will flag any now-unused import — remove it.)

- [ ] **Step 3: Commit**

```bash
git add src/pages/NetWorthPage.tsx src/pages/NetWorthPage.test.tsx
git commit -m "feat(net-worth): stack, bridge and drill on ChartCard — Share %, one linked group, export + Table everywhere (F2, F8, F9, F11, F12)"
```

---

### Task 5: Overview builders — trend and recent spend (F14) on the grammar

**Files:**
- Modify: `src/components/overview/overviewChartOptions.ts`, `src/components/overview/overviewChartOptions.test.ts`
- Create: `src/charts/fixtures/overviewNetWorthTrend.fixture.ts`, `src/charts/fixtures/overviewRecentSpend.fixture.ts`

Named changes: §8 (trend `grid('noLegend')` — was `{70,16,12,28}`; bars `grid()` now that F14 adds a legend entry — was `{70,16,24,28}`; `monthAxis` labels every month at ≤ 12), F14 (`referenceLine('12-mo average')` at the mean of the shown months), F7 (`axisTooltip`; `shadow` pointer on the bars — the old `axisPointer toBeUndefined` bar pin flips), §9 (`LINE`/`BAR_MARKS` focus, `legendFor`), F12 (two CSVs).

- [ ] **Step 1: Update the tests**

In `overviewChartOptions.test.ts`:

1. `netWorthTrendOption` case: replace `expect(valueFormatterOf(option)(1234.5)).toBe('$1,234.50')` with a `tooltipRows` read — `expect(tooltipRows(tooltipOf(option).formatter([{ seriesName: 'Net worth', seriesType: 'line', axisValueLabel: 'Dec 2025', value: -250.5, color: PALETTE[0] }])).rows).toEqual([{ kind: 'row', label: 'Net worth', value: '-$250.50' }])` — and add `expect((option as { grid: unknown }).grid).toEqual(GRID_VARIANTS.noLegend)`, `expect(line.emphasis).toEqual({ focus: 'series' })`. `tooltipOf`'s type gains `formatter: (p: unknown) => string`.
2. `recentSpendOption` — `'bars the months in palette slot 2…'`: add `expect(bars.emphasis).toEqual({ focus: 'series', itemStyle: { borderColor: INK } })`; then a new case:
   ```ts
   it('F14: a dashed 12-mo average reference at the mean of the shown months, listed after the bars', () => {
     const option = recentSpendOption({ months: monthsFrom('2026-01-01', 3), totals: totalsFrom(3) })
     const [bars, average] = seriesOf(option) as (SeriesLike & { name?: string; lineStyle?: { type?: string }; z?: number })[]
     expect(bars.name).toBe('Spend')
     expect(average).toMatchObject({ name: '12-mo average', type: 'line', color: MUTED, z: 9, lineStyle: { width: 2, type: 'dashed' } })
     expect(average.data).toEqual([200, 200, 200])
     expect((option as unknown as { legend: { type: string } }).legend.type).toBe('plain')
     expect((option as { grid: unknown }).grid).toEqual(GRID_VARIANTS.default)
     // The reference rides the trailing window: a 14-month feed averages its last twelve.
     const long = recentSpendOption({ months: monthsFrom('2025-01-01', 14), totals: totalsFrom(14) })
     expect((seriesOf(long)[1].data as number[])[0]).toBe(850)
   })
   ```
3. `'formats the axis compactly and the tooltip in full…'`: replace the `valueFormatterOf` and `axisPointer toBeUndefined` lines with:
   ```ts
   expect(tooltipOf(option).axisPointer).toEqual({ type: 'shadow' }) // F7: bars take the shadow rule
   const rows = tooltipRows(tooltipOf(option).formatter([
     { seriesName: 'Spend', seriesType: 'bar', axisValueLabel: 'Jan 2026', value: 100, color: PALETTE[1] },
     { seriesName: '12-mo average', seriesType: 'line', value: 150, color: MUTED },
   ]))
   expect(rows.rows.map((r) => [r.kind, r.label, r.value])).toEqual([['row', 'Spend', '$100.00'], ['ref', '12-mo average', '$150.00']])
   ```
4. Add CSV cases:
   ```ts
   it('exports the trend and the shown spend months', () => {
     expect(netWorthTrendCsv({ months: ['2026-01-01', '2026-02-01'], net_worth: ['1.00', '2.00'] })).toEqual({ headers: ['Month', 'Net worth'], rows: [['2026-01-01', '1.00'], ['2026-02-01', '2.00']] })
     expect(recentSpendCsv({ months: monthsFrom('2025-01-01', 14), totals: totalsFrom(14) }).rows).toHaveLength(12)
     expect(recentSpendCsv({ months: monthsFrom('2026-01-01', 2), totals: totalsFrom(2) })).toEqual({ headers: ['Month', 'Spend'], rows: [['2026-01-01', '100.00'], ['2026-02-01', '200.00']] })
   })
   ```
   Remove the unused `valueFormatterOf` helper. Imports: `GRID_VARIANTS` from grammar, `INK, MUTED` from theme, `tooltipRows`, the two CSV functions.

Run: `npx vitest run src/components/overview/overviewChartOptions.test.ts`
Expected: FAIL.

- [ ] **Step 2: Rewrite the two builders**

```ts
import { BAR_MARKS, LINE, WASH, cents, grid, moneyAxis, monthAxis } from '../../charts/grammar'
import { legendFor } from '../../charts/legend'
import { referenceLine } from '../../charts/reference'
import { PALETTE } from '../../charts/theme'
import { axisTooltip } from '../../charts/tooltip'
import type { ExportTable } from '../../utils/download'

export function netWorthTrendOption(ts: Pick<NetWorthTimeseries, 'months' | 'net_worth'>): EChartsOption | null {
  if (ts.months.length < 2) return null
  return {
    grid: grid('noLegend'),
    xAxis: monthAxis(ts.months.map(formatMonth)),
    // A washed area over a VISIBLE axis needs the honest zero baseline — no scale:true.
    yAxis: moneyAxis(),
    // Default axis pointer kept: a line chart ships its crosshair by default (dataviz law).
    tooltip: axisTooltip({ unit: 'money' }),
    series: [{ ...LINE, name: 'Net worth', ...WASH, color: PALETTE[0], data: ts.net_worth.map(Number) }],
  }
}

export function netWorthTrendCsv(ts: Pick<NetWorthTimeseries, 'months' | 'net_worth'>): ExportTable {
  return { headers: ['Month', 'Net worth'], rows: ts.months.map((m, i) => [m, ts.net_worth[i]]) }
}

export const RECENT_SPEND_MONTHS = 12
const AVERAGE_SERIES = '12-mo average'

export function recentSpendOption(matrix: Pick<SpendingMatrix, 'months' | 'totals'>, months = RECENT_SPEND_MONTHS): EChartsOption | null {
  if (matrix.months.length === 0) return null
  const start = Math.max(0, matrix.months.length - months)
  const totals = matrix.totals.slice(start).map(Number)
  // F14: the window's own mean as a reference — the same window the bars show, so the line and
  // the bars answer one question ("is this month over my recent average?").
  const mean = cents(totals.reduce((sum, t) => sum + t, 0) / totals.length)
  return {
    grid: grid(),
    legend: legendFor(2),
    xAxis: monthAxis(matrix.months.slice(start).map(formatMonth), { gap: true }),
    yAxis: moneyAxis(),
    tooltip: axisTooltip({ unit: 'money', references: [AVERAGE_SERIES], pointer: 'shadow' }),
    series: [
      { type: 'bar', name: 'Spend', ...BAR_MARKS, color: PALETTE[1], data: totals },
      referenceLine(AVERAGE_SERIES, totals.map(() => mean)),
    ],
  }
}

export function recentSpendCsv(matrix: Pick<SpendingMatrix, 'months' | 'totals'>, months = RECENT_SPEND_MONTHS): ExportTable {
  const start = Math.max(0, matrix.months.length - months)
  return { headers: ['Month', 'Spend'], rows: matrix.months.slice(start).map((m, i) => [m, matrix.totals[start + i]]) }
}
```

(`SURFACE`, `formatCurrency`, `formatCurrencyCompact` imports become unused — remove them.)

- [ ] **Step 3: Add the fixtures**

```ts
// src/charts/fixtures/overviewNetWorthTrend.fixture.ts
import type { ChartFixture } from './_types'
import { netWorthTrendOption } from '../../components/overview/overviewChartOptions'

const fixture: ChartFixture = {
  name: 'overviewNetWorthTrend',
  kind: 'cartesian',
  ariaLabel: 'Line chart of net worth at every monthly snapshot',
  build: () => netWorthTrendOption({ months: ['2026-06-01', '2026-07-01', '2026-08-01'], net_worth: ['1000.00', '-250.50', '2000.75'] }),
}
export default fixture
```

```ts
// src/charts/fixtures/overviewRecentSpend.fixture.ts
import type { ChartFixture } from './_types'
import { recentSpendOption } from '../../components/overview/overviewChartOptions'

const fixture: ChartFixture = {
  name: 'overviewRecentSpend',
  kind: 'cartesian',
  ariaLabel: 'Bar chart of total spending for each of the last 12 entered months, with the 12-month average',
  dashed: ['12-mo average'],
  build: () => recentSpendOption({ months: ['2026-06-01', '2026-07-01', '2026-08-01'], totals: ['100.00', '200.00', '300.00'] }),
}
export default fixture
```

Run: `npx vitest run src/components/overview/overviewChartOptions.test.ts src/charts/conformance.test.ts src/pages/OverviewPage.test.tsx`
Expected: PASS (the page still mounts the same builders).

- [ ] **Step 4: Commit**

```bash
git add src/components/overview/overviewChartOptions.ts src/components/overview/overviewChartOptions.test.ts src/charts/fixtures/overviewNetWorthTrend.fixture.ts src/charts/fixtures/overviewRecentSpend.fixture.ts
git commit -m "feat(overview): trend and recent-spend builders on the grammar; 12-mo average reference on the bars; CSVs (F14, F7, F12, §8, §9)"
```

---

### Task 6: The money-flow card onto `ChartCard` with CSV

**Files:**
- Modify: `src/components/overview/moneyFlowOptions.ts`, `src/components/overview/moneyFlowOptions.test.ts`
- Modify: `src/components/overview/MoneyFlowCard.tsx`, `src/components/overview/MoneyFlowCard.test.tsx`
- Create: `src/charts/fixtures/moneyFlow.fixture.ts`

The sankey option is untouched (`charts/sankey.ts` conforms; C1 branded it). F12 adds `moneyFlowCsv`; the card mounts through `ChartCard` with the year chips as `controls`, Retry as an `action`, the payload's refusal sentence as `empty`, and the first fetch as `busy`.

- [ ] **Step 1: Write the failing tests**

`moneyFlowOptions.test.ts`:

```ts
import { moneyFlowCsv } from './moneyFlowOptions'

it('exports nodes then links at the server figures', () => {
  const csv = moneyFlowCsv(flowOut())
  expect(csv.headers).toEqual(['Kind', 'Source', 'Target', 'Value'])
  expect(csv.rows).toContainEqual(['node', 'Gross income', '', '307500.00'])
  expect(csv.rows).toContainEqual(['link', 'Take-home cash', 'Saved', '76000.00'])
  expect(moneyFlowCsv(flowOut({ renderable: false, reason: 'nope' })).rows).toEqual([])
})
```

`MoneyFlowCard.test.tsx` — in the render cases add: `expect(screen.getByRole('group', { name: /Export money-flow/ })).toBeTruthy()`, `expect(screen.getByLabelText(/Sankey diagram of 2026 money flow/)).toBeTruthy()`, `expect(screen.getByRole('group', { name: 'Money-flow year' })).toBeTruthy()`; the failed case keeps `getByRole('button', { name: 'Retry loading the money flow' })` and now also `expect(screen.getByText("Couldn't load the money flow.")).toBeTruthy()`; a new case `'skeletons while the first fetch is in flight'`: `render(<MoneyFlowCard flow={null} failed={false} … />)` → `expect(document.querySelector('.chart-card-skeleton')).toBeTruthy()`.

Run: `npx vitest run src/components/overview`
Expected: FAIL.

- [ ] **Step 2: CSV + fixture**

```ts
// moneyFlowOptions.ts
import { sankeyCsv } from '../../charts/sankey'
import type { ExportTable } from '../../utils/download'

/** The flow as a table (F12) — the same nodes and links the chart draws; a refused payload → no rows. */
export function moneyFlowCsv(flow: MoneyFlowOut): ExportTable {
  const option = moneyFlowOption(flow) as { series?: { data: SankeyNode[]; links: SankeyLink[] }[] } | null
  const series = option?.series?.[0]
  return series === undefined ? { headers: ['Kind', 'Source', 'Target', 'Value'], rows: [] } : sankeyCsv(series.data, series.links)
}
```

```ts
// src/charts/fixtures/moneyFlow.fixture.ts
import type { ChartFixture } from './_types'
import { moneyFlowOption } from '../../components/overview/moneyFlowOptions'

const fixture: ChartFixture = {
  name: 'moneyFlow',
  kind: 'sankey',
  ariaLabel: 'Sankey diagram of the year’s money flow from income sources through taxes, savings and take-home cash to spending categories',
  exempt: ['grid', 'axis', 'legend'],
  build: () =>
    moneyFlowOption({
      year: 2026, available_years: [2026], renderable: true, reason: null, warnings: [],
      sources: { salary_and_bonus: '220000.00', rsu_vests: '80000.00', espp: '4000.00', investment_income: '2500.00', other_income: '1000.00', salary_people: [] },
      gross_income: '307500.00',
      taxes: { total: '67016.05', federal: '26520.00', state: '14225.00', medicare: '4345.65', social_security: '18581.40', disability: '3344.00', capital_gains: '0.00', niit: '123.45' },
      pre_tax_savings: '27300.00', take_home_cash: '120000.00', retained_equity: '93183.95',
      categories: [{ name: 'Rent', amount: '24000.00' }, { name: 'Food', amount: '6000.00' }],
      other_spend: '1400.00', total_spend: '31400.00', saved: '88600.00',
    }),
}
export default fixture
```

- [ ] **Step 3: The card**

```tsx
// src/components/overview/MoneyFlowCard.tsx
import { useMemo } from 'react'
import type { MoneyFlowOut } from '../../types/api'
import ChartCard from '../ChartCard'
import Segmented from '../shell/Segmented'
import { moneyFlowCsv, moneyFlowOption } from './moneyFlowOptions'
import '../panels.css'
import './moneyFlow.css'

export default function MoneyFlowCard({ flow, failed, onRetry, onYearChange }: {
  flow: MoneyFlowOut | null
  failed: boolean
  onRetry: () => void
  onYearChange: (year: number) => void
}) {
  const option = useMemo(() => (flow === null ? null : moneyFlowOption(flow)), [flow])
  return (
    <ChartCard
      title={flow === null ? 'Money flow' : `Money flow — ${flow.year}`}
      hint="Where the year's money went. Income comes from the year's tax inputs through the tax engine; take-home cash is the entered monthly net pay; the right-hand fan is the year's entered spending. Retained equity & other is the residual — ≈ vest shares kept + ESPP contributions + timing between W-2 income and cash."
      ariaLabel={`Sankey diagram of ${flow?.year ?? 'the year'}'s money flow from income sources through taxes, savings and take-home cash to spending categories`}
      option={option}
      // The SERVER's refusal sentence, verbatim; the fallback covers only a renderable payload
      // the builder's negative backstop still refused.
      empty={flow?.reason ?? 'Nothing to draw for this year yet.'}
      exportName={`money-flow-${flow?.year ?? 'year'}`}
      csv={flow === null ? undefined : () => moneyFlowCsv(flow)}
      // ~17 nodes at most, so 380px keeps every ribbon legible.
      height={380}
      busy={flow === null && !failed}
      error={failed ? "Couldn't load the money flow." : null}
      controls={
        flow !== null && flow.available_years.length > 0 ? (
          <Segmented
            variant="toggle"
            size="sm"
            ariaLabel="Money-flow year"
            options={flow.available_years.map((year) => ({ value: String(year), label: String(year) }))}
            value={String(flow.year)}
            onChange={(value) => onYearChange(Number(value))}
          />
        ) : undefined
      }
      actions={
        failed ? (
          <button type="button" className="button" aria-label="Retry loading the money flow" onClick={onRetry}>Retry</button>
        ) : undefined
      }
      footer={flow !== null && flow.warnings.length > 0 ? <p className="drill-hint">{flow.warnings.join(' · ')}</p> : undefined}
    />
  )
}
```

(`moneyFlow.css`'s `.money-flow-years` rule becomes unused — C7 lists it.)

Run: `npx vitest run src/components/overview src/charts/conformance.test.ts src/pages/OverviewPage.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/overview/moneyFlowOptions.ts src/components/overview/moneyFlowOptions.test.ts src/components/overview/MoneyFlowCard.tsx src/components/overview/MoneyFlowCard.test.tsx src/charts/fixtures/moneyFlow.fixture.ts
git commit -m "feat(overview): money-flow card on ChartCard with year controls, Retry action, refusal sentence and CSV (F11, F12)"
```

---

### Task 7: OverviewPage onto `ChartCard`

**Files:**
- Modify: `src/pages/OverviewPage.tsx`, `src/pages/OverviewPage.test.tsx`

Three `ChartCard`s (trend, performance, recent spend) replace the `section.card` blocks at `OverviewPage.tsx:536-596`; the "Open … →" links become footers; `EChart`, `InfoHint`-in-header and `animateEntrance` leave this part of the page. The performance card mounts C4's builder as it stands on `main` (this lane never edits `historyChartOptions.ts`).

- [ ] **Step 1: Extend the page test**

```ts
  it('mounts the three snapshot charts through ChartCard with labels, export rows and the drill links', async () => {
    renderPage()
    await screen.findByText('Net worth trend')
    expect(screen.getByLabelText('Line chart of net worth at every monthly snapshot')).toBeTruthy()
    expect(screen.getByLabelText(/Line chart of portfolio value against cost basis/)).toBeTruthy()
    expect(screen.getByLabelText(/Bar chart of total spending for each of the last 12 entered months/)).toBeTruthy()
    expect(screen.getAllByRole('group', { name: /Export/ }).length).toBeGreaterThanOrEqual(3)
    expect(screen.getByRole('link', { name: 'Open net worth →' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open spending →' })).toBeTruthy()
  })
```

The existing `pageCharts()` helper and its `data-animate` assertions keep working (the mock is the same). Where a test asserted the empty notes (`'No snapshots yet.'`, `'No performance history yet.'`, `'No spending months yet.'`), the sentences are unchanged — they are now the cards' `empty` props.

Run: `npx vitest run src/pages/OverviewPage.test.tsx`
Expected: FAIL — no export groups.

- [ ] **Step 2: Rewrite the three cards**

Imports: `ChartCard from '../components/ChartCard'`; `netWorthTrendCsv`, `recentSpendCsv` from `overviewChartOptions`; `portfolioHistoryCsv` from `historyChartOptions`; drop `EChart` (keep the `EChartEventParams` type import).

```tsx
            <div className="card-grid">
              <ChartCard
                title="Net worth trend"
                hint="Net worth at every monthly snapshot — the series the Net Worth page breaks down by group."
                ariaLabel="Line chart of net worth at every monthly snapshot"
                option={nwTrend}
                empty="No snapshots yet."
                exportName="net-worth-trend"
                csv={() => netWorthTrendCsv(data.ts)}
                height={220}
                onClick={() => navigate('/net-worth')}
                footer={<NavLink className="drill-hint" to="/net-worth">Open net worth →</NavLink>}
              />
              <ChartCard
                title="Portfolio performance"
                hint={performanceHint}
                ariaLabel="Line chart of portfolio value against cost basis and benchmark lines, weekly"
                option={perf}
                empty="No performance history yet."
                exportName="portfolio-performance"
                csv={() => portfolioHistoryCsv(data.history)}
                height={280}
                onClick={() => navigate('/portfolio')}
                footer={<NavLink className="drill-hint" to="/portfolio">Open portfolio →</NavLink>}
              />
              <ChartCard
                title="Recent spending"
                hint="Total spend for each of the last 12 entered months, with their average as the dashed line."
                ariaLabel="Bar chart of total spending for each of the last 12 entered months, with the 12-month average"
                option={bars}
                empty="No spending months yet."
                exportName="recent-spending"
                csv={() => recentSpendCsv(data.matrix)}
                height={240}
                onClick={openSpendingMonth}
                footer={<NavLink className="drill-hint" to="/spending">Open spending →</NavLink>}
              />
              <MoneyFlowCard flow={flow} failed={flowFailed} onRetry={() => loadFlow(flowYear)} onYearChange={showFlowYear} />
            </div>
```

(`data` is non-null inside this branch — the page already narrows it.)

Run: `npx vitest run src/pages/OverviewPage.test.tsx && npx tsc -b && npx eslint src/pages/OverviewPage.tsx`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/pages/OverviewPage.tsx src/pages/OverviewPage.test.tsx
git commit -m "feat(overview): the three snapshot charts on ChartCard with export + Table and footer drill links (F11, F12)"
```

---

### Task 8: Verify

- [ ] Run `npx tsc -b && npx eslint . && npx vitest run` from the worktree root. Expected: green. `npx vitest run src/charts/conformance.test.ts` lists passing cases for `netWorthStack`, `netWorthStackShare`, `netWorthDrill`, `netWorthBridge`, `overviewNetWorthTrend`, `overviewRecentSpend`, `moneyFlow`.
- [ ] `grep -rn "<EChart" src/pages/NetWorthPage.tsx src/pages/OverviewPage.tsx src/components/overview src/components/networth` → no output.
- [ ] Commit anything the runs touched; the lane is ready to merge.

---

## Self-review

**Spec coverage:** F2 (zero floor, immaterial liabilities, Share %, bridge) → Tasks 1, 3, 4. F8 (endLabel grid on both, `group="net-worth"`) → Tasks 1, 2, 4. F14 → Task 5. F7 on every builder here → Tasks 1, 2, 3, 5. F9 (persisted picks — stack and drill already mirrored; the builders now take `selected`) → Tasks 1, 2, 4. F11 (every mount named: stack, drill, bridge, trend, performance, bars, money flow) → Tasks 4, 6, 7. F12 (CSV + Table on all six mounts; drill/trend/bars/sankey CSVs added) → Tasks 2, 3, 5, 6, 7. §12 people slots via `personSlot` → Task 1. The retired page code (`networth-chart-header` CSS, `netWorthStackedTooltipFormatter`, `.money-flow-years`) stays in place — C7's list. **Placeholders:** the unchanged JSX regions are marked as such ("unchanged body", "the unchanged …") and point at code the implementer already has open in the same file; every NEW element is written out. **Type consistency:** `netWorthStackOption({ ts, mode, people, marriageDate, range, selected })`, `netWorthDrillOption({ ts, drill, range, selected })`, `netWorthDrillCsv(ts, drill)`, `netWorthBridgeOption(ts, index)`, `netWorthBridgeCsv(ts, index)`, `liabilitiesMaterial(ts)`, `STACK_MODES`/`StackMode`, `netWorthTrendCsv(ts)`, `recentSpendCsv(matrix)`, `moneyFlowCsv(flow)` match between tasks and the page; C1 names (`grid`, `moneyAxis`, `pctAxis`, `monthAxis`, `LINE`, `STACK_WASH`, `WASH`, `BAR_MARKS`, `cents`, `FOCUS`, `legendFor`, `referenceLine`, `axisTooltip`, `personSlot`, `slotColor`, `waterfallSteps`/`waterfallSeries`/`waterfallTooltip`/`waterfallCsv`, `sankeyCsv`, `ChartCard`, `ChartFixture`, `tooltipRows`) are used exactly as C1 defines them.

