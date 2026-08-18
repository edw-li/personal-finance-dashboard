// Pure option builder for the holding drill-in's price chart — no React, no fetching, no
// theme decisions of its own (historyChartOptions.ts posture). Number() here is
// display-only: the server's Decimal strings are parsed once and never handed back to the
// API (format.ts's rule).
import type { EChartsOption } from '../../charts/echarts'
import { PALETTE } from '../../charts/theme'
import { timeZoom } from '../../charts/timeZoom'
import type { PricePoint } from '../../types/api'
import { formatCurrency, formatCurrencyCompact, formatDate } from '../../utils/format'

/**
 * Daily closes for ONE security. Returns null under two points — the house pattern for a
 * builder with nothing to draw; a manual-priced security accrues one bar per hand entry,
 * so the caller's empty note has to say why the chart may take a while to exist.
 */
export function priceHistoryOption(points: PricePoint[]): EChartsOption | null {
  if (points.length < 2) return null
  return {
    // 'all': the panel's 1Y/3Y/Max control changes the FETCH window, so the zoom always
    // opens on everything it was handed; ctrl+wheel still narrows within it.
    dataZoom: timeZoom(points.map((p) => p.d), 'all'),
    grid: { left: 70, right: 16, top: 16, bottom: 28 },
    tooltip: {
      trigger: 'axis',
      valueFormatter: (value) =>
        value === null || value === undefined ? '—' : formatCurrency(value as number),
    },
    xAxis: { type: 'category', data: points.map((p) => formatDate(p.d)), boundaryGap: false },
    yAxis: {
      type: 'value',
      // scale, unlike the money charts' zero anchor: a price line carries no area wash and
      // no additive reading, and pinning a ~$580 close to a $0 floor flattens the year to
      // a ribbon (netWorthSparkOption's posture, here with the axis showing — the labeled
      // ticks are what keep the scaled frame honest).
      scale: true,
      axisLabel: { formatter: (value: number) => formatCurrencyCompact(value) },
    },
    series: [
      {
        type: 'line',
        name: 'Close',
        symbol: 'none',
        lineStyle: { width: 2 },
        color: PALETTE[0],
        data: points.map((p) => Number(p.c)),
      },
    ],
  }
}
