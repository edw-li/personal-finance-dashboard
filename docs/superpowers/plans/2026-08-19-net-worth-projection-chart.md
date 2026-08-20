# Net Worth over Time (Projected) Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the finances.xlsx "Net Worth over Time (Projected)" chart — actual monthly net-worth dots plus an exponential best-fit trendline extended to the page's horizon — onto `/projection`, directly above the "Projected investable balance" card.

**Architecture:** Frontend-only, three units. (1) A pure fit module `expTrend.ts` does Excel's `exp` trendline math (least squares on `(month-serial, ln y)`). (2) A pure option builder `netWorthProjectionOption` joins the existing `projectionChartOptions.ts`. (3) `ProjectionPage` gains a mount-only `fetchTimeseries()` call and the new card. No backend changes, no new endpoints, no CSS changes, no new echarts registrations.

**Tech Stack:** React 19 + TypeScript, ECharts 6 (tree-shaken via `src/charts/echarts.ts`), Vitest + Testing Library (jsdom), ESLint 9.

**Spec:** `docs/superpowers/specs/2026-08-19-net-worth-projection-chart-design.md` — read it first; it pins every behavioral decision (user-approved).

**Working tree:** main-tree execution is fine — frontend-only, tree is clean. All commands run from the repo root `C:\Users\edyli\personal-finance-dashboard`.

**House rules that bind this plan:**
- Server Decimal strings are parsed with `Number()` for DISPLAY ONLY — never handed back to the API.
- Never `new Date(iso)` on date-only strings (UTC-shift rule) — all month math is string/serial based.
- Charts: no hues outside `src/charts/theme.ts`; dashed lines are reserved for thresholds; echarts is NEVER rendered in jsdom (the page test mocks `EChart`).
- Never copy real workbook dollar values into fixtures — synthetic values only.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/components/projection/expTrend.ts` | Create | Pure exponential-fit math (`monthSerial`, `fitExpTrend`, `ExpTrendFit`) |
| `src/components/projection/expTrend.test.ts` | Create | Fit-math unit tests |
| `src/components/projection/projectionChartOptions.ts` | Modify | Add `NET_WORTH_PROJECTION_SERIES` + `netWorthProjectionOption` builder |
| `src/components/projection/projectionChartOptions.test.ts` | Modify | Add builder tests (new `describe` block) |
| `src/pages/ProjectionPage.tsx` | Modify | History fetch/state, fit derivation, new card above the investable chart |
| `src/pages/ProjectionPage.test.tsx` | Modify | Mock `../api/netWorth`, timeseries fixture, new card tests, two-chart assertion |

---

### Task 1: The fit module — `expTrend.ts`

**Files:**
- Create: `src/components/projection/expTrend.ts`
- Test: `src/components/projection/expTrend.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/components/projection/expTrend.test.ts` with exactly:

```ts
import { describe, expect, it } from 'vitest'
import { fitExpTrend, monthSerial } from './expTrend'

// A perfect geometric series: value = 1000 · 1.01^i at consecutive months. The fit must
// recover the generator (up to float dust) — that is the module's whole contract.
const MONTHS = [
  '2025-01-01',
  '2025-02-01',
  '2025-03-01',
  '2025-04-01',
  '2025-05-01',
  '2025-06-01',
]
const VALUES = MONTHS.map((_, i) => (1000 * 1.01 ** i).toFixed(2))

describe('monthSerial', () => {
  it('counts calendar months, year boundaries included', () => {
    expect(monthSerial('2026-01-01') - monthSerial('2025-12-01')).toBe(1)
    expect(monthSerial('2026-08-01') - monthSerial('2025-08-01')).toBe(12)
  })
})

describe('fitExpTrend', () => {
  it('recovers the monthly growth of a perfect geometric series', () => {
    const fit = fitExpTrend(MONTHS, VALUES)
    expect(fit).not.toBeNull()
    expect(fit!.monthlyGrowth).toBeCloseTo(1.01, 4)
    expect(fit!.annualRate).toBeCloseTo(1.01 ** 12 - 1, 4)
  })

  it('is gap-proof: a missing month cannot compress time', () => {
    // The same generator with March deleted — serial-x fitting still reads 1%/mo;
    // an index-x fit would report a faster rate.
    const gapMonths = ['2025-01-01', '2025-02-01', '2025-04-01', '2025-05-01']
    const gapValues = [0, 1, 3, 4].map((i) => (1000 * 1.01 ** i).toFixed(2))
    const fit = fitExpTrend(gapMonths, gapValues)
    expect(fit).not.toBeNull()
    expect(fit!.monthlyGrowth).toBeCloseTo(1.01, 4)
  })

  it('valueAt reproduces the series and extends past it', () => {
    const fit = fitExpTrend(MONTHS, VALUES)!
    expect(fit.valueAt('2025-01-01')).toBeCloseTo(1000, 1)
    expect(fit.valueAt('2025-06-01')).toBeCloseTo(1000 * 1.01 ** 5, 1)
    // Six months past the last point: the extension is the same law, further out.
    expect(fit.valueAt('2025-12-01')).toBeCloseTo(1000 * 1.01 ** 11, 1)
  })

  it('refuses under two points', () => {
    expect(fitExpTrend(['2025-01-01'], ['1000.00'])).toBeNull()
    expect(fitExpTrend([], [])).toBeNull()
  })

  it('refuses nonpositive values — ln is undefined there (the sheet refuses too)', () => {
    expect(fitExpTrend(MONTHS.slice(0, 2), ['0.00', '1000.00'])).toBeNull()
    expect(fitExpTrend(MONTHS.slice(0, 2), ['-5.00', '1000.00'])).toBeNull()
  })

  it('refuses mismatched or degenerate input', () => {
    expect(fitExpTrend(MONTHS.slice(0, 3), ['1000.00', '1010.00'])).toBeNull()
    expect(fitExpTrend(['2025-01-01', '2025-01-01'], ['1000.00', '1010.00'])).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/projection/expTrend.test.ts`
Expected: FAIL — `Cannot find module './expTrend'` (or equivalent resolve error).

- [ ] **Step 3: Write the implementation**

Create `src/components/projection/expTrend.ts` with exactly:

```ts
// The sheet's "Net Worth over Time (Projected)" model: Excel's `exp` trendline is least
// squares on (x, ln y), i.e. y = e^(a + b·x). Pure float math over the timeseries'
// Decimal strings — display-only (format.ts's Number() rule), never handed back to the
// API. The attention.ts/ytd.ts posture: page-adjacent pure logic, no React, no fetching.

/**
 * Calendar month serial (year·12 + month−1) from an ISO month string — the fit's x.
 * NOT an array index: a skipped snapshot month must not compress time and skew the rate
 * (Excel fits on true dates; serials are the monthly-data equivalent). Same index
 * formula utils/months.ts::addMonths steps by.
 */
export function monthSerial(iso: string): number {
  const [year, month] = iso.split('-').map(Number)
  return year * 12 + (month - 1)
}

export interface ExpTrendFit {
  /** e^b — the fitted month-over-month growth factor. */
  monthlyGrowth: number
  /** monthlyGrowth^12 − 1, fraction form — feeds formatPct directly. */
  annualRate: number
  /** Fitted value at any ISO month: e^(a + b·serial). */
  valueAt(monthIso: string): number
}

/**
 * Null is a refusal, not an error: under two points there is no trend; a nonpositive or
 * non-finite value has no logarithm (Excel refuses exp trendlines on such data too); and
 * zero x-variance (duplicate months — impossible from the server, guarded for totality)
 * has no slope. The page draws the dots without the curve and says why.
 */
export function fitExpTrend(months: string[], values: string[]): ExpTrendFit | null {
  if (months.length < 2 || months.length !== values.length) return null
  const ys = values.map(Number)
  if (ys.some((y) => !Number.isFinite(y) || y <= 0)) return null
  const xs = months.map(monthSerial)
  const zs = ys.map(Math.log)
  const n = xs.length
  const xMean = xs.reduce((sum, x) => sum + x, 0) / n
  const zMean = zs.reduce((sum, z) => sum + z, 0) / n
  let sxx = 0
  let sxz = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - xMean
    sxx += dx * dx
    sxz += dx * (zs[i] - zMean)
  }
  if (sxx === 0) return null
  const b = sxz / sxx
  const a = zMean - b * xMean
  const monthlyGrowth = Math.exp(b)
  return {
    monthlyGrowth,
    annualRate: monthlyGrowth ** 12 - 1,
    valueAt: (monthIso) => Math.exp(a + b * monthSerial(monthIso)),
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/projection/expTrend.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/projection/expTrend.ts src/components/projection/expTrend.test.ts
git commit -m "feat: exponential trend fit for the net-worth projection"
```

---

### Task 2: The chart builder — `netWorthProjectionOption`

**Files:**
- Modify: `src/components/projection/projectionChartOptions.ts` (imports at top; new exports appended after `projectionOption`)
- Test: `src/components/projection/projectionChartOptions.test.ts` (imports; new `describe` appended)

- [ ] **Step 1: Write the failing tests**

In `src/components/projection/projectionChartOptions.test.ts`, replace the existing import line

```ts
import { PROJECTION_SERIES, projectionOption } from './projectionChartOptions'
```

with

```ts
import type { ExpTrendFit } from './expTrend'
import {
  NET_WORTH_PROJECTION_SERIES,
  netWorthProjectionOption,
  PROJECTION_SERIES,
  projectionOption,
} from './projectionChartOptions'
```

Then append this block at the end of the file (after the existing `describe`):

```ts
const HISTORY = {
  months: ['2026-06-01', '2026-07-01', '2026-08-01'],
  net_worth: ['100000.00', '101000.00', '102010.00'],
}

// A hand-made fit — the builder only ever calls valueAt (the real math is pinned in
// expTrend.test.ts; this keeps the builder test a unit test).
const FIT: ExpTrendFit = {
  monthlyGrowth: 1.01,
  annualRate: 1.01 ** 12 - 1,
  valueAt: (iso) => (iso === '2026-06-01' ? 100000 : 123456),
}

function readNw(option: EChartsOption | null) {
  expect(option).not.toBeNull()
  return option as unknown as {
    dataZoom: { type: string; startValue: number }[]
    legend: { data: { name: string; icon?: string }[] }
    xAxis: { data: string[] }
    series: {
      name: string
      type: string
      color: string
      z: number
      symbolSize?: number
      areaStyle?: unknown
      data: number[]
    }[]
  }
}

describe('netWorthProjectionOption', () => {
  it('returns null under two history points', () => {
    expect(
      netWorthProjectionOption(
        { months: ['2026-08-01'], net_worth: ['1'] },
        FIT,
        '2026-08-01',
        30,
      ),
    ).toBeNull()
  })

  it('extends the axis from the last snapshot to the horizon end', () => {
    // start 2026-08 + 1y horizon ends 2027-08; history ends 2026-08 → 12 future months.
    const option = readNw(netWorthProjectionOption(HISTORY, FIT, '2026-08-01', 1))
    expect(option.xAxis.data).toHaveLength(15)
    expect(option.xAxis.data[0]).toBe('Jun 2026')
    expect(option.xAxis.data[2]).toBe('Aug 2026')
    expect(option.xAxis.data[14]).toBe('Aug 2027')
  })

  it('draws blue dots over the history months only', () => {
    const option = readNw(netWorthProjectionOption(HISTORY, FIT, '2026-08-01', 1))
    const dots = option.series[0]
    expect(dots.name).toBe(NET_WORTH_PROJECTION_SERIES[0])
    expect(dots.type).toBe('scatter')
    expect(dots.color).toBe(PALETTE[0])
    expect(dots.symbolSize).toBe(6)
    // Unpadded: on a category axis the shorter series simply ends where history does.
    expect(dots.data).toEqual([100000, 101000, 102010])
  })

  it('draws the trend across the whole axis, orange, washless, under the dots', () => {
    const option = readNw(netWorthProjectionOption(HISTORY, FIT, '2026-08-01', 1))
    const [dots, trend] = option.series
    expect(trend.name).toBe(NET_WORTH_PROJECTION_SERIES[1])
    expect(trend.type).toBe('line')
    expect(trend.color).toBe(PALETTE[1])
    expect(trend.areaStyle).toBeUndefined()
    expect(trend.data).toHaveLength(15)
    expect(trend.data[0]).toBe(100000) // FIT.valueAt('2026-06-01')
    expect(trend.data[14]).toBe(123456)
    expect(dots.z).toBeGreaterThan(trend.z)
  })

  it('omits the trend when the fit was refused, keeping the dots', () => {
    const option = readNw(netWorthProjectionOption(HISTORY, null, '2026-08-01', 1))
    expect(option.series.map((s) => s.name)).toEqual([NET_WORTH_PROJECTION_SERIES[0]])
  })

  it('yields no continuation when a snapshot already sits at the horizon end', () => {
    // A future-dated snapshot at/past startMonth+years·12 — the axis is history verbatim.
    const history = { months: ['2026-08-01', '2027-08-01'], net_worth: ['1000.00', '2000.00'] }
    const option = readNw(netWorthProjectionOption(history, FIT, '2026-08-01', 1))
    expect(option.xAxis.data).toEqual(['Aug 2026', 'Aug 2027'])
  })

  it('tells the legend swatches apart and opens the inside zoom on everything', () => {
    const option = readNw(netWorthProjectionOption(HISTORY, FIT, '2026-08-01', 1))
    expect(option.legend.data[0]).toEqual({ name: NET_WORTH_PROJECTION_SERIES[0], icon: 'circle' })
    expect(option.legend.data[1]).toEqual({ name: NET_WORTH_PROJECTION_SERIES[1] })
    expect(option.dataZoom[0].type).toBe('inside')
    expect(option.dataZoom[0].startValue).toBe(0)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/projection/projectionChartOptions.test.ts`
Expected: FAIL — `netWorthProjectionOption`/`NET_WORTH_PROJECTION_SERIES` are not exported. The four pre-existing `projectionOption` tests must still PASS.

- [ ] **Step 3: Write the implementation**

In `src/components/projection/projectionChartOptions.ts`, replace the import block at the top

```ts
import type { EChartsOption } from '../../charts/echarts'
import { MUTED, PALETTE } from '../../charts/theme'
import { timeZoom } from '../../charts/timeZoom'
import type { ProjectionOut } from '../../types/api'
import { formatCurrency, formatCurrencyCompact, formatMonth } from '../../utils/format'
```

with

```ts
import type { EChartsOption } from '../../charts/echarts'
import { MUTED, PALETTE } from '../../charts/theme'
import { timeZoom } from '../../charts/timeZoom'
import type { NetWorthTimeseries, ProjectionOut } from '../../types/api'
import { formatCurrency, formatCurrencyCompact, formatMonth } from '../../utils/format'
import { monthSerial } from './expTrend'
import type { ExpTrendFit } from './expTrend'
import { addMonths } from '../../utils/months'
```

then append at the end of the file:

```ts
// Series names in series order — the measured months and the fitted extrapolation.
export const NET_WORTH_PROJECTION_SERIES = ['Net worth', 'Exponential trend'] as const

/**
 * The sheet's "Net Worth over Time (Projected)": actual snapshots as blue dots, the
 * exponential best-fit as a solid orange curve drawn over history AND the future (so
 * fit-vs-dots stays visible, like Excel's trendline), extended to the SAME final month
 * as the investable chart — one horizon per page. No wash: an area under a 30-year
 * exponential swallows the chart. A refused fit (null) drops the curve, never the dots —
 * the page's hint says why. Returns null under two points.
 */
export function netWorthProjectionOption(
  history: Pick<NetWorthTimeseries, 'months' | 'net_worth'>,
  fit: ExpTrendFit | null,
  startMonth: string,
  years: number,
): EChartsOption | null {
  if (history.months.length < 2) return null
  const last = history.months[history.months.length - 1]
  const end = addMonths(startMonth, years * 12)
  // A future-dated snapshot at or past the horizon end just empties the continuation.
  const count = Math.max(0, monthSerial(end) - monthSerial(last))
  const future = Array.from({ length: count }, (_, i) => addMonths(last, i + 1))
  const months = [...history.months, ...future]
  return {
    dataZoom: timeZoom(months, 'all'),
    grid: { left: 76, right: 24, top: 40, bottom: 28 },
    legend: {
      top: 0,
      // The dot series wears a circle swatch so the two entries stay tellable apart.
      data: [
        { name: NET_WORTH_PROJECTION_SERIES[0], icon: 'circle' },
        { name: NET_WORTH_PROJECTION_SERIES[1] },
      ],
    },
    tooltip: {
      trigger: 'axis',
      valueFormatter: (value) =>
        value === null || value === undefined ? '—' : formatCurrency(value as number),
    },
    xAxis: { type: 'category', data: months.map(formatMonth), boundaryGap: false },
    yAxis: {
      // Zero-anchored (the house rule): the dots stand on an honest baseline.
      type: 'value',
      axisLabel: { formatter: (value: number) => formatCurrencyCompact(value) },
    },
    series: [
      {
        name: NET_WORTH_PROJECTION_SERIES[0],
        type: 'scatter',
        symbolSize: 6,
        color: PALETTE[0],
        // Above the curve, so the dots stay visible where it passes through them.
        z: 3,
        data: history.net_worth.map(Number),
      },
      ...(fit === null
        ? []
        : [
            {
              name: NET_WORTH_PROJECTION_SERIES[1],
              type: 'line' as const,
              symbol: 'none' as const,
              lineStyle: { width: 2 },
              color: PALETTE[1],
              z: 2,
              data: months.map((m) => fit.valueAt(m)),
            },
          ]),
    ],
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/projection/projectionChartOptions.test.ts`
Expected: PASS — 11 tests (4 pre-existing + 7 new).

- [ ] **Step 5: Commit**

```bash
git add src/components/projection/projectionChartOptions.ts src/components/projection/projectionChartOptions.test.ts
git commit -m "feat: net worth (projected) chart builder"
```

---

### Task 3: Page wiring — the new card on `/projection`

**Files:**
- Modify: `src/pages/ProjectionPage.tsx`
- Test: `src/pages/ProjectionPage.test.tsx`

- [ ] **Step 1: Write the failing tests**

Four edits to `src/pages/ProjectionPage.test.tsx`.

**(a)** After the existing `vi.mock('../components/EChart', …)` block (which ends with `})` just above `import { fetchProjection } from '../api/projection'`), add the netWorth mock so it sits with the other `vi.mock` calls:

```ts
vi.mock('../api/netWorth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/netWorth')>()),
  fetchTimeseries: vi.fn(),
}))
```

and change the import line below the mocks from

```ts
import { fetchProjection } from '../api/projection'
```

to

```ts
import { fetchTimeseries } from '../api/netWorth'
import { fetchProjection } from '../api/projection'
```

Also extend the type-only import at the top from

```ts
import type { ProjectionOut } from '../types/api'
```

to

```ts
import type { NetWorthTimeseries, ProjectionOut } from '../types/api'
```

**(b)** After the `projectionOut` fixture function, add the timeseries fixture (synthetic values; 1.01 growth exactly, so the fitted rate is deterministic):

```ts
function timeseries(over: Partial<NetWorthTimeseries> = {}): NetWorthTimeseries {
  return {
    months: ['2026-06-01', '2026-07-01', '2026-08-01'],
    accounts: [],
    series: [],
    group_totals: {
      cash: [],
      pre_tax: [],
      post_tax: [],
      taxable: [],
      equity: [],
      other: [],
      liability: [],
    },
    net_worth: ['100000.00', '101000.00', '102010.00'],
    mom_pct: [null, null, null],
    notes: [null, null, null],
    ...over,
  }
}
```

**(c)** Extend the `beforeEach` to seed the new mock:

```ts
beforeEach(() => {
  vi.mocked(fetchProjection).mockResolvedValue(projectionOut())
  vi.mocked(fetchTimeseries).mockResolvedValue(timeseries())
})
```

**(d)** In the first test (`'states the FI figures from the echo and names their derivations'`), replace

```ts
    expect(await screen.findByTestId('echart')).toBeTruthy()
```

with

```ts
    expect(await screen.findAllByTestId('echart')).toHaveLength(2)
```

**(e)** Append these tests inside the `describe('ProjectionPage', …)` block, after the last existing test:

```ts
  it('draws the net-worth history chart above the investable one, hint carrying the fitted rate', async () => {
    renderPage()
    const charts = await screen.findAllByTestId('echart')
    expect(charts).toHaveLength(2)
    // DOM order IS the card order: the net-worth chart's axis starts at the history
    // (Jun 2026); the investable chart's starts at the projection t0 (Aug 2026).
    expect(charts[0].getAttribute('data-categories')).toContain('Jun 2026')
    expect(charts[1].getAttribute('data-categories')?.startsWith('Aug 2026')).toBe(true)
    expect(screen.getByText('Net worth over time (projected)')).toBeTruthy()
    // 1.01^12 − 1 → 12.7% at formatPct's 1dp — the fixture's exact geometric rate.
    expect(screen.getByText(/12\.7%\/yr/)).toBeTruthy()
  })

  it('keeps the page alive when the history fetch alone fails', async () => {
    vi.mocked(fetchTimeseries).mockRejectedValue(new ApiError('history unavailable', 500))
    renderPage()

    expect(await screen.findByText('history unavailable')).toBeTruthy()
    expect(await screen.findByText('$1,500,000.00')).toBeTruthy() // tiles still stand
    expect(screen.getAllByTestId('echart')).toHaveLength(1) // the investable chart
    expect(screen.queryByRole('alert')).toBeNull() // advisory note, not the page banner
  })

  it('does not refetch the history on Recalculate', async () => {
    renderPage()
    await waitFor(() => expect(box(/annual return/i).value).toBe('5'))

    fireEvent.click(screen.getByRole('button', { name: /recalculate/i }))

    await waitFor(() => expect(fetchProjection).toHaveBeenCalledTimes(2))
    expect(fetchTimeseries).toHaveBeenCalledTimes(1)
  })

  it('draws dots alone and says why when a snapshot is nonpositive', async () => {
    vi.mocked(fetchTimeseries).mockResolvedValue(
      timeseries({ net_worth: ['0.00', '101000.00', '102010.00'] }),
    )
    renderPage()

    expect(await screen.findByText(/needs every net-worth snapshot above zero/)).toBeTruthy()
    expect(screen.getAllByTestId('echart')).toHaveLength(2) // the dots still chart
  })

  it('asks for more snapshots under two history points', async () => {
    vi.mocked(fetchTimeseries).mockResolvedValue(
      timeseries({
        months: ['2026-08-01'],
        net_worth: ['100000.00'],
        mom_pct: [null],
        notes: [null],
      }),
    )
    renderPage()

    expect(await screen.findByText('Not enough monthly snapshots to chart yet.')).toBeTruthy()
    expect(screen.getAllByTestId('echart')).toHaveLength(1)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/pages/ProjectionPage.test.tsx`
Expected: FAIL — the five new tests (and the edited first test, which now expects 2 charts) fail because the page renders one chart and no new card. The other pre-existing tests must still PASS.

- [ ] **Step 3: Write the implementation**

Five edits to `src/pages/ProjectionPage.tsx`.

**(a)** Replace the import block

```ts
import { ApiError } from '../api/client'
import { fetchProjection } from '../api/projection'
import type { ProjectionParams } from '../api/projection'
import EChart from '../components/EChart'
import { projectionOption } from '../components/projection/projectionChartOptions'
import StatTile from '../components/StatTile'
import type { ProjectionOut } from '../types/api'
```

with

```ts
import { ApiError } from '../api/client'
import { fetchTimeseries } from '../api/netWorth'
import { fetchProjection } from '../api/projection'
import type { ProjectionParams } from '../api/projection'
import EChart from '../components/EChart'
import { fitExpTrend } from '../components/projection/expTrend'
import {
  netWorthProjectionOption,
  projectionOption,
} from '../components/projection/projectionChartOptions'
import StatTile from '../components/StatTile'
import type { NetWorthTimeseries, ProjectionOut } from '../types/api'
```

**(b)** After the `const [knobs, setKnobs] = useState<Knobs>(EMPTY_KNOBS)` line, add:

```ts
  // The history behind the new chart — its OWN state and failure: the card degrades to a
  // note while the tiles, the investable chart and the form keep running.
  const [history, setHistory] = useState<NetWorthTimeseries | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
```

**(c)** After the existing `useEffect(() => { load() … }, [])` block, add:

```ts
  useEffect(() => {
    // Mount-only, never on Recalculate: the history doesn't change with the knobs — the
    // horizon reaches the chart through the projection echo instead.
    fetchTimeseries()
      .then((res) => setHistory(res))
      .catch((err: unknown) =>
        setHistoryError(message(err, 'Failed to load net-worth history')),
      )
  }, [])
```

**(d)** Replace the derivation line

```ts
  const chart = data === null ? null : projectionOption(data)
```

with

```ts
  const chart = data === null ? null : projectionOption(data)
  const fit = history === null ? null : fitExpTrend(history.months, history.net_worth)
  const nwChart =
    history === null || data === null
      ? null
      : netWorthProjectionOption(history, fit, data.start_month, data.years)
```

**(e)** Inside the `data && (…)` branch, insert the new card section between the warnings block's closing

```tsx
            {data.warnings.length > 0 && (
              …
            )}
```

and the existing `<section className="card projection-chart-card">` (the "Projected investable balance" card). Insert exactly:

```tsx
            <section className="card projection-chart-card">
              <h2 className="eyebrow">Net worth over time (projected)</h2>
              {historyError !== null ? (
                // Advisory, never the page banner: the rest of the page runs without it.
                <p className="empty-note">{historyError}</p>
              ) : history === null ? (
                <p className="empty-note">Loading net-worth history…</p>
              ) : nwChart === null ? (
                <p className="empty-note">Not enough monthly snapshots to chart yet.</p>
              ) : (
                <>
                  <EChart option={nwChart} height={340} />
                  <p className="drill-hint">
                    {fit === null
                      ? 'The exponential trendline needs every net-worth snapshot above zero — showing the history alone.'
                      : `Exponential best-fit over every monthly net-worth snapshot, extended ${data.years} years — history implies ≈${formatPct(fit.annualRate, { signed: false })}/yr. Momentum, not a plan; the knob-driven model is the chart below.`}
                  </p>
                </>
              )}
            </section>
```

(`formatPct` is already imported by the page; the em dash and `≈` are literal characters, fine inside the template literal.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/pages/ProjectionPage.test.tsx`
Expected: PASS — 11 tests (6 pre-existing, one of them edited, + 5 new).

- [ ] **Step 5: Commit**

```bash
git add src/pages/ProjectionPage.tsx src/pages/ProjectionPage.test.tsx
git commit -m "feat: net worth over time (projected) card on /projection"
```

---

### Task 4: Full gates

**Files:** none (verification only)

- [ ] **Step 1: Full frontend suite**

Run: `npm test`
Expected: ALL green — 406 pre-existing + 18 new/edited ≈ 424 tests, 0 failures. (If any UNRELATED test fails, stop and report — do not fix drive-by.)

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: exactly ONE pre-existing sanctioned warning (AuthContext react-refresh); zero errors, nothing new.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: clean build. The EChart chunk stays ~700.93 kB (no new echarts registrations) — under the 720 kB advisory in `vite.config.ts`. If the chunk moved more than ~1 kB, something imported echarts wrongly (only `src/charts/echarts.ts` may import from `'echarts/*'`).

- [ ] **Step 4: Report**

No commit here unless gates forced a fix. Summarize: tests/lint/build results, files touched, and that the feature is visible at `/projection` (requires a logged-in session against the dev DB, which has real snapshots).

---

## Self-review notes (already applied)

- Spec coverage: fit module → Task 1; builder incl. axis/continuation/legend/zoom/z rules → Task 2; page wiring incl. placement, degradation, hint copy, mount-only fetch → Task 3; "no chunk growth" constraint → Task 4 gate.
- `fetchTimeseries()` bare call = the client's `'monthly'` default (spec was corrected from a nonexistent `'month'` literal).
- Scatter data is UNPADDED (spec updated) — no null-typing friction; the axis still spans history + continuation via `xAxis.data`.
- Type consistency: `ExpTrendFit`/`monthSerial` exported from `expTrend.ts` and consumed by name in Tasks 2–3; `NET_WORTH_PROJECTION_SERIES` defined in Task 2, asserted in Task 2 tests; page uses `data.start_month`/`data.years` (fields verified on `ProjectionOut`).
