import { describe, expect, it } from 'vitest'
import type { EChartsOption } from '../../charts/echarts'
import { MARK_LINE_LABEL, MARK_LINE_STYLE } from '../../charts/markLine'
import { MUTED, PALETTE } from '../../charts/theme'
import { tooltipRows } from '../../testing/tooltipRows'
import type { PolyTrendFit } from './polyTrend'
import {
  BAND_SERIES,
  MEDIAN_SERIES,
  NET_WORTH_PROJECTION_SERIES,
  netWorthProjectionOption,
  PROJECTION_SERIES,
  projectionCsv,
  projectionOption,
} from './projectionChartOptions'

const DATA = {
  months: ['2026-08-01', '2026-09-01', '2026-10-01'],
  projected: ['100000.00', '104000.00', '108000.00'],
  coast: ['100000.00', '100000.00', '100000.00'],
  fi_target: '1500000.00' as string | null,
  bands: null as Record<string, string[]> | null,
}

// Three months of hand-made percentiles — every diff below is checkable by eye.
const BANDS: Record<string, string[]> = {
  p10: ['100000.00', '90000.00', '80000.00'],
  p25: ['100000.00', '95000.00', '92000.00'],
  p50: ['100000.00', '104000.00', '108000.00'],
  p75: ['100000.00', '112000.00', '125000.00'],
  p90: ['100000.00', '120000.00', '150000.00'],
}

// EChartsOption is a wide union; narrow once so the assertions stay about the numbers
// (the option-builder tests' shared posture).
function read(option: EChartsOption | null) {
  expect(option).not.toBeNull()
  return option as unknown as {
    dataZoom: { type: string; startValue: number }[]
    legend: { data: string[]; selected?: Record<string, boolean> }
    xAxis: { data: string[] }
    yAxis: { type: string }
    series: {
      name: string
      color: string
      stack?: string
      silent?: boolean
      tooltip?: { show: boolean }
      emphasis?: { disabled: boolean }
      lineStyle: { type?: string; width?: number }
      markArea?: unknown
      markPoint?: { data: { name: string; coord: [string, number] }[] }
      markLine?: {
        silent: boolean
        symbol: string
        lineStyle: { color: string; width: number; type: string }
        label: { show: boolean; position: string; color: string; fontSize: number }
        data: { xAxis: string; label: { formatter: string } }[]
      }
      areaStyle?: { opacity: number }
      data: number[]
    }[]
  }
}

describe('projectionOption', () => {
  it('returns null under two points', () => {
    expect(projectionOption({ ...DATA, months: ['2026-08-01'], projected: ['1'], coast: ['1'] })).toBeNull()
  })

  it('draws projected (washed blue), coast (orange) and the dashed threshold', () => {
    const option = read(projectionOption(DATA))
    expect(option.series.map((s) => s.name)).toEqual([...PROJECTION_SERIES])
    expect(option.series[0].color).toBe(PALETTE[0])
    expect(option.series[0].areaStyle).toBeTruthy() // the ONE wash (history chart's rule)
    expect(option.series[0].data).toEqual([100000, 104000, 108000])
    expect(option.series[1].color).toBe(PALETTE[1])
    expect(option.series[1].areaStyle).toBeUndefined()
    // Dashed is reserved for thresholds — this IS the threshold, at the target on every month.
    expect(option.series[2].color).toBe(MUTED)
    expect(option.series[2].lineStyle.type).toBe('dashed')
    expect(option.series[2].data).toEqual([1500000, 1500000, 1500000])
  })

  it('drops the threshold when there is no target to draw', () => {
    const option = read(projectionOption({ ...DATA, fi_target: null }))
    expect(option.series.map((s) => s.name)).toEqual([PROJECTION_SERIES[0], PROJECTION_SERIES[1]])
  })

  it('formats the month axis and opens the inside zoom on everything', () => {
    const option = read(projectionOption(DATA))
    expect(option.xAxis.data).toEqual(['Aug 2026', 'Sep 2026', 'Oct 2026'])
    expect(option.dataZoom[0].type).toBe('inside')
    expect(option.dataZoom[0].startValue).toBe(0)
  })

  it('draws the pre-Monte-Carlo chart exactly when the payload carries no bands', () => {
    // Back-compat is a test, not a hope: a deterministic run is three series, no more.
    // The second case is the older payload with no `bands` key at all (a stale tab).
    const stale = { ...DATA, bands: undefined } as unknown as typeof DATA
    for (const data of [DATA, stale]) {
      const option = read(projectionOption(data))
      expect(option.series).toHaveLength(3)
      expect(option.series.map((s) => s.name)).toEqual([...PROJECTION_SERIES])
      expect(option.series.every((s) => s.stack === undefined)).toBe(true)
      expect(option.legend.data).toEqual([...PROJECTION_SERIES])
    }
  })

  it('prepends four stacked band series plus the median path so the lines draw on top', () => {
    const option = read(projectionOption({ ...DATA, bands: BANDS }))
    expect(option.series).toHaveLength(8)
    // The upper outer wash wears the SAME name as its lower half (F3) — one legend entry.
    expect(option.series.map((s) => s.name)).toEqual([
      'mc-base',
      BAND_SERIES[0],
      BAND_SERIES[1],
      BAND_SERIES[0],
      MEDIAN_SERIES,
      ...PROJECTION_SERIES,
    ])
    // One stack, so echarts sums base + the three diffs back into p25 / p75 / p90.
    expect(option.series.slice(0, 4).every((s) => s.stack === 'mc-band')).toBe(true)
    expect(option.series.slice(4).every((s) => s.stack === undefined)).toBe(true)
  })

  it('stacks an absolute p10 base under exact percentile diffs, all in the projection blue', () => {
    const option = read(projectionOption({ ...DATA, bands: BANDS }))
    const [base, outerLow, inner, outerHigh] = option.series
    expect(base.data).toEqual([100000, 90000, 80000]) // ABSOLUTE — the stack's floor
    expect(base.color).toBe('transparent')
    expect(base.areaStyle).toBeUndefined() // an invisible line, not a wash
    expect(outerLow.data).toEqual([0, 5000, 12000]) // p25 − p10
    expect(inner.data).toEqual([0, 17000, 33000]) // p75 − p25
    expect(outerHigh.data).toEqual([0, 8000, 25000]) // p90 − p75
    // Uncertainty about one entity wears that entity's hue — never a new one.
    expect([outerLow.color, inner.color, outerHigh.color]).toEqual([
      PALETTE[0],
      PALETTE[0],
      PALETTE[0],
    ])
    // The inner half reads denser than the outer eighty percent.
    expect(outerLow.areaStyle?.opacity).toBe(0.1)
    expect(inner.areaStyle?.opacity).toBe(0.18)
    expect(outerHigh.areaStyle?.opacity).toBe(0.1)
    expect(option.series.slice(0, 4).every((s) => s.lineStyle.width === 0)).toBe(true)
  })

  it('keeps the bands out of the tooltip and the hover — they are geometry', () => {
    const option = read(projectionOption({ ...DATA, bands: BANDS }))
    for (const series of option.series.slice(0, 4)) {
      expect(series.silent).toBe(true)
      expect(series.tooltip).toEqual({ show: false })
      expect(series.emphasis).toEqual({ disabled: true })
    }
    // The three real lines still carry the numbers.
    for (const series of option.series.slice(4)) {
      expect(series.silent).toBeUndefined()
      expect(series.tooltip).toBeUndefined()
    }
  })

  it('names only the two washes that differ in the legend', () => {
    const option = read(projectionOption({ ...DATA, bands: BANDS }))
    // 'mc-base' is invisible; the two outer washes share ONE name, so the legend lists it once.
    expect(option.legend.data).toEqual([...PROJECTION_SERIES, MEDIAN_SERIES, ...BAND_SERIES])
    expect(option.legend.data).not.toContain('mc-base')
  })

  it('bands survive a missing target — the threshold leaves, the fan stays', () => {
    const option = read(projectionOption({ ...DATA, fi_target: null, bands: BANDS }))
    expect(option.series).toHaveLength(7)
    expect(option.legend.data).toEqual([
      PROJECTION_SERIES[0],
      PROJECTION_SERIES[1],
      MEDIAN_SERIES,
      ...BAND_SERIES,
    ])
  })

  it('F7: rows in series order, the FI target as a muted reference, band ranges as footer lines', () => {
    const option = projectionOption({ ...DATA, bands: BANDS }) as unknown as {
      tooltip: { formatter: (p: unknown) => string }
    }
    const parsed = tooltipRows(
      option.tooltip.formatter([
        { seriesName: 'Projected', seriesType: 'line', axisValueLabel: 'Sep 2026', dataIndex: 1, value: 104000, color: PALETTE[0] },
        { seriesName: 'Growth only', seriesType: 'line', value: 100000, color: PALETTE[1] },
        { seriesName: 'FI target', seriesType: 'line', value: 1500000, color: MUTED },
        { seriesName: MEDIAN_SERIES, seriesType: 'line', value: 104000, color: PALETTE[0] },
        { seriesName: 'Projected', seriesType: 'line', value: null },
      ]),
    )
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
    const plain = projectionOption(DATA) as unknown as {
      tooltip: { formatter: (p: unknown) => string }
    }
    expect(
      tooltipRows(plain.tooltip.formatter([{ seriesName: 'Projected', seriesType: 'line', dataIndex: 0, value: 1 }])).foot,
    ).toEqual([])
  })
})

describe('projectionOption — F3', () => {
  const FI = {
    ...DATA,
    fi_month: '2026-10-01',
    coast_fi_month: '2026-09-01',
    fi_month_p10: '2026-09-01',
    fi_month_p50: '2026-10-01',
    fi_month_p90: null,
    bands: BANDS,
  }

  it('rules FI and Coast FI on the Projected line beside the retirements, in the shared markLine', () => {
    const option = read(
      projectionOption({
        ...FI,
        retirements: [{ person_id: 2, name: 'Alex', month: '2026-09-01', monthly_drop: '1.00' }],
      }),
    )
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
    expect(projected.markArea).toMatchObject({
      data: [[{ xAxis: 'Oct 2026' }, { xAxis: 'Oct 2026' }]],
      label: { formatter: 'After FI' },
    })
    const target = option.series.find((s) => s.name === PROJECTION_SERIES[2])!
    // p90 is null → two marks; each sits ON the target value at its anchored month.
    expect(target.markPoint?.data).toEqual([
      { name: 'p10', coord: ['Sep 2026', 1500000] },
      { name: 'p50', coord: ['Oct 2026', 1500000] },
    ])
    // No FI → no area, no marks, no rules (a stale payload or an unreachable target).
    const none = read(projectionOption({ ...DATA, fi_month: null, coast_fi_month: null }))
    expect(
      none.series.every((s) => s.markArea === undefined && s.markPoint === undefined && s.markLine === undefined),
    ).toBe(true)
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

  it('feeds the page’s legend picks back in', () => {
    expect(read(projectionOption(DATA, { selected: { 'Growth only': false } })).legend.selected).toEqual({
      'Growth only': false,
    })
  })
})

const HISTORY = {
  months: ['2026-06-01', '2026-07-01', '2026-08-01'],
  net_worth: ['100000.00', '101000.00', '102010.00'],
}

// A hand-made fit — the builder only ever calls valueAt (the real math is pinned in
// polyTrend.test.ts; this keeps the builder test a unit test).
const FIT: PolyTrendFit = {
  valueAt: (iso) => (iso === '2026-06-01' ? 100000 : 123456),
}

function readNw(option: EChartsOption | null) {
  expect(option).not.toBeNull()
  return option as unknown as {
    dataZoom: { type: string; startValue: number }[]
    legend: { data: { name: string; icon?: string }[] }
    xAxis: { data: string[] }
    yAxis: { type: string }
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

  it('rides a log y-axis, turning nonpositive values into gaps', () => {
    // A log axis cannot place zero or below — such points become NaN gaps, never lies.
    const history = {
      months: ['2026-06-01', '2026-07-01', '2026-08-01'],
      net_worth: ['-5.00', '101000.00', '102010.00'],
    }
    const dipping: PolyTrendFit = { valueAt: (iso) => (iso === '2026-06-01' ? -1 : 123456) }
    const option = readNw(netWorthProjectionOption(history, dipping, '2026-08-01', 1))
    expect(option.yAxis.type).toBe('log')
    expect(option.series[0].data).toEqual([NaN, 101000, 102010])
    expect(option.series[1].data[0]).toBeNaN()
    expect(option.series[1].data[1]).toBe(123456)
  })
})

describe('projectionCsv', () => {
  const BASE = {
    months: ['2026-09-01', '2026-10-01'],
    projected: ['1000.00', '1100.00'],
    coast: ['1000.00', '1005.00'],
    bands: null,
  }

  it('is month/projected/coast without the fan', () => {
    expect(projectionCsv(BASE)).toEqual({
      headers: ['Month', 'Projected', 'Growth only'],
      rows: [
        ['2026-09-01', '1000.00', '1000.00'],
        ['2026-10-01', '1100.00', '1005.00'],
      ],
    })
  })

  it('appends p10/p50/p90 when the fan is on', () => {
    const csv = projectionCsv({
      ...BASE,
      bands: {
        p10: ['900.00', '950.00'], p25: ['950.00', '990.00'], p50: ['1000.00', '1080.00'],
        p75: ['1050.00', '1180.00'], p90: ['1200.00', '1300.00'],
      },
    })
    expect(csv.headers).toEqual(['Month', 'Projected', 'Growth only', 'p10', 'p50', 'p90'])
    expect(csv.rows[1]).toEqual(['2026-10-01', '1100.00', '1005.00', '950.00', '1080.00', '1300.00'])
  })
})

import { retirementMarkLine } from './projectionChartOptions'

describe('retirementMarkLine', () => {
  const MONTHS = ['2026-08-01', '2026-09-01', '2026-10-01']

  it('draws one dashed muted rule per retirement, each labelled with the name', () => {
    const mark = retirementMarkLine(MONTHS, [
      { month: '2026-09-01', name: 'Alex' },
      { month: '2026-10-01', name: 'Bo' },
    ])
    // The axis carries formatMonth labels, so the rules have to speak the same words.
    expect(mark?.data).toEqual([
      { xAxis: 'Sep 2026', label: { formatter: 'Alex' } },
      { xAxis: 'Oct 2026', label: { formatter: 'Bo' } },
    ])
    expect(mark?.lineStyle).toEqual(MARK_LINE_STYLE)
    expect(mark?.label).toEqual(MARK_LINE_LABEL)
    expect(mark?.silent).toBe(true)
    expect(mark?.symbol).toBe('none')
  })

  it('draws nothing it cannot honestly place', () => {
    expect(retirementMarkLine(MONTHS, [])).toBeUndefined()
    // A payload whose horizon shrank under a stale tab: the server fences the month into
    // the axis, so this is a guard, and it DROPS the rule rather than clamping it.
    expect(retirementMarkLine(MONTHS, [{ month: '2040-01-01', name: 'Alex' }])).toBeUndefined()
    expect(retirementMarkLine([], [{ month: '2026-09-01', name: 'Alex' }])).toBeUndefined()
  })
})

describe('projectionOption retirement rules', () => {
  it('hangs the rules on the Projected series, above the fan', () => {
    const option = read(
      projectionOption({
        ...DATA,
        retirements: [
          {
            person_id: 2,
            name: 'Alex',
            month: '2026-09-01',
            monthly_drop: '2000.00',
          },
        ],
      }),
    )
    const projected = option.series.find((s) => s.name === PROJECTION_SERIES[0])
    expect(projected?.markLine?.data).toEqual([{ xAxis: 'Sep 2026', label: { formatter: 'Alex' } }])
    // One annotation, on the ONE series every payload has.
    expect(option.series.filter((s) => s.markLine !== undefined)).toHaveLength(1)
  })

  it('carries no markLine at all without retirements — back-compat', () => {
    // Both shapes: a live server's empty list and a stale payload with no key.
    for (const data of [{ ...DATA, retirements: [] }, DATA]) {
      const option = read(projectionOption(data))
      expect(option.series.every((s) => s.markLine === undefined)).toBe(true)
    }
  })
})
