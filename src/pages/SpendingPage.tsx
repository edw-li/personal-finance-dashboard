import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PencilLine } from 'lucide-react'
import { ApiError } from '../api/client'
import { fetchMatrix, fetchYearly } from '../api/spending'
import EChart from '../components/EChart'
import type { EChartEventParams, EChartsInstance } from '../components/EChart'
import MonthRibbon from '../components/MonthRibbon'
import RangeChips from '../components/RangeChips'
import StatTile from '../components/StatTile'
import type { EChartsOption } from '../charts/echarts'
import { timeZoom } from '../charts/timeZoom'
import type { RangePreset } from '../charts/timeZoom'
import {
  INK,
  MUTED,
  OTHER_SERIES_COLOR,
  PALETTE,
  SEQUENTIAL_BLUE,
  SURFACE,
} from '../charts/theme'
import type { SpendingMatrix, SpendingYearly } from '../types/api'
import {
  escapeHtml,
  formatCurrency,
  formatCurrencyCompact,
  formatMonth,
  formatPct,
} from '../utils/format'
import { currentMonthIso } from '../utils/months'
import { buildMonthSlices } from '../utils/spending'
import '../components/panels.css'
import './SpendingPage.css'

const TOP_N = 7
const MAX_TREND = 3

export default function SpendingPage() {
  const navigate = useNavigate()
  const [matrix, setMatrix] = useState<SpendingMatrix | null>(null)
  const [yearly, setYearly] = useState<SpendingYearly | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [trend, setTrend] = useState<{ categoryId: number; slot: number }[]>([])
  // Month drill-in: the ISO month whose breakdown pie replaces the bars chart. Stored
  // as the month string (never an index) so a refetch that reshapes the month list
  // cannot mis-target; a month that vanished falls back to the all-months view.
  const [detailMonth, setDetailMonth] = useState<string | null>(null)
  // The page's time window, applied to the three time charts together (bars, savings
  // rate, category trends — one month axis, one answer). Object identity so a re-click
  // of the active chip re-asserts the window (NetWorthPage's `range`). The heatmap stays
  // whole: its visualMap is scaled to all time, and windowing rows of cells reads as
  // missing data rather than as a zoom.
  const [range, setRange] = useState<{ preset: RangePreset }>({ preset: 'all' })
  // Instance handle for the bars chart so heatmap hover can dispatch highlights into it.
  const barsChartRef = useRef<EChartsInstance | null>(null)

  // Promise callbacks, no setState in the effect's synchronous body
  // (react-hooks/set-state-in-effect) — same shape as NetWorthPage.
  const load = useCallback(() => {
    Promise.all([fetchMatrix(), fetchYearly()])
      .then(([m, y]) => {
        setMatrix(m)
        setYearly(y)
        setError(null)
        setTrend((current) => {
          if (current.length > 0 || m.categories.length === 0) return current
          // Default: the single biggest all-time category, slot 1.
          const totals = m.series.map((s) => ({
            id: s.category_id,
            total: s.values.reduce((acc, v) => acc + (v === null ? 0 : Number(v)), 0),
          }))
          totals.sort((a, b) => b.total - a.total)
          return [{ categoryId: totals[0].id, slot: 0 }]
        })
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Failed to load spending data')
      })
      .finally(() => setLoading(false))
  }, [])

  // Mount fetch is covered by useState's initial `true`; Retry flips these itself.
  const beginLoad = () => {
    setLoading(true)
    setError(null)
  }

  useEffect(() => {
    load()
  }, [load])

  const monthLabels = useMemo(() => matrix?.months.map(formatMonth) ?? [], [matrix])

  // All-time totals decide the top-7 fold AND the heatmap row order (biggest at top).
  const categoryTotals = useMemo(() => {
    if (!matrix) return []
    return matrix.series
      .map((s) => ({
        id: s.category_id,
        total: s.values.reduce((acc, v) => acc + (v === null ? 0 : Number(v)), 0),
      }))
      .sort((a, b) => b.total - a.total)
  }, [matrix])

  const nameById = useMemo(
    () => new Map((matrix?.categories ?? []).map((c) => [c.id, c.name])),
    [matrix],
  )

  // Shared by the bars fold, the drill-in pie, and the heatmap->bars highlight
  // mapping: index in this array IS the palette slot AND the bar seriesIndex.
  const topIds = useMemo(() => categoryTotals.slice(0, TOP_N).map((t) => t.id), [categoryTotals])

  // Heatmap row order (biggest all-time at top); row index -> category id, needed by
  // the heatmap option and by the hover mapping onto bar segments.
  const heatmapOrder = useMemo(() => categoryTotals.map((t) => t.id), [categoryTotals])

  const barsOption = useMemo<EChartsOption | null>(() => {
    if (!matrix || matrix.months.length === 0) return null
    const topSet = new Set(topIds)
    const valuesById = new Map(matrix.series.map((s) => [s.category_id, s.values]))
    const otherPerMonth = matrix.months.map((_, i) =>
      matrix.series.reduce((acc, s) => {
        if (topSet.has(s.category_id)) return acc
        const v = s.values[i]
        return acc + (v === null ? 0 : Number(v))
      }, 0),
    )
    return {
      dataZoom: timeZoom(matrix.months, range.preset),
      grid: { left: 70, right: 24, top: 40, bottom: 28 },
      legend: { top: 0 },
      tooltip: {
        trigger: 'axis',
        valueFormatter: (value) =>
          value === null || value === undefined ? '—' : formatCurrency(value as number),
      },
      xAxis: { type: 'category', data: monthLabels },
      yAxis: {
        type: 'value',
        axisLabel: { formatter: (value: number) => formatCurrencyCompact(value) },
      },
      series: [
        // Stable ids: the drill-in pie morphs from/to these series (universalTransition
        // keys on id across notMerge setOption calls). Emphasis border mirrors the
        // heatmap's hover language — heatmap-cell hover highlights the matching segment.
        ...topIds.map((id, slot) => ({
          id: `cat-${id}`,
          name: nameById.get(id) ?? String(id),
          type: 'bar' as const,
          stack: 'spend',
          barMaxWidth: 22,
          color: PALETTE[slot],
          itemStyle: { borderColor: SURFACE, borderWidth: 1 },
          emphasis: { itemStyle: { borderColor: INK } },
          universalTransition: true,
          data: (valuesById.get(id) ?? []).map((v) => (v === null ? 0 : Number(v))),
        })),
        {
          id: 'other',
          name: 'Other',
          type: 'bar' as const,
          stack: 'spend',
          barMaxWidth: 22,
          color: OTHER_SERIES_COLOR,
          itemStyle: { borderColor: SURFACE, borderWidth: 1 },
          emphasis: { itemStyle: { borderColor: INK } },
          universalTransition: true,
          data: otherPerMonth,
        },
        {
          id: 'net-pay',
          name: 'Net pay',
          type: 'line' as const,
          symbol: 'none' as const,
          lineStyle: { width: 2 },
          color: INK,
          z: 10,
          connectNulls: false,
          data: matrix.net_pay.map((v) => (v === null ? null : Number(v))),
        },
        {
          id: 'four-pct',
          name: '4% rule',
          type: 'line' as const,
          symbol: 'none' as const,
          // Dashed is reserved for thresholds — this IS the threshold line.
          lineStyle: { width: 2, type: 'dashed' as const },
          color: MUTED,
          z: 9,
          connectNulls: false,
          data: matrix.four_pct_rule.map((v) => (v === null ? null : Number(v))),
        },
      ],
    }
  }, [matrix, topIds, monthLabels, nameById, range])

  const detailIndex = useMemo(
    () => (matrix && detailMonth ? matrix.months.indexOf(detailMonth) : -1),
    [matrix, detailMonth],
  )
  const activeDetail = detailIndex >= 0
  const detailLabel = activeDetail && matrix ? formatMonth(matrix.months[detailIndex]) : null

  const monthDetailOption = useMemo<EChartsOption | null>(() => {
    if (!matrix || detailIndex < 0) return null
    const slices = buildMonthSlices(matrix, topIds, detailIndex)
    if (slices.length === 0) return null
    return {
      tooltip: {
        // HTML formatter: category names are user text — escapeHtml is mandatory.
        formatter: (params) => {
          const p = Array.isArray(params) ? params[0] : params
          return (
            `<strong>${formatCurrency(p.value as number)}</strong> · ` +
            `${(p.percent ?? 0).toFixed(1)}%<br/>${escapeHtml(p.name ?? '')}`
          )
        },
      },
      series: [
        {
          id: 'month-pie',
          type: 'pie' as const,
          radius: ['42%', '70%'],
          itemStyle: { borderColor: SURFACE, borderWidth: 2 },
          label: { color: INK, formatter: '{b}  {d}%' },
          emphasis: { itemStyle: { borderColor: INK } },
          // Morph the month's bar segments into slices and back out on exit; falls back
          // to a plain swap under reduced motion (EChart forces animation off).
          universalTransition: {
            enabled: true,
            seriesKey: [...topIds.map((id) => `cat-${id}`), 'other'],
          },
          data: slices.map((s) => ({
            name: s.name,
            value: s.value,
            itemStyle: { color: s.slot === null ? OTHER_SERIES_COLOR : PALETTE[s.slot] },
          })),
        },
      ],
    }
  }, [matrix, detailIndex, topIds])

  const handleSpendChartClick = (params: EChartEventParams) => {
    if (activeDetail) {
      setDetailMonth(null) // any chart click in detail mode returns to all months
      return
    }
    const index = params.dataIndex
    if (matrix && typeof index === 'number' && index >= 0 && index < matrix.months.length) {
      setDetailMonth(matrix.months[index])
    }
  }

  // Heatmap cell -> the EXACT bar segment it corresponds to: the category's own series
  // when it made the top fold, the "Other" stack segment when folded. seriesIndex is
  // positional in barsOption.series — kept in lockstep by both deriving from topIds.
  const handleHeatmapHover = (params: EChartEventParams) => {
    if (!matrix || activeDetail || params.seriesType !== 'heatmap') return
    if (!Array.isArray(params.value)) return
    const [col, row] = params.value as [number, number, number]
    const categoryId = heatmapOrder[row]
    if (categoryId === undefined) return
    const top = topIds.indexOf(categoryId)
    barsChartRef.current?.dispatchAction({
      type: 'highlight',
      seriesIndex: top >= 0 ? top : topIds.length,
      dataIndex: col,
    })
  }

  const handleHeatmapHoverEnd = () => {
    // Downplay every stack series — cheaper than tracking which one lit up, and a
    // harmless no-op when nothing is highlighted (or the pie is showing).
    barsChartRef.current?.dispatchAction({
      type: 'downplay',
      seriesIndex: Array.from({ length: topIds.length + 1 }, (_, i) => i),
    })
  }

  const heatmapOption = useMemo<EChartsOption | null>(() => {
    if (!matrix || matrix.months.length === 0) return null
    const order = heatmapOrder // biggest at top
    const rowIndex = new Map(order.map((id, i) => [id, i]))
    const cells: [number, number, number][] = []
    let max = 0
    for (const s of matrix.series) {
      const row = rowIndex.get(s.category_id)
      if (row === undefined) continue
      s.values.forEach((v, col) => {
        if (v === null) return
        const n = Number(v)
        max = Math.max(max, n)
        cells.push([col, row, n])
      })
    }
    return {
      // bottom must clear BOTH the 45°-rotated month labels (~48px) and the visualMap
      // bar parked at bottom: 0 (~30px) — 64 made them overlap.
      grid: { left: 130, right: 24, top: 8, bottom: 96 },
      tooltip: {
        // HTML formatter: category names are user text — escapeHtml is mandatory.
        formatter: (params) => {
          // `TopLevelFormatterParams` is `CallbackDataParams | CallbackDataParams[]`;
          // item-trigger only ever passes the single form, but narrowing the union
          // (rather than asserting past it) keeps the assertion down to the one
          // property whose declared type already admits an array of values.
          const p = Array.isArray(params) ? params[0] : params
          const [col, row, value] = p.value as [number, number, number]
          const name = nameById.get(order[row]) ?? ''
          return `<strong>${formatCurrency(value)}</strong><br/>${escapeHtml(name)} · ${escapeHtml(monthLabels[col] ?? '')}`
        },
      },
      xAxis: { type: 'category', data: monthLabels, axisLabel: { rotate: 45 } },
      yAxis: {
        type: 'category',
        data: order.map((id) => nameById.get(id) ?? String(id)),
        inverse: true,
        axisLabel: { width: 118, overflow: 'truncate' as const },
      },
      visualMap: {
        min: 0,
        max: Math.max(max, 1),
        calculable: false,
        orient: 'horizontal',
        left: 'center',
        bottom: 0,
        inRange: { color: [...SEQUENTIAL_BLUE] },
        textStyle: { color: MUTED },
        formatter: (value) => formatCurrencyCompact(value as number),
      },
      series: [
        {
          type: 'heatmap' as const,
          data: cells,
          itemStyle: { borderColor: SURFACE, borderWidth: 1 },
          emphasis: { itemStyle: { borderColor: INK, borderWidth: 1 } },
        },
      ],
    }
  }, [matrix, heatmapOrder, monthLabels, nameById])

  const savingsOption = useMemo<EChartsOption | null>(() => {
    if (!matrix || matrix.months.length === 0) return null
    return {
      dataZoom: timeZoom(matrix.months, range.preset), // the page's one window (see `range`)
      grid: { left: 60, right: 24, top: 16, bottom: 28 },
      tooltip: {
        trigger: 'axis',
        // True value in the tooltip even when the line is clamped out of frame.
        valueFormatter: (value) =>
          value === null || value === undefined ? '—' : formatPct(value as number),
      },
      xAxis: { type: 'category', data: monthLabels, boundaryGap: false },
      yAxis: {
        type: 'value',
        // Clamp the frame to ±100%; early months have wild negatives that would
        // squash the whole series otherwise.
        min: (extent: { min: number }) => Math.max(extent.min, -1),
        max: (extent: { max: number }) => Math.min(Math.max(extent.max, 0.1), 1),
        axisLabel: { formatter: (value: number) => formatPct(value, { signed: false }) },
      },
      series: [
        {
          name: 'Savings rate (actual)',
          type: 'line' as const,
          symbol: 'none' as const,
          lineStyle: { width: 2 },
          color: PALETTE[0],
          connectNulls: false,
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: MUTED, width: 1, type: 'solid' as const },
            label: { show: false },
            data: [{ yAxis: 0 }],
          },
          data: matrix.savings_rate.map((v) => (v === null ? null : Number(v))),
        },
      ],
    }
  }, [matrix, monthLabels, range])

  const trendOption = useMemo<EChartsOption | null>(() => {
    if (!matrix || matrix.months.length === 0 || trend.length === 0) return null
    const valuesById = new Map(matrix.series.map((s) => [s.category_id, s.values]))
    return {
      dataZoom: timeZoom(matrix.months, range.preset), // the page's one window (see `range`)
      grid: { left: 70, right: 24, top: 40, bottom: 28 },
      legend: { top: 0 },
      tooltip: {
        trigger: 'axis',
        valueFormatter: (value) =>
          value === null || value === undefined ? '—' : formatCurrency(value as number),
      },
      xAxis: { type: 'category', data: monthLabels, boundaryGap: false },
      yAxis: {
        type: 'value',
        axisLabel: { formatter: (value: number) => formatCurrencyCompact(value) },
      },
      series: trend.map(({ categoryId, slot }) => ({
        name: nameById.get(categoryId) ?? String(categoryId),
        type: 'line' as const,
        symbol: 'none' as const,
        lineStyle: { width: 2 },
        color: PALETTE[slot],
        connectNulls: false,
        data: (valuesById.get(categoryId) ?? []).map((v) => (v === null ? null : Number(v))),
      })),
    }
  }, [matrix, trend, monthLabels, nameById, range])

  const toggleTrend = (categoryId: number) => {
    setTrend((current) => {
      const existing = current.find((t) => t.categoryId === categoryId)
      if (existing) return current.filter((t) => t.categoryId !== categoryId)
      if (current.length >= MAX_TREND) return current
      const used = new Set(current.map((t) => t.slot))
      const slot = [0, 1, 2].find((s) => !used.has(s)) ?? 0
      return [...current, { categoryId, slot }]
    })
  }

  // KPI row: latest data month + trailing-12 average + latest savings rate.
  const kpis = useMemo(() => {
    if (!matrix || matrix.months.length === 0) return null
    const last = matrix.months.length - 1
    const window = matrix.totals.slice(-12).map(Number)
    const average = window.reduce((a, b) => a + b, 0) / window.length
    return {
      month: matrix.months[last],
      total: matrix.totals[last],
      average,
      savings: matrix.savings_rate[last],
      netPay: matrix.net_pay[last],
    }
  }, [matrix])

  const filledMonths = useMemo(() => {
    const set = new Set<string>()
    matrix?.series.forEach((s) =>
      s.values.forEach((v, i) => {
        if (v !== null) set.add(matrix.months[i])
      }),
    )
    return set
  }, [matrix])

  return (
    <div className="page">
      <div className="page-header">
        <h1>Spending</h1>
        <div className="spacer" />
        <MonthRibbon
          anchor={currentMonthIso()}
          filledMonths={filledMonths}
          onSelect={(month) => navigate(`/update?month=${month}&step=spending`)}
        />
        <button
          className="button button-primary"
          onClick={() => navigate('/update?step=spending')}
        >
          <PencilLine size={15} /> Enter month
        </button>
      </div>

      {error && (
        <div className="error-banner" role="alert">
          {error}{' '}
          <button
            className="button"
            onClick={() => {
              beginLoad()
              load()
            }}
          >
            Retry
          </button>
        </div>
      )}

      {kpis && (
        <div className="kpi-row">
          <StatTile
            label={`Spend — ${formatMonth(kpis.month)}`}
            value={formatCurrency(kpis.total)}
          />
          <StatTile label="12-month average" value={formatCurrency(kpis.average)} />
          <StatTile
            label="Savings rate (actual)"
            value={kpis.savings === null ? '—' : formatPct(kpis.savings, { signed: false })}
          />
          <StatTile label="Net pay" value={formatCurrency(kpis.netPay)} />
        </div>
      )}

      <div className={`card-grid loading-dim${loading ? ' is-loading' : ''}`}>
        <div className="card span-12">
          <div className="spending-chart-header">
            <h2 className="eyebrow">
              {detailLabel
                ? `Spending breakdown — ${detailLabel}`
                : `Monthly spend vs net pay — top ${TOP_N} categories + other`}
            </h2>
            {/* One slot, two modes: the drill-in's way back, or the page's time window
                (a pie has no time axis, so the chips would be dead weight beside it). */}
            {activeDetail ? (
              <button className="button" onClick={() => setDetailMonth(null)}>
                All months
              </button>
            ) : (
              <RangeChips value={range.preset} onChange={setRange} />
            )}
          </div>
          {activeDetail && matrix ? (
            <>
              <p className="drill-hint">
                Total {formatCurrency(matrix.totals[detailIndex])} · Net pay{' '}
                {formatCurrency(matrix.net_pay[detailIndex])} · Savings{' '}
                {matrix.savings_rate[detailIndex] === null
                  ? '—'
                  : formatPct(matrix.savings_rate[detailIndex], { signed: false })}{' '}
                — click the chart to go back.
              </p>
              {monthDetailOption ? (
                <EChart
                  option={monthDetailOption}
                  height={340}
                  onClick={handleSpendChartClick}
                  instanceRef={barsChartRef}
                />
              ) : (
                <div className="empty-note">No spending recorded for {detailLabel}.</div>
              )}
            </>
          ) : barsOption ? (
            <>
              <p className="drill-hint">Click a month's bar to expand its breakdown.</p>
              <EChart
                option={barsOption}
                height={340}
                onClick={handleSpendChartClick}
                instanceRef={barsChartRef}
              />
            </>
          ) : (
            !loading &&
            !error && (
              <div className="empty-note">No spending recorded yet — enter a month to begin.</div>
            )
          )}
        </div>

        <div className="card span-12">
          <h2 className="eyebrow">Month × category heatmap</h2>
          {heatmapOption && (
            <EChart
              option={heatmapOption}
              height={Math.max(332, (matrix?.categories.length ?? 0) * 24 + 142)}
              onHover={handleHeatmapHover}
              onHoverEnd={handleHeatmapHoverEnd}
            />
          )}
        </div>

        <div className="card span-6">
          <h2 className="eyebrow">Savings rate (actual)</h2>
          {savingsOption && <EChart option={savingsOption} height={260} />}
          <p className="drill-hint">
            (net pay − spend) ÷ net pay, per month. The old sheet's column tracked a
            planned rate, so values differ by design.
          </p>
        </div>

        <div className="card span-6">
          <h2 className="eyebrow">Category trends</h2>
          <div className="chip-row">
            {matrix?.categories.map((category) => {
              const active = trend.find((t) => t.categoryId === category.id)
              // Slot hue goes on the BORDER, never the text (text stays --text via
              // .chip.active) — series color marks identity beside text, not in it.
              return (
                <button
                  key={category.id}
                  type="button"
                  className={active ? 'chip active' : 'chip'}
                  style={active ? { borderColor: PALETTE[active.slot] } : undefined}
                  aria-pressed={!!active}
                  onClick={() => toggleTrend(category.id)}
                >
                  {category.name}
                </button>
              )
            })}
          </div>
          {trendOption ? (
            <EChart option={trendOption} height={220} />
          ) : (
            <div className="empty-note">Pick up to {MAX_TREND} categories.</div>
          )}
        </div>

        <div className="card span-12">
          <h2 className="eyebrow">Yearly rollups</h2>
          <div className="yearly-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Category</th>
                  {yearly?.years.map((y) => (
                    <th key={y.year} className="num">
                      {y.year}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix?.categories.map((category) => (
                  <tr key={category.id}>
                    <td>{category.name}</td>
                    {yearly?.years.map((y) => {
                      const cell = y.by_category.find((c) => c.category_id === category.id)
                      return (
                        <td key={y.year} className="num">
                          {formatCurrency(cell?.total ?? null)}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td style={{ fontWeight: 600 }}>Total</td>
                  {yearly?.years.map((y) => (
                    <td key={y.year} className="num" style={{ fontWeight: 600 }}>
                      {formatCurrency(y.total)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td>Net pay</td>
                  {yearly?.years.map((y) => (
                    <td key={y.year} className="num">
                      {formatCurrency(y.net_pay_total)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td>Savings rate</td>
                  {yearly?.years.map((y) => (
                    <td key={y.year} className="num">
                      {y.savings_rate === null ? '—' : formatPct(y.savings_rate, { signed: false })}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
