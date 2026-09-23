import { describe, expect, it } from 'vitest'
import { grid } from './grammar'
import { fitMonthAxes, monthAxis, monthLabelMode, monthTick } from './monthLabels'

// 2026-09-23 spec §C4: month labels never collide. Thresholds come from the chart font's own
// measurements (12px Segoe UI): "Sep 2026*" 53.9px, "May '26" 41.7px, "2026" 25.9px, "May" 22.7px —
// plus the 2px a side of textMargin every month axis carries (echarts' own default is 3).
describe('month labels', () => {
  const YEAR = ['Oct 2025', 'Nov 2025', 'Dec 2025', 'Jan 2026', 'Feb 2026', 'Mar 2026', 'Apr 2026', 'May 2026', 'Jun 2026', 'Jul 2026', 'Aug 2026', 'Sep 2026']
  type Axis = { data: string[]; axisLabel: { formatter: (value: string, index: number) => string; interval?: number | 'auto'; hideOverlap?: boolean; rotate?: number } }
  const labelsOf = (axis: Axis) => axis.data.map((label, i) => axis.axisLabel.formatter(label, i))

  it('picks the form from the width each month gets', () => {
    expect(monthLabelMode(57)).toBe('full')
    expect(monthLabelMode(56.9)).toBe('short')
    expect(monthLabelMode(35)).toBe('short')
    expect(monthLabelMode(34.9)).toBe('compact')
    expect(monthLabelMode(28)).toBe('compact')
    expect(monthLabelMode(27.9)).toBe('sparse')
  })

  it('monthTick: full keeps the month; short years the first label and January; compact shows the year there instead; sparse years every label', () => {
    expect(monthTick('Oct 2025', 0, 'full')).toBe('Oct 2025')
    expect(monthTick('Oct 2025', 0, 'short')).toBe("Oct '25")
    expect(monthTick('Nov 2025', 1, 'short')).toBe('Nov')
    expect(monthTick('Jan 2026', 3, 'short')).toBe("Jan '26")
    // Review nit (spec §C4): the FIRST label carries the month AND the year in every form — a
    // bare "2025" under October reads as January. Later Januaries keep the year alone.
    expect(monthTick('Oct 2025', 0, 'compact')).toBe("Oct '25")
    expect(monthTick('Jan 2026', 0, 'compact')).toBe("Jan '26")
    expect(monthTick('Nov 2025', 1, 'compact')).toBe('Nov')
    expect(monthTick('Jan 2026', 3, 'compact')).toBe('2026')
    expect(monthTick('Nov 2025', 1, 'sparse')).toBe("Nov '25")
    // The partial-month marker rides every form (spec §C5).
    expect(monthTick('Sep 2026', 11, 'full', true)).toBe('Sep 2026*')
    expect(monthTick('Sep 2026', 11, 'short', true)).toBe('Sep*')
    // Not a month: untouched.
    expect(monthTick('Q3', 0, 'short')).toBe('Q3')
  })

  it('monthAxis gives month labels the grammar formatter and the overlap guard; other labels keep the old axis', () => {
    const axis = monthAxis(YEAR, { gap: true }) as unknown as Axis
    expect(axis.axisLabel.hideOverlap).toBe(true)
    // echarts pads each label 3px a side before its overlap test; 2px keeps neighbours apart
    // and lets twelve short months fit the Overview card at 1280.
    expect((axis.axisLabel as unknown as { textMargin: number[] }).textMargin).toEqual([0, 2])
    expect(axis.axisLabel.interval).toBe(0)
    // Unfitted (no width known — tests, SSR): the full month, as before.
    expect(labelsOf(axis)).toEqual(YEAR)
    const marked = monthAxis(YEAR, { gap: true, marked: new Set(['Sep 2026']) }) as unknown as Axis
    expect(labelsOf(marked).at(-1)).toBe('Sep 2026*')
    // Review nit (spec §C5): the in-progress month is the latest one, and when echarts thins the
    // labels (All ranges, the heatmap) its marked label must not be the one thinned away.
    expect((marked.axisLabel as unknown as { showMaxLabel?: boolean }).showMaxLabel).toBe(true)
    expect((axis.axisLabel as unknown as { showMaxLabel?: boolean }).showMaxLabel).toBeUndefined()
    const heat = monthAxis(YEAR, { gap: true, rotate: 45, marked: new Set(['Sep 2026']) }) as unknown as Axis
    expect((heat.axisLabel as unknown as { showMaxLabel?: boolean }).showMaxLabel).toBe(true)
    // …and the fit keeps it: 38 months at 1280 are sparse, thinned by echarts.
    const long = Array.from({ length: 38 }, (_, i) => `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][(i + 7) % 12]} ${2023 + Math.floor((i + 7) / 12)}`)
    const sparse = (fitMonthAxes({ grid: grid(), xAxis: monthAxis(long, { gap: true, marked: new Set([long[37]]) }) }, 949).option as unknown as { xAxis: Axis }).xAxis
    expect(sparse.axisLabel.interval).toBe('auto')
    expect((sparse.axisLabel as unknown as { showMaxLabel?: boolean }).showMaxLabel).toBe(true)
    // Years, tax steps, dates: byte-identical to the axis every other chart has today.
    expect(monthAxis(['2024', '2025'], { gap: true })).toEqual({ type: 'category', data: ['2024', '2025'], axisLabel: { interval: 0 } })
    expect(monthAxis([])).toEqual({ type: 'category', data: [], boundaryGap: false, axisLabel: { interval: 0 } })
  })

  // The Overview's Recent spending card, measured in the browser: 446 / 606 / 766 px wide at
  // 1280 / 1600 / 1920 (the default grid takes 94 px) — 29, 43 and 56 px per month. At 56 px two
  // full months ("Nov 2025" 50.9px beside "Dec 2025" 49.3px) are a quarter pixel short of fitting.
  it('fits the Overview twelve months at 1280, 1600 and 1920', () => {
    const option = { grid: grid(), xAxis: monthAxis(YEAR, { gap: true }) }
    const at = (width: number) => (fitMonthAxes(option, width).option as unknown as { xAxis: Axis }).xAxis
    // At 29 px "Oct '25" needs the room of its neighbour: the overlap guard hides "Nov" when drawn.
    expect(labelsOf(at(446))).toEqual(["Oct '25", 'Nov', 'Dec', '2026', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'])
    expect(labelsOf(at(606))).toEqual(["Oct '25", 'Nov', 'Dec', "Jan '26", 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'])
    expect(labelsOf(at(766))).toEqual(["Oct '25", 'Nov', 'Dec', "Jan '26", 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'])
    // A wider card (the Expand dialog, a full-width card) earns the full month.
    expect(labelsOf(at(800))).toEqual(YEAR)
    for (const width of [446, 606, 766]) expect(at(width).axisLabel.interval).toBe(0)
    expect(fitMonthAxes(option, 446).key).toBe('compact')
    // The original option is never mutated — EChart refits the same one on every resize.
    expect(labelsOf(option.xAxis as unknown as Axis)).toEqual(YEAR)
  })

  it('counts the visible window, not the whole axis: 38 months on All thin out, a 1Y zoom reads in full', () => {
    const NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const months = Array.from({ length: 38 }, (_, i) => {
      const index = 2023 * 12 + 7 + i
      return NAMES[index % 12] + ' ' + String(Math.floor(index / 12))
    })
    const all = { grid: grid(), xAxis: monthAxis(months, { gap: true }), dataZoom: [{ type: 'inside', startValue: 0 }] }
    // The Spending bars at 1280 (949 px): 22.5 px per month — every label names its year, and
    // echarts thins them.
    const thin = fitMonthAxes(all, 949).option as unknown as { xAxis: Axis }
    expect(thin.xAxis.axisLabel.interval).toBe('auto')
    expect(thin.xAxis.axisLabel.formatter('Nov 2023', 3)).toBe("Nov '23")
    // A 1Y window of 13 months at the same width: 66 px each — the full month.
    const zoomed = fitMonthAxes({ ...all, dataZoom: [{ type: 'inside', startValue: 25 }] }, 949)
    expect(zoomed.key).toBe('full')
    // The live window EChart reads back after a ctrl+wheel wins over the option's preset.
    expect(fitMonthAxes(all, 949, { startValue: 30, endValue: 37 }).key).toBe('full')
  })

  it('lines space labels one gap fewer; percent grids are measured against the container', () => {
    // A line (boundaryGap false) puts its first and last labels on the plot's edges.
    const line = { grid: grid(), xAxis: monthAxis(YEAR) }
    expect(fitMonthAxes(line, 94 + 11 * 36).key).toBe('short')
    // Small multiples: three cells of 29.33% each on a 1600 px card — 469 px, 43 px a month (a
    // misread '29.333%' as 29 px would call it sparse).
    const cells = { grid: [{ left: '2%', width: '29.333%', top: 24, height: 66 }], xAxis: [{ ...monthAxis(YEAR), gridIndex: 0 }] }
    expect(fitMonthAxes(cells, 1600).key).toBe('short')
  })

  it('leaves rotated axes, non-month axes and unmeasured charts alone', () => {
    const rotated = { grid: grid('heatmap'), xAxis: monthAxis(YEAR, { gap: true, rotate: 45 }) }
    expect(fitMonthAxes(rotated, 446)).toEqual({ option: rotated, key: '' })
    const years = { grid: grid(), xAxis: monthAxis(['2024', '2025'], { gap: true }) }
    expect(fitMonthAxes(years, 446)).toEqual({ option: years, key: '' })
    const unmeasured = { grid: grid(), xAxis: monthAxis(YEAR, { gap: true }) }
    expect(fitMonthAxes(unmeasured, 0)).toEqual({ option: unmeasured, key: '' })
  })

  it('refits idempotently: a fitted option refits to the same labels', () => {
    const once = fitMonthAxes({ grid: grid(), xAxis: monthAxis(YEAR, { gap: true }) }, 606)
    const twice = fitMonthAxes(once.option, 606)
    expect(twice.key).toBe(once.key)
    expect(labelsOf((twice.option as unknown as { xAxis: Axis }).xAxis)).toEqual(labelsOf((once.option as unknown as { xAxis: Axis }).xAxis))
  })
})
