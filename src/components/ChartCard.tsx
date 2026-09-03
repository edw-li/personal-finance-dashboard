import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { EChartsOption } from '../charts/echarts'
import type { ZoomWindow } from '../charts/timeZoom'
import type { ExportTable } from '../utils/download'
import ChartExportMenu from './ChartExportMenu'
import ChartTable from './ChartTable'
import ChartZoomHint from './ChartZoomHint'
import EChart from './EChart'
import type { EChartEventParams, EChartsInstance } from './EChart'
import InfoHint from './InfoHint'
import { usePageFrame } from './shell/PageFrame'
import './panels.css'

// The one chart mount (chart spec §6): header · hint · controls · export row · states · chart ·
// zoom hint · table twin · footer. It never rewrites series — helpers inside builders carry
// everything data-shaped; this carries chrome and lifecycle. `animateEntrance` comes from the
// frame's context, so no page passes it. The shell `Segmented` renders every control a caller
// hands in; scope controls (range, owner, month) belong to the ScopeBar, never here.
export interface ChartCardProps {
  /** Eyebrow, sentence case. */
  title: string
  /** InfoHint copy — required. */
  hint: string
  /** One sentence: what the chart SHOWS — required, forwarded to EChart. */
  ariaLabel: string
  option: EChartsOption | null
  /** The sentence shown when option is null — required, no default prose. */
  empty: string
  /** {exportName}.png / .csv; the PNG caption's slug. */
  exportName: string
  /** Enables CSV and the Table twin. */
  csv?: () => ExportTable
  /** "as of Aug 14, 2026" — the PNG caption's second line. */
  caption?: string
  height?: number
  /** Chart-local Segmented(s) — never scope controls. */
  controls?: ReactNode
  /** Rare: the drill-in's "All months" button, a Retry. */
  actions?: ReactNode
  /** Drill-hint paragraph(s), pickers. */
  footer?: ReactNode
  /** Renders ChartZoomHint; the option carries the dataZoom. */
  zoomable?: boolean
  /** echarts.connect group for same-axis siblings. */
  group?: string
  /** Card-local revalidation: the previous render holds under a dim (a skeleton only when
   *  there is nothing to hold). */
  busy?: boolean
  /** Card-local advisory — never the page banner. */
  error?: string | null
  span?: 6 | 12
  // Pass-through to EChart.
  onClick?: (params: EChartEventParams) => void
  onHover?: (params: EChartEventParams) => void
  onHoverEnd?: () => void
  instanceRef?: { current: EChartsInstance | null }
  onLegendChange?: (selected: Record<string, boolean>) => void
  onDataZoom?: (window: { startValue: number; endValue: number }) => void
  zoomWindow?: ZoomWindow
}

export default function ChartCard({
  title, hint, ariaLabel, option, empty, exportName, csv, caption, height = 320, controls, actions, footer,
  zoomable = false, group, busy = false, error = null, span = 12,
  onClick, onHover, onHoverEnd, instanceRef, onLegendChange, onDataZoom, zoomWindow,
}: ChartCardProps) {
  const { fromCache } = usePageFrame()
  const [tableOpen, setTableOpen] = useState(false)
  // The export menu needs the live instance. A caller's ref is honoured (SpendingPage
  // dispatches highlights into its bars); otherwise the card keeps its own. Either way the
  // object handed to EChart is stable — a fresh one would re-init the chart every render.
  const ownRef = useRef<EChartsInstance | null>(null)
  const chartRef = instanceRef ?? ownRef
  const showTable = tableOpen && csv !== undefined && option !== null

  let body: ReactNode
  if (option === null) {
    body = busy ? (
      <>
        <p className="visually-hidden" role="status">Loading…</p>
        <div className="skeleton chart-card-skeleton" aria-hidden="true" style={{ height }} />
      </>
    ) : (
      <p className="empty-note">{error ?? empty}</p>
    )
  } else {
    body = (
      <div className={`loading-dim${busy ? ' is-loading' : ''}`}>
        <EChart
          option={option}
          height={height}
          ariaLabel={ariaLabel}
          animateEntrance={!fromCache}
          group={group}
          onClick={onClick}
          onHover={onHover}
          onHoverEnd={onHoverEnd}
          instanceRef={chartRef}
          onLegendChange={onLegendChange}
          onDataZoom={onDataZoom}
          zoomWindow={zoomWindow}
        />
      </div>
    )
  }

  return (
    <section className={`card chart-card span-${span}`}>
      <div className="chart-card-header">
        <h2 className="eyebrow">
          {title}
          <InfoHint text={hint} />
        </h2>
        {(controls !== undefined || actions !== undefined) && (
          <div className="chart-card-controls">
            {controls}
            {actions}
          </div>
        )}
      </div>
      {option !== null && (
        <ChartExportMenu
          config={{ name: exportName, csv, title, caption }}
          getChart={() => chartRef.current}
          tableShown={showTable}
          onToggleTable={csv === undefined ? undefined : () => setTableOpen((open) => !open)}
        />
      )}
      {option !== null && error !== null && (
        <p className="chart-card-error" role="status">{error}</p>
      )}
      {body}
      {zoomable && option !== null && <ChartZoomHint />}
      {showTable && csv !== undefined && <ChartTable table={csv()} caption={`${title} — data table`} />}
      {footer}
    </section>
  )
}
