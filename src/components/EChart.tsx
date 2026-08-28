import { useEffect, useRef } from 'react'
import { echarts } from '../charts/echarts'
import type { EChartsOption } from '../charts/echarts'
import { quiesceRipples } from '../charts/motion'
import ChartExportMenu from './ChartExportMenu'
import type { ExportConfig } from './ChartExportMenu'

export type EChartsInstance = ReturnType<typeof echarts.init>

// The subset of echarts event params the pages consume; the runtime object carries more.
export interface EChartEventParams {
  seriesName?: string
  seriesType?: string
  name?: string
  dataIndex?: number
  value?: unknown
}

const REDUCED_MOTION =
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

export default function EChart({
  option,
  height = 320,
  ariaLabel,
  onClick,
  onHover,
  onHoverEnd,
  instanceRef,
  onLegendChange,
  onDataZoom,
  exportConfig,
  animateEntrance = true,
}: {
  option: EChartsOption
  height?: number
  // A one-sentence description of what the chart SHOWS (deliberate house wording —
  // ECharts' generated aria is not used; spec §4 item 6). Like every prop here it is
  // optional and additive: the signature only ever GROWS entries.
  ariaLabel?: string
  onClick?: (params: EChartEventParams) => void
  onHover?: (params: EChartEventParams) => void
  onHoverEnd?: () => void
  // Escape hatch for cross-chart coordination (dispatchAction from a sibling chart's
  // handlers). Must be a STABLE ref (useRef) — a fresh object every render would
  // re-init the chart via the effect dep below.
  instanceRef?: { current: EChartsInstance | null }
  /** Mirrors legend toggles into page state (2026-08-25 spec §2e) with echarts' full
   *  name→shown map, COPIED — fed back via legend.selected so notMerge rebuilds keep
   *  the picks. */
  onLegendChange?: (selected: Record<string, boolean>) => void
  /** Mirrors a ctrl+wheel/drag-pan window into page state, as category-axis indices. */
  onDataZoom?: (window: { startValue: number; endValue: number }) => void
  /** Mounts the house ⤓ export menu above the canvas (2026-08-25 spec §2a). */
  exportConfig?: ExportConfig
  /** false = paint the option already-drawn (cached revisits must not replay the
   *  entrance dance — 2026-08-27 spec §1). Default true. Merged after the page's
   *  option, exactly like the reduced-motion force. */
  animateEntrance?: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<EChartsInstance | null>(null)
  const onClickRef = useRef(onClick)
  const onHoverRef = useRef(onHover)
  const onHoverEndRef = useRef(onHoverEnd)
  const onLegendChangeRef = useRef(onLegendChange)
  const onDataZoomRef = useRef(onDataZoom)

  // Latest-handler refs, refreshed after each render so the chart's listeners never
  // have to be rebound. Assigning during render trips react-hooks/refs ("Cannot update
  // ref during render"); an unkeyed effect is the sanctioned form. Safe on mount:
  // useRef seeds the first handlers, and events can only arrive after effects have run.
  useEffect(() => {
    onClickRef.current = onClick
    onHoverRef.current = onHover
    onHoverEndRef.current = onHoverEnd
    onLegendChangeRef.current = onLegendChange
    onDataZoomRef.current = onDataZoom
  })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const chart = echarts.init(el, 'finance')
    chart.on('click', (params) => onClickRef.current?.(params as EChartEventParams))
    chart.on('mouseover', (params) => onHoverRef.current?.(params as EChartEventParams))
    // mouseout fires per-item; globalout covers fast exits that skip it — without it a
    // cross-chart highlight would stick after the cursor leaves the canvas.
    chart.on('mouseout', () => onHoverEndRef.current?.())
    chart.on('globalout', () => onHoverEndRef.current?.())
    chart.on('legendselectchanged', (params) => {
      // Copied, not aliased: echarts mutates its own map on the next toggle.
      onLegendChangeRef.current?.({
        ...(params as { selected: Record<string, boolean> }).selected,
      })
    })
    chart.on('datazoom', () => {
      // The event's own payload is percent-based (and batch-shaped from inside zooms);
      // the RESOLVED category-axis indices live on the option — read them back instead.
      const zoom = (
        chart.getOption() as { dataZoom?: { startValue?: unknown; endValue?: unknown }[] }
      ).dataZoom?.[0]
      if (zoom && typeof zoom.startValue === 'number' && typeof zoom.endValue === 'number') {
        onDataZoomRef.current?.({ startValue: zoom.startValue, endValue: zoom.endValue })
      }
    })
    chartRef.current = chart
    if (instanceRef) instanceRef.current = chart
    const observer = new ResizeObserver(() => chart.resize())
    observer.observe(el)
    return () => {
      observer.disconnect()
      chart.dispose()
      chartRef.current = null
      if (instanceRef) instanceRef.current = null
    }
  }, [instanceRef])

  useEffect(() => {
    // notMerge: pages always send complete options; merging stale series causes ghosts.
    // Reduced-motion is forced AFTER the spread — a page option must never re-enable
    // animation against the user's OS preference (Global rules a11y promise). The flag
    // alone is not enough: ripple animators ignore it, so quiesceRipples covers the gap.
    // animateEntrance rides the same override slot: a cached paint is already-seen data.
    const base = REDUCED_MOTION ? quiesceRipples(option) : option
    chartRef.current?.setOption(
      {
        ...base,
        ...(REDUCED_MOTION || !animateEntrance ? { animation: false } : {}),
      },
      { notMerge: true },
    )
  }, [option, animateEntrance])

  return (
    <>
      {exportConfig && (
        <ChartExportMenu config={exportConfig} getChart={() => chartRef.current} />
      )}
      <div
        ref={containerRef}
        // role only WITH a label: a bare role="img" would be an unnamed image to a screen
        // reader — worse than the default (skippable) div.
        role={ariaLabel === undefined ? undefined : 'img'}
        aria-label={ariaLabel}
        style={{ height, width: '100%' }}
      />
    </>
  )
}
