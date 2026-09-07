# ESPP visuals — Lane 3 (the two chart cards) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The two chart cards of `docs/superpowers/specs/2026-09-07-espp-visuals-design.md`: **Lot anatomy** with its `Dollars · Per share` toggle, hollow sold lots and the loss overlay (§5), and **{ticker} vs your purchases** — daily closes with the subscription-price and average-paid step rules, the wash, purchase and sale markers, window chips (§6) — mounted side by side in a `card-grid` under the headline strip (§2), with the chart-to-table highlight (§5.6), fixtures for the conformance walk, and the real-canvas probe of the new forms (§9).

**Architecture:** One pure builder module `src/components/espp/esppChartOptions.ts` (two option builders, two CSV twins, the window and label helpers) in the house grammar — `grid`/`moneyAxis`/`monthAxis`/`BAR_MARKS`/`stagger`, `legendFor`, `referenceLine`, `axisTooltip` with the `footer` hook, `timeZoom` — tested through `tooltipRows`. Two thin card components (`LotAnatomyCard`, `EsppPriceCard`) own the toggle, the chips, the legend state and the footers and mount `ChartCard`. `EsppPage.tsx` gains the `card-grid`, a nullable `bars` state and the highlight state; its new tests live in their own file so Lane 2's edits to `EsppPage.test.tsx` never collide.

**Tech Stack:** React 19, TypeScript 5.9, ECharts 6 through `src/charts/echarts.ts`, vitest 3 + Testing Library, playwright-core (probe).

**Worktree / commands:** `C:\Users\edyli\personal-finance-dashboard\.worktrees\espp-3` on branch `espp-visuals-3` (created; `node_modules` is a junction to the main checkout's). From the worktree root: `npx vitest run <file>`, `npx tsc -b`, `npx eslint <files>`. Local commits only. Read first: `src/charts/grammar.ts`, `tooltip.ts`, `legend.ts`, `reference.ts`, `timeZoom.ts`, `conformance.ts`, `src/charts/fixtures/_types.ts` + `priceHistory.fixture.ts`, `src/components/portfolio/priceChartOptions.ts` + its test, `historyChartOptions.ts` (`ChartEventPoint`, `eventLines`), `src/components/portfolio/HoldingDetailPanel.tsx` lines 240–330 (chips + footer wiring), `src/components/ChartCard.tsx`, `src/components/shell/Segmented.tsx`, `src/testing/tooltipRows.ts`, `src/pages/EsppPage.tsx` (whole file), `src/pages/CompPage.test.tsx` lines 1–60 (the EChart mock), `src/types/api.ts` (`Espp*`, `PricePoint`), `tools/probes/charts-c5/probe.html` + `shoot.mjs`, `tools/probes/pace-v/smoke.mjs` lines 30–45 (the playwright-core require and node spoof).

**Rules for every task**
- Builders are pure: no React, no fetching, no theme branching. `Number()` is display-only geometry; every tooltip and CSV string is the wire string, formatted.
- Colors are token constants from `src/charts/theme.ts`, `'transparent'`, or nothing — the conformance walk fails anything else.
- Lane 2 owns the headline strip, the lots `<tfoot>`, the modeler card and `src/components/espp/espp.css`. This lane creates `src/components/espp/charts.css` for its own rules and inserts ONE `card-grid` block into `EsppPage.tsx` immediately above the lots `<Feed>`; it does not touch the strip, the modeler card or `EsppPage.test.tsx`.
- Snippets carry only the comments that encode a rule; match each file's comment density and voice when you write the real thing.

---

## File structure

| File | Responsibility |
|---|---|
| `src/components/espp/esppChartOptions.ts` + `.test.ts` (new) | `lotAnatomyOption` (both views), `lotAnatomyCsv`, `esppPriceOption`, `esppPriceCsv`, `lotLabels`, `sortLots`, `hasAnatomy`, `sliceWindow`, `lotsBeforeHistory`, the series-name constants |
| `src/testing/esppFixtures.ts` (new) | the four sheet lots with anatomy fields, a totals block, an offering, bars — shared by the builder, card and page tests |
| `src/charts/fixtures/esppLotAnatomyDollars.fixture.ts`, `esppLotAnatomyPerShare.fixture.ts`, `esppPrice.fixture.ts` (new); `src/charts/conformance.test.ts` (modify: ROSTER) | the grammar's proofs |
| `src/components/espp/LotAnatomyCard.tsx` + `.test.tsx` (new) | ChartCard mount, toggle, legend state, footer, hover/click → lot id |
| `src/components/espp/EsppPriceCard.tsx` + `.test.tsx` (new) | ChartCard mount, chips, window slicing, footer sentences |
| `src/components/espp/charts.css` (new) | the highlighted lots row |
| `src/pages/EsppPage.tsx` (modify) | nullable `bars`, the `card-grid`, the highlight state, row ids |
| `src/pages/EsppPage.charts.test.tsx` (new) | the page wiring, with an EChart mock |
| `tools/probes/espp-3/probe.html` + `shoot.mjs` (new); `tools/probes/README.md` (modify) | the real-canvas probe of the per-share form and the stepped references |

---

### Task 1: Shared fixtures

**Files:** Create `src/testing/esppFixtures.ts`

- [ ] **1 Create the module** — the page test's four sheet lots, now carrying the anatomy fields the server sends (every figure below was computed with the calc module):

```ts
// ESPP fixtures shared by the builder, card and page tests (2026-09-07 visuals). The four lots
// are EsppPage.test.tsx's — the sheet's own numbers at a $171.31 quote — with the anatomy fields
// the lots envelope carries since the 2026-09-07 batch (computed with espp_calc, not by hand).
import type { EsppLotOut, EsppLotsResponse, EsppOfferingOut, PricePoint } from '../types/api'

export function esppLot(over: Partial<EsppLotOut> = {}): EsppLotOut {
  return {
    id: 1,
    purchase_date: '2024-02-29',
    qualifying_date: '2025-09-01',
    shares: '260.0000',
    subscription_price: '48.50900',
    purchase_fmv: '79.11200',
    purchase_price: '41.23265',
    sold_date: null,
    sold_price: null,
    notes: null,
    cost_basis: '10720.49',
    market_value: '44540.60',
    gain_amount: '33820.11',
    gain_pct: '3.154717',
    qualified: true,
    days_until_qualified: 0,
    is_sold: false,
    fmv_value: '20569.12',
    bargain_element: '9848.63',
    lookback_component: '7956.78',
    discount_component: '1891.85',
    appreciation: '23971.48',
    avg_paid_to_date: '41.23265',
    ...over,
  }
}

/** Held, qualified, well above its purchase FMV. */
export const heldLot = esppLot()
/** Sold after qualifying, at $120 — hollow on every chart. */
export const soldLot = esppLot({
  id: 2, purchase_date: '2024-08-30', shares: '255.0000', sold_date: '2025-10-15', sold_price: '120.00000',
  cost_basis: '10514.33', market_value: '30600.00', gain_amount: '20085.67', gain_pct: '1.910315',
  days_until_qualified: null, is_sold: true,
  fmv_value: '20173.56', bargain_element: '9659.23', lookback_component: '7803.77', discount_component: '1855.46', appreciation: '10426.44',
})
/** Sold before qualifying and BELOW its purchase FMV — hollow AND a realized loss overlay. */
export const soldLossLot = esppLot({
  id: 3, purchase_date: '2025-02-28', qualifying_date: '2026-02-28', shares: '274.0000', purchase_fmv: '124.80000',
  sold_date: '2025-11-03', sold_price: '110.00000',
  cost_basis: '11297.75', market_value: '30140.00', gain_amount: '18842.25', gain_pct: '1.667789',
  qualified: false, days_until_qualified: null, is_sold: true,
  fmv_value: '34195.20', bargain_element: '22897.45', lookback_component: '20903.73', discount_component: '1993.72', appreciation: '-4055.20',
})
/** Held, still qualifying, and a hair UNDER its purchase FMV at this quote — the loss overlay. */
export const underwaterLot = esppLot({
  id: 4, purchase_date: '2025-08-29', qualifying_date: '2026-08-29', shares: '241.0000', purchase_fmv: '174.18000',
  cost_basis: '9937.07', market_value: '41285.71', gain_amount: '31348.64',
  qualified: false, days_until_qualified: 13,
  fmv_value: '41977.38', bargain_element: '32040.31', lookback_component: '30286.71', discount_component: '1753.60', appreciation: '-691.67',
})

export const anatomyLots: EsppLotOut[] = [heldLot, soldLot, soldLossLot, underwaterLot]

export function esppLotsResponse(over: Partial<EsppLotsResponse> = {}): EsppLotsResponse {
  return {
    espp_ticker: 'NVDA',
    current_price: '171.3100',
    quoted_at: '2026-08-15T20:00:00Z',
    lots: anatomyLots,
    totals: {
      held: {
        lots: 2, shares: '501.0000', cost_basis: '20657.56', fmv_value: '62546.50',
        market_value: '85826.31', gain_amount: '65168.75', gain_pct: '3.154717',
        bargain_element: '41888.94', lookback_component: '38243.49', discount_component: '3645.45',
        appreciation: '23279.81', avg_paid: '41.23265',
      },
      sold: { lots: 2, shares: '529.0000', cost_basis: '21812.08', proceeds: '60740.00', gain_amount: '38927.92' },
    },
    ...over,
  }
}

export const septOffering: EsppOfferingOut = {
  id: 1, offering_start: '2023-09-01', subscription_price: '48.50900', notes: null,
}

/** Five daily bars around the first two purchases and the first sale's date range. */
export const bars: PricePoint[] = [
  { d: '2024-02-27', c: '75.0000' },
  { d: '2024-02-29', c: '79.1120' },
  { d: '2024-03-01', c: '80.0000' },
  { d: '2024-08-30', c: '119.3700' },
  { d: '2024-09-03', c: '121.0000' },
]
```

- [ ] **2 Check:** `npx tsc -b` → clean (the anatomy fields are optional on the type, so the literal type-checks).
- [ ] **3 Commit:** `git add src/testing/esppFixtures.ts && git commit -m "test(espp): shared lot, offering and bar fixtures carrying the anatomy fields"`

---

### Task 2: `lotAnatomyOption` — the Dollars view

**Files:** Create `src/components/espp/esppChartOptions.ts`, `src/components/espp/esppChartOptions.test.ts`

- [ ] **1 Write the failing tests:**

```ts
import { describe, expect, it } from 'vitest'
import type { EChartsOption } from '../../charts/echarts'
import { BAR_MARKS, GRID_VARIANTS } from '../../charts/grammar'
import { INK, MUTED, NEGATIVE, PALETTE, SURFACE } from '../../charts/theme'
import { isGrammarTooltip } from '../../charts/tooltip'
import { tooltipRows } from '../../testing/tooltipRows'
import { anatomyLots, esppLot, esppLotsResponse } from '../../testing/esppFixtures'
import {
  APPRECIATION, BARGAIN, LOSS, PAID, hasAnatomy, lotAnatomyCsv, lotAnatomyOption, lotLabels, sortLots,
} from './esppChartOptions'

// EChartsOption is a wide union; narrow once (the option-builder tests' shared posture).
function read(option: EChartsOption | null) {
  expect(option).not.toBeNull()
  return option as unknown as {
    grid: unknown
    legend: { type: string; data?: string[]; selected?: Record<string, boolean> }
    xAxis: { data: string[]; boundaryGap?: boolean }
    yAxis: { type: string; scale?: boolean }
    tooltip: { formatter: (p: unknown) => string }
    series: {
      id?: string
      name: string
      type: string
      stack?: string
      color?: string
      silent?: boolean
      barMaxWidth?: number
      barGap?: string
      symbol?: string
      symbolSize?: number
      z?: number
      animationDelay?: unknown
      itemStyle?: { borderColor?: string; borderWidth?: number; color?: string }
      lineStyle?: { type?: string; width?: number }
      label?: { show: boolean; formatter: (p: { dataIndex: number }) => string }
      data: unknown[]
    }[]
  }
}
const hollow = (value: number, color: string) => ({
  value,
  itemStyle: { color: 'transparent', borderColor: color, borderWidth: 1.5 },
})
const byName = (option: ReturnType<typeof read>, name: string) => {
  const found = option.series.find((s) => s.name === name)
  expect(found, name).toBeDefined()
  return found!
}

describe('lotLabels / sortLots / hasAnatomy', () => {
  it('labels lots by purchase month, falls back to the full date on a collision, and marks sold lots', () => {
    expect(lotLabels(anatomyLots)).toEqual(['Feb 2024', 'Aug 2024 (sold)', 'Feb 2025 (sold)', 'Aug 2025'])
    const twins = [esppLot({ id: 9, purchase_date: '2024-02-05' }), esppLot()]
    expect(lotLabels(twins)).toEqual(['Feb 5, 2024', 'Feb 29, 2024'])
  })
  it('sorts by purchase date then id — the chain order', () => {
    const shuffled = [anatomyLots[3], anatomyLots[0], anatomyLots[2], anatomyLots[1]]
    expect(sortLots(shuffled).map((l) => l.id)).toEqual([1, 2, 3, 4])
  })
  it('recognises a pre-batch payload by its missing anatomy fields', () => {
    expect(hasAnatomy(anatomyLots)).toBe(true)
    const stale = { ...esppLot() } as Record<string, unknown>
    delete stale.fmv_value
    expect(hasAnatomy([stale as unknown as typeof anatomyLots[number]])).toBe(false)
  })
})

describe('lotAnatomyOption — Dollars', () => {
  it('returns null with no lots or without the anatomy fields', () => {
    expect(lotAnatomyOption(esppLotsResponse({ lots: [] }), { view: 'dollars' })).toBeNull()
    const stale = { ...esppLot() } as Record<string, unknown>
    delete stale.appreciation
    expect(
      lotAnatomyOption(esppLotsResponse({ lots: [stale as unknown as typeof anatomyLots[number]] }), { view: 'dollars' }),
    ).toBeNull()
  })

  it('stacks paid, bargain and appreciation per lot in chain order on the money grid', () => {
    const option = read(lotAnatomyOption(esppLotsResponse(), { view: 'dollars' }))
    expect(option.grid).toEqual(GRID_VARIANTS.default)
    expect(option.xAxis.data).toEqual(['Feb 2024', 'Aug 2024 (sold)', 'Feb 2025 (sold)', 'Aug 2025'])
    expect(option.xAxis.boundaryGap).toBeUndefined() // bars: the category gap stays
    expect(option.yAxis.type).toBe('value')
    expect(option.yAxis.scale).toBeUndefined() // zero-anchored: additive money
    const paid = byName(option, PAID)
    expect(paid).toMatchObject({ id: 'paid', type: 'bar', stack: 'lot', color: PALETTE[1], barMaxWidth: BAR_MARKS.barMaxWidth })
    expect(paid.itemStyle?.borderColor).toBe(SURFACE)
    expect(typeof paid.animationDelay).toBe('function')
    expect(paid.data).toEqual([10720.49, hollow(10514.33, PALETTE[1]), hollow(11297.75, PALETTE[1]), 9937.07])
    const bargain = byName(option, BARGAIN)
    expect(bargain).toMatchObject({ id: 'bargain', color: PALETTE[2], stack: 'lot' })
    expect(bargain.data).toEqual([9848.63, hollow(9659.23, PALETTE[2]), hollow(22897.45, PALETTE[2]), 32040.31])
    const appreciation = byName(option, APPRECIATION)
    expect(appreciation).toMatchObject({ id: 'appreciation', color: PALETTE[0], stack: 'lot' })
    // Negative appreciation draws NOTHING in this stack — the loss overlay carries it.
    expect(appreciation.data).toEqual([23971.48, hollow(10426.44, PALETTE[0]), hollow(0, PALETTE[0]), 0])
  })

  it('labels sold columns "Sold" on the cap and nothing on held ones', () => {
    const option = read(lotAnatomyOption(esppLotsResponse(), { view: 'dollars' }))
    const label = byName(option, APPRECIATION).label!
    expect(label.show).toBe(true)
    expect(label.formatter({ dataIndex: 0 })).toBe('')
    expect(label.formatter({ dataIndex: 1 })).toBe('Sold')
  })

  it('overlays a below-FMV loss on its own stack, over the same column, from market value up to FMV value', () => {
    const option = read(lotAnatomyOption(esppLotsResponse(), { view: 'dollars' }))
    const base = option.series.find((s) => s.name === 'loss-base')!
    expect(base).toMatchObject({ type: 'bar', stack: 'loss', silent: true, color: 'transparent' })
    expect(base.data).toEqual([0, 0, 30140, 41285.71])
    const loss = byName(option, LOSS)
    expect(loss).toMatchObject({ id: 'loss', stack: 'loss', color: NEGATIVE, barGap: '-100%', barMaxWidth: BAR_MARKS.barMaxWidth })
    expect(loss.itemStyle?.borderColor).toBe(SURFACE)
    expect(loss.data).toEqual([0, 0, 4055.2, 691.67]) // 34195.20 - 30140.00, 41977.38 - 41285.71
    expect(option.series[option.series.length - 1].name).toBe(LOSS) // barGap rides the LAST bar series
    expect(option.legend.data).toEqual([PAID, BARGAIN, APPRECIATION, LOSS])
  })

  it('omits the loss stack and its legend entry when no lot is under its FMV', () => {
    const option = read(lotAnatomyOption(esppLotsResponse({ lots: [anatomyLots[0], anatomyLots[1]] }), { view: 'dollars' }))
    expect(option.series.map((s) => s.name)).toEqual([PAID, BARGAIN, APPRECIATION])
    expect(option.legend.data).toEqual([PAID, BARGAIN, APPRECIATION])
    expect(option.series.some((s) => s.barGap !== undefined)).toBe(false)
  })

  it('draws paid and bargain only when the position is unpriced', () => {
    const unpriced = esppLotsResponse({
      current_price: null,
      quoted_at: null,
      lots: [esppLot({ market_value: null, gain_amount: null, gain_pct: null, appreciation: null })],
    })
    const option = read(lotAnatomyOption(unpriced, { view: 'dollars' }))
    expect(byName(option, APPRECIATION).data).toEqual([0])
    expect(byName(option, BARGAIN).data).toEqual([9848.63])
    expect(option.legend.data).toEqual([PAID, BARGAIN, APPRECIATION])
  })

  it('mirrors legend picks and keeps the tooltip on the grammar: components sorted, no total, the lot in the foot', () => {
    const option = read(lotAnatomyOption(esppLotsResponse(), { view: 'dollars', selected: { [LOSS]: false } }))
    expect(option.legend.selected).toEqual({ [LOSS]: false })
    expect(isGrammarTooltip(option.tooltip.formatter)).toBe(true)
    const parsed = tooltipRows(
      option.tooltip.formatter([
        { seriesName: PAID, seriesType: 'bar', axisValueLabel: 'Feb 2024', dataIndex: 0, value: 10720.49, color: PALETTE[1] },
        { seriesName: BARGAIN, seriesType: 'bar', axisValueLabel: 'Feb 2024', dataIndex: 0, value: 9848.63, color: PALETTE[2] },
        { seriesName: APPRECIATION, seriesType: 'bar', axisValueLabel: 'Feb 2024', dataIndex: 0, value: 23971.48, color: PALETTE[0] },
      ]),
    )
    expect(parsed.head).toBe('Feb 2024')
    expect(parsed.rows.map((r) => [r.kind, r.label, r.value])).toEqual([
      ['row', APPRECIATION, '$23,971.48'],
      ['row', PAID, '$10,720.49'],
      ['row', BARGAIN, '$9,848.63'],
    ])
    expect(parsed.foot).toEqual([
      'Value $44,540.60 · gain $33,820.11 (+315.5%)',
      '260 sh · paid $41.23 · FMV $79.11 · subscription $48.51 · price $171.31',
      'Bargain element: $1,891.85 discount + $7,956.78 lookback',
      'Qualified',
    ])
  })

  it('says sold and qualifying in the foot as the row does', () => {
    const option = read(lotAnatomyOption(esppLotsResponse(), { view: 'dollars' }))
    const foot = (index: number) =>
      tooltipRows(option.tooltip.formatter([{ seriesName: PAID, seriesType: 'bar', dataIndex: index, value: 1, color: PALETTE[1] }])).foot
    expect(foot(1)[1]).toBe('255 sh · paid $41.23 · FMV $79.11 · subscription $48.51 · price $120.00')
    expect(foot(1)[3]).toBe('Sold Oct 15, 2025 at $120.00')
    expect(foot(3)[3]).toBe('Qualifies in 13 days')
  })
})

describe('lotAnatomyCsv', () => {
  it('prints one row per lot in chain order, verbatim wire strings, the price column by status', () => {
    const table = lotAnatomyCsv(esppLotsResponse())
    expect(table.headers).toEqual([
      'Purchased', 'Status', 'Shares', 'Paid / sh', 'FMV at purchase / sh', 'Subscription / sh', 'Price / sh',
      'Cost', 'Discount component', 'Lookback component', 'Bargain element', 'Appreciation', 'Value',
    ])
    expect(table.rows[0]).toEqual([
      '2024-02-29', 'held', '260.0000', '41.23265', '79.11200', '48.50900', '171.3100',
      '10720.49', '1891.85', '7956.78', '9848.63', '23971.48', '44540.60',
    ])
    expect(table.rows[1][1]).toBe('sold')
    expect(table.rows[1][6]).toBe('120.00000')
  })
})
```

- [ ] **2 Fail:** `npx vitest run src/components/espp/esppChartOptions.test.ts` → cannot resolve `./esppChartOptions`.
- [ ] **3 Create `src/components/espp/esppChartOptions.ts`** (the Dollars half; the per-share and price builders come in Tasks 3–4, and every import below is used by the end of Task 4):

```ts
// Pure option builders for the ESPP page's two chart cards (2026-09-07 spec §5–§6) — no React,
// no fetching, no theme decisions of its own (compChartOptions.ts's posture). Number() here is
// display-only geometry: the server's Decimal strings are parsed once and never handed back
// (format.ts's rule), and every figure a tooltip or CSV prints is the wire string, formatted.
import type { EChartsOption } from '../../charts/echarts'
import {
  BAR_MARKS,
  LINE,
  capLabel,
  cents,
  dateAxis,
  grid,
  moneyAxis,
  monthAxis,
  stagger,
} from '../../charts/grammar'
import { legendFor } from '../../charts/legend'
import { referenceLine } from '../../charts/reference'
import { INK, MUTED, NEGATIVE, PALETTE, POSITIVE, SURFACE } from '../../charts/theme'
import { timeZoom } from '../../charts/timeZoom'
import { axisTooltip } from '../../charts/tooltip'
import type { EsppLotOut, EsppLotsResponse, EsppOfferingOut, PricePoint } from '../../types/api'
import type { ExportTable } from '../../utils/download'
import {
  escapeHtml,
  formatCurrency,
  formatDate,
  formatMonth,
  formatPct,
  formatShares,
} from '../../utils/format'
import { addDays } from '../../utils/months'
import { eventLines } from '../portfolio/historyChartOptions'
import type { ChartEventPoint } from '../portfolio/historyChartOptions'

export type AnatomyView = 'dollars' | 'per-share'

// Series names — the legend, the tooltip contract, the cards and the tests share them.
export const PAID = 'Paid'
export const BARGAIN = 'Bargain element'
export const APPRECIATION = 'Appreciation'
export const LOSS = 'Below purchase FMV'
export const PRICE_DOT = 'Price'
export const SUBSCRIPTION = 'Subscription price'
export const QUOTE_RULE = 'Current quote'
export const CLOSE = 'Close'
export const AVG_PAID = 'Avg paid to date'
export const PURCHASES = 'Purchases'
export const SALES = 'Sales'

// Slots 2, 3, 1 — orange, green, blue — validated in both themes (spec §8.2). Fixed by
// COMPONENT, never by lot: lots pass eight by 2028 and identity was never the story.
export const ANATOMY_COLORS = {
  paid: PALETTE[1],
  bargain: PALETTE[2],
  appreciation: PALETTE[0],
} as const

/** A lot the anatomy builder can draw: the 2026-09-07 fields are present. */
export type AnatomyLot = EsppLotOut & {
  fmv_value: string
  bargain_element: string
  lookback_component: string
  discount_component: string
  appreciation: string | null
  avg_paid_to_date: string | null
}

/** A pre-batch snapshot lacks the anatomy: the cards read that as "not loaded yet", never as zero. */
export function hasAnatomy(lots: EsppLotOut[]): lots is AnatomyLot[] {
  return lots.every(
    (l) =>
      l.fmv_value !== undefined &&
      l.bargain_element !== undefined &&
      l.lookback_component !== undefined &&
      l.discount_component !== undefined &&
      l.appreciation !== undefined &&
      l.avg_paid_to_date !== undefined,
  )
}

/** Chain order — (purchase_date, id), the router's own. The chart owns its axis order rather than
 *  trusting the feed (tcTrajectoryOption's reasoning). ISO dates sort as strings. */
export function sortLots<L extends EsppLotOut>(lots: L[]): L[] {
  return [...lots].sort((a, b) =>
    a.purchase_date < b.purchase_date ? -1 : a.purchase_date > b.purchase_date ? 1 : a.id - b.id,
  )
}

/** "Feb 2024" per lot; two lots in one month fall back to the full date; sold lots say so. */
export function lotLabels(lots: EsppLotOut[]): string[] {
  const months = lots.map((l) => formatMonth(l.purchase_date))
  const counts = new Map<string, number>()
  for (const m of months) counts.set(m, (counts.get(m) ?? 0) + 1)
  return lots.map(
    (l, i) =>
      `${(counts.get(months[i]) ?? 0) > 1 ? formatDate(l.purchase_date) : months[i]}${l.is_sold ? ' (sold)' : ''}`,
  )
}

type Datum =
  | number
  | { value: number; itemStyle: { color: string; borderColor: string; borderWidth: number } }

/** Sold lots draw HOLLOW (spec §5.2): an outline in the segment's own colour over a transparent
 *  fill — the shares are gone. Hatch and fade already mean "estimate" on the Comp page, gray is
 *  the folded tail; fill was the one free channel. */
function hollowIfSold(values: number[], lots: EsppLotOut[], color: string): Datum[] {
  return values.map((value, i) =>
    lots[i].is_sold
      ? { value, itemStyle: { color: 'transparent', borderColor: color, borderWidth: 1.5 } }
      : value,
  )
}

/** The loss overlay: a second stack laid over the SAME column (`barGap: '-100%'`, which must
 *  ride the LAST bar series — echarts reads the shared bar layout from it). A transparent,
 *  silent base lifts the NEGATIVE segment to where the loss starts, so the solid stack still
 *  stops at the FMV level and the red reads down to the market value (spec §5.3). */
function lossStack(base: number[], loss: number[], barMaxWidth: number, index: number) {
  return [
    {
      id: 'loss-base',
      name: 'loss-base',
      type: 'bar' as const,
      stack: 'loss',
      silent: true,
      tooltip: { show: false },
      color: 'transparent',
      barMaxWidth,
      data: base,
    },
    {
      id: 'loss',
      name: LOSS,
      type: 'bar' as const,
      stack: 'loss',
      ...BAR_MARKS,
      barMaxWidth,
      ...stagger(index),
      color: NEGATIVE,
      barGap: '-100%',
      data: loss,
    },
  ]
}

/** The lot's own lines under the tooltip's rows — every figure the wire's, formatted; the
 *  bargain split names the discount and the lookback apart (the ten-to-one fact). */
function lotFooter(lots: AnatomyLot[], currentPrice: string | null) {
  return (dataIndex: number): string[] => {
    const lot = lots[dataIndex]
    if (lot === undefined) return []
    const price = lot.is_sold ? lot.sold_price : currentPrice
    const gain =
      lot.gain_amount === null ? '' : ` · gain ${formatCurrency(lot.gain_amount)} (${formatPct(lot.gain_pct)})`
    const status = lot.is_sold
      ? `Sold ${formatDate(lot.sold_date)}${lot.sold_price === null ? '' : ` at ${formatCurrency(lot.sold_price)}`}`
      : lot.qualified
        ? 'Qualified'
        : lot.days_until_qualified === null
          ? 'Qualifying'
          : `Qualifies in ${lot.days_until_qualified} ${lot.days_until_qualified === 1 ? 'day' : 'days'}`
    return [
      `Value ${formatCurrency(lot.market_value)}${gain}`,
      `${formatShares(lot.shares)} sh · paid ${formatCurrency(lot.purchase_price)} · FMV ${formatCurrency(
        lot.purchase_fmv,
      )} · subscription ${formatCurrency(lot.subscription_price)}${price === null ? '' : ` · price ${formatCurrency(price)}`}`,
      `Bargain element: ${formatCurrency(lot.discount_component)} discount + ${formatCurrency(
        lot.lookback_component,
      )} lookback`,
      status,
    ].map(escapeHtml)
  }
}

/**
 * Each lot's value split three ways (spec §5): what was paid, the bargain element on purchase day
 * and the market's move since — or, per share, the same split as a floating range from the paid
 * price up to today's quote. Both views share ids for the two common stacks so the toggle re-runs
 * as an update, not an entrance. Returns null with nothing to draw or on a pre-batch payload.
 */
export function lotAnatomyOption(
  data: EsppLotsResponse,
  { view, selected }: { view: AnatomyView; selected?: Record<string, boolean> },
): EChartsOption | null {
  if (data.lots.length === 0 || !hasAnatomy(data.lots)) return null
  const lots = sortLots(data.lots)
  const labels = lotLabels(lots)
  const footer = lotFooter(lots, data.current_price)
  // The text backup for the hollow outline: a cap label on the top-most segment.
  const soldCap = { label: capLabel((p) => (lots[p.dataIndex]?.is_sold ? 'Sold' : '')) }
  return view === 'dollars'
    ? dollarsOption(lots, labels, footer, soldCap, selected)
    : perShareOption(lots, labels, footer, soldCap, data.current_price, selected)
}

function dollarsOption(
  lots: AnatomyLot[],
  labels: string[],
  footer: (dataIndex: number) => string[],
  soldCap: { label: ReturnType<typeof capLabel> },
  selected?: Record<string, boolean>,
): EChartsOption {
  const paid = lots.map((l) => Number(l.cost_basis))
  const bargain = lots.map((l) => Math.max(Number(l.bargain_element), 0))
  const appreciation = lots.map((l) => (l.appreciation === null ? 0 : Math.max(Number(l.appreciation), 0)))
  const underwater = lots.map((l) => l.appreciation !== null && Number(l.appreciation) < 0)
  const lossBase = lots.map((l, i) => (underwater[i] ? Number(l.market_value) : 0))
  const loss = lots.map((l, i) => (underwater[i] ? cents(Number(l.fmv_value) - Number(l.market_value)) : 0))
  const hasLoss = underwater.some(Boolean)
  const bar = (id: string, name: string, color: string, values: number[], index: number, extra = {}) => ({
    id,
    name,
    type: 'bar' as const,
    stack: 'lot',
    ...BAR_MARKS,
    ...stagger(index),
    color,
    data: hollowIfSold(values, lots, color),
    ...extra,
  })
  const names = [PAID, BARGAIN, APPRECIATION, ...(hasLoss ? [LOSS] : [])]
  return {
    grid: grid(),
    legend: { ...legendFor(names.length, selected), data: names },
    // No Total row: with a loss overlay the components no longer sum to the value, so the value
    // rides the foot as the server's own figure instead.
    tooltip: axisTooltip({ unit: 'money', pointer: 'shadow', groups: names, totalLabel: false, footer }),
    xAxis: monthAxis(labels, { gap: true }),
    yAxis: moneyAxis(),
    series: [
      bar('paid', PAID, ANATOMY_COLORS.paid, paid, 0),
      bar('bargain', BARGAIN, ANATOMY_COLORS.bargain, bargain, 1),
      bar('appreciation', APPRECIATION, ANATOMY_COLORS.appreciation, appreciation, 2, soldCap),
      ...(hasLoss ? lossStack(lossBase, loss, BAR_MARKS.barMaxWidth, 3) : []),
    ],
  }
}

/** The lots as a table (F12): one row per lot in chain order, verbatim wire strings. */
export function lotAnatomyCsv(data: EsppLotsResponse): ExportTable {
  const lots = hasAnatomy(data.lots) ? sortLots(data.lots) : []
  return {
    headers: [
      'Purchased', 'Status', 'Shares', 'Paid / sh', 'FMV at purchase / sh', 'Subscription / sh', 'Price / sh',
      'Cost', 'Discount component', 'Lookback component', 'Bargain element', 'Appreciation', 'Value',
    ],
    rows: lots.map((l) => [
      l.purchase_date,
      l.is_sold ? 'sold' : 'held',
      l.shares,
      l.purchase_price,
      l.purchase_fmv,
      l.subscription_price,
      (l.is_sold ? l.sold_price : data.current_price) ?? '',
      l.cost_basis,
      l.discount_component,
      l.lookback_component,
      l.bargain_element,
      l.appreciation ?? '',
      l.market_value ?? '',
    ]),
  }
}
```

Until Task 3 lands, add a temporary stub so the module compiles: `function perShareOption(...args: Parameters<typeof dollarsOption> extends [infer L, infer La, infer F, infer S, ...unknown[]] ? [L, La, F, S, string | null, Record<string, boolean>?] : never): EChartsOption { throw new Error('Task 3') }` — or simply write Task 3's `perShareOption` now (recommended) and run Task 3's tests together with these.

- [ ] **4 Pass:** `npx vitest run src/components/espp/esppChartOptions.test.ts` → the Dollars, label and CSV cases green.
- [ ] **5 Commit:** `git add src/components/espp/esppChartOptions.ts src/components/espp/esppChartOptions.test.ts && git commit -m "feat(espp): lotAnatomyOption — paid, bargain element and appreciation per lot; sold lots hollow; loss overlay"`

---

### Task 3: The Per share view

**Files:** Modify `src/components/espp/esppChartOptions.ts` · Test `src/components/espp/esppChartOptions.test.ts`

- [ ] **1 Write the failing tests** — append:

```ts
describe('lotAnatomyOption — Per share', () => {
  const hollowDot = (value: number, color: string) => ({
    value,
    itemStyle: { color: SURFACE, borderColor: color, borderWidth: 1.5 },
  })

  it('floats each lot from the paid price: a silent base, then bargain and appreciation per share, 10px wide', () => {
    const option = read(lotAnatomyOption(esppLotsResponse(), { view: 'per-share' }))
    expect(option.yAxis.scale).toBeUndefined() // zero-anchored: the discount as a true share of the price
    const base = option.series.find((s) => s.name === 'ladder-base')!
    expect(base).toMatchObject({ type: 'bar', stack: 'ladder', silent: true, color: 'transparent', barMaxWidth: 10 })
    expect(base.data).toEqual([41.23265, 41.23265, 41.23265, 41.23265])
    const bargain = byName(option, BARGAIN)
    expect(bargain).toMatchObject({ id: 'bargain', stack: 'ladder', barMaxWidth: 10, color: PALETTE[2] })
    // cents(): 79.112 − 41.23265 and 174.18 − 41.23265 are float dust, and dust must not reach a chart.
    expect(bargain.data).toEqual([37.88, hollow(37.88, PALETTE[2]), hollow(83.57, PALETTE[2]), 132.95])
    const appreciation = byName(option, APPRECIATION)
    expect(appreciation.data).toEqual([92.2, hollow(40.89, PALETTE[0]), hollow(0, PALETTE[0]), 0])
    expect(appreciation.label!.formatter({ dataIndex: 2 })).toBe('Sold')
  })

  it('overlays a per-share loss from the price up to the purchase FMV', () => {
    const option = read(lotAnatomyOption(esppLotsResponse(), { view: 'per-share' }))
    expect(option.series.find((s) => s.name === 'loss-base')!.data).toEqual([0, 0, 110, 171.31])
    const loss = byName(option, LOSS)
    expect(loss).toMatchObject({ stack: 'loss', color: NEGATIVE, barGap: '-100%', barMaxWidth: 10 })
    expect(loss.data).toEqual([0, 0, 14.8, 2.87]) // 124.80 − 110, 174.18 − 171.31
  })

  it('rides the ends with Paid and Price dots, hollow on sold lots, the subscription diamond and the quote rule', () => {
    const option = read(lotAnatomyOption(esppLotsResponse(), { view: 'per-share' }))
    const paid = byName(option, PAID)
    expect(paid).toMatchObject({ id: 'paid', type: 'scatter', color: PALETTE[1], symbolSize: 9, z: 11 })
    expect(paid.itemStyle).toEqual({ borderColor: INK, borderWidth: 1 })
    expect(paid.data).toEqual([41.23265, hollowDot(41.23265, PALETTE[1]), hollowDot(41.23265, PALETTE[1]), 41.23265])
    const price = byName(option, PRICE_DOT)
    expect(price).toMatchObject({ type: 'scatter', color: PALETTE[0] })
    expect(price.data).toEqual([171.31, hollowDot(120, PALETTE[0]), hollowDot(110, PALETTE[0]), 171.31])
    const subscription = byName(option, SUBSCRIPTION)
    expect(subscription).toMatchObject({ type: 'scatter', color: MUTED, symbol: 'diamond', symbolSize: 9 })
    expect(subscription.itemStyle).toEqual({ borderColor: INK, borderWidth: 1 }) // filled — hollow means sold
    expect(subscription.data).toEqual([48.509, 48.509, 48.509, 48.509])
    const rule = byName(option, QUOTE_RULE)
    expect(rule).toMatchObject({ type: 'line', color: MUTED, z: 9, lineStyle: { type: 'dashed', width: 2 } })
    expect(rule.data).toEqual([171.31, 171.31, 171.31, 171.31])
    expect(option.legend.data).toEqual([PAID, BARGAIN, APPRECIATION, LOSS, PRICE_DOT, SUBSCRIPTION, QUOTE_RULE])
  })

  it('drops the Price dots and the quote rule when unpriced', () => {
    const unpriced = esppLotsResponse({
      current_price: null,
      quoted_at: null,
      lots: [esppLot({ market_value: null, gain_amount: null, gain_pct: null, appreciation: null })],
    })
    const option = read(lotAnatomyOption(unpriced, { view: 'per-share' }))
    expect(byName(option, PRICE_DOT).data).toEqual([null])
    expect(option.series.some((s) => s.name === QUOTE_RULE)).toBe(false)
    expect(option.legend.data).toEqual([PAID, BARGAIN, APPRECIATION, PRICE_DOT, SUBSCRIPTION])
  })

  it('tooltips the per-share components as rows and the paid, price, subscription and quote figures as references', () => {
    const option = read(lotAnatomyOption(esppLotsResponse(), { view: 'per-share' }))
    const parsed = tooltipRows(
      option.tooltip.formatter([
        { seriesName: BARGAIN, seriesType: 'bar', axisValueLabel: 'Feb 2024', dataIndex: 0, value: 37.88, color: PALETTE[2] },
        { seriesName: APPRECIATION, seriesType: 'bar', axisValueLabel: 'Feb 2024', dataIndex: 0, value: 92.2, color: PALETTE[0] },
        { seriesName: PAID, seriesType: 'scatter', dataIndex: 0, value: 41.23265, color: PALETTE[1] },
        { seriesName: PRICE_DOT, seriesType: 'scatter', dataIndex: 0, value: 171.31, color: PALETTE[0] },
        { seriesName: SUBSCRIPTION, seriesType: 'scatter', dataIndex: 0, value: 48.509, color: MUTED },
        { seriesName: QUOTE_RULE, seriesType: 'line', dataIndex: 0, value: 171.31, color: MUTED },
      ]),
    )
    expect(parsed.rows.map((r) => [r.kind, r.label, r.value])).toEqual([
      ['row', APPRECIATION, '$92.20'],
      ['row', BARGAIN, '$37.88'],
      ['ref', PAID, '$41.23'],
      ['ref', PRICE_DOT, '$171.31'],
      ['ref', SUBSCRIPTION, '$48.51'],
      ['ref', QUOTE_RULE, '$171.31'],
    ])
    expect(parsed.foot[0]).toBe('Value $44,540.60 · gain $33,820.11 (+315.5%)')
  })
})
```

- [ ] **2 Fail:** `npx vitest run src/components/espp/esppChartOptions.test.ts -t "Per share"`.
- [ ] **3 Implement** — replace the stub with:

```ts
/** The dumbbell form for "before → after per item": every lot on one price axis, its bar a range
 *  from the paid price up to today's quote (or its sale price), the colour change at the FMV on
 *  purchase day. Every unsold column's Price dot sits on the quote rule — the view's point: the
 *  spread is your entry prices, the line is where they all are today (spec §5.4). */
function perShareOption(
  lots: AnatomyLot[],
  labels: string[],
  footer: (dataIndex: number) => string[],
  soldCap: { label: ReturnType<typeof capLabel> },
  currentPrice: string | null,
  selected?: Record<string, boolean>,
): EChartsOption {
  const WIDTH = 10 // a dumbbell's bar is thin; BAR_MARKS' surface hairline stays
  const paid = lots.map((l) => Number(l.purchase_price))
  const fmv = lots.map((l) => Number(l.purchase_fmv))
  const price = lots.map((l) =>
    l.is_sold
      ? l.sold_price === null
        ? null
        : Number(l.sold_price)
      : currentPrice === null
        ? null
        : Number(currentPrice),
  )
  const bargain = lots.map((_, i) => cents(Math.max(fmv[i] - paid[i], 0)))
  const appreciation = lots.map((_, i) => (price[i] === null ? 0 : cents(Math.max((price[i] as number) - fmv[i], 0))))
  const underwater = lots.map((_, i) => price[i] !== null && (price[i] as number) < fmv[i])
  const lossBase = lots.map((_, i) => (underwater[i] ? (price[i] as number) : 0))
  const loss = lots.map((_, i) => (underwater[i] ? cents(fmv[i] - (price[i] as number)) : 0))
  const hasLoss = underwater.some(Boolean)
  const bar = (id: string, name: string, color: string, values: number[], index: number, extra = {}) => ({
    id,
    name,
    type: 'bar' as const,
    stack: 'ladder',
    ...BAR_MARKS,
    barMaxWidth: WIDTH,
    ...stagger(index),
    color,
    data: hollowIfSold(values, lots, color),
    ...extra,
  })
  // The end dots wear the house marker (9px, INK ring); a sold lot's dots go hollow like its bar.
  const dot = (id: string, name: string, color: string, values: (number | null)[]) => ({
    id,
    name,
    type: 'scatter' as const,
    color,
    symbolSize: 9,
    z: 11,
    itemStyle: { borderColor: INK, borderWidth: 1 },
    data: values.map((v, i) =>
      v === null ? null : lots[i].is_sold ? { value: v, itemStyle: { color: SURFACE, borderColor: color, borderWidth: 1.5 } } : v,
    ),
  })
  const priced = currentPrice !== null
  const names = [PAID, BARGAIN, APPRECIATION, ...(hasLoss ? [LOSS] : []), PRICE_DOT, SUBSCRIPTION, ...(priced ? [QUOTE_RULE] : [])]
  return {
    grid: grid(),
    legend: { ...legendFor(names.length, selected), data: names },
    tooltip: axisTooltip({
      unit: 'money',
      pointer: 'shadow',
      groups: [BARGAIN, APPRECIATION, ...(hasLoss ? [LOSS] : [])],
      totalLabel: false,
      references: [PAID, PRICE_DOT, SUBSCRIPTION, ...(priced ? [QUOTE_RULE] : [])],
      footer,
    }),
    xAxis: monthAxis(labels, { gap: true }),
    yAxis: moneyAxis(),
    series: [
      {
        id: 'ladder-base',
        name: 'ladder-base',
        type: 'bar' as const,
        stack: 'ladder',
        silent: true,
        tooltip: { show: false },
        color: 'transparent',
        barMaxWidth: WIDTH,
        data: paid,
      },
      bar('bargain', BARGAIN, ANATOMY_COLORS.bargain, bargain, 1),
      bar('appreciation', APPRECIATION, ANATOMY_COLORS.appreciation, appreciation, 2, soldCap),
      ...(hasLoss ? lossStack(lossBase, loss, WIDTH, 3) : []),
      dot('paid', PAID, ANATOMY_COLORS.paid, paid),
      dot('price', PRICE_DOT, ANATOMY_COLORS.appreciation, price),
      {
        // The annotation-marker grammar, FILLED: hollow stays reserved for sold.
        id: 'subscription',
        name: SUBSCRIPTION,
        type: 'scatter' as const,
        color: MUTED,
        symbol: 'diamond' as const,
        symbolSize: 9,
        z: 12,
        itemStyle: { borderColor: INK, borderWidth: 1 },
        data: lots.map((l) => Number(l.subscription_price)),
      },
      ...(priced ? [referenceLine(QUOTE_RULE, lots.map(() => Number(currentPrice)))] : []),
    ],
  }
}
```

- [ ] **4 Pass:** `npx vitest run src/components/espp/esppChartOptions.test.ts` → green.
- [ ] **5 Commit:** `git add src/components/espp/esppChartOptions.ts src/components/espp/esppChartOptions.test.ts && git commit -m "feat(espp): the per-share view — a floating range per lot with paid and price dots on the quote rule"`

---

### Task 4: `esppPriceOption`, `esppPriceCsv`, `sliceWindow`, `lotsBeforeHistory`

**Files:** Modify `src/components/espp/esppChartOptions.ts` · Test `src/components/espp/esppChartOptions.test.ts`

- [ ] **1 Write the failing tests** — append; extend the test's import from `./esppChartOptions` with `AVG_PAID, CLOSE, PURCHASES, SALES, SUBSCRIPTION, esppPriceCsv, esppPriceOption, lotsBeforeHistory, sliceWindow` and from `../../testing/esppFixtures` with `bars, septOffering`:

```ts
describe('esppPriceOption', () => {
  const lots = [
    esppLot(), // bought 2024-02-29
    esppLot({ id: 2, purchase_date: '2024-08-30', shares: '255.0000', sold_date: '2024-09-03', sold_price: '120.00000', is_sold: true, days_until_qualified: null }),
  ]

  it('returns null under two bars', () => {
    expect(esppPriceOption({ points: [], offerings: [septOffering], lots })).toBeNull()
    expect(esppPriceOption({ points: [bars[0]], offerings: [septOffering], lots })).toBeNull()
  })

  it('draws the closes, the two stepped rules with end labels, the wash against the average, and the markers', () => {
    const option = read(esppPriceOption({ points: bars, offerings: [septOffering], lots }))
    expect(option.grid).toEqual(GRID_VARIANTS.endLabel)
    expect(option.xAxis.data).toEqual(['Feb 27, 2024', 'Feb 29, 2024', 'Mar 1, 2024', 'Aug 30, 2024', 'Sep 3, 2024'])
    expect(option.yAxis.scale).toBe(true) // a price line has no additive reading
    expect(option.legend.data).toEqual([CLOSE, SUBSCRIPTION, AVG_PAID, PURCHASES, SALES])
    expect(byName(option, CLOSE)).toMatchObject({ type: 'line', color: PALETTE[0], lineStyle: { width: 2 } })
    expect(byName(option, CLOSE).data).toEqual([75, 79.112, 80, 119.37, 121])
    const sub = byName(option, SUBSCRIPTION) as unknown as { step: string; endLabel: { show: boolean; formatter: string } }
    expect(byName(option, SUBSCRIPTION)).toMatchObject({ color: MUTED, z: 9, lineStyle: { type: 'dashed', width: 2 } })
    expect(sub.step).toBe('end')
    expect(sub.endLabel).toEqual({ show: true, formatter: '{a}', color: MUTED, fontSize: 11 })
    expect(byName(option, SUBSCRIPTION).data).toEqual([48.509, 48.509, 48.509, 48.509, 48.509])
    // Null before the first purchase; the running average from the lot itself afterwards.
    expect(byName(option, AVG_PAID).data).toEqual([null, 41.23265, 41.23265, 41.23265, 41.23265])
    const above = option.series.find((s) => s.name === 'Above avg paid')!
    expect(above).toMatchObject({ stack: 'above-paid', color: POSITIVE, silent: true })
    expect(above.data).toEqual([null, 37.88, 38.77, 78.14, 79.77])
    expect(option.series.find((s) => s.name === 'Below avg paid')!.data).toEqual([null, 0, 0, 0, 0])
  })

  it('snaps purchases to the last bar on or before the date, hollow once sold, and sales to theirs', () => {
    const option = read(esppPriceOption({ points: bars, offerings: [septOffering], lots }))
    const purchases = byName(option, PURCHASES)
    expect(purchases).toMatchObject({ type: 'scatter', color: PALETTE[1], symbolSize: 10, z: 11 })
    expect(purchases.itemStyle).toEqual({ borderColor: INK, borderWidth: 1 })
    expect(purchases.data).toEqual([
      { value: ['Feb 29, 2024', 79.112], symbol: 'diamond', symbolRotate: 0, events: [{ text: 'Feb 29, 2024 · 260 sh · paid $41.23 · FMV $79.11' }] },
      {
        value: ['Aug 30, 2024', 119.37], symbol: 'diamond', symbolRotate: 0,
        events: [{ text: 'Aug 30, 2024 · 255 sh · paid $41.23 · FMV $79.11 · sold Sep 3, 2024' }],
        itemStyle: { color: SURFACE, borderColor: PALETTE[1], borderWidth: 1.5 },
      },
    ])
    const sales = byName(option, SALES)
    expect(sales).toMatchObject({ type: 'scatter', color: MUTED, symbolSize: 9 })
    expect(sales.data).toEqual([
      { value: ['Sep 3, 2024', 121], symbol: 'triangle', symbolRotate: 180, events: [{ text: 'Sold Sep 3, 2024 · 255 sh at $120.00' }] },
    ])
  })

  it('skips a purchase the history does not reach and drops the series and legend entries it cannot fill', () => {
    const early = esppLot({ id: 7, purchase_date: '2023-12-01' })
    const option = read(esppPriceOption({ points: bars.slice(0, 3), offerings: [], lots: [early] }))
    expect(option.series.some((s) => s.name === PURCHASES)).toBe(false)
    expect(option.series.some((s) => s.name === SUBSCRIPTION)).toBe(false) // no offering
    // The early lot's average still rules the whole window — it was bought before every bar.
    expect(byName(option, AVG_PAID).data).toEqual([41.23265, 41.23265, 41.23265])
    expect(option.legend.data).toEqual([CLOSE, AVG_PAID])
  })

  it('tooltips Close first, the two rules as references, and the markers as lines', () => {
    const option = read(esppPriceOption({ points: bars, offerings: [septOffering], lots }))
    expect(isGrammarTooltip(option.tooltip.formatter)).toBe(true)
    const purchase = (byName(option, PURCHASES).data as unknown[])[0]
    const parsed = tooltipRows(
      option.tooltip.formatter([
        { seriesName: CLOSE, seriesType: 'line', axisValueLabel: 'Feb 29, 2024', value: 79.112, color: PALETTE[0] },
        { seriesName: SUBSCRIPTION, seriesType: 'line', value: 48.509, color: MUTED },
        { seriesName: AVG_PAID, seriesType: 'line', value: 41.23265, color: MUTED },
        { seriesName: PURCHASES, seriesType: 'scatter', value: ['Feb 29, 2024', 79.112], color: PALETTE[1], data: purchase },
      ]),
    )
    expect(parsed.rows.map((r) => [r.kind, r.label, r.value])).toEqual([
      ['row', CLOSE, '$79.11'],
      ['ref', SUBSCRIPTION, '$48.51'],
      ['ref', AVG_PAID, '$41.23'],
    ])
    expect(parsed.notes).toEqual(['Feb 29, 2024 · 260 sh · paid $41.23 · FMV $79.11'])
  })
})

describe('sliceWindow / lotsBeforeHistory / esppPriceCsv', () => {
  it('slices the fetched series to the chip window, anchored on today', () => {
    expect(sliceWindow(bars, 365, '2024-09-04').map((p) => p.d)).toEqual(['2024-02-27', '2024-02-29', '2024-03-01', '2024-08-30', '2024-09-03'])
    expect(sliceWindow(bars, 30, '2024-09-04').map((p) => p.d)).toEqual(['2024-08-30', '2024-09-03'])
    expect(sliceWindow([], 30, '2024-09-04')).toEqual([])
  })
  it('counts the lots the stored history cannot reach', () => {
    expect(lotsBeforeHistory(bars, [esppLot({ purchase_date: '2023-12-01' }), esppLot()])).toBe(1)
    expect(lotsBeforeHistory([], [esppLot()])).toBe(0)
  })
  it('prints one row per bar with the rules and the day’s purchase or sale shares', () => {
    const lots = [esppLot(), esppLot({ id: 2, purchase_date: '2024-08-30', shares: '255.0000', sold_date: '2024-09-03', sold_price: '120.00000', is_sold: true })]
    const table = esppPriceCsv(bars, [septOffering], lots)
    expect(table.headers).toEqual(['Date', 'Close', 'Subscription price', 'Avg paid to date', 'Purchase (shares)', 'Sale (shares)'])
    expect(table.rows[0]).toEqual(['2024-02-27', '75.0000', '48.50900', '', '', ''])
    expect(table.rows[1]).toEqual(['2024-02-29', '79.1120', '48.50900', '41.23265', '260.0000', ''])
    expect(table.rows[4]).toEqual(['2024-09-03', '121.0000', '48.50900', '41.23265', '', '255.0000'])
  })
})
```

- [ ] **2 Fail:** `npx vitest run src/components/espp/esppChartOptions.test.ts -t "esppPriceOption|sliceWindow"`.
- [ ] **3 Implement** — append to `esppChartOptions.ts`:

```ts
// ── The employer price with your purchases (spec §6) ─────────────────────────────────────────

export interface EsppPriceInput {
  /** The window's daily bars, oldest first. */
  points: PricePoint[]
  /** Ascending by offering_start — the resolution order. */
  offerings: EsppOfferingOut[]
  lots: EsppLotOut[]
}

/** A purchase marker rides the close line at its bar; a sold lot's marker goes hollow. */
export interface PurchaseMarker extends ChartEventPoint {
  itemStyle?: { color: string; borderColor: string; borderWidth: number }
}

/** Index of the last bar on or before `iso`, or -1 when the history starts later. ISO strings
 *  compare as dates (format.ts's never-`new Date(iso)` rule). */
function barOnOrBefore(dates: string[], iso: string): number {
  let index = -1
  for (let i = 0; i < dates.length && dates[i] <= iso; i++) index = i
  return index
}

/** The covering offering's price per bar — greatest offering_start <= date (espp_calc's rule),
 *  null before the first offering. */
function subscriptionSteps(dates: string[], offerings: EsppOfferingOut[]): (number | null)[] {
  return dates.map((d) => {
    let covering: EsppOfferingOut | null = null
    for (const o of offerings) if (o.offering_start <= d) covering = o
    return covering === null ? null : Number(covering.subscription_price)
  })
}

/** The latest lot bought on or before each bar, and its running average — null before the first
 *  purchase, or on a pre-batch payload that carries no average. */
function avgPaidSteps(dates: string[], chain: EsppLotOut[]): (number | null)[] {
  return dates.map((d) => {
    let latest: EsppLotOut | null = null
    for (const l of chain) if (l.purchase_date <= d) latest = l
    const avg = latest?.avg_paid_to_date
    return avg === undefined || avg === null ? null : Number(avg)
  })
}

/**
 * Daily closes for the employer ticker against two stepped rules — the subscription price of the
 * offering in force and your average paid per share to date — with the above/below wash against
 * the average and one marker per purchase (and per sale). The holding drill-in's chart, with the
 * rules that make an ESPP legible: whenever the close sits above the subscription rule, the
 * lookback is binding. Returns null under two bars.
 */
export function esppPriceOption({ points, offerings, lots }: EsppPriceInput): EChartsOption | null {
  if (points.length < 2) return null
  const dates = points.map((p) => p.d)
  const labels = dates.map(formatDate)
  const closes = points.map((p) => Number(p.c))
  const chain = sortLots(lots)
  const subscription = subscriptionSteps(dates, offerings)
  const avgPaid = avgPaidSteps(dates, chain)
  const hasSub = subscription.some((v) => v !== null)
  const hasAvg = avgPaid.some((v) => v !== null)
  // The wash is TWO STACKED PAIRS against the STEPPED average (priceChartOptions' technique — a
  // piecewise visualMap with open-ended pieces throws on a real canvas, the 2026-09-04 probe).
  // Nothing draws before the first purchase: a null in every member leaves the gap honest.
  const wash = (name: string, stack: string, color: string, data: (number | null)[]) => ({
    name,
    type: 'line' as const,
    stack,
    symbol: 'none' as const,
    lineStyle: { width: 0 },
    color,
    emphasis: { disabled: true },
    tooltip: { show: false },
    silent: true,
    connectNulls: false,
    ...(color === 'transparent' ? {} : { areaStyle: { opacity: 0.12 } }),
    data,
  })
  const at = (i: number) => avgPaid[i] as number
  const washes = hasAvg
    ? [
        wash('wash-above-base', 'above-paid', 'transparent', avgPaid),
        wash('Above avg paid', 'above-paid', POSITIVE, closes.map((c, i) => (avgPaid[i] === null ? null : cents(Math.max(c - at(i), 0))))),
        wash('wash-below-base', 'below-paid', 'transparent', closes.map((c, i) => (avgPaid[i] === null ? null : Math.min(c, at(i))))),
        wash('Below avg paid', 'below-paid', NEGATIVE, closes.map((c, i) => (avgPaid[i] === null ? null : cents(Math.max(at(i) - c, 0))))),
      ]
    : []
  const purchases: PurchaseMarker[] = []
  const sales: ChartEventPoint[] = []
  for (const l of chain) {
    const bought = barOnOrBefore(dates, l.purchase_date)
    if (bought >= 0) {
      purchases.push({
        value: [labels[bought], closes[bought]],
        symbol: 'diamond',
        symbolRotate: 0,
        events: [
          {
            text: `${formatDate(l.purchase_date)} · ${formatShares(l.shares)} sh · paid ${formatCurrency(
              l.purchase_price,
            )} · FMV ${formatCurrency(l.purchase_fmv)}${l.is_sold ? ` · sold ${formatDate(l.sold_date)}` : ''}`,
          },
        ],
        // Hollow = sold, the page's one meaning for it (spec §5.2).
        ...(l.is_sold ? { itemStyle: { color: SURFACE, borderColor: PALETTE[1], borderWidth: 1.5 } } : {}),
      })
    }
    if (l.is_sold && l.sold_date !== null) {
      const sold = barOnOrBefore(dates, l.sold_date)
      if (sold >= 0) {
        sales.push({
          value: [labels[sold], closes[sold]],
          // The events grammar's sell glyph (historyChartOptions): the triangle, rotated.
          symbol: 'triangle',
          symbolRotate: 180,
          events: [
            {
              text: `Sold ${formatDate(l.sold_date)} · ${formatShares(l.shares)} sh${
                l.sold_price === null ? '' : ` at ${formatCurrency(l.sold_price)}`
              }`,
            },
          ],
        })
      }
    }
  }
  // Two dashed MUTED references look alike, so each names itself at its end (grid 'endLabel').
  const step = (name: string, data: (number | null)[]) => ({
    ...referenceLine(name, data, { step: 'end' }),
    endLabel: { show: true, formatter: '{a}', color: MUTED, fontSize: 11 },
  })
  const names = [
    CLOSE,
    ...(hasSub ? [SUBSCRIPTION] : []),
    ...(hasAvg ? [AVG_PAID] : []),
    ...(purchases.length > 0 ? [PURCHASES] : []),
    ...(sales.length > 0 ? [SALES] : []),
  ]
  const marker = (name: string, color: string, symbolSize: number, data: ChartEventPoint[]) => ({
    type: 'scatter' as const,
    name,
    color,
    symbolSize,
    itemStyle: { borderColor: INK, borderWidth: 1 },
    z: 11,
    data,
  })
  return {
    // 'all': the chips change the WINDOW handed in, so the zoom opens on everything it was given.
    dataZoom: timeZoom(dates, 'all'),
    grid: grid('endLabel'),
    // Listed explicitly so the four wash members stay OUT of the legend (the price chart's rule).
    legend: { ...legendFor(names.length), data: names },
    tooltip: axisTooltip({
      unit: 'money',
      references: [SUBSCRIPTION, AVG_PAID],
      annotationSeries: [PURCHASES, SALES],
      annotations: eventLines,
    }),
    xAxis: dateAxis(labels),
    // scale, unlike the money charts' zero anchor: a price line has no additive reading.
    yAxis: moneyAxis({ zero: false }),
    series: [
      ...washes,
      { ...LINE, name: CLOSE, color: PALETTE[0], data: closes },
      ...(hasSub ? [step(SUBSCRIPTION, subscription)] : []),
      ...(hasAvg ? [step(AVG_PAID, avgPaid)] : []),
      ...(purchases.length > 0 ? [marker(PURCHASES, PALETTE[1], 10, purchases)] : []),
      ...(sales.length > 0 ? [marker(SALES, MUTED, 9, sales)] : []),
    ],
  }
}

/** The chip window over the ONE fetched series, anchored on today (the chips slice, they do not
 *  refetch — the page already holds 3650 days for the offerings chip). */
export function sliceWindow(points: PricePoint[], days: number, todayIso: string): PricePoint[] {
  const since = addDays(todayIso, -days)
  return points.filter((p) => p.d >= since)
}

/** How many lots were bought before the stored history begins — the footer's honesty line. */
export function lotsBeforeHistory(points: PricePoint[], lots: EsppLotOut[]): number {
  if (points.length === 0) return 0
  const first = points[0].d
  return lots.filter((l) => l.purchase_date < first).length
}

/** The window as a table (F12): one row per bar, the two rules, and the day's purchase or sale. */
export function esppPriceCsv(points: PricePoint[], offerings: EsppOfferingOut[], lots: EsppLotOut[]): ExportTable {
  const dates = points.map((p) => p.d)
  const chain = sortLots(lots)
  const subscription = subscriptionSteps(dates, offerings)
  const avgPaid = avgPaidSteps(dates, chain)
  const bought = new Map<number, string>()
  const sold = new Map<number, string>()
  for (const l of chain) {
    const b = barOnOrBefore(dates, l.purchase_date)
    if (b >= 0) bought.set(b, l.shares)
    if (l.is_sold && l.sold_date !== null) {
      const s = barOnOrBefore(dates, l.sold_date)
      if (s >= 0) sold.set(s, l.shares)
    }
  }
  // Verbatim wire strings where one exists; the rules print the covering row's own text.
  const subText = (d: string) => {
    let covering: EsppOfferingOut | null = null
    for (const o of offerings) if (o.offering_start <= d) covering = o
    return covering === null ? '' : covering.subscription_price
  }
  const avgText = (d: string) => {
    let latest: EsppLotOut | null = null
    for (const l of chain) if (l.purchase_date <= d) latest = l
    return latest?.avg_paid_to_date ?? ''
  }
  void subscription
  void avgPaid
  return {
    headers: ['Date', 'Close', 'Subscription price', 'Avg paid to date', 'Purchase (shares)', 'Sale (shares)'],
    rows: points.map((p, i) => [p.d, p.c, subText(p.d), avgText(p.d), bought.get(i) ?? '', sold.get(i) ?? '']),
  }
}
```

Remove the two `void` lines and the unused `subscription`/`avgPaid` locals from `esppPriceCsv` before committing — the CSV prints the wire strings through `subText`/`avgText`, so the numeric steps are not needed there (they are shown above only to make the parallel obvious).

- [ ] **4 Pass:** `npx vitest run src/components/espp/esppChartOptions.test.ts` → all green. `npx eslint src/components/espp/esppChartOptions.ts` → clean.
- [ ] **5 Commit:** `git add src/components/espp/esppChartOptions.ts src/components/espp/esppChartOptions.test.ts && git commit -m "feat(espp): esppPriceOption — closes against the subscription and average-paid steps, wash, purchase and sale markers"`

---

### Task 5: Fixtures and the conformance roster

**Files:** Create `src/charts/fixtures/esppLotAnatomyDollars.fixture.ts`, `esppLotAnatomyPerShare.fixture.ts`, `esppPrice.fixture.ts` · Modify `src/charts/conformance.test.ts` (ROSTER)

- [ ] **1 Add the three names to `ROSTER`** in `src/charts/conformance.test.ts`, after `'whatIfDeltaBar',`:

```ts
  // ESPP visuals (2026-09-07 spec §5–§6): both views of the lot anatomy — hollow sold lots and
  // the loss overlay stack are branches the dollars fixture alone would not reach without a
  // sold and an underwater lot, so the shared fixtures carry both — and the price chart.
  'esppLotAnatomyDollars',
  'esppLotAnatomyPerShare',
  'esppPrice',
```

- [ ] **2 Fail:** `npx vitest run src/charts/conformance.test.ts` → `every builder in the spec has a fixture` lists the three.
- [ ] **3 Create the fixtures:**

```ts
// src/charts/fixtures/esppLotAnatomyDollars.fixture.ts
// The lot anatomy's Dollars view over the shared sheet lots: a held lot, two sold (hollow) lots
// and one under its FMV, so the loss overlay stack is on the canvas.
import type { ChartFixture } from './_types'
import { lotAnatomyOption } from '../../components/espp/esppChartOptions'
import { esppLotsResponse } from '../../testing/esppFixtures'

const fixture: ChartFixture = {
  name: 'esppLotAnatomyDollars',
  kind: 'cartesian',
  ariaLabel:
    "Stacked bar chart of each ESPP lot's value split into amount paid, bargain element at purchase and appreciation since, with a per-share view",
  build: () => lotAnatomyOption(esppLotsResponse(), { view: 'dollars' }),
}
export default fixture
```

```ts
// src/charts/fixtures/esppLotAnatomyPerShare.fixture.ts
import type { ChartFixture } from './_types'
import { QUOTE_RULE, lotAnatomyOption } from '../../components/espp/esppChartOptions'
import { esppLotsResponse } from '../../testing/esppFixtures'

const fixture: ChartFixture = {
  name: 'esppLotAnatomyPerShare',
  kind: 'cartesian',
  ariaLabel:
    "Stacked bar chart of each ESPP lot's value split into amount paid, bargain element at purchase and appreciation since, with a per-share view",
  dashed: [QUOTE_RULE],
  build: () => lotAnatomyOption(esppLotsResponse(), { view: 'per-share' }),
}
export default fixture
```

```ts
// src/charts/fixtures/esppPrice.fixture.ts
import type { ChartFixture } from './_types'
import { AVG_PAID, SUBSCRIPTION, esppPriceOption } from '../../components/espp/esppChartOptions'
import { anatomyLots, bars, septOffering } from '../../testing/esppFixtures'

const fixture: ChartFixture = {
  name: 'esppPrice',
  kind: 'cartesian',
  ariaLabel:
    "Line chart of NVDA's daily closes against the subscription price and your average paid per share, with purchase markers",
  dashed: [SUBSCRIPTION, AVG_PAID],
  build: () => esppPriceOption({ points: bars, offerings: [septOffering], lots: anatomyLots }),
}
export default fixture
```

- [ ] **4 Pass:** `npx vitest run src/charts/conformance.test.ts` → green, every rule (token colors, grammar axes, named grid, branded tooltip, bar caps and borders, dashed only on references, stagger on stacks). If a rule fails, fix the BUILDER — the fixture states the contract.
- [ ] **5 Commit:** `git add src/charts && git commit -m "test(charts): ESPP fixtures join the conformance roster"`

---

### Task 6: `LotAnatomyCard`

**Files:** Create `src/components/espp/LotAnatomyCard.tsx`, `src/components/espp/LotAnatomyCard.test.tsx`

- [ ] **1 Write the failing tests:**

```tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { esppLot, esppLotsResponse } from '../../testing/esppFixtures'
import LotAnatomyCard, { ANATOMY_ARIA } from './LotAnatomyCard'

vi.mock('../EChart', async () => {
  const { createElement } = await import('react')
  return {
    default: ({ option, ariaLabel, onHover, onHoverEnd, onClick }: {
      option: { series?: { name: string }[] }
      ariaLabel?: string
      onHover?: (p: { dataIndex: number }) => void
      onHoverEnd?: () => void
      onClick?: (p: { dataIndex: number }) => void
    }) =>
      createElement(
        'div',
        { 'data-testid': 'echart', 'aria-label': ariaLabel, 'data-series': (option.series ?? []).map((s) => s.name).join('|') },
        createElement('button', { type: 'button', onClick: () => onHover?.({ dataIndex: 1 }) }, 'hover-1'),
        createElement('button', { type: 'button', onClick: () => onHoverEnd?.() }, 'hover-end'),
        createElement('button', { type: 'button', onClick: () => onClick?.({ dataIndex: 3 }) }, 'click-3'),
      ),
  }
})
// ChartCard reads the frame context; outside a PageFrame it is `fromCache: false`.
vi.mock('../shell/PageFrame', () => ({ usePageFrame: () => ({ fromCache: false }) }))

afterEach(cleanup)

describe('LotAnatomyCard', () => {
  it('mounts the Dollars view through ChartCard with the house sentence, the toggle and the footer', () => {
    render(<LotAnatomyCard data={esppLotsResponse()} />)
    expect(screen.getByRole('heading', { name: /Lot anatomy/ })).toBeTruthy()
    const chart = screen.getByTestId('echart')
    expect(chart.getAttribute('aria-label')).toBe(ANATOMY_ARIA)
    expect(chart.getAttribute('data-series')).toBe('Paid|Bargain element|Appreciation|loss-base|Below purchase FMV')
    expect(screen.getByRole('button', { name: 'Dollars' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText(/NVDA · \$171\.31 · as of Aug 15, 2026 · Hollow = sold/)).toBeTruthy()
    expect(
      screen.getByText('Of the $41,888.94 bargain element across your held lots, $3,645.45 was the plan discount and $38,243.49 the lookback.'),
    ).toBeTruthy()
  })

  it('switches to the per-share series on the toggle', () => {
    render(<LotAnatomyCard data={esppLotsResponse()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Per share' }))
    expect(screen.getByTestId('echart').getAttribute('data-series')).toBe(
      'ladder-base|Bargain element|Appreciation|loss-base|Below purchase FMV|Paid|Price|Subscription price|Current quote',
    )
    expect(screen.getByRole('button', { name: 'Per share' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('reports the hovered and clicked lot by id, in chain order', () => {
    const onHoverLot = vi.fn()
    const onSelectLot = vi.fn()
    render(<LotAnatomyCard data={esppLotsResponse()} onHoverLot={onHoverLot} onSelectLot={onSelectLot} />)
    fireEvent.click(screen.getByText('hover-1'))
    expect(onHoverLot).toHaveBeenLastCalledWith(2) // the Aug 2024 lot is second in the chain
    fireEvent.click(screen.getByText('hover-end'))
    expect(onHoverLot).toHaveBeenLastCalledWith(null)
    fireEvent.click(screen.getByText('click-3'))
    expect(onSelectLot).toHaveBeenCalledWith(4)
  })

  it('shows the empty sentence with no lots, and a skeleton on a pre-batch payload', () => {
    const { rerender } = render(<LotAnatomyCard data={esppLotsResponse({ lots: [], totals: undefined })} />)
    expect(screen.getByText('No lots yet — add your first purchase in the Lots card below.')).toBeTruthy()
    const stale = { ...esppLot() } as Record<string, unknown>
    delete stale.fmv_value
    rerender(<LotAnatomyCard data={esppLotsResponse({ lots: [stale as unknown as ReturnType<typeof esppLot>], totals: undefined })} />)
    expect(document.querySelector('.chart-card-skeleton')).not.toBeNull()
    expect(screen.queryByTestId('echart')).toBeNull()
  })

  it('states the missing quote in the footer and drops the Hollow clause with nothing sold', () => {
    render(
      <LotAnatomyCard
        data={esppLotsResponse({
          current_price: null,
          quoted_at: null,
          lots: [esppLot({ market_value: null, gain_amount: null, gain_pct: null, appreciation: null })],
          totals: {
            ...esppLotsResponse().totals!,
            sold: { lots: 0, shares: '0.0000', cost_basis: '0.00', proceeds: '0.00', gain_amount: '0.00' },
          },
        })}
      />,
    )
    expect(screen.getByText('NVDA — no live quote; unsold lots are unpriced.')).toBeTruthy()
    expect(screen.queryByText(/Hollow = sold/)).toBeNull()
  })
})
```

- [ ] **2 Fail:** `npx vitest run src/components/espp/LotAnatomyCard.test.tsx` → cannot resolve.
- [ ] **3 Create `src/components/espp/LotAnatomyCard.tsx`:**

```tsx
import { useMemo, useState } from 'react'
import ChartCard from '../ChartCard'
import Segmented from '../shell/Segmented'
import type { EsppLotsResponse } from '../../types/api'
import { formatCurrency, formatDate } from '../../utils/format'
import { hasAnatomy, lotAnatomyCsv, lotAnatomyOption, sortLots } from './esppChartOptions'
import type { AnatomyView } from './esppChartOptions'
import '../panels.css'

// The house sentence the mount carries (F11) — the fixtures copy it from here.
export const ANATOMY_ARIA =
  "Stacked bar chart of each ESPP lot's value split into amount paid, bargain element at purchase and appreciation since, with a per-share view"

const VIEWS = [
  { value: 'dollars', label: 'Dollars' },
  { value: 'per-share', label: 'Per share' },
] as const

/**
 * The lot anatomy card (2026-09-07 spec §5): the builder's two views behind a chart-local
 * toggle, legend picks mirrored back (grammar §9), and the two footer sentences — the quote the
 * unsold lots were priced at, and the bargain element's split into discount and lookback from the
 * server's totals. A payload without the anatomy fields (a warm pre-batch snapshot) holds the
 * skeleton until the mount's own fetch lands; it is never "no lots".
 */
export default function LotAnatomyCard({
  data,
  onHoverLot,
  onSelectLot,
}: {
  data: EsppLotsResponse
  /** The hovered lot's id, or null when the pointer leaves — the lots table lights the row. */
  onHoverLot?: (id: number | null) => void
  onSelectLot?: (id: number) => void
}) {
  const [view, setView] = useState<AnatomyView>('dollars')
  const [legend, setLegend] = useState<Record<string, boolean>>({})
  const ready = data.totals !== undefined && hasAnatomy(data.lots)
  // Chain order is the builder's axis order, so a dataIndex maps to a lot through it.
  const chain = useMemo(() => sortLots(data.lots), [data.lots])
  // Memoized: EChart keys its effect on [option] with notMerge (AllocationPanel's note).
  const option = useMemo(
    () => (ready ? lotAnatomyOption(data, { view, selected: legend }) : null),
    [data, ready, view, legend],
  )
  const lotAt = (index: number | undefined): number | null =>
    index === undefined ? null : (chain[index]?.id ?? null)
  const held = data.totals?.held
  const soldAny = data.totals !== undefined && data.totals.sold.lots > 0

  return (
    <ChartCard
      title="Lot anatomy"
      hint="Each purchase split three ways: what you paid, the bargain element at purchase (the plan discount, plus the lookback when the price had risen above the subscription price), and the market's move since. Unsold lots at the current quote; sold lots at their sale price, drawn hollow."
      ariaLabel={ANATOMY_ARIA}
      option={option}
      empty="No lots yet — add your first purchase in the Lots card below."
      exportName="espp-lot-anatomy"
      csv={ready ? () => lotAnatomyCsv(data) : undefined}
      height={300}
      span={6}
      busy={!ready && data.lots.length > 0}
      controls={
        <Segmented
          variant="toggle"
          size="sm"
          ariaLabel="Lot chart view"
          options={VIEWS}
          value={view}
          onChange={setView}
        />
      }
      onLegendChange={(selected) => setLegend((current) => ({ ...current, ...selected }))}
      onHover={(p) => onHoverLot?.(lotAt(p.dataIndex))}
      onHoverEnd={() => onHoverLot?.(null)}
      onClick={(p) => {
        const id = lotAt(p.dataIndex)
        if (id !== null) onSelectLot?.(id)
      }}
      footer={
        <>
          {/* The quote line the Lots card prints, plus the outline's text backup. The date is
              rendered, not judged (the table's own note). */}
          <p className="drill-hint">
            {data.espp_ticker === null
              ? 'No ESPP ticker configured — set the espp_ticker setting to price these lots.'
              : data.current_price === null
                ? `${data.espp_ticker} — no live quote; unsold lots are unpriced.`
                : `${data.espp_ticker} · ${formatCurrency(data.current_price)} · as of ${formatDate(data.quoted_at)}`}
            {soldAny && ' · Hollow = sold'}
          </p>
          {held !== undefined && Number(held.bargain_element) > 0 && (
            <p className="drill-hint">
              {`Of the ${formatCurrency(held.bargain_element)} bargain element across your held lots, ${formatCurrency(
                held.discount_component,
              )} was the plan discount and ${formatCurrency(held.lookback_component)} the lookback.`}
            </p>
          )}
        </>
      }
    />
  )
}
```

- [ ] **4 Pass:** `npx vitest run src/components/espp/LotAnatomyCard.test.tsx` → 5 green.
- [ ] **5 Commit:** `git add src/components/espp/LotAnatomyCard.tsx src/components/espp/LotAnatomyCard.test.tsx && git commit -m "feat(espp): LotAnatomyCard — the anatomy chart with its Dollars · Per share toggle and footer"`

---

### Task 7: `EsppPriceCard`

**Files:** Create `src/components/espp/EsppPriceCard.tsx`, `src/components/espp/EsppPriceCard.test.tsx`

- [ ] **1 Write the failing tests:**

```tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PricePoint } from '../../types/api'
import { anatomyLots, bars, esppLot, septOffering } from '../../testing/esppFixtures'
import EsppPriceCard from './EsppPriceCard'

vi.mock('../EChart', async () => {
  const { createElement } = await import('react')
  return {
    default: ({ option, ariaLabel }: { option: { xAxis?: { data?: unknown[] }; series?: { name: string }[] }; ariaLabel?: string }) =>
      createElement('div', {
        'data-testid': 'echart',
        'aria-label': ariaLabel,
        'data-categories': (option.xAxis?.data ?? []).join(','),
        'data-series': (option.series ?? []).map((s) => s.name).join('|'),
      }),
  }
})
vi.mock('../shell/PageFrame', () => ({ usePageFrame: () => ({ fromCache: false }) }))
// The chips and the footer are anchored on today; pin it a day after the last bar.
vi.mock('../../utils/months', async () => {
  const actual = await vi.importActual<typeof import('../../utils/months')>('../../utils/months')
  return { ...actual, todayIso: () => '2024-09-04' }
})

afterEach(cleanup)

/** Ten years of one bar a month — long enough that every chip stays live. */
const decade: PricePoint[] = Array.from({ length: 120 }, (_, i) => {
  const year = 2014 + Math.floor((i + 8) / 12)
  const month = ((i + 8) % 12) + 1
  return { d: `${year}-${String(month).padStart(2, '0')}-15`, c: String(50 + i) }
})

describe('EsppPriceCard', () => {
  it('titles itself after the ticker, mounts the chart on the whole fetched series, and says where the history starts', () => {
    render(<EsppPriceCard ticker="NVDA" bars={bars} offerings={[septOffering]} lots={anatomyLots} />)
    expect(screen.getByRole('heading', { name: /NVDA vs your purchases/ })).toBeTruthy()
    const chart = screen.getByTestId('echart')
    expect(chart.getAttribute('aria-label')).toBe(
      "Line chart of NVDA's daily closes against the subscription price and your average paid per share, with purchase markers",
    )
    expect(chart.getAttribute('data-categories')?.split(',').length).toBe(5)
    // Five bars answer a 3650-day request: the extent is known, so 3Y and All would refetch nothing
    // and the widest live chip (1Y) is the one pressed.
    expect(screen.getByRole('button', { name: '1Y' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '3Y' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'All' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(/\+61\.3% over this window · history since Feb 27, 2024/)).toBeTruthy()
  })

  it('counts the lots the stored history predates', () => {
    render(<EsppPriceCard ticker="NVDA" bars={bars} offerings={[septOffering]} lots={[esppLot({ purchase_date: '2023-12-01' }), ...anatomyLots]} />)
    expect(screen.getByText('1 lot predates the stored history — the employer backfill reaches it on the next price refresh.')).toBeTruthy()
  })

  it('defaults to All over a long history and slices the series when a chip is pressed', () => {
    render(<EsppPriceCard ticker="NVDA" bars={decade} offerings={[septOffering]} lots={anatomyLots} />)
    expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('echart').getAttribute('data-categories')?.split(',').length).toBe(120)
    fireEvent.click(screen.getByRole('button', { name: '1Y' }))
    expect(screen.getByTestId('echart').getAttribute('data-categories')?.split(',').length).toBe(12)
    expect(screen.getByText(/window from/)).toBeTruthy() // a full-length window says nothing about inception
  })

  it('holds a skeleton while the bars are in flight, and names the missing ticker or history', () => {
    const { rerender } = render(<EsppPriceCard ticker="NVDA" bars={null} offerings={[]} lots={[]} />)
    expect(document.querySelector('.chart-card-skeleton')).not.toBeNull()
    rerender(<EsppPriceCard ticker="NVDA" bars={[]} offerings={[]} lots={[]} />)
    expect(screen.getByText('No stored price history for NVDA yet — run a price refresh.')).toBeTruthy()
    rerender(<EsppPriceCard ticker={null} bars={[]} offerings={[]} lots={[]} />)
    expect(screen.getByRole('heading', { name: /Employer price vs your purchases/ })).toBeTruthy()
    expect(screen.getByText('No ESPP ticker configured — set the espp_ticker setting to chart the price.')).toBeTruthy()
  })
})
```

- [ ] **2 Fail:** `npx vitest run src/components/espp/EsppPriceCard.test.tsx`.
- [ ] **3 Create `src/components/espp/EsppPriceCard.tsx`:**

```tsx
import { useMemo, useState } from 'react'
import ChartCard from '../ChartCard'
import Segmented from '../shell/Segmented'
import type { EsppLotOut, EsppOfferingOut, PricePoint } from '../../types/api'
import { formatPct } from '../../utils/format'
import { todayIso } from '../../utils/months'
import { PRICE_SPANS, priceWindowSummary, reachableSpans } from '../portfolio/priceChartOptions'
import type { SpanDays } from '../portfolio/priceChartOptions'
import { esppPriceCsv, esppPriceOption, lotsBeforeHistory, sliceWindow } from './esppChartOptions'
import '../panels.css'

// The page fetches this many days once (the offerings chip's series); the chips slice it.
const FETCHED_DAYS = 3650

/**
 * The employer's daily closes against the subscription rule and your average paid (2026-09-07
 * spec §6). The chips are WINDOWS over the one fetched series, not refetches — the page already
 * holds ten years for the offerings chip — so a chip whose window reaches past the stored history
 * is disabled (the holding drill-in's `reachableSpans` rule), and the default is the widest
 * live one: All when the history is long, 1Y when it is a year old. `bars === null` means the
 * fetch has not answered; `[]` means there is nothing to draw.
 */
export default function EsppPriceCard({
  ticker,
  bars,
  offerings,
  lots,
}: {
  ticker: string | null
  bars: PricePoint[] | null
  offerings: EsppOfferingOut[]
  lots: EsppLotOut[]
}) {
  const today = todayIso()
  const [pick, setPick] = useState<SpanDays>(3650)
  const all = bars ?? []
  const reachable = reachableSpans(all, FETCHED_DAYS, today)
  const live = PRICE_SPANS.map((s) => s.days).filter((d) => reachable[d])
  const span: SpanDays = reachable[pick] ? pick : (live[live.length - 1] ?? 365)
  const window = useMemo(() => sliceWindow(all, span, today), [all, span, today])
  const option = useMemo(() => esppPriceOption({ points: window, offerings, lots }), [window, offerings, lots])
  const summary = priceWindowSummary(window, span, today)
  const predating = lotsBeforeHistory(all, lots)
  const name = ticker ?? 'the employer'

  return (
    <ChartCard
      title={ticker === null ? 'Employer price vs your purchases' : `${ticker} vs your purchases`}
      hint="Daily closes over the chosen window. Dashed rules: the subscription price of the offering in force, and your average paid per share to date, which steps up at each purchase. The wash is green above your average paid and red below. Diamonds are purchases (hollow once sold); triangles are sales."
      ariaLabel={`Line chart of ${name}'s daily closes against the subscription price and your average paid per share, with purchase markers`}
      option={option}
      empty={
        ticker === null
          ? 'No ESPP ticker configured — set the espp_ticker setting to chart the price.'
          : `No stored price history for ${ticker} yet — run a price refresh.`
      }
      exportName="espp-price-history"
      csv={window.length > 0 ? () => esppPriceCsv(window, offerings, lots) : undefined}
      height={300}
      span={6}
      zoomable
      busy={ticker !== null && bars === null}
      controls={
        <Segmented
          variant="toggle"
          size="sm"
          ariaLabel="History window"
          options={PRICE_SPANS.map((s) => ({ value: String(s.days), label: s.label, disabled: !reachable[s.days] }))}
          value={String(span)}
          onChange={(value) => setPick(Number(value) as SpanDays)}
        />
      }
      footer={
        summary === null && predating === 0 ? undefined : (
          <>
            {summary !== null && (
              <p className="drill-hint">
                {formatPct(summary.changePct)} over this window ·{' '}
                {/* 'history since' is a claim about INCEPTION, and only a response short of the
                    window it asked for earns it (the holding drill-in's rule). */}
                {summary.extentKnown ? `history since ${summary.since}` : `window from ${summary.since}`}
              </p>
            )}
            {predating > 0 && (
              <p className="drill-hint">
                {`${predating} ${predating === 1 ? 'lot predates' : 'lots predate'} the stored history — the employer backfill ${
                  predating === 1 ? 'reaches it' : 'reaches them'
                } on the next price refresh.`}
              </p>
            )}
          </>
        )
      }
    />
  )
}
```

- [ ] **4 Pass:** `npx vitest run src/components/espp/EsppPriceCard.test.tsx` → 4 green. (If the "+61.3%" figure differs, recompute from the fixture: (121 − 75) / 75 = 0.6133; fix the TEST only if your arithmetic proves the plan's wrong.)
- [ ] **5 Commit:** `git add src/components/espp/EsppPriceCard.tsx src/components/espp/EsppPriceCard.test.tsx && git commit -m "feat(espp): EsppPriceCard — the employer price with your purchases behind window chips"`

---

### Task 8: Page wiring

**Files:** Modify `src/pages/EsppPage.tsx` (`bars` state, `LotsPanel` row ids/highlight, the page's return) · Create `src/components/espp/charts.css`, `src/pages/EsppPage.charts.test.tsx`

- [ ] **1 Write the failing tests** — `src/pages/EsppPage.charts.test.tsx`:

```tsx
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearSnapshots } from '../api/snapshotCache'
import { bars, esppLotsResponse, septOffering } from '../testing/esppFixtures'
import EsppPage from './EsppPage'

vi.mock('../api/espp', () => ({
  fetchLots: vi.fn(), createLot: vi.fn(), updateLot: vi.fn(), deleteLot: vi.fn(),
  fetchOfferings: vi.fn(), createOffering: vi.fn(), updateOffering: vi.fn(), deleteOffering: vi.fn(),
  createPeriod: vi.fn(), updatePeriod: vi.fn(), deletePeriod: vi.fn(), fetchModeler: vi.fn(),
}))
vi.mock('../api/prices', () => ({ fetchPriceHistory: vi.fn() }))
vi.mock('../components/EChart', async () => {
  const { createElement } = await import('react')
  return {
    default: ({ option, ariaLabel, onHover, onHoverEnd, onClick }: {
      option: { xAxis?: { data?: unknown[] }; series?: { name: string }[] }
      ariaLabel?: string
      onHover?: (p: { dataIndex: number }) => void
      onHoverEnd?: () => void
      onClick?: (p: { dataIndex: number }) => void
    }) =>
      createElement(
        'div',
        { 'data-testid': 'echart', 'aria-label': ariaLabel, 'data-categories': (option.xAxis?.data ?? []).join(','), 'data-series': (option.series ?? []).map((s) => s.name).join('|') },
        createElement('button', { type: 'button', onClick: () => onHover?.({ dataIndex: 0 }) }, `${ariaLabel}::hover-0`),
        createElement('button', { type: 'button', onClick: () => onHoverEnd?.() }, `${ariaLabel}::hover-end`),
        createElement('button', { type: 'button', onClick: () => onClick?.({ dataIndex: 0 }) }, `${ariaLabel}::click-0`),
      ),
  }
})
import { fetchLots, fetchModeler, fetchOfferings } from '../api/espp'
import { fetchPriceHistory } from '../api/prices'

const renderPage = () => render(<EsppPage />, { wrapper: MemoryRouter })
const anatomyAria = "Stacked bar chart of each ESPP lot's value split into amount paid, bargain element at purchase and appreciation since, with a per-share view"

beforeEach(() => {
  clearSnapshots()
  vi.mocked(fetchLots).mockResolvedValue(esppLotsResponse())
  vi.mocked(fetchOfferings).mockResolvedValue([septOffering])
  // The modeler is Lane 2's concern; a rejected feed keeps its card out of these tests' way.
  vi.mocked(fetchModeler).mockRejectedValue(new Error('not under test'))
  vi.mocked(fetchPriceHistory).mockResolvedValue({ ticker: 'NVDA', points: bars })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('EsppPage — the two chart cards', () => {
  it('mounts both cards side by side in a card-grid above the lots card', async () => {
    renderPage()
    await screen.findByText('$10,720.49')
    const grid = document.querySelector('.card-grid') as HTMLElement
    expect(grid).not.toBeNull()
    const cards = grid.querySelectorAll(':scope > .chart-card')
    expect(cards.length).toBe(2)
    expect(cards[0].className).toContain('span-6')
    expect(cards[1].className).toContain('span-6')
    expect(screen.getByLabelText(anatomyAria)).toBeTruthy()
    expect(await screen.findByLabelText(/Line chart of NVDA's daily closes/)).toBeTruthy()
    // The grid comes BEFORE the lots card in the document.
    const lots = screen.getByRole('heading', { name: /^Lots/ }).closest('section') as HTMLElement
    expect(grid.compareDocumentPosition(lots) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('fetches ten years of bars once and hands them to the price card', async () => {
    renderPage()
    await screen.findByLabelText(/Line chart of NVDA's daily closes/)
    expect(vi.mocked(fetchPriceHistory)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetchPriceHistory)).toHaveBeenCalledWith('NVDA', 3650)
    expect(screen.getByLabelText(/Line chart of NVDA's daily closes/).getAttribute('data-categories')?.split(',').length).toBe(5)
  })

  it('lights the hovered lot’s row and scrolls to the clicked one', async () => {
    renderPage()
    await screen.findByText('$10,720.49')
    const scroll = vi.fn()
    ;(document.getElementById('lot-row-1') as HTMLElement).scrollIntoView = scroll
    fireEvent.click(screen.getByText(`${anatomyAria}::hover-0`))
    expect(document.getElementById('lot-row-1')?.className).toContain('is-highlighted')
    fireEvent.click(screen.getByText(`${anatomyAria}::hover-end`))
    expect(document.getElementById('lot-row-1')?.className ?? '').not.toContain('is-highlighted')
    fireEvent.click(screen.getByText(`${anatomyAria}::click-0`))
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' })
    expect(document.getElementById('lot-row-1')?.className).toContain('is-highlighted')
  })

  it('shows the price card’s empty sentence when the bars fetch fails, never a skeleton forever', async () => {
    vi.mocked(fetchPriceHistory).mockRejectedValue(new Error('offline'))
    renderPage()
    expect(await screen.findByText('No stored price history for NVDA yet — run a price refresh.')).toBeTruthy()
  })

  it('names the missing ticker on the price card without ever fetching bars', async () => {
    vi.mocked(fetchLots).mockResolvedValue(esppLotsResponse({ espp_ticker: null, current_price: null, quoted_at: null }))
    renderPage()
    expect(await screen.findByText('No ESPP ticker configured — set the espp_ticker setting to chart the price.')).toBeTruthy()
    await act(async () => {})
    expect(vi.mocked(fetchPriceHistory)).not.toHaveBeenCalled()
    await waitFor(() => expect(document.querySelector('.chart-card-skeleton')).toBeNull())
  })
})
```

- [ ] **2 Fail:** `npx vitest run src/pages/EsppPage.charts.test.tsx` → no `.card-grid`.
- [ ] **3 Create `src/components/espp/charts.css`:**

```css
/* Chart-to-table hover (2026-09-07 spec §5.6): the hovered or clicked lot's row lights up without
   stealing the editing tint (.is-editing is the surface-2 wash). */
.espp-page tr.is-highlighted td {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.espp-page tr.is-highlighted td:first-child {
  box-shadow: inset 3px 0 0 var(--accent);
}
```

- [ ] **4 Implement in `EsppPage.tsx`:**

Imports: add `import LotAnatomyCard from '../components/espp/LotAnatomyCard'`, `import EsppPriceCard from '../components/espp/EsppPriceCard'`, `import '../components/espp/charts.css'`, and `useRef` is already imported.

`LotsPanel` gains a prop `highlightId: number | null` and its row becomes:

```tsx
                <tr
                  key={lot.id}
                  // The chart cards address rows by id (spec §5.6) — the scroll target and the ring.
                  id={`lot-row-${lot.id}`}
                  className={
                    [lot.id === editingId ? 'is-editing' : '', lot.id === highlightId ? 'is-highlighted' : '']
                      .filter(Boolean)
                      .join(' ') || undefined
                  }
                >
```

In the page component:

- `bars` becomes nullable — `const [bars, setBars] = useState<PricePoint[] | null>(null)` with the comment *"null = the fetch has not answered (the price card holds its skeleton); [] = nothing to draw or no ticker."* In `loadLots`, the lazy fetch block becomes:

```tsx
        if (!barsFetched.current) {
          if (data.espp_ticker === null) {
            // No ticker, no fetch — and the price card must not wait forever for one.
            setBars((current) => current ?? [])
          } else {
            barsFetched.current = true
            fetchPriceHistory(data.espp_ticker, 3650)
              .then((history) => setBars(history.points))
              .catch(() => setBars([]))
          }
        }
```

- `OfferingsPanel` receives `bars={bars ?? []}`.
- Highlight state, beside the other page state:

```tsx
  // The chart-to-table ring (spec §5.6): the hovered lot's id, or the clicked one held for 2s.
  const [highlightLotId, setHighlightLotId] = useState<number | null>(null)
  const highlightHold = useRef<number | undefined>(undefined)
  const selectLot = (id: number) => {
    setHighlightLotId(id)
    // jsdom has no scrollIntoView; the optional call keeps the tests honest about that.
    document.getElementById(`lot-row-${id}`)?.scrollIntoView?.({ block: 'nearest' })
    window.clearTimeout(highlightHold.current)
    highlightHold.current = window.setTimeout(() => setHighlightLotId(null), 2000)
  }
```

- In the return, immediately ABOVE the lots `<Feed` (after whatever the headline strip block is — do not edit that block):

```tsx
        {/* The two chart cards (2026-09-07 spec §5–§6), side by side under the headline strip;
            the grid's own rule stacks them under 1000px. The lots payload is the anatomy card's
            whole input, so it renders as soon as the lots do and holds a skeleton on a warm
            pre-batch snapshot; the price card waits on the bars the offerings chip already fetches. */}
        {lots !== null && (
          <div className="card-grid">
            <LotAnatomyCard data={lots} onHoverLot={setHighlightLotId} onSelectLot={selectLot} />
            <EsppPriceCard
              ticker={lots.espp_ticker}
              bars={bars}
              offerings={offerings ?? []}
              lots={lots.lots}
            />
          </div>
        )}
```

and pass `highlightId={highlightLotId}` into `<LotsPanel …/>`.

- [ ] **5 Pass:** `npx vitest run src/pages/EsppPage.charts.test.tsx src/pages/EsppPage.test.tsx` → both files green (the existing page tests have no chart mock — `ChartCard` mounts `EChart`, which needs a canvas; if `EsppPage.test.tsx` now fails on `echarts.init`, add at its top the same `vi.mock('../components/EChart', …)` block used above, minus the buttons — that mock is the only edit this lane makes to that file, and it is confined to the mocks region).
- [ ] **6 Commit:** `git add src/pages/EsppPage.tsx src/pages/EsppPage.charts.test.tsx src/components/espp/charts.css $(git diff --name-only src/pages/EsppPage.test.tsx) && git commit -m "feat(espp): the two chart cards mount side by side under the headline; hover and click reach the lots table"`

---

### Task 9: The real-canvas probe

**Files:** Create `tools/probes/espp-3/probe.html`, `tools/probes/espp-3/shoot.mjs` · Modify `tools/probes/README.md` (one table row)

- [ ] **1 Create `tools/probes/espp-3/probe.html`** — REAL echarts from `node_modules` fed the exact shapes the builders emit (copy the option literals from a `console.log(JSON.stringify(option))` of the two fixtures if you prefer; function-valued keys — the stagger and the cap label — are dropped by JSON, which is fine for the probe):

```html
<!doctype html>
<!-- ESPP visuals probe (2026-09-07 spec §9): the forms this batch adds, rendered by REAL echarts —
     (A) the per-share view: two stacks on one column (barGap -100%), hollow sold items, scatters
     over bars on a category axis, a dashed quote rule; (B) the price chart: two stepped references
     with endLabels, a wash with nulls before the first purchase, diamond/triangle markers with a
     hollow item. Not part of the app; shoot it with tools/probes/espp-3/shoot.mjs. -->
<html><head><meta charset="utf-8" />
<style>
  body { background: #171a21; color: #e6e9ef; font: 14px system-ui; margin: 24px; }
  .title { margin: 0 0 6px 2px; font-size: 13px; letter-spacing: .08em; color: #8b93a3; }
  .chart { width: 680px; height: 300px; margin-bottom: 28px; }
  .row { display: flex; gap: 24px; }
</style></head><body>
<p class="title">A — PER SHARE: ladder stack + loss stack overlaid (barGap -100%), hollow sold column (Aug 2024), Paid/Price dots (hollow on sold), filled subscription diamonds, dashed quote rule. LOOK FOR: the two stacks share ONE column; the red overlay sits over Aug 2025's bar top; the doubled hairline where hollow segments meet</p>
<p class="title">B — PRICE: two dashed steps with end labels, green wash from the avg-paid step, nulls before the first purchase, diamond purchases (2nd hollow), a triangle sale</p>
<div class="row"><div id="a" class="chart"></div><div id="b" class="chart"></div></div>
<script src="../../../node_modules/echarts/dist/echarts.js"></script>
<script>
const SURFACE = '#171a21', INK = '#e6e9ef', MUTED = '#8b93a3', BLUE = '#3987e5', ORANGE = '#d95926', GREEN = '#199e70', RED = '#e05252', POSITIVE = '#3fb968'
const draw = (id, option) => echarts.init(document.getElementById(id), null, { renderer: 'canvas' }).setOption(option)
const hollow = (value, color) => ({ value, itemStyle: { color: 'transparent', borderColor: color, borderWidth: 1.5 } })
const hollowDot = (value, color) => ({ value, itemStyle: { color: SURFACE, borderColor: color, borderWidth: 1.5 } })
const marks = { itemStyle: { borderColor: SURFACE, borderWidth: 1 }, emphasis: { focus: 'series', itemStyle: { borderColor: INK } } }
const labels = ['Feb 2024', 'Aug 2024 (sold)', 'Aug 2025']
draw('a', {
  grid: { left: 70, right: 24, top: 40, bottom: 28 }, legend: { top: 0, data: ['Paid', 'Bargain element', 'Appreciation', 'Below purchase FMV', 'Price', 'Subscription price', 'Current quote'] },
  xAxis: { type: 'category', data: labels, axisLabel: { interval: 0 } }, yAxis: { type: 'value' },
  series: [
    { name: 'ladder-base', type: 'bar', stack: 'ladder', silent: true, color: 'transparent', barMaxWidth: 10, data: [41.23265, 41.23265, 41.23265] },
    { name: 'Bargain element', type: 'bar', stack: 'ladder', ...marks, barMaxWidth: 10, color: GREEN, data: [37.88, hollow(37.88, GREEN), 132.95], label: { show: true, position: 'top', color: MUTED, fontSize: 11, formatter: (p) => (p.dataIndex === 1 ? 'Sold' : '') } },
    { name: 'Appreciation', type: 'bar', stack: 'ladder', ...marks, barMaxWidth: 10, color: BLUE, data: [92.2, hollow(40.89, BLUE), 0] },
    { name: 'loss-base', type: 'bar', stack: 'loss', silent: true, color: 'transparent', barMaxWidth: 10, data: [0, 0, 171.31] },
    { name: 'Below purchase FMV', type: 'bar', stack: 'loss', ...marks, barMaxWidth: 10, color: RED, barGap: '-100%', data: [0, 0, 2.87] },
    { name: 'Paid', type: 'scatter', color: ORANGE, symbolSize: 9, z: 11, itemStyle: { borderColor: INK, borderWidth: 1 }, data: [41.23265, hollowDot(41.23265, ORANGE), 41.23265] },
    { name: 'Price', type: 'scatter', color: BLUE, symbolSize: 9, z: 11, itemStyle: { borderColor: INK, borderWidth: 1 }, data: [171.31, hollowDot(120, BLUE), 171.31] },
    { name: 'Subscription price', type: 'scatter', color: MUTED, symbol: 'diamond', symbolSize: 9, z: 12, itemStyle: { borderColor: INK, borderWidth: 1 }, data: [48.509, 48.509, 48.509] },
    { name: 'Current quote', type: 'line', symbol: 'none', lineStyle: { width: 2, type: 'dashed' }, color: MUTED, z: 9, data: [171.31, 171.31, 171.31] },
  ],
})
const days = ['Feb 27, 2024', 'Feb 29, 2024', 'Mar 1, 2024', 'Aug 30, 2024', 'Sep 3, 2024']
const closes = [75, 79.112, 80, 119.37, 121]
const avg = [null, 41.23265, 41.23265, 41.23265, 41.23265]
const wash = (name, stack, color, data) => ({ name, type: 'line', stack, symbol: 'none', lineStyle: { width: 0 }, color, emphasis: { disabled: true }, tooltip: { show: false }, silent: true, connectNulls: false, ...(color === 'transparent' ? {} : { areaStyle: { opacity: 0.12 } }), data })
draw('b', {
  grid: { left: 70, right: 84, top: 40, bottom: 28 }, legend: { top: 0, data: ['Close', 'Subscription price', 'Avg paid to date', 'Purchases', 'Sales'] },
  xAxis: { type: 'category', boundaryGap: false, data: days, axisLabel: { interval: 0 } }, yAxis: { type: 'value', scale: true },
  series: [
    wash('wash-above-base', 'above-paid', 'transparent', avg),
    wash('Above avg paid', 'above-paid', POSITIVE, closes.map((c, i) => (avg[i] === null ? null : Math.max(c - avg[i], 0)))),
    { name: 'Close', type: 'line', symbol: 'none', color: BLUE, lineStyle: { width: 2 }, data: closes },
    { name: 'Subscription price', type: 'line', symbol: 'none', step: 'end', lineStyle: { width: 2, type: 'dashed' }, color: MUTED, z: 9, endLabel: { show: true, formatter: '{a}', color: MUTED, fontSize: 11 }, data: [48.509, 48.509, 48.509, 48.509, 48.509] },
    { name: 'Avg paid to date', type: 'line', symbol: 'none', step: 'end', lineStyle: { width: 2, type: 'dashed' }, color: MUTED, z: 9, connectNulls: false, endLabel: { show: true, formatter: '{a}', color: MUTED, fontSize: 11 }, data: avg },
    { name: 'Purchases', type: 'scatter', color: ORANGE, symbolSize: 10, z: 11, itemStyle: { borderColor: INK, borderWidth: 1 }, data: [{ value: ['Feb 29, 2024', 79.112], symbol: 'diamond' }, { value: ['Aug 30, 2024', 119.37], symbol: 'diamond', itemStyle: { color: SURFACE, borderColor: ORANGE, borderWidth: 1.5 } }] },
    { name: 'Sales', type: 'scatter', color: MUTED, symbolSize: 9, z: 11, itemStyle: { borderColor: INK, borderWidth: 1 }, data: [{ value: ['Sep 3, 2024', 121], symbol: 'triangle', symbolRotate: 180 }] },
  ],
})
</script></body></html>
```

- [ ] **2 Create `tools/probes/espp-3/shoot.mjs`** — `charts-c5/shoot.mjs`'s shape on playwright-core (the box's driver; `pace-v/smoke.mjs` lines 30–45 are the require and the node spoof to copy):

```js
// ESPP visuals probe (2026-09-07 spec §9): shoot probe.html with real Edge so the per-share form
// and the stepped references are judged on a real canvas — jsdom never draws. PNG lands in the
// gitignored scratchpad/. Env: EDGE_PATH, PLAYWRIGHT_CORE, PROBE_OUT.
Object.defineProperty(process, 'version', { value: 'v20.19.0' })
Object.defineProperty(process.versions, 'node', { value: '20.19.0' })
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const { chromium } = require(
  process.env.PLAYWRIGHT_CORE ??
    'C:/Users/edyli/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core',
)
const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..', '..')
const out = process.env.PROBE_OUT ?? join(repo, 'scratchpad', 'espp-3-probe', 'probe.png')
mkdirSync(dirname(out), { recursive: true })
const browser = await chromium.launch({
  executablePath: process.env.EDGE_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--force-device-scale-factor=1'],
})
const page = await browser.newPage({ viewport: { width: 1460, height: 460 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
await page.goto('file:///' + join(here, 'probe.html').replaceAll('\\', '/'), { waitUntil: 'networkidle' })
await new Promise((r) => setTimeout(r, 1200))
// Both canvases must actually paint: sample a grid of pixels and count distinct colours.
const painted = await page.evaluate(() => [...document.querySelectorAll('canvas')].map((cv) => {
  const { width: w, height: h } = cv; const d = cv.getContext('2d').getImageData(0, 0, w, h).data; const uniq = new Set()
  for (let y = 0; y < h; y += 9) for (let x = 0; x < w; x += 9) { const i = (y * w + x) * 4; uniq.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]) }
  return uniq.size
}))
await page.screenshot({ path: out, fullPage: true })
await browser.close()
if (errors.length || painted.length !== 2 || painted.some((n) => n < 6)) {
  console.error(errors.join('\n') || `canvases painted ${JSON.stringify(painted)}`)
  process.exit(1)
}
console.log(`PROBE OK — ${out} (colours per canvas ${painted.join(', ')})`)
```

- [ ] **3 Run:** `node tools/probes/espp-3/shoot.mjs` → `PROBE OK — …probe.png`. Then LOOK at the PNG (open it with the Read tool) and record in your report, in one line each: (a) do the ladder and loss stacks share one column in panel A, (b) does the hollow Aug 2024 column read as an outline with its dots hollow, (c) how the doubled hairline between hollow segments looks, (d) do both step rules carry their end labels in panel B and does the wash start at the first purchase. If (a) fails — two columns side by side — the fix is in `lossStack`: `barGap` must sit on the LAST bar series of the option; move it and re-shoot.
- [ ] **4 README** — add one row to the table in `tools/probes/README.md`, after the `pace-v/smoke.mjs` row:

```markdown
| `espp-3/` | Static `probe.html` for the 2026-09-07 ESPP visuals: the per-share lot view (two stacks on one column via `barGap: '-100%'`, hollow sold items, scatters over bars on a category axis) and the price chart's stepped references with end labels | `node tools/probes/espp-3/shoot.mjs` — no server needed |
```

- [ ] **5 Commit:** `git add tools/probes/espp-3 tools/probes/README.md && git commit -m "probe(espp): real-canvas probe of the per-share form and the stepped price references"`

---

### Task 10: Lane gate

- [ ] **1** `npx vitest run` → all green; record the count.
- [ ] **2** `npx tsc -b` → clean. `npx eslint src/components/espp src/charts/fixtures src/charts/conformance.test.ts src/testing/esppFixtures.ts src/pages/EsppPage.tsx src/pages/EsppPage.charts.test.tsx` → clean.
- [ ] **3** `git log --oneline main..HEAD` — nine commits. Report them, the vitest count, the probe's four observations, and any deviation with its reason.
