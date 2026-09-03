# Charts C5 — Projection + Comp/ESPP onto the grammar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the Projection page's two charts and the Comp page's two charts (the ESPP page has no charts; the lane name follows the spec's grouping) onto the C1 grammar (`docs/superpowers/plans/2026-09-04-charts-c1-primitives.md`) and land F3 (both projection builders memoized, both legends persisted, `FI` and `Coast FI` arrival rules, the post-FI area, p10/p50/p90 marks on the target line, a 1 px `Median path`, a `Linear · Log` toggle, the two outer band washes sharing one legend name), F6 (a `Today` rule on the vesting calendar, hatched future bars with "(est.)" in the tooltip, a "Vested $X · Unvested $Y (est.)" strip, entrance gated by the frame, aria + CSV), F13 (`barMaxWidth` 46 → 24 on the TC stack), and F7/F9/F11/F12 for all four mounts.

**Architecture:** `projectionChartOptions.ts` and `vestingChartOptions.ts` / `compChartOptions.ts` stay pure; the page and panel pass `{ log, selected }` / `{ todayIso }` inputs. Rules ride the one series every payload has (`Projected`) through `annotationRules([...retirements, fi, coastFi])`; the post-FI wash is a `markArea` (`afterArea`); the percentile marks a `markPoint` (`percentileMarks`) on the target line — all from `charts/markLine.ts`. Under `Log`, the projected line drops its wash (a log axis has no zero to anchor a fill on — spec §8); the fan stays because its stacked diffs still sum to the true percentiles. Future vest bars hatch through `itemStyle.decal` per data item in the card surface color (tone-on-tone, a token hex, so conformance's color rule holds). A real-echarts probe of the decal + `markArea` + `markPoint` precedes the merge (§17).

**Tech Stack:** React 19, TypeScript 5.9, vitest 3 + @testing-library/react (jsdom; `EChart` mocked as today), ECharts 6.1 via `src/charts/echarts.ts`; puppeteer-core + Edge for the probe.

**Worktree / commands:** Branch `charts-c5` from `main` AFTER C1 merges; `cmd //c "mklink /J node_modules ..\\..\\node_modules"` once; `npx vitest run <file>`, `npx tsc -b`, `npx eslint <files>`. Local commits only. Read `src/charts/grammar.ts`, `tooltip.ts`, `legend.ts`, `markLine.ts`, `src/components/ChartCard.tsx`, `src/charts/fixtures/_types.ts`, `src/testing/tooltipRows.ts` first.

**Done when:** no `<EChart` outside `ChartCard` in `ProjectionPage.tsx`, `CompPage.tsx`, `VestingSchedulePanel.tsx`; conformance green with this lane's fixtures; probe screenshots in `scratchpad/charts-c5-probe/`; `npx tsc -b`, `npx eslint`, full `npx vitest run` pass.

---

## File structure

| File | Responsibility |
|---|---|
| `src/components/projection/projectionChartOptions.ts` (modify) | `projectionOption(data, { log, selected })` with F3; `netWorthProjectionOption(history, fit, start, years, { selected })` on the grammar; `netWorthProjectionCsv`; `MEDIAN_SERIES`; `projectionTooltipFormatter` left in place unused |
| `src/components/projection/projectionChartOptions.test.ts` (modify) | F3 pins; band name pin updated; tooltip via `tooltipRows` |
| `src/charts/fixtures/projectionFan.fixture.ts`, `projectionLog.fixture.ts`, `netWorthProjection.fixture.ts` (new) | Conformance fixtures |
| `src/pages/ProjectionPage.tsx` (modify) | Two `ChartCard`s; `useMemo` on both builders; `projLegend`/`nwLegend` state; `Linear · Log` and trend-span `Segmented`s in `controls`; `zoomable`; `csv` on both |
| `src/pages/ProjectionPage.test.tsx` (modify) | Card structure; log toggle; legend persistence |
| `src/components/comp/vestingChartOptions.ts` (modify) | `vestingChartOption(vests, grants, latestPrice, { todayIso })` with F6; `vestingTotals`; `vestingCsv`; `vestingTooltipFormatter` left unused |
| `src/components/comp/vestingChartOptions.test.ts` (modify) | F6 pins |
| `src/components/comp/compChartOptions.ts` (modify) | `tcTrajectoryOption(events, { selected })` on the grammar, `barMaxWidth` 24; `tcTrajectoryCsv` |
| `src/components/comp/compChartOptions.test.ts` (modify) | Pins |
| `src/charts/fixtures/vestingCalendar.fixture.ts`, `tcTrajectory.fixture.ts` (new) | Conformance fixtures |
| `src/components/comp/VestingSchedulePanel.tsx` (modify) | Vesting `ChartCard` with the totals strip + hatched footnote in `footer`, `csv`, `ariaLabel` |
| `src/pages/CompPage.tsx` (modify) | TC `ChartCard` with legend state, `csv`, `ariaLabel` |
| `src/pages/CompPage.test.tsx` (modify) | Card structure |
| `scratchpad/charts-c5-probe/probe.html`, `shoot.mjs` (new) | Real-echarts probe: decal hatching, `markArea`, `markPoint` labels |

---

### Task 1: `projectionOption` with F3

**Files:**
- Modify: `src/components/projection/projectionChartOptions.ts`, `src/components/projection/projectionChartOptions.test.ts`
- Create: `src/charts/fixtures/projectionFan.fixture.ts`, `src/charts/fixtures/projectionLog.fixture.ts`

F3: FI + Coast FI rules on the `Projected` line beside the retirement rules, a post-FI `markArea`, p10/p50/p90 marks on the target line, a 1 px `Median path` from `bands.p50`, `Linear · Log` through `moneyAxis({ log })` (the projected wash drops under log — §8), and the two outer band washes share the exact name `10–90% band` so one legend entry toggles both. F7 replaces `projectionTooltipFormatter` with `axisTooltip` whose `footer` reconstructs the band ranges. `grid('fan')` is the same `{76,24,40,28}`.

- [ ] **Step 1: Update the tests**

In `src/components/projection/projectionChartOptions.test.ts`:

1. In `read()`'s series type add `markArea?: unknown; markPoint?: { data: { name: string; coord: [string, number] }[] }` and to the top-level `legend: { data: string[]; selected?: Record<string, boolean> }`, `yAxis: { type: string }`.
2. `'prepends four stacked band series so the lines draw on top'` → the fan now has FIVE prepended series (the median path joins) and the upper wash carries the SAME name:
   ```ts
   expect(option.series).toHaveLength(8)
   expect(option.series.map((s) => s.name)).toEqual([
     'mc-base', BAND_SERIES[0], BAND_SERIES[1], BAND_SERIES[0], MEDIAN_SERIES, ...PROJECTION_SERIES,
   ])
   expect(option.series.slice(0, 4).every((s) => s.stack === 'mc-band')).toBe(true)
   expect(option.series.slice(4).every((s) => s.stack === undefined)).toBe(true)
   ```
3. `'names only the two washes that differ in the legend'` → `expect(option.legend.data).toEqual([...PROJECTION_SERIES, MEDIAN_SERIES, ...BAND_SERIES])` and drop the `-upper` assertion (there is no such name any more).
4. `'bands survive a missing target'` → `toHaveLength(7)` and legend `[PROJECTION_SERIES[0], PROJECTION_SERIES[1], MEDIAN_SERIES, ...BAND_SERIES]`.
5. Replace the two tooltip tests (`'tooltip reconstructs the band RANGES…'`, `'keeps the plain per-value tooltip…'`, `'tooltip formatter drops non-finite rows…'`) with:
   ```ts
   it('F7: rows in series order, the FI target as a muted reference, band ranges as footer lines', () => {
     const option = projectionOption({ ...DATA, bands: BANDS }) as unknown as {
       tooltip: { formatter: (p: unknown) => string }
     }
     const parsed = tooltipRows(option.tooltip.formatter([
       { seriesName: 'Projected', seriesType: 'line', axisValueLabel: 'Sep 2026', dataIndex: 1, value: 104000, color: PALETTE[0] },
       { seriesName: 'Growth only', seriesType: 'line', value: 100000, color: PALETTE[1] },
       { seriesName: 'FI target', seriesType: 'line', value: 1500000, color: MUTED },
       { seriesName: MEDIAN_SERIES, seriesType: 'line', value: 104000, color: PALETTE[0] },
       { seriesName: 'Projected', seriesType: 'line', value: null },
     ]))
     expect(parsed.head).toBe('Sep 2026')
     expect(parsed.rows.map((r) => [r.kind, r.label, r.value])).toEqual([
       ['row', 'Projected', '$104,000.00'],
       ['row', 'Growth only', '$100,000.00'],
       ['row', MEDIAN_SERIES, '$104,000.00'],
       ['ref', 'FI target', '$1,500,000.00'],
     ])
     // Real percentile ABSOLUTES from the bands arrays — never the stack's diff values; the
     // wide band above the tight one (the legend's order).
     expect(parsed.foot.map((line) => line.replace(/<i [^>]*><\/i>/, ''))).toEqual([
       `${BAND_SERIES[0]}: $90,000.00 – $120,000.00`,
       `${BAND_SERIES[1]}: $95,000.00 – $112,000.00`,
     ])
     expect(parsed.foot[0]).toContain('is-wash')
     // No bands → no footer, same formatter family.
     const plain = projectionOption(DATA) as unknown as { tooltip: { formatter: (p: unknown) => string } }
     expect(tooltipRows(plain.formatter([{ seriesName: 'Projected', seriesType: 'line', dataIndex: 0, value: 1 }])).foot).toEqual([])
   })
   ```
6. Add F3 cases:
   ```ts
   describe('projectionOption — F3', () => {
     const FI = { ...DATA, fi_month: '2026-10-01', coast_fi_month: '2026-09-01', fi_month_p10: '2026-09-01', fi_month_p50: '2026-10-01', fi_month_p90: null, bands: BANDS }

     it('rules FI and Coast FI on the Projected line beside the retirements, in the shared markLine', () => {
       const option = read(projectionOption({ ...FI, retirements: [{ person_id: 2, name: 'Alex', month: '2026-09-01', monthly_drop: '1.00' }] }))
       const projected = option.series.find((s) => s.name === PROJECTION_SERIES[0])!
       expect(projected.markLine?.data).toEqual([
         { xAxis: 'Sep 2026', label: { formatter: 'Alex' } },
         { xAxis: 'Oct 2026', label: { formatter: 'FI' } },
         { xAxis: 'Sep 2026', label: { formatter: 'Coast FI' } },
       ])
       expect(projected.markLine?.lineStyle).toEqual(MARK_LINE_STYLE)
     })

     it('washes the months after FI and marks the percentile arrivals on the target line', () => {
       const option = read(projectionOption(FI))
       const projected = option.series.find((s) => s.name === PROJECTION_SERIES[0])!
       expect(projected.markArea).toMatchObject({ data: [[{ xAxis: 'Oct 2026' }, { xAxis: 'Oct 2026' }]], label: { formatter: 'After FI' } })
       const target = option.series.find((s) => s.name === PROJECTION_SERIES[2])!
       // p90 is null → two marks; each sits ON the target value at its anchored month.
       expect(target.markPoint?.data).toEqual([
         { name: 'p10', coord: ['Sep 2026', 1500000] },
         { name: 'p50', coord: ['Oct 2026', 1500000] },
       ])
       // No FI → no area, no marks, no rules (a stale payload or an unreachable target).
       const none = read(projectionOption({ ...DATA, fi_month: null, coast_fi_month: null }))
       expect(none.series.every((s) => s.markArea === undefined && s.markPoint === undefined && s.markLine === undefined)).toBe(true)
     })

     it('draws the median path as a 1px line in the projection blue when the fan is on', () => {
       const [, , , , median] = read(projectionOption({ ...DATA, bands: BANDS })).series
       expect(median).toMatchObject({ name: MEDIAN_SERIES, color: PALETTE[0], lineStyle: { width: 1 } })
       expect(median.data).toEqual([100000, 104000, 108000])
       expect(read(projectionOption(DATA)).series.map((s) => s.name)).not.toContain(MEDIAN_SERIES)
     })

     it('Log: a log money axis and NO wash on the projected line; the fan stays', () => {
       const linear = read(projectionOption({ ...DATA, bands: BANDS }))
       const log = read(projectionOption({ ...DATA, bands: BANDS }, { log: true }))
       expect(linear.yAxis.type).toBe('value')
       expect(log.yAxis.type).toBe('log')
       expect(linear.series.find((s) => s.name === PROJECTION_SERIES[0])?.areaStyle).toEqual({ opacity: 0.12 })
       expect(log.series.find((s) => s.name === PROJECTION_SERIES[0])?.areaStyle).toBeUndefined()
       expect(log.series.slice(0, 4).every((s) => s.stack === 'mc-band')).toBe(true)
     })

     it('feeds the page's legend picks back in', () => {
       expect(read(projectionOption(DATA, { selected: { 'Growth only': false } })).legend.selected).toEqual({ 'Growth only': false })
     })
   })
   ```
   Import `MEDIAN_SERIES` from the module, `tooltipRows` from `'../../testing/tooltipRows'`, `MARK_LINE_STYLE` is already imported at the bottom — hoist that import to the top.

Run: `npx vitest run src/components/projection/projectionChartOptions.test.ts`
Expected: FAIL — `MEDIAN_SERIES` missing; the upper wash still wears `-upper`; no options argument.

- [ ] **Step 2: Rewrite `projectionOption`**

Imports to add in `projectionChartOptions.ts`:

```ts
import { LINE, WASH, grid, moneyAxis, monthAxis } from '../../charts/grammar'
import { legendFor } from '../../charts/legend'
import { afterArea, annotationRules, arrivalRule, percentileMarks, ruleAt } from '../../charts/markLine'
import { referenceLine } from '../../charts/reference'
import { axisTooltip, swatch } from '../../charts/tooltip'
```

New constant and the builder:

```ts
/** The fan's 50th percentile drawn as a hairline — where the median path actually runs,
 *  against the deterministic Projected line above it. */
export const MEDIAN_SERIES = 'Median path'

const monthBucket = (iso: string) => `${iso.slice(0, 7)}-01`

/** Retirement rules as entries — `retirementMarkLine` (kept, pinned) wraps them. */
export function retirementEntries(months: string[], retirements: { month: string; name: string }[]) {
  return retirements.map((r) => ruleAt(months, r.month, r.name, formatMonth, monthBucket))
}

export function retirementMarkLine(months: string[], retirements: { month: string; name: string }[]): RetirementMarkLine | undefined {
  return annotationRules(retirementEntries(months, retirements)) as RetirementMarkLine | undefined
}

export interface ProjectionOptionInput
  extends Pick<ProjectionOut, 'months' | 'projected' | 'coast' | 'fi_target' | 'bands'>,
    Partial<Pick<ProjectionOut, 'retirements' | 'fi_month' | 'coast_fi_month' | 'fi_month_p10' | 'fi_month_p50' | 'fi_month_p90'>> {}

export function projectionOption(
  data: ProjectionOptionInput,
  { log = false, selected }: { log?: boolean; selected?: Record<string, boolean> } = {},
): EChartsOption | null {
  if (data.months.length < 2) return null
  const target = data.fi_target === null ? null : Number(data.fi_target)
  const bands = data.bands ?? null
  const labels = data.months.map(formatMonth)
  const lastLabel = labels[labels.length - 1]

  // Rules and washes ride the ONE series every payload has. FI/Coast FI arrive through the
  // same fall-forward anchor as the retirements; an unplaceable month (stale horizon) is
  // dropped, never clamped.
  const fiLabel = anchorMonthLabel(data.months, data.fi_month ?? null)
  const rules = annotationRules([
    ...retirementEntries(data.months, data.retirements ?? []),
    arrivalRule(data.months, data.fi_month ?? null, 'FI'),
    arrivalRule(data.months, data.coast_fi_month ?? null, 'Coast FI'),
  ])
  const area = fiLabel === undefined ? undefined : afterArea(fiLabel, lastLabel, 'After FI')
  const marks =
    target === null
      ? []
      : (
          [
            ['p10', data.fi_month_p10],
            ['p50', data.fi_month_p50],
            ['p90', data.fi_month_p90],
          ] as const
        ).flatMap(([name, iso]) => {
          const label = anchorMonthLabel(data.months, iso ?? null)
          return label === undefined ? [] : [{ name, label, value: target }]
        })

  const bandSeries =
    bands === null
      ? []
      : (() => {
          const p10 = bands.p10.map(Number)
          const p25 = bands.p25.map(Number)
          const p75 = bands.p75.map(Number)
          const p90 = bands.p90.map(Number)
          const diff = (hi: number[], lo: number[]) => hi.map((v, i) => v - lo[i])
          // Stacked washes: an invisible ABSOLUTE base at p10, then DIFFS. All the projection's
          // own blue. Tooltip-silent — the footer below reconstructs the real ranges.
          const wash = (name: string, values: number[], opacity: number) => ({
            name, type: 'line' as const, stack: 'mc-band', symbol: 'none' as const,
            lineStyle: { width: 0 }, color: PALETTE[0], emphasis: { disabled: true },
            tooltip: { show: false }, silent: true, areaStyle: { opacity }, data: values,
          })
          return [
            { name: 'mc-base', type: 'line' as const, stack: 'mc-band', symbol: 'none' as const, lineStyle: { width: 0 }, color: 'transparent', emphasis: { disabled: true }, tooltip: { show: false }, silent: true, data: p10 },
            wash(BAND_SERIES[0], diff(p25, p10), 0.1),
            wash(BAND_SERIES[1], diff(p75, p25), 0.18),
            // The SAME name as the lower outer wash (F3): one legend entry toggles both halves.
            wash(BAND_SERIES[0], diff(p90, p75), 0.1),
            { ...LINE, name: MEDIAN_SERIES, lineStyle: { width: 1 }, color: PALETTE[0], data: bands.p50.map(Number) },
          ]
        })()

  const bandLines = (index: number): string[] => {
    if (bands === null) return []
    const at = (key: string) => Number(bands[key]?.[index])
    const range = (label: string, low: number, high: number) =>
      Number.isFinite(low) && Number.isFinite(high)
        ? [`${swatch(PALETTE[0], { wash: true })}${label}: ${formatCurrency(low)} – ${formatCurrency(high)}`]
        : []
    return [...range(BAND_SERIES[0], at('p10'), at('p90')), ...range(BAND_SERIES[1], at('p25'), at('p75'))]
  }

  const series = [
    ...bandSeries,
    {
      ...LINE,
      name: PROJECTION_SERIES[0],
      color: PALETTE[0],
      // A wash needs a zero to stand on; a log axis has none (§8).
      ...(log ? {} : WASH),
      ...(rules ? { markLine: rules } : {}),
      ...(area ? { markArea: area } : {}),
      data: data.projected.map(Number),
    },
    { ...LINE, name: PROJECTION_SERIES[1], color: PALETTE[1], data: data.coast.map(Number) },
    ...(target === null
      ? []
      : [
          {
            ...referenceLine(PROJECTION_SERIES[2], data.months.map(() => target)),
            ...(marks.length > 0 ? { markPoint: percentileMarks(marks) } : {}),
          },
        ]),
  ]
  const legendData = [
    PROJECTION_SERIES[0],
    PROJECTION_SERIES[1],
    ...(target === null ? [] : [PROJECTION_SERIES[2]]),
    ...(bands === null ? [] : [MEDIAN_SERIES, ...BAND_SERIES]),
  ]
  return {
    dataZoom: timeZoom(data.months, 'all'),
    grid: grid('fan'),
    // Listed explicitly so the invisible base stays OUT; the two outer washes share one name
    // and therefore one entry.
    legend: { ...legendFor(legendData.length, selected), data: legendData },
    tooltip: axisTooltip({ unit: 'money', references: [PROJECTION_SERIES[2]], footer: bandLines }),
    xAxis: monthAxis(labels),
    yAxis: moneyAxis({ log }),
    series,
  }
}
```

Remove `BAND_MARKER` and the `AxisTooltipParam` interface if nothing else uses them; leave `projectionTooltipFormatter` exported (its describe still passes; C7 retires it).

- [ ] **Step 3: Add the fixtures**

```ts
// src/charts/fixtures/projectionFan.fixture.ts
import type { ChartFixture } from './_types'
import { BAND_SERIES, PROJECTION_SERIES, projectionOption } from '../../components/projection/projectionChartOptions'

export const FAN = {
  months: ['2026-08-01', '2026-09-01', '2026-10-01'],
  projected: ['100000.00', '104000.00', '108000.00'],
  coast: ['100000.00', '100000.00', '100000.00'],
  fi_target: '105000.00',
  fi_month: '2026-10-01',
  coast_fi_month: null,
  fi_month_p10: '2026-09-01',
  fi_month_p50: '2026-10-01',
  fi_month_p90: null,
  bands: {
    p10: ['100000.00', '90000.00', '80000.00'], p25: ['100000.00', '95000.00', '92000.00'],
    p50: ['100000.00', '104000.00', '108000.00'], p75: ['100000.00', '112000.00', '125000.00'],
    p90: ['100000.00', '120000.00', '150000.00'],
  },
  retirements: [{ person_id: 2, name: 'Alex', month: '2026-09-01', monthly_drop: '1.00' }],
}

const fixture: ChartFixture = {
  name: 'projectionFan',
  kind: 'cartesian',
  ariaLabel: 'Projected investable balance over the horizon with the Monte Carlo band',
  dashed: [PROJECTION_SERIES[2]],
  build: () => projectionOption(FAN),
}
export default fixture
export { BAND_SERIES }
```

```ts
// src/charts/fixtures/projectionLog.fixture.ts
import type { ChartFixture } from './_types'
import { PROJECTION_SERIES, projectionOption } from '../../components/projection/projectionChartOptions'
import { FAN } from './projectionFan.fixture'

const fixture: ChartFixture = {
  name: 'projectionLog',
  kind: 'cartesian',
  ariaLabel: 'Projected investable balance on a log scale',
  dashed: [PROJECTION_SERIES[2]],
  build: () => projectionOption(FAN, { log: true }),
}
export default fixture
```

Run: `npx vitest run src/components/projection/projectionChartOptions.test.ts src/charts/conformance.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/projection/projectionChartOptions.ts src/components/projection/projectionChartOptions.test.ts src/charts/fixtures/projectionFan.fixture.ts src/charts/fixtures/projectionLog.fixture.ts
git commit -m "feat(projection): FI/Coast FI rules, After FI area, percentile marks, Median path, Linear/Log, shared band name, grammar tooltip (F3, F7, §8, §9)"
```

---

### Task 2: `netWorthProjectionOption` on the grammar + CSV

**Files:**
- Modify: `src/components/projection/projectionChartOptions.ts`, `src/components/projection/projectionChartOptions.test.ts`
- Create: `src/charts/fixtures/netWorthProjection.fixture.ts`

Named changes: §9 (`legendFor(2, selected)` under the explicit `data`, `LINE` focus on the trend), F7 (`axisTooltip` — NaN gaps drop instead of dashing), F12 (`netWorthProjectionCsv`). `grid('fan')` and the log axis (`moneyAxis({ log: true })`) are byte-identical.

- [ ] **Step 1: Update the tests**

In `projectionChartOptions.test.ts`, extend `readNw`'s type with `legend: { type: string; selected?: Record<string, boolean>; data: … }`, `tooltip: { formatter: (p: unknown) => string }`, `yAxis: { type: string; axisLabel: { formatter: unknown } }`, and add:

```ts
import { compactMoney } from '../../charts/grammar'
import { netWorthProjectionCsv } from './projectionChartOptions'

describe('netWorthProjectionOption — grammar', () => {
  it('log money axis with compact ticks, focus on the trend, page legend picks', () => {
    const option = readNw(netWorthProjectionOption(HISTORY, FIT, '2026-08-01', 1, { selected: { 'Quadratic trend': false } }))
    expect(option.yAxis).toMatchObject({ type: 'log' })
    expect(option.yAxis.axisLabel.formatter).toBe(compactMoney)
    expect(option.legend.type).toBe('plain')
    expect(option.legend.selected).toEqual({ 'Quadratic trend': false })
    expect((option.series[1] as { emphasis?: unknown }).emphasis).toEqual({ focus: 'series' })
  })
  it('F7: rows in series order, NaN gaps dropped', () => {
    const option = readNw(netWorthProjectionOption(HISTORY, FIT, '2026-08-01', 1))
    const parsed = tooltipRows(option.tooltip.formatter([
      { seriesName: NET_WORTH_PROJECTION_SERIES[0], seriesType: 'scatter', axisValueLabel: 'Jun 2026', value: 100000, color: PALETTE[0] },
      { seriesName: NET_WORTH_PROJECTION_SERIES[1], seriesType: 'line', value: Number.NaN, color: PALETTE[1] },
    ]))
    expect(parsed.rows.map((r) => [r.label, r.value])).toEqual([[NET_WORTH_PROJECTION_SERIES[0], '$100,000.00']])
  })
  it('exports history and the fitted trend over the extended axis', () => {
    const csv = netWorthProjectionCsv(HISTORY, FIT, '2026-08-01', 1)
    expect(csv.headers).toEqual(['Month', 'Net worth', 'Quadratic trend'])
    expect(csv.rows).toHaveLength(15)
    expect(csv.rows[0]).toEqual(['2026-06-01', '100000.00', '100000.00'])
    expect(csv.rows[14]).toEqual(['2027-08-01', '', '123456.00'])
    expect(netWorthProjectionCsv(HISTORY, null, '2026-08-01', 1).rows[0]).toEqual(['2026-06-01', '100000.00', ''])
  })
})
```

Run: `npx vitest run src/components/projection/projectionChartOptions.test.ts`
Expected: FAIL — no options argument; `netWorthProjectionCsv` missing.

- [ ] **Step 2: Rewrite the builder**

```ts
/** The extended month axis both the option and the CSV walk: history, then every month to
 *  the horizon end — a future-dated snapshot at or past the end just empties the continuation. */
function projectionMonths(history: Pick<NetWorthTimeseries, 'months'>, startMonth: string, years: number): string[] {
  const last = history.months[history.months.length - 1]
  const end = addMonths(startMonth, years * 12)
  const count = Math.max(0, monthSerial(end) - monthSerial(last))
  return [...history.months, ...Array.from({ length: count }, (_, i) => addMonths(last, i + 1))]
}

export function netWorthProjectionOption(
  history: Pick<NetWorthTimeseries, 'months' | 'net_worth'>,
  fit: PolyTrendFit | null,
  startMonth: string,
  years: number,
  { selected }: { selected?: Record<string, boolean> } = {},
): EChartsOption | null {
  if (history.months.length < 2) return null
  const months = projectionMonths(history, startMonth, years)
  // The log axis cannot place zero or below — such points become gaps (NaN keeps the arrays
  // plain number[]; echarts treats NaN as empty), never lies.
  const positive = (value: number) => (value > 0 ? value : Number.NaN)
  const legendData = [
    { name: NET_WORTH_PROJECTION_SERIES[0], icon: 'circle' },
    { name: NET_WORTH_PROJECTION_SERIES[1] },
  ]
  return {
    dataZoom: timeZoom(months, 'all'),
    grid: grid('fan'),
    legend: { ...legendFor(legendData.length, selected), data: legendData },
    tooltip: axisTooltip({ unit: 'money' }),
    xAxis: monthAxis(months.map(formatMonth)),
    // Log scale (user-requested departure from the zero-anchored rule — a log axis HAS no
    // zero): equal steps are equal multiples, so decades of growth can't squash the early
    // history into the floor. Legal here because nothing is washed.
    yAxis: moneyAxis({ log: true }),
    series: [
      {
        name: NET_WORTH_PROJECTION_SERIES[0],
        type: 'scatter',
        symbolSize: 6,
        color: PALETTE[0],
        z: 3,
        data: history.net_worth.map((value) => positive(Number(value))),
      },
      ...(fit === null
        ? []
        : [{ ...LINE, name: NET_WORTH_PROJECTION_SERIES[1], color: PALETTE[1], z: 2, data: months.map((m) => positive(fit.valueAt(m))) }]),
    ],
  }
}

/** The trend chart as a table (F12): every axis month, the snapshot where one exists, the fit. */
export function netWorthProjectionCsv(
  history: Pick<NetWorthTimeseries, 'months' | 'net_worth'>,
  fit: PolyTrendFit | null,
  startMonth: string,
  years: number,
): ExportTable {
  const months = history.months.length === 0 ? [] : projectionMonths(history, startMonth, years)
  return {
    headers: ['Month', 'Net worth', 'Quadratic trend'],
    rows: months.map((m, i) => [m, history.net_worth[i] ?? '', fit === null ? '' : fit.valueAt(m).toFixed(2)]),
  }
}
```

- [ ] **Step 3: Add the fixture**

```ts
// src/charts/fixtures/netWorthProjection.fixture.ts
import type { ChartFixture } from './_types'
import { netWorthProjectionOption } from '../../components/projection/projectionChartOptions'

const fixture: ChartFixture = {
  name: 'netWorthProjection',
  kind: 'cartesian',
  ariaLabel: 'Net worth history with a fitted trend extended forward, on a log scale',
  build: () =>
    netWorthProjectionOption(
      { months: ['2026-06-01', '2026-07-01', '2026-08-01'], net_worth: ['100000.00', '101000.00', '102010.00'] },
      { valueAt: (iso) => (iso === '2026-06-01' ? 100000 : 123456) },
      '2026-08-01',
      1,
    ),
}
export default fixture
```

Run: `npx vitest run src/components/projection/projectionChartOptions.test.ts src/charts/conformance.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/projection/projectionChartOptions.ts src/components/projection/projectionChartOptions.test.ts src/charts/fixtures/netWorthProjection.fixture.ts
git commit -m "feat(projection): net-worth trend builder on the grammar with a persisted legend and CSV (§9, F7, F12)"
```

---

### Task 3: ProjectionPage onto `ChartCard`

**Files:**
- Modify: `src/pages/ProjectionPage.tsx`, `src/pages/ProjectionPage.test.tsx`

F3 (memoized builders, persisted legends, `Linear · Log`), F9/F11/F12 (persisted picks, `ariaLabel`, export + Table on both cards). The `projection-chart-header` markup, `ChartZoomHint`, `EChart` and `animateEntrance` leave the page (`ProjectionPage.css`'s rule stays, unused — C7 lists it).

- [ ] **Step 1: Extend the page test**

In `src/pages/ProjectionPage.test.tsx`, extend the `EChart` mock's rendered attributes with:

```ts
        'data-y-type': String((option as { yAxis?: { type?: string } }).yAxis?.type ?? ''),
        'data-legend-selected': JSON.stringify((option as { legend?: { selected?: unknown } }).legend?.selected ?? null),
        onMouseEnter: () => onLegendChange?.({ 'Growth only': false }),
```

(add `onLegendChange` to the destructured props if the mock lacks it). Then add cases beside the existing animation ones:

```ts
  it('mounts both charts through ChartCard with house labels, export rows and the trend-span / axis-scale controls', async () => {
    renderPage()
    await screen.findByText('Projected investable balance')
    expect(screen.getByLabelText(/Projected investable balance over the next/)).toBeTruthy()
    expect(screen.getByLabelText(/Net worth history with a fitted trend/)).toBeTruthy()
    expect(screen.getAllByRole('group', { name: /Export/ })).toHaveLength(2)
    expect(screen.getByRole('group', { name: 'Trend span' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Axis scale' })).toBeTruthy()
    expect(screen.getAllByText('ctrl+scroll to zoom · drag to pan')).toHaveLength(2)
  })

  it('Log flips the fan’s axis and the pick survives a recalculation', async () => {
    renderPage()
    await screen.findByText('Projected investable balance')
    const fan = () => screen.getByLabelText(/Projected investable balance over the next/).closest('.chart-card')!.querySelector('[data-testid="echart"]')!
    expect(fan().getAttribute('data-y-type')).toBe('value')
    fireEvent.click(screen.getByRole('button', { name: 'Log' }))
    expect(fan().getAttribute('data-y-type')).toBe('log')
  })

  it('legend picks persist through an option rebuild', async () => {
    renderPage()
    await screen.findByText('Projected investable balance')
    const fan = screen.getByLabelText(/Projected investable balance over the next/).closest('.chart-card')!.querySelector('[data-testid="echart"]')!
    fireEvent.mouseEnter(fan) // stands in for legendselectchanged
    fireEvent.click(screen.getByRole('button', { name: 'Log' })) // rebuilds the option
    expect(JSON.parse(fan.getAttribute('data-legend-selected')!)).toEqual({ 'Growth only': false })
  })
```

(`renderPage` is whatever helper the file already uses to render with its router/provider; the mock's aria-label attribute is what `getByLabelText` finds.)

Run: `npx vitest run src/pages/ProjectionPage.test.tsx`
Expected: FAIL — no `Axis scale` group; no export rows.

- [ ] **Step 2: Rewrite the chart section of the page**

Imports: replace `EChart`, `ChartZoomHint` with `ChartCard from '../components/ChartCard'` and `Segmented from '../components/shell/Segmented'`; add `useMemo` to the React import; import `netWorthProjectionCsv` alongside the other builders. State and memos (after `trendYears`):

```ts
  // Linear/Log for the fan (F3) and the two charts' mirrored legend picks (§9) — page state,
  // fed back through the memoized options so a Recalculate never resets them.
  const [log, setLog] = useState(false)
  const [fanLegend, setFanLegend] = useState<Record<string, boolean>>({})
  const [trendLegend, setTrendLegend] = useState<Record<string, boolean>>({})
  const onFanLegend = (selected: Record<string, boolean>) => setFanLegend((c) => ({ ...c, ...selected }))
  const onTrendLegend = (selected: Record<string, boolean>) => setTrendLegend((c) => ({ ...c, ...selected }))
  // Memoized (F3): EChart keys its setOption effect on [option], and a fresh object per
  // keystroke in the knobs form would redraw both charts on every character.
  const chart = useMemo(() => (data === null ? null : projectionOption(data, { log, selected: fanLegend })), [data, log, fanLegend])
  const fit = useMemo(() => (history === null ? null : fitPolyTrend(history.months, history.net_worth)), [history])
  const nwChart = useMemo(
    () => (history === null || data === null ? null : netWorthProjectionOption(history, fit, data.start_month, trendYears, { selected: trendLegend })),
    [history, fit, data, trendYears, trendLegend],
  )
```

Replace the two `<section className="card projection-chart-card">` blocks with:

```tsx
              <div className="card-grid">
                <ChartCard
                  title="Net worth over time (projected)"
                  hint="Every snapshot as dots with a quadratic best-fit extended forward — momentum, not a plan. Log axis: equal steps are equal multiples."
                  ariaLabel={`Net worth history with a fitted trend extended ${trendYears} ${trendYears === 1 ? 'year' : 'years'} forward, on a log scale`}
                  option={historyError === null ? nwChart : null}
                  // Advisory, never the page banner: the rest of the page runs without it.
                  error={historyError}
                  busy={history === null && historyError === null}
                  empty="Not enough monthly snapshots to chart yet."
                  exportName="net-worth-trend"
                  csv={history === null ? undefined : () => netWorthProjectionCsv(history, fit, data.start_month, trendYears)}
                  height={340}
                  zoomable
                  onLegendChange={onTrendLegend}
                  controls={
                    <Segmented
                      variant="toggle"
                      size="sm"
                      ariaLabel="Trend span"
                      options={TREND_SPANS.map((span) => ({ value: String(span), label: `${span}Y` }))}
                      value={String(trendYears)}
                      onChange={(value) => setTrendYears(Number(value) as TrendSpan)}
                    />
                  }
                  footer={
                    <p className="drill-hint">
                      {fit === null
                        ? 'The polynomial trendline needs at least three snapshots — showing the history alone. Log-scale axis: equal steps are equal multiples.'
                        : `Second-degree polynomial best-fit over every monthly net-worth snapshot, extended ${trendYears} ${trendYears === 1 ? 'year' : 'years'} — momentum, not a plan; the knob-driven model is the chart below. Log-scale axis: equal steps are equal multiples.`}
                    </p>
                  }
                />
                <ChartCard
                  title="Projected investable balance"
                  hint="Deterministic compounding at your assumptions; the bands hold the middle 50% and 80% of simulated outcomes. FI and Coast FI mark the months the target is reached; the shaded months come after it."
                  ariaLabel={`Projected investable balance over the next ${data.years} years`}
                  option={chart}
                  empty="Nothing to chart at this horizon."
                  exportName="projection"
                  csv={() => projectionCsv(data)}
                  height={340}
                  zoomable
                  onLegendChange={onFanLegend}
                  controls={
                    <Segmented
                      variant="toggle"
                      size="sm"
                      ariaLabel="Axis scale"
                      options={[{ value: 'linear', label: 'Linear' }, { value: 'log', label: 'Log' }]}
                      value={log ? 'log' : 'linear'}
                      onChange={(value) => setLog(value === 'log')}
                    />
                  }
                  footer={
                    <p className="drill-hint">
                      Deterministic compounding at one assumed return — a planning sketch, not a
                      forecast. The chart reads in today&apos;s dollars by default (inflation is
                      modelled); set inflation to 0 to read nominal dollars. The growth-only line
                      is the same balance with contributions turned off. With a volatility, bands
                      are percentiles across 500 simulated lognormal-return paths — seed-stable,
                      so identical knobs redraw identical bands; the median path is their 50th.
                    </p>
                  }
                />
              </div>
```

(`ChartCard` defaults to `span={12}`; the two cards stack inside one `card-grid` so they keep the house gap that `.projection-chart-card { margin-bottom }` used to provide.)

Run: `npx vitest run src/pages/ProjectionPage.test.tsx && npx tsc -b && npx eslint src/pages/ProjectionPage.tsx`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/pages/ProjectionPage.tsx src/pages/ProjectionPage.test.tsx
git commit -m "feat(projection): both charts on ChartCard — memoized builders, persisted legends, Linear/Log, export + Table (F3, F9, F11, F12)"
```

---

### Task 4: The vesting calendar with F6

**Files:**
- Modify: `src/components/comp/vestingChartOptions.ts`, `src/components/comp/vestingChartOptions.test.ts`
- Create: `src/charts/fixtures/vestingCalendar.fixture.ts`

F6: a `Today` rule (`todayRule` on the vest-date axis), future bars hatched through a per-item `itemStyle.decal` in the card surface colour (tone-on-tone, a token hex) with "(est.)" on their tooltip rows, `vestingTotals` for the strip, `vestingCsv`. Also F7 (`axisTooltip` groups + Total, `shadow`), §9 (`BAR_MARKS`, `legendFor(selected)`), §11 (`stagger`), §8 (`monthAxis` labels every date at ≤ 12).

- [ ] **Step 1: Update the tests**

In `vestingChartOptions.test.ts`:

1. Every call becomes `vestingChartOption(vests, grants, price, { todayIso: TODAY })` with `const TODAY = '2026-09-03'` (Nov 18, 2026 is the one future date in the golden schedule).
2. Future columns now carry item OBJECTS. Update: `expect(refresh.data).toEqual([0, 0, expect.objectContaining({ value: 6963.53 })])`; `expect(newHire.data).toEqual([11207.5, 3239.13, expect.objectContaining({ value: 4581.27 })])`; `'rounds a future bar back to cents'` → `expect(String((refresh.data![2] as { value: number }).value)).toBe('6963.53')`; `'omits the FUTURE columns…'` and the past-only cases are unchanged (plain numbers).
3. `'formats the axis and wires the total-carrying tooltip formatter'` → replace with:
   ```ts
   it('F7: grant rows by value, a Total, "(est.)" on future rows; shadow pointer', () => {
     const option = vestingChartOption(GOLDEN_VESTS, GOLDEN_GRANTS, QUOTE, { todayIso: TODAY })! as unknown as {
       tooltip: { axisPointer: unknown; formatter: (p: unknown) => string }
     }
     expect(option.tooltip.axisPointer).toEqual({ type: 'shadow' })
     const parsed = tooltipRows(option.tooltip.formatter([
       { seriesName: 'FY24 new hire', seriesType: 'bar', axisValueLabel: 'Nov 18, 2026', value: 4581.27, color: PALETTE[0], data: { value: 4581.27, estimate: true } },
       { seriesName: 'FY26 refresh', seriesType: 'bar', value: 6963.53, color: PALETTE[1], data: { value: 6963.53, estimate: true } },
     ]))
     expect(parsed.rows.map((r) => [r.kind, r.label, r.value])).toEqual([
       ['row', 'FY26 refresh (est.)', '$6,963.53'],
       ['row', 'FY24 new hire (est.)', '$4,581.27'],
       ['total', 'Total', '$11,544.80'],
     ])
     const past = tooltipRows(option.tooltip.formatter([{ seriesName: 'FY24 new hire', seriesType: 'bar', axisValueLabel: 'Nov 20, 2024', value: 11207.5, data: 11207.5 }]))
     expect(past.rows[0].label).toBe('FY24 new hire')
   })
   ```
   and delete `'totals the hovered bar and escapes user-text grant labels'` (the grammar escapes — Task 5 of C1 pins that).
4. Add:
   ```ts
   describe('F6', () => {
     it('hatches future columns tone-on-tone and marks Today on the first series', () => {
       const option = vestingChartOption(GOLDEN_VESTS, GOLDEN_GRANTS, QUOTE, { todayIso: TODAY })! as unknown as {
         series: { data: unknown[]; markLine?: { data: { xAxis: string; label: { formatter: string } }[] } }[]
       }
       const future = option.series[1].data[2] as { value: number; itemStyle: { decal: { color: string; rotation: number } }; estimate: boolean }
       expect(future.estimate).toBe(true)
       expect(future.itemStyle.decal).toMatchObject({ symbol: 'rect', color: SURFACE, dashArrayX: [1, 0], dashArrayY: [2, 4] })
       expect(typeof option.series[0].data[0]).toBe('number') // past columns are plain values
       expect(option.series[0].markLine?.data).toEqual([{ xAxis: 'Nov 18, 2026', label: { formatter: 'Today' } }])
       expect(option.series[1].markLine).toBeUndefined()
       // Everything past → no rule to draw.
       const allPast = vestingChartOption([PAST_2024, PAST_2025], [NEW_HIRE], QUOTE, { todayIso: TODAY })! as unknown as { series: { markLine?: unknown }[] }
       expect(allPast.series[0].markLine).toBeUndefined()
     })
     it('vestingTotals: vested at stored closes, unvested at the quote (null without one)', () => {
       expect(vestingTotals(GOLDEN_VESTS, QUOTE)).toEqual({ vested: 14446.63, unvested: 11544.8 })
       expect(vestingTotals(GOLDEN_VESTS, null)).toEqual({ vested: 14446.63, unvested: null })
     })
     it('vestingCsv lists every tranche with its value and whether it is an estimate', () => {
       const csv = vestingCsv(GOLDEN_VESTS, GOLDEN_GRANTS, QUOTE)
       expect(csv.headers).toEqual(['Vest date', 'Grant', 'Shares', 'Value', 'Estimate'])
       expect(csv.rows[0]).toEqual(['2024-11-20', 'FY24 new hire', 100, '11207.50', 'no'])
       expect(csv.rows[3]).toEqual(['2026-11-18', 'FY26 refresh', 38, '6963.53', 'yes'])
       expect(vestingCsv(GOLDEN_VESTS, GOLDEN_GRANTS, null).rows[3][3]).toBe('')
     })
     it('feeds the panel’s legend picks back in and staggers the stack', () => {
       const option = vestingChartOption(GOLDEN_VESTS, GOLDEN_GRANTS, QUOTE, { todayIso: TODAY, selected: { 'FY26 refresh': false } })! as unknown as {
         legend: { selected: unknown }; series: { animationDelay: () => number }[]
       }
       expect(option.legend.selected).toEqual({ 'FY26 refresh': false })
       expect(option.series[1].animationDelay()).toBe(12)
     })
   })
   ```
   Imports: `tooltipRows`, `vestingTotals`, `vestingCsv`.

Run: `npx vitest run src/components/comp/vestingChartOptions.test.ts`
Expected: FAIL — no options argument; exports missing.

- [ ] **Step 2: Rewrite the builder**

```ts
import { BAR_MARKS, grid, moneyAxis, monthAxis, roundTo, stagger } from '../../charts/grammar'
import { legendFor } from '../../charts/legend'
import { annotationRules, todayRule } from '../../charts/markLine'
import { axisTooltip } from '../../charts/tooltip'
import type { ExportTable } from '../../utils/download'

/** Tone-on-tone hatching for bars valued at today's quote rather than a stored close (F6):
 *  45° lines in the card surface over the grant's own colour — a token hex, so the light
 *  recolor and the conformance colour rule both hold. */
export const ESTIMATE_HATCH = {
  symbol: 'rect' as const,
  symbolSize: 1,
  dashArrayX: [1, 0],
  dashArrayY: [2, 4],
  rotation: -Math.PI / 4,
  color: SURFACE,
}

/** The strip's two figures: past tranches at their stored closes, future ones at the quote. */
export function vestingTotals(vests: VestOut[], latestPrice: string | null): { vested: number; unvested: number | null } {
  const vested = roundTo(vests.filter((v) => v.is_past && v.value !== null).reduce((s, v) => s + Number(v.value), 0), 2)
  const futureShares = vests.filter((v) => !v.is_past).reduce((s, v) => s + v.shares, 0)
  return { vested, unvested: latestPrice === null ? null : roundTo(futureShares * Number(latestPrice), 2) }
}

export function vestingChartOption(
  vests: VestOut[],
  grants: RsuGrantOut[],
  latestPrice: string | null,
  { todayIso, selected }: { todayIso: string; selected?: Record<string, boolean> },
): EChartsOption | null {
  // … unchanged through `rows` and `names` (slot folding, drawable filter, the empty-looking guard,
  // the date columns, the zero-filled rows) …
  const futureDates = new Set(drawable.filter(({ vest }) => !vest.is_past).map(({ vest }) => vest.vest_date))
  const today = annotationRules([todayRule(dates, todayIso, formatDate)])
  return {
    grid: grid(),
    legend: legendFor(slotCount, selected),
    tooltip: axisTooltip({
      unit: 'money',
      groups: names,
      pointer: 'shadow',
      // A future column's rows are estimates at today's quote; the item carries the flag.
      rowSuffix: (p) => ((p.data as { estimate?: boolean } | number | undefined) as { estimate?: boolean })?.estimate ? '(est.)' : null,
    }),
    xAxis: monthAxis(dates.map((date) => formatDate(date)), { gap: true }),
    yAxis: moneyAxis(),
    series: rows.map((data, slot) => ({
      name: names[slot],
      type: 'bar' as const,
      stack: 'vest',
      ...BAR_MARKS,
      ...stagger(slot),
      color: folded && slot === MAX_GRANT_SLOTS ? OTHER_SERIES_COLOR : PALETTE[slot],
      // The Today rule rides the first series only — one rule, not one per grant.
      ...(slot === 0 && today ? { markLine: today } : {}),
      data: data.map((value, c) =>
        futureDates.has(dates[c])
          ? { value: roundTo(value, 2), itemStyle: { decal: ESTIMATE_HATCH }, estimate: true }
          : roundTo(value, 2),
      ),
    })),
  }
}

/** Every drawable tranche (F12): past at its stored value, future at the quote, flagged. */
export function vestingCsv(vests: VestOut[], grants: RsuGrantOut[], latestPrice: string | null): ExportTable {
  const known = new Set(grants.map((g) => g.id))
  return {
    headers: ['Vest date', 'Grant', 'Shares', 'Value', 'Estimate'],
    rows: vests
      .filter((v) => known.has(v.grant_id))
      .map((v) => [
        v.vest_date,
        v.label,
        v.shares,
        v.is_past ? (v.value ?? '') : latestPrice === null ? '' : roundTo(v.shares * Number(latestPrice), 2).toFixed(2),
        v.is_past ? 'no' : 'yes',
      ]),
  }
}
```

Delete the private `roundTo` and `AxisTooltipParam`; leave `vestingTooltipFormatter` exported (unused; its remaining test cases still pass or are deleted per step 1).

- [ ] **Step 3: Add the fixture**

```ts
// src/charts/fixtures/vestingCalendar.fixture.ts
import type { ChartFixture } from './_types'
import { vestingChartOption } from '../../components/comp/vestingChartOptions'

const grant = (id: number, label: string) => ({ id, label, kind: 'refresh' as const, focal_year: null, shares: 100, grant_price: '129.5651', first_vest_date: '2024-11-20', cliff_pct: '0.0625', vest_quantum: 1, notes: null, vest_count: 16, vested_shares: 0, unvested_shares: 100 })
const fixture: ChartFixture = {
  name: 'vestingCalendar',
  kind: 'cartesian',
  ariaLabel: 'Stacked bar chart of vest value per vest date by grant, future dates at today’s quote',
  build: () =>
    vestingChartOption(
      [
        { vest_date: '2024-11-20', grant_id: 1, label: 'FY24 new hire', shares: 100, fmv: '112.0750', value: '11207.50', is_past: true },
        { vest_date: '2026-11-18', grant_id: 1, label: 'FY24 new hire', shares: 25, fmv: null, value: null, is_past: false },
        { vest_date: '2026-11-18', grant_id: 2, label: 'FY26 refresh', shares: 38, fmv: null, value: null, is_past: false },
      ],
      [grant(1, 'FY24 new hire'), grant(2, 'FY26 refresh')],
      '183.2508',
      { todayIso: '2026-09-03' },
    ),
}
export default fixture
```

Run: `npx vitest run src/components/comp/vestingChartOptions.test.ts src/charts/conformance.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/comp/vestingChartOptions.ts src/components/comp/vestingChartOptions.test.ts src/charts/fixtures/vestingCalendar.fixture.ts
git commit -m "feat(comp): vesting calendar — Today rule, hatched estimates with (est.) rows, totals strip figures, CSV, grammar tooltip (F6, F7, F12, §9, §11)"
```

---

### Task 5: The TC trajectory on the grammar

**Files:**
- Modify: `src/components/comp/compChartOptions.ts`, `src/components/comp/compChartOptions.test.ts`
- Create: `src/charts/fixtures/tcTrajectory.fixture.ts`

Named changes: F13 (`barMaxWidth` 46 → 24), F7 (`axisTooltip` with the two stack members as groups and NO Total row — the INK line IS the total; `shadow` pointer), §9 (`BAR_MARKS` focus, `legendFor(selected)`), §11 (`stagger`), §8 (`monthAxis` labels every year at ≤ 12), F12 (`tcTrajectoryCsv`). The line keeps its symbols (`symbolSize: 6`, no `symbol: 'none'`), so it spreads `FOCUS` rather than `LINE`.

- [ ] **Step 1: Update the tests**

In `compChartOptions.test.ts`: replace `'formats both units as money'` (the `valueFormatterOf` helper goes) with:

```ts
import { tooltipRows } from '../../testing/tooltipRows'
import { GRID_VARIANTS } from '../../charts/grammar'
import { tcTrajectoryCsv } from './compChartOptions'

  it('F7: base and equity by value, NO Total row (the line is the total), then the line; shadow pointer', () => {
    const option = tcTrajectoryOption(GOLDEN_EVENTS) as unknown as { tooltip: { axisPointer: unknown; formatter: (p: unknown) => string } }
    expect(option.tooltip.axisPointer).toEqual({ type: 'shadow' })
    const parsed = tooltipRows(option.tooltip.formatter([
      { seriesName: 'Base', seriesType: 'bar', axisValueLabel: '2026', value: 188930, color: PALETTE[0] },
      { seriesName: 'Equity value (incl. refresh)', seriesType: 'bar', value: 412924.46, color: PALETTE[1] },
      { seriesName: 'Total comp', seriesType: 'line', value: 601854.46, color: INK },
    ]))
    expect(parsed.rows.map((r) => [r.kind, r.label, r.value])).toEqual([
      ['row', 'Equity value (incl. refresh)', '$412,924.46'],
      ['row', 'Base', '$188,930.00'],
      ['row', 'Total comp', '$601,854.46'],
    ])
    expect(moneyAxisLabelOf(option as never)(411078)).toBe('$411.1K')
  })
  it('grammar: money grid, 24px staggered stacks with focus, page legend picks', () => {
    const option = tcTrajectoryOption(GOLDEN_EVENTS, { selected: { Base: false } }) as unknown as {
      grid: unknown; legend: { selected: unknown }
      series: { barMaxWidth?: number; emphasis?: unknown; animationDelay?: () => number }[]
    }
    expect(option.grid).toEqual(GRID_VARIANTS.default)
    expect(option.legend.selected).toEqual({ Base: false })
    expect(option.series[0].barMaxWidth).toBe(24) // F13, was 46
    expect(option.series[1].animationDelay?.()).toBe(12)
    expect(option.series[2].emphasis).toEqual({ focus: 'series' })
  })
  it('exports year × base / equity / total', () => {
    expect(tcTrajectoryCsv(GOLDEN_EVENTS)).toEqual({
      headers: ['Focal year', 'Base', 'Equity value (incl. refresh)', 'Total comp'],
      rows: [
        [2024, '151000.00', '260078.00', '411078.00'],
        [2025, '162000.00', '343878.28', '505878.28'],
        [2026, '188930.00', '412924.46', '601854.46'],
        [2027, '188930.00', '0.00', '188930.00'],
      ],
    })
  })
```

Run: `npx vitest run src/components/comp/compChartOptions.test.ts`
Expected: FAIL.

- [ ] **Step 2: Rewrite the builder**

```ts
import { BAR_MARKS, grid, moneyAxis, monthAxis, roundTo, stagger } from '../../charts/grammar'
import { FOCUS, legendFor } from '../../charts/legend'
import { axisTooltip } from '../../charts/tooltip'
import type { ExportTable } from '../../utils/download'

/** The chart's rows — one computation for the option and the CSV. */
function trajectoryRows(events: CompEventOut[]) {
  const ordered = [...events].sort((a, b) => a.focal_year - b.focal_year)
  return ordered.map((e) => {
    const base = Number(e.new_base ?? e.current_base)
    const total = Number(e.tc_after)
    return { year: e.focal_year, base, total, equity: roundTo(total - base, 2) }
  })
}

export function tcTrajectoryOption(events: CompEventOut[], { selected }: { selected?: Record<string, boolean> } = {}): EChartsOption | null {
  if (events.length === 0) return null
  const rows = trajectoryRows(events)
  const stack = (name: string, index: number, data: number[]) => ({
    name, type: 'bar' as const, stack: 'tc', ...BAR_MARKS, barMaxWidth: 24, ...stagger(index), color: TC_COLORS[index], data,
  })
  return {
    grid: grid(),
    legend: legendFor(3, selected),
    // The two segments sum to the line, so a Total row would print the line twice.
    tooltip: axisTooltip({ unit: 'money', groups: [TC_LABELS[0], TC_LABELS[1]], totalLabel: false, pointer: 'shadow' }),
    xAxis: monthAxis(rows.map((r) => String(r.year)), { gap: true }),
    yAxis: moneyAxis(),
    series: [
      stack(TC_LABELS[0], 0, rows.map((r) => r.base)),
      stack(TC_LABELS[1], 1, rows.map((r) => r.equity)),
      {
        name: TC_LABELS[2],
        type: 'line',
        color: INK,
        symbolSize: 6,
        lineStyle: { width: 2 },
        z: 10,
        ...FOCUS,
        connectNulls: false,
        data: rows.map((r) => r.total),
      },
    ],
  }
}

export function tcTrajectoryCsv(events: CompEventOut[]): ExportTable {
  return {
    headers: ['Focal year', ...TC_LABELS],
    rows: trajectoryRows(events).map((r) => [r.year, r.base.toFixed(2), r.equity.toFixed(2), r.total.toFixed(2)]),
  }
}
```

Delete the private `roundTo`; `SURFACE`, `formatCurrency`, `formatCurrencyCompact` become unused — remove.

- [ ] **Step 3: Add the fixture**

```ts
// src/charts/fixtures/tcTrajectory.fixture.ts
import type { ChartFixture } from './_types'
import { tcTrajectoryOption } from '../../components/comp/compChartOptions'

const event = (id: number, focal_year: number, current_base: string, new_base: string | null, tc_after: string) => ({
  id, focal_year, current_base, new_base, unvested_rsus: null, unvested_price: null, refresh_rsus: null, grant_price: null, notes: null,
  base_delta: null, base_delta_pct: null, unvested_equity: null, equity_delta: null, equity_delta_pct: null, tc_before: current_base, tc_after,
})
const fixture: ChartFixture = {
  name: 'tcTrajectory',
  kind: 'cartesian',
  ariaLabel: 'Stacked bar chart of base salary and unvested equity value per focal year, with total comp as a line',
  build: () => tcTrajectoryOption([event(1, 2025, '151000.00', '162000.00', '505878.28'), event(2, 2026, '162000.00', '188930.00', '601854.46')]),
}
export default fixture
```

Run: `npx vitest run src/components/comp/compChartOptions.test.ts src/charts/conformance.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/comp/compChartOptions.ts src/components/comp/compChartOptions.test.ts src/charts/fixtures/tcTrajectory.fixture.ts
git commit -m "feat(comp): TC trajectory on the grammar — 24px staggered stacks, grammar tooltip without a duplicate total, persisted legend, CSV (F13, F7, F9, F12, §11)"
```

---

### Task 6: VestingSchedulePanel and CompPage onto `ChartCard`

**Files:**
- Modify: `src/components/comp/VestingSchedulePanel.tsx`, `src/pages/CompPage.tsx`, `src/pages/CompPage.test.tsx`

F6 (the strip "Vested $X · Unvested $Y (est.)", the "Hatched = at today's quote" footnote, entrance gated by the frame, aria + CSV), F9 (both legends persisted), F11/F12 on both mounts. The vesting card stays ONE card: the quote line, the totals strip, the warnings, the instruction paragraph and the schedule table ride the `ChartCard` footer.

- [ ] **Step 1: Extend the page test**

```ts
  it('mounts the TC trajectory and the vesting calendar through ChartCard', async () => {
    renderPage()
    await screen.findByText(TC_CHART_LABEL)
    expect(screen.getByLabelText(/Stacked bar chart of base salary and unvested equity value/)).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Export total-comp' })).toBeTruthy()
    expect(screen.getByLabelText(/Stacked bar chart of vest value per vest date/)).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Export vesting-calendar' })).toBeTruthy()
    expect(screen.getByText(/Vested \$[\d,.]+ · Unvested \$[\d,.]+ \(est\.\)/)).toBeTruthy()
    expect(screen.getByText('Hatched = at today’s quote')).toBeTruthy()
  })
```

(`getByTestId('echart')` cases that assumed ONE chart on the page: with a schedule fixture that has grants there are now two — change those to `getAllByTestId('echart')[0]` for the TC chart.)

Run: `npx vitest run src/pages/CompPage.test.tsx`
Expected: FAIL.

- [ ] **Step 2: `VestingSchedulePanel`**

Imports: `ChartCard from '../ChartCard'`, `{ todayIso } from '../../utils/months'`, `{ vestingChartOption, vestingCsv, vestingTotals }`; drop `EChart`. State + memo:

```ts
  const [legend, setLegend] = useState<Record<string, boolean>>({})
  const calendar = useMemo(
    () => vestingChartOption(schedule.vests, schedule.grants, schedule.latest_price, { todayIso: todayIso(), selected: legend }),
    [schedule, legend],
  )
  const totals = vestingTotals(schedule.vests, latestPrice)
```

The section becomes:

```tsx
    <ChartCard
      title="Vesting schedule"
      hint={`Every vest from your grants — quarterly on the 3rd Wednesday. Past dates at their own close, future dates at ${quoteSource} (hatched, marked est.); the dashed rule is today.`}
      ariaLabel="Stacked bar chart of vest value per vest date by grant, future dates at today’s quote"
      option={schedule.grants.length === 0 ? null : calendar}
      empty={schedule.grants.length === 0 ? 'No grants yet — add one above to see the schedule.' : 'Nothing priced to draw yet — see the notes below.'}
      exportName="vesting-calendar"
      csv={() => vestingCsv(schedule.vests, schedule.grants, latestPrice)}
      height={260}
      onLegendChange={(selected) => setLegend((current) => ({ ...current, ...selected }))}
      footer={
        <>
          {/* the unchanged quote line: no ticker / no quote / ticker · price · as of */}
          {schedule.grants.length > 0 && (
            <p className="drill-hint">
              Vested {formatCurrency(totals.vested)} · Unvested {totals.unvested === null ? '—' : formatCurrency(totals.unvested)} (est.)
              {' · '}Hatched = at today’s quote
            </p>
          )}
          {warningNotes}
          {schedule.grants.length > 0 && (
            <>
              <p className="drill-hint">{/* the unchanged "One row per vest date…" sentence */}</p>
              <div className="vest-scroll">{/* the unchanged table */}</div>
            </>
          )}
        </>
      }
    />
```

(`Hatched = at today’s quote` must be its own text node for the test's exact match — render it as `<span>Hatched = at today’s quote</span>` after the ` · ` separator.)

- [ ] **Step 3: `CompPage`**

State `const [tcLegend, setTcLegend] = useState<Record<string, boolean>>({})`; memo `const trajectory = useMemo(() => (events === null ? null : tcTrajectoryOption(events, { selected: tcLegend })), [events, tcLegend])`. The `<div className="loading-dim…"><section className="card">…</section></div>` block becomes:

```tsx
        <ChartCard
          title={TC_CHART_LABEL}
          hint="Base salary stacked under the value of unvested equity, including the year's refresh — this app's total-comp proxy; the line is the server's own total."
          ariaLabel="Stacked bar chart of base salary and unvested equity value per focal year, with total comp as a line"
          option={trajectory}
          empty="No comp events yet — add one above."
          exportName="total-comp"
          csv={events === null ? undefined : () => tcTrajectoryCsv(events)}
          height={320}
          // Dimmed by the SAME flag as the table above: both are drawn from one payload.
          busy={busy || events === null}
          onLegendChange={(selected) => setTcLegend((current) => ({ ...current, ...selected }))}
          footer={
            <p className="drill-hint">
              Total comp as this app defines it: the base the year landed on, stacked under the value of the unvested equity behind it
              (the sheet has no TC column — this is the proxy, and the line is the server&apos;s own total).
            </p>
          }
        />
```

Import `ChartCard`, `tcTrajectoryCsv`; drop `EChart` and the now-unused `InfoHint` if nothing else uses it.

Run: `npx vitest run src/pages/CompPage.test.tsx src/components/comp && npx tsc -b && npx eslint src/pages/CompPage.tsx src/components/comp`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/comp/VestingSchedulePanel.tsx src/pages/CompPage.tsx src/pages/CompPage.test.tsx
git commit -m "feat(comp): vesting calendar and TC trajectory on ChartCard — totals strip, hatched footnote, persisted legends, export + Table (F6, F9, F11, F12)"
```

---

### Task 7: Real-echarts probe before merge — decals, `markArea`, `markPoint`

**Files:**
- Create: `scratchpad/charts-c5-probe/probe.html`, `scratchpad/charts-c5-probe/shoot.mjs` (outside `src/`)

Spec §17/§20: the three new forms this lane draws (per-item `itemStyle.decal`, a `markArea` wash, `markPoint` circles with labels) must be seen on a real canvas before the merge. Copy `scratchpad/paycheck-sankey-probe/probe.html`'s shell and draw panels **A** (decals + the Today rule) and **B** (After-FI area + percentile marks on a dashed target) exactly as C7's probe page spells them out (`docs/superpowers/plans/2026-09-04-charts-c7-verify.md`, Task 5 — the option literals there are the ones this lane's builders emit; copy them verbatim). `shoot.mjs` is C7's too. Run `node scratchpad/charts-c5-probe/shoot.mjs` and open the PNG.

- [ ] **Step 1: Judge panel A**

Accept when the two future segments show diagonal hatching in the card colour over their grant colours, the past segments are solid, and the `Today` rule stands at the future column with its label inside the top edge. If nothing hatches: `AriaComponent` is not registered in `src/charts/echarts.ts` (C1 Task 10) — per-item decals need it even with `aria.enabled` off; check the import list and re-run. If the hatch is invisible on the dark surface, raise the decal's `dashArrayY` gap (`[2, 4]` → `[2, 6]`) in `ESTIMATE_HATCH` and update the Task 4 pin.

- [ ] **Step 2: Judge panel B**

Accept when the shaded region starts at `M13` with "After FI" inside its top edge, the `FI` and `Coast FI` rules carry their labels without overlapping the retirement label at the same month, and both circles sit ON the dashed target line labelled `p10` / `p50`. If a `markPoint` label overlaps its rule label, set `percentileMarks`' label `position` to `'bottom'` — that is a `src/charts/markLine.ts` change (C1's file): make it in this lane, note it for C7, and update `markLine.test.ts`'s pin.

- [ ] **Step 3: Commit the probe**

```bash
git add scratchpad/charts-c5-probe
git commit -m "chore(comp,projection): real-echarts probe of decal hatching, markArea and markPoint (spec §17)"
```

---

### Task 8: Verify

- [ ] Run `npx tsc -b && npx eslint . && npx vitest run` from the worktree root. Expected: green. `npx vitest run src/charts/conformance.test.ts` lists passing cases for `projectionFan`, `projectionLog`, `netWorthProjection`, `vestingCalendar`, `tcTrajectory`.
- [ ] `grep -rn "<EChart" src/pages/ProjectionPage.tsx src/pages/CompPage.tsx src/components/comp src/components/projection` → no output; `grep -rn "barMaxWidth: 46" src` → no output.
- [ ] Commit anything the runs touched; the lane is ready to merge.

---

## Self-review

**Spec coverage:** F3 (memoized builders, persisted legends ×2, FI + Coast FI rules, post-FI area, p10/p50/p90 marks, `Median path`, `Linear · Log`, shared band name) → Tasks 1, 3. F6 (`todayRule`, hatched futures with "(est.)", the strip, frame-gated entrance, aria + CSV, the footnote) → Tasks 4, 6. F13 (`barMaxWidth` 46 → 24 on the comp stack) → Task 5. F7 on all four builders → Tasks 1, 2, 4, 5. F9 (Projection ×2, TC, vesting legends persisted — the four the spec names) → Tasks 1–6. F11 (vesting, TC trajectory named; both projection charts already were) → Tasks 3, 6. F12 (CSV added for TC and vesting; the trend chart gains one too) → Tasks 2, 4, 5, 6. §8 log only on unwashed forms → Task 1 drops the wash under Log. §17 probe → Task 7. `projectionTooltipFormatter`, `BAND_MARKER`, `vestingTooltipFormatter`, `.projection-chart-header`/`.projection-chart-card` stay in place unused — C7. **Placeholders:** the marked "unchanged" regions (the vesting builder's slot/row derivation, the quote line, the schedule table, the projection page's other cards) are code already in the files; every new element is written out. **Type consistency:** `projectionOption(data, { log, selected })`, `MEDIAN_SERIES`, `retirementEntries`, `netWorthProjectionOption(history, fit, start, years, { selected })`, `netWorthProjectionCsv`, `vestingChartOption(vests, grants, latestPrice, { todayIso, selected })`, `ESTIMATE_HATCH`, `vestingTotals`, `vestingCsv`, `tcTrajectoryOption(events, { selected })`, `tcTrajectoryCsv` match between builder, test, fixture and mount tasks; C1 names (`grid`, `moneyAxis`, `monthAxis`, `LINE`, `WASH`, `BAR_MARKS`, `capLabel`, `stagger`, `roundTo`, `legendFor`, `FOCUS`, `referenceLine`, `annotationRules`, `arrivalRule`, `todayRule`, `ruleAt`, `afterArea`, `percentileMarks`, `axisTooltip`, `swatch`, `ChartCard`, `Segmented`, `tooltipRows`) match C1's definitions.

