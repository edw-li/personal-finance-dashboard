import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { EChartsOption } from '../charts/echarts'
import type { ZoomWindow } from '../charts/timeZoom'
import { initialZoomWindow, sameZoom, selectionFromOption, selectionFromRow } from '../charts/selection'
import type { ChartSelection } from '../types/metrics'
import type { ExportTable } from '../utils/download'
import ChartExportMenu from './ChartExportMenu'
import ChartTable from './ChartTable'
import ChartZoomHint from './ChartZoomHint'
import EChart from './EChart'
import type { EChartEventParams, EChartsInstance } from './EChart'
import InfoHint from './InfoHint'
import ChartSurface from './ChartSurface'
import { useDetailPanel } from './details/DetailPanelProvider'
import SelectionDetail from './details/SelectionDetail'
import { usePageFrame } from './shell/PageFrame'
import { useLocalSectionVisible } from './shell/localSectionContext'
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
  /** A header strip under the title: the movers card's "from → to" line (spec §4.2). */
  lede?: ReactNode
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
  /** Domain adapters read source data and attach real identifiers/source links. */
  selectionAdapter?: (params: EChartEventParams) => ChartSelection | null
  rowSelection?: (row: (string | number)[], index: number) => ChartSelection | null
  selection?: ChartSelection | null
  onSelectionChange?: (selection: ChartSelection | null) => void
  renderSelection?: (selection: ChartSelection) => ReactNode
  /** Owner/entity/scenario boundary. A changed key immediately hides stale selections. */
  selectionScopeKey?: string
  independentRangeLabel?: string
  allowExpand?: boolean
}

export default function ChartCard({
  title, hint, ariaLabel, option, empty, exportName, csv, caption, height = 320, controls, actions, footer, lede,
  zoomable = false, group, busy = false, error = null, span = 12,
  onClick, onHover, onHoverEnd, instanceRef, onLegendChange, onDataZoom, zoomWindow,
  selectionAdapter, rowSelection, selection, onSelectionChange, renderSelection, selectionScopeKey = '', independentRangeLabel, allowExpand = true,
}: ChartCardProps) {
  const { fromCache } = usePageFrame()
  const [tableOpen, setTableOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const activeView = useLocalSectionVisible()
  if (!activeView && expanded) setExpanded(false)
  const [pinned, setPinned] = useState<{ scope: string; value: ChartSelection | null; blocked?: ChartSelection | null }>({ scope: selectionScopeKey, value: null })
  if (pinned.scope !== selectionScopeKey) setPinned({ scope: selectionScopeKey, value: null, blocked: selection })
  const selected = pinned.scope !== selectionScopeKey ? null : selection === undefined ? pinned.value : selection === pinned.blocked ? null : selection
  const panel = useDetailPanel()
  const openPanel = panel?.open
  const closePanel = panel?.close
  const panelId = `chart:${exportName}`
  // Render live detail content from this tree. The panel receives a stable host, so
  // parent renders can refresh its values without reopening a dismissed selection.
  const [detailHost] = useState(() => document.createElement('div'))
  const panelContent = useMemo(() => <div ref={(node) => {
    if (node && detailHost.parentNode !== node) node.appendChild(detailHost)
    else if (!node) detailHost.parentNode?.removeChild(detailHost)
  }} />, [detailHost])
  const previousScope = useRef(selectionScopeKey)
  const initialZoom = initialZoomWindow(option, zoomWindow)
  const [zoom, setZoom] = useState<{ baseline: ZoomWindow | null; manual: ZoomWindow | null; scope: string }>({ baseline: initialZoom, manual: null, scope: selectionScopeKey })
  // A new page preset replaces the baseline; an echoed manual gesture does not.
  if (zoom.scope !== selectionScopeKey || (!sameZoom(initialZoom, zoom.baseline) && !sameZoom(initialZoom, zoom.manual))) {
    setZoom({ baseline: initialZoom, manual: null, scope: selectionScopeKey })
  }
  // The export menu needs the live instance. A caller's ref is honoured (SpendingPage
  // dispatches highlights into its bars); otherwise the card keeps its own. Either way the
  // object handed to EChart is stable — a fresh one would re-init the chart every render.
  const ownRef = useRef<EChartsInstance | null>(null)
  const chartRef = instanceRef ?? ownRef
  const showTable = tableOpen && csv !== undefined && option !== null
  const table = showTable && csv ? csv() : null
  const dismissSelection = useCallback(() => {
    setPinned({ scope: selectionScopeKey, value: null })
    onSelectionChange?.(null)
  }, [onSelectionChange, selectionScopeKey])
  const clearSelection = useCallback(() => {
    dismissSelection()
    closePanel?.(panelId)
  }, [dismissSelection, closePanel, panelId])
  const inspect = (next: ChartSelection) => {
    setPinned({ scope: selectionScopeKey, value: next })
    onSelectionChange?.(next)
    if (!expanded && activeView) openPanel?.({ id: panelId, title, subtitle: next.label, content: panelContent, contextKey: selectionScopeKey })
  }
  const selectionContent = useMemo(() => selected === null ? null : renderSelection
    ? renderSelection(selected)
    : <SelectionDetail selection={selected} chartTitle={title} onClear={clearSelection} />,
  [selected, renderSelection, title, clearSelection])
  useEffect(() => {
    if (!selected || expanded || !activeView) return
    openPanel?.({ id: panelId, title, subtitle: selected.label, content: panelContent, contextKey: selectionScopeKey })
  }, [selected, expanded, activeView, openPanel, panelId, title, panelContent, selectionScopeKey])
  useEffect(() => {
    if (previousScope.current !== selectionScopeKey) {
      previousScope.current = selectionScopeKey
      onSelectionChange?.(null)
    }
  }, [selectionScopeKey, onSelectionChange])
  useEffect(() => () => closePanel?.(panelId), [closePanel, panelId, selectionScopeKey, activeView, expanded])
  const handleClick = (params: EChartEventParams) => {
    if (selectionAdapter) {
      const next = selectionAdapter(params)
      if (next) inspect(next)
    } else if (onClick) {
      // Existing domain handlers keep working until their page supplies a typed adapter.
      onClick(params)
    } else if (option) {
      const next = selectionFromOption(option, params, exportName)
      if (next) inspect(next)
    }
  }
  const handleZoom = (window: ZoomWindow) => {
    setZoom((current) => ({ ...current, manual: sameZoom(current.baseline, window) ? null : window }))
    onDataZoom?.(window)
  }
  const resetZoom = () => {
    if (!zoom.baseline) return
    chartRef.current?.dispatchAction({ type: 'dataZoom', ...zoom.baseline })
    setZoom((current) => ({ ...current, manual: null }))
    onDataZoom?.(zoom.baseline)
  }
  const chartHeight = expanded ? Math.max(height, window.innerHeight - 280) : height

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
          height={chartHeight}
          ariaLabel={ariaLabel}
          animateEntrance={!fromCache}
          group={group}
          onClick={handleClick}
          onHover={onHover}
          onHoverEnd={onHoverEnd}
          instanceRef={chartRef}
          onLegendChange={onLegendChange}
          onDataZoom={handleZoom}
          zoomWindow={zoomWindow}
        />
      </div>
    )
  }

  return (
    <>
    {selected && panel && !expanded && createPortal(selectionContent, detailHost)}
    <ChartSurface title={title} expanded={expanded} onClose={() => setExpanded(false)} span={span}>
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
      {lede !== undefined && <div className="chart-lede">{lede}</div>}
      {/* Rows the card reserves in EVERY state (spec §7). The export row and the zoom caption used
          to mount WITH the option, so the card grew the instant data landed and shoved the next
          card down the page; the twin is the same element with nothing in it, and panels.css
          gives both their height. */}
      <div className="chart-card-row chart-card-row-export">
        {option !== null && (
          <div className="chart-card-utility">
          {independentRangeLabel && <span className="chart-independent-range">{independentRangeLabel}</span>}
          {allowExpand && <button type="button" className="button" data-chart-collapse={expanded || undefined} aria-label={expanded ? `Close expanded ${title}` : `Expand ${title}`} onClick={() => setExpanded((value) => !value)}>{expanded ? 'Close expanded chart' : 'Expand'}</button>}
          {zoomable && zoom.manual && <button type="button" className="button" onClick={resetZoom}>Reset zoom</button>}
          <ChartExportMenu
            config={{ name: exportName, csv, title, caption }}
            getChart={() => chartRef.current}
            tableShown={showTable}
            onToggleTable={csv === undefined ? undefined : () => setTableOpen((open) => !open)}
          />
          </div>
        )}
      </div>
      {option !== null && error !== null && (
        <p className="chart-card-error" role="status">{error}</p>
      )}
      {body}
      {selected && <div className="chart-selection-summary" role="status">
        <span>Pinned: {selected.label}</span>
        {panel && !expanded && <button type="button" className="button" onClick={() => panel.open({ id: panelId, title, subtitle: selected.label, content: panelContent, contextKey: selectionScopeKey })}>Details</button>}
        <button type="button" className="button" onClick={clearSelection}>Clear selection</button>
      </div>}
      {selected && (!panel || expanded) && <div className="chart-inline-selection">{selectionContent}</div>}
      {zoomable && (
        <div className="chart-card-row chart-card-row-zoom">{option !== null && <ChartZoomHint />}</div>
      )}
      {table && <ChartTable table={table} caption={`${title} — data table`} selectedId={selected?.id} onSelect={inspect} rowSelection={rowSelection ?? ((row, index) => selectionFromRow(table, row, index, exportName))} />}
      {footer !== undefined && <div className="chart-card-row chart-card-row-caption">{footer}</div>}
    </section>
    </ChartSurface>
    </>
  )
}
