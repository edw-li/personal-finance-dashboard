// Pure option builder for the portfolio performance chart, shared by PortfolioPage and
// OverviewPage (overviewChartOptions.ts posture: no React, no fetching, no theme
// decisions of its own). Number() here is display-only — the server's Decimal strings
// are parsed once and never handed back to the API (format.ts's rule).
import type { EChartsOption } from '../../charts/echarts'
import { PALETTE } from '../../charts/theme'
import type { HoldingsTotals, PortfolioHistory } from '../../types/api'
import { formatCurrency, formatCurrencyCompact, formatDate } from '../../utils/format'

export interface LivePoint {
  date: string // quote bar date, ISO YYYY-MM-DD
  value: number // Number(totals.market_value) — display-only
}

// Both pages derive the live point from the SAME holdings payload they already fetch —
// one definition so the two charts can never disagree about what "live" means. Dated by
// the NEWEST quote (latest_quote_at), never by as_of: as_of is the OLDEST (the staleness
// clock), and once weekly Monday rows keep the series fresh, a single stale manual-priced
// quote in it dragged the live date behind the series' end and silently retired the ping.
export function liveFromHoldings(holdings: {
  latest_quote_at: string | null
  totals: Pick<HoldingsTotals, 'market_value'>
}): LivePoint | null {
  return holdings.latest_quote_at
    ? { date: holdings.latest_quote_at.slice(0, 10), value: Number(holdings.totals.market_value) }
    : null
}

// Axis-tooltip params subset the formatter reads (the runtime shape for trigger:'axis'
// is an array of these; echarts types the callback param as a much wider union).
interface AxisTooltipParam {
  seriesName?: string
  marker?: string
  axisValueLabel?: string
  value?: unknown
}

function rowValue(value: unknown): number | null {
  // Line rows carry plain numbers (null on the padded live category); the live
  // effectScatter carries a [category, value] pair.
  const raw = Array.isArray(value) ? value[1] : value
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
}

// Exported for tests. Skipping null rows is the point: on the live category the three
// lines are padding-null and would each print a dash row under the default formatter.
// All strings interpolated here are app-generated (fixed series names, our own date
// labels), so no escapeHtml is needed.
export function historyTooltipFormatter(params: unknown): string {
  const list = (Array.isArray(params) ? params : [params]) as AxisTooltipParam[]
  const rows: { param: AxisTooltipParam; value: number }[] = []
  for (const param of list) {
    const value = rowValue(param.value)
    if (value !== null) rows.push({ param, value })
  }
  if (rows.length === 0) return ''
  const header = rows[0].param.axisValueLabel ?? ''
  return [
    header,
    ...rows.map(
      ({ param, value }) =>
        `${param.marker ?? ''} ${param.seriesName ?? ''}&nbsp;&nbsp;${formatCurrency(value)}`,
    ),
  ].join('<br/>')
}

export function portfolioHistoryOption(
  history: PortfolioHistory,
  live: LivePoint | null,
): EChartsOption | null {
  if (history.dates.length < 2) return null
  const lastDate = history.dates[history.dates.length - 1]
  const lastValue = Number(history.market_value[history.market_value.length - 1])
  // The ping renders only when there IS a usable quote no older than the imported
  // series — a live marker BEHIND the line's end would read as a glitch, not as "now".
  const livePt = live !== null && Number.isFinite(live.value) && live.date >= lastDate ? live : null
  // Same-day quote: the ping sits ON the last imported category — no new category and
  // no connector, because there is nothing to bridge.
  const extendAxis = livePt !== null && livePt.date > lastDate

  const categories = history.dates.map(formatDate)
  const lastLabel = categories[categories.length - 1]
  const liveLabel = livePt ? formatDate(livePt.date) : ''
  if (extendAxis) categories.push(liveLabel)

  // Lines end at the last IMPORTED point: the live category (when present) gets null,
  // never an extrapolated value.
  const lineData = (values: string[]): (number | null)[] =>
    extendAxis ? [...values.map(Number), null] : values.map(Number)

  // Fixed validated palette slots (charts/theme.ts law): value=slot 1 blue, cost
  // basis=slot 2 orange, S&P=slot 3 aqua. The wash rides the value line ONLY — the
  // Excel original's three overlapping opaque areas occlude each other (spec: rejected).
  const lineSeries = (name: string, values: string[], color: string, wash: boolean) => ({
    type: 'line' as const,
    name,
    symbol: 'none' as const,
    lineStyle: { width: 2 },
    color,
    ...(wash ? { areaStyle: { opacity: 0.12 } } : {}),
    data: lineData(values),
  })

  return {
    grid: { left: 70, right: 16, top: 32, bottom: 28 },
    legend: { top: 0 },
    xAxis: { type: 'category', data: categories, boundaryGap: false },
    yAxis: {
      // No scale:true — a washed area over a visible axis needs the honest zero baseline.
      type: 'value',
      axisLabel: { formatter: (v: number) => formatCurrencyCompact(v) },
    },
    tooltip: { trigger: 'axis', formatter: historyTooltipFormatter },
    series: [
      lineSeries('Portfolio value', history.market_value, PALETTE[0], true),
      lineSeries('Cost basis', history.cost_basis, PALETTE[1], false),
      lineSeries('S&P 500 baseline', history.sp500, PALETTE[2], false),
      ...(livePt
        ? [
            {
              // The live point wears the SAME blue — same entity, fresher reading; a new
              // hue would read as a fourth data series. The ripple is what says "live".
              type: 'effectScatter' as const,
              name: 'Live',
              color: PALETTE[0],
              symbolSize: 9,
              rippleEffect: { brushType: 'stroke' as const, scale: 3 },
              data: [[extendAxis ? liveLabel : lastLabel, livePt.value]] as [string, number][],
              ...(extendAxis
                ? {
                    // Dashed connector from the line's end to the ping (dashed =
                    // provisional). A markLine, not a fifth series: it toggles with
                    // 'Live' in the legend and stays out of the axis tooltip.
                    markLine: {
                      silent: true,
                      symbol: 'none' as const,
                      lineStyle: { type: 'dashed' as const, width: 2, color: PALETTE[0] },
                      label: { show: false },
                      // A 2D markLine datum is a 2-TUPLE (from, to), not an array —
                      // without the assertion the literal widens and tsc rejects it.
                      data: [
                        [
                          { coord: [lastLabel, lastValue] },
                          { coord: [liveLabel, livePt.value] },
                        ] as [{ coord: [string, number] }, { coord: [string, number] }],
                      ],
                    },
                  }
                : {}),
            },
          ]
        : []),
    ],
  }
}
