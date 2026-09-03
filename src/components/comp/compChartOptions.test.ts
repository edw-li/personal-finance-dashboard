import { describe, expect, it } from 'vitest'
import type { EChartsOption } from '../../charts/echarts'
import { GRID_VARIANTS } from '../../charts/grammar'
import { INK, PALETTE } from '../../charts/theme'
import { tooltipRows } from '../../testing/tooltipRows'
import type { CompEventOut } from '../../types/api'
import {
  TC_CHART_LABEL,
  TC_COLORS,
  TC_LABELS,
  tcTrajectoryCsv,
  tcTrajectoryOption,
} from './compChartOptions'

// --- the golden events ----------------------------------------------------------------
// Wire shape of GET /comp/events. The computed columns are the plan's pinned Focal History
// table (Plan 5 §"Focal History computed columns"), 2024-2027, and the stored operands are
// chosen to reproduce them to the cent: 2026 carries the real row (1822 x 183.2508 and
// 610.0524 x 129.5651, backend/tests/test_paycheck_comp_api.py), while 2024's and 2025's
// share counts are INVENTED — the plan pins those years' products, not the operands behind
// them, and the chart reads neither.
function event(over: Partial<CompEventOut> & Pick<CompEventOut, 'id' | 'focal_year'>): CompEventOut {
  return {
    current_base: '0.00',
    new_base: null,
    unvested_rsus: null,
    unvested_price: null,
    refresh_rsus: null,
    grant_price: null,
    notes: null,
    base_delta: null,
    base_delta_pct: null,
    unvested_equity: null,
    equity_delta: null,
    equity_delta_pct: null,
    tc_before: '0.00',
    tc_after: '0.00',
    ...over,
  }
}

const EVENT_2024 = event({
  id: 1,
  focal_year: 2024,
  current_base: '145000.00',
  new_base: '151000.00',
  unvested_rsus: '2000.0000',
  unvested_price: '112.0750',
  refresh_rsus: '300.0000',
  grant_price: '119.7600',
  base_delta: '6000.00',
  base_delta_pct: '0.041379',
  unvested_equity: '224150.00',
  equity_delta: '35928.00',
  equity_delta_pct: '0.160286',
  tc_before: '369150.00',
  tc_after: '411078.00',
})

const EVENT_2025 = event({
  id: 2,
  focal_year: 2025,
  current_base: '151000.00',
  new_base: '162000.00',
  unvested_rsus: '2152.0000',
  unvested_price: '129.5651',
  refresh_rsus: '502.0965',
  grant_price: '129.5651',
  base_delta: '11000.00',
  base_delta_pct: '0.072848',
  unvested_equity: '278824.10',
  equity_delta: '65054.18',
  equity_delta_pct: '0.233316',
  tc_before: '429824.10',
  tc_after: '505878.28',
})

const EVENT_2026 = event({
  id: 3,
  focal_year: 2026,
  current_base: '162000.00',
  new_base: '188930.00',
  unvested_rsus: '1822.0000',
  unvested_price: '183.2508',
  refresh_rsus: '610.0524',
  grant_price: '129.5651',
  base_delta: '26930.00',
  base_delta_pct: '0.166235',
  unvested_equity: '333882.96',
  equity_delta: '79041.50',
  equity_delta_pct: '0.236734',
  tc_before: '495882.96',
  tc_after: '601854.46',
})

// The year with no raise and no grant on the books yet: every computed column is null and
// TC is the base alone.
const EVENT_2027 = event({
  id: 4,
  focal_year: 2027,
  current_base: '188930.00',
  tc_before: '188930.00',
  tc_after: '188930.00',
})

const GOLDEN_EVENTS = [EVENT_2024, EVENT_2025, EVENT_2026, EVENT_2027]

// --- option readers -------------------------------------------------------------------
// EChartsOption is a wide union; these narrow it once so the assertions stay about the
// numbers (taxChartOptions.test.ts's posture).
interface SeriesLike {
  name?: string
  type?: string
  stack?: string
  color?: string
  data?: unknown[]
}

function seriesOf(option: EChartsOption | null): SeriesLike[] {
  expect(option).not.toBeNull()
  return (option as unknown as { series: SeriesLike[] }).series
}

function categoriesOf(option: EChartsOption | null): string[] {
  return (option as unknown as { xAxis: { data: string[] } }).xAxis.data
}

function moneyAxisLabelOf(option: EChartsOption | null): (value: number) => string {
  return (option as unknown as { yAxis: { axisLabel: { formatter: (v: number) => string } } })
    .yAxis.axisLabel.formatter
}

describe('tcTrajectoryOption', () => {
  it('pins the four golden years: base, equity and the total-comp line', () => {
    const option = tcTrajectoryOption(GOLDEN_EVENTS)
    expect(categoriesOf(option)).toEqual(['2024', '2025', '2026', '2027'])

    const [base, equity, line] = seriesOf(option)
    // base = new_base ?? current_base — the raise the year LANDED on, per the wire type's
    // own note. 2027 has no new_base, so it charts its current base.
    expect(base.data).toEqual([151000, 162000, 188930, 188930])
    // equity = tc_after - base, with the SAME base selection: 411078 - 151000, and so on.
    // 2027 has no equity at all, so the stack is base-only.
    expect(equity.data).toEqual([260078, 343878.28, 412924.46, 0])
    // The line is the server's tc_after, never the stack re-added.
    expect(line.data).toEqual([411078, 505878.28, 601854.46, 188930])
    // ...and the stack does sum to it, which is the invariant the chart is drawn on.
    expect(base.data?.map((b, i) => (b as number) + (equity.data?.[i] as number))).toEqual(
      line.data,
    )
  })

  it('rounds the derived equity back to cents rather than shipping float dust', () => {
    // 601854.46 - 188930 is 412924.45999999996 in binary; a chart axis must not carry it.
    const [, equity] = seriesOf(tcTrajectoryOption([EVENT_2026]))
    expect(equity.data).toEqual([412924.46])
    expect(String((equity.data ?? [])[0])).toBe('412924.46')
  })

  it('never folds a raise into the equity stack', () => {
    // The trap the wire type warns about: taking current_base as the floor would report
    // 2026's 26,930 raise as 26,930 of extra unvested equity.
    const [base, equity] = seriesOf(tcTrajectoryOption([EVENT_2026]))
    expect(base.data).toEqual([188930]) // new_base, NOT the 162000 current_base
    expect(equity.data).toEqual([412924.46]) // == unvested_equity 333882.96 + delta 79041.50
  })

  it('charts a year with no equity as base-only', () => {
    const [base, equity, line] = seriesOf(tcTrajectoryOption([EVENT_2027]))
    expect(base.data).toEqual([188930])
    expect(equity.data).toEqual([0])
    expect(line.data).toEqual([188930])
  })

  it('survives a row whose nullable columns are all empty', () => {
    // Every computed column null except the two that never are — the shape a freshly
    // created event has before any equity is entered.
    const bare = event({ id: 9, focal_year: 2028, current_base: '200000.00',
      tc_before: '200000.00', tc_after: '200000.00' })
    const [base, equity, line] = seriesOf(tcTrajectoryOption([bare]))
    expect(base.data).toEqual([200000])
    expect(equity.data).toEqual([0])
    expect(line.data).toEqual([200000])
  })

  it('orders the x axis itself rather than trusting the feed', () => {
    const option = tcTrajectoryOption([EVENT_2026, EVENT_2024, EVENT_2027, EVENT_2025])
    expect(categoriesOf(option)).toEqual(['2024', '2025', '2026', '2027'])
    expect(seriesOf(option)[0].data).toEqual([151000, 162000, 188930, 188930])
  })

  it('returns null for an empty feed so the caller can render an empty note', () => {
    expect(tcTrajectoryOption([])).toBeNull()
  })

  it('names the equity segment for what it actually is, not for the table column', () => {
    // The segment is tc_after - base, which on 2026 is 412,924.46 — the "Unvested equity"
    // COLUMN of the table on the same page reads 333,882.96, because the refresh grant is
    // in the segment and not in the column. One name for two figures on one screen is a
    // reading error waiting to happen, so the legend carries the wider one.
    const [, equity] = seriesOf(tcTrajectoryOption([EVENT_2026]))
    expect(equity.name).toBe('Equity value (incl. refresh)')
    expect(TC_LABELS[1]).toBe('Equity value (incl. refresh)')
    expect(equity.data).toEqual([412924.46])
    expect(EVENT_2026.unvested_equity).toBe('333882.96') // the column, deliberately not this
    // The chart's own title still names the proxy in the sheet's words, unchanged.
    expect(TC_CHART_LABEL).toBe('Base + unvested equity value')
  })

  it('stacks the two money series and rides the line above them', () => {
    const [base, equity, line] = seriesOf(tcTrajectoryOption(GOLDEN_EVENTS))
    expect([base.name, equity.name, line.name]).toEqual([...TC_LABELS])
    expect(base.type).toBe('bar')
    expect(equity.type).toBe('bar')
    expect(base.stack).toBe(equity.stack)
    expect(line.type).toBe('line')
    expect(line.stack).toBeUndefined()
  })

  it('wears theme slots only — two stack colors and the ink line', () => {
    const [base, equity, line] = seriesOf(tcTrajectoryOption(GOLDEN_EVENTS))
    // Two identity categories, so identity hues: the first two validated palette slots
    // (SpendingPage's "index IS the slot" convention). No new hex anywhere on this page.
    expect(TC_COLORS).toEqual([PALETTE[0], PALETTE[1]])
    expect(base.color).toBe(PALETTE[0])
    expect(equity.color).toBe(PALETTE[1])
    expect(line.color).toBe(INK)
  })

  it('F7: base and equity by value, NO Total row (the line is the total), then the line; shadow pointer', () => {
    const option = tcTrajectoryOption(GOLDEN_EVENTS) as unknown as {
      tooltip: { axisPointer: unknown; formatter: (p: unknown) => string }
    }
    expect(option.tooltip.axisPointer).toEqual({ type: 'shadow' })
    const parsed = tooltipRows(
      option.tooltip.formatter([
        { seriesName: 'Base', seriesType: 'bar', axisValueLabel: '2026', value: 188930, color: PALETTE[0] },
        { seriesName: 'Equity value (incl. refresh)', seriesType: 'bar', value: 412924.46, color: PALETTE[1] },
        { seriesName: 'Total comp', seriesType: 'line', value: 601854.46, color: INK },
      ]),
    )
    expect(parsed.rows.map((r) => [r.kind, r.label, r.value])).toEqual([
      ['row', 'Equity value (incl. refresh)', '$412,924.46'],
      ['row', 'Base', '$188,930.00'],
      ['row', 'Total comp', '$601,854.46'],
    ])
    expect(moneyAxisLabelOf(option as never)(411078)).toBe('$411.1K')
  })

  it('grammar: money grid, 24px staggered stacks with focus, page legend picks', () => {
    const option = tcTrajectoryOption(GOLDEN_EVENTS, { selected: { Base: false } }) as unknown as {
      grid: unknown
      legend: { selected: unknown }
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
})
