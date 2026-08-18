import { useEffect, useRef } from 'react'
import { echarts } from '../charts/echarts'
import type { EChartsOption } from '../charts/echarts'
import { quiesceRipples } from '../charts/motion'

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
  onClick,
  onHover,
  onHoverEnd,
  instanceRef,
}: {
  option: EChartsOption
  height?: number
  onClick?: (params: EChartEventParams) => void
  onHover?: (params: EChartEventParams) => void
  onHoverEnd?: () => void
  // Escape hatch for cross-chart coordination (dispatchAction from a sibling chart's
  // handlers). Must be a STABLE ref (useRef) — a fresh object every render would
  // re-init the chart via the effect dep below.
  instanceRef?: { current: EChartsInstance | null }
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<EChartsInstance | null>(null)
  const onClickRef = useRef(onClick)
  const onHoverRef = useRef(onHover)
  const onHoverEndRef = useRef(onHoverEnd)

  // Latest-handler refs, refreshed after each render so the chart's listeners never
  // have to be rebound. Assigning during render trips react-hooks/refs ("Cannot update
  // ref during render"); an unkeyed effect is the sanctioned form. Safe on mount:
  // useRef seeds the first handlers, and events can only arrive after effects have run.
  useEffect(() => {
    onClickRef.current = onClick
    onHoverRef.current = onHover
    onHoverEndRef.current = onHoverEnd
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
    const base = REDUCED_MOTION ? quiesceRipples(option) : option
    chartRef.current?.setOption(
      { ...base, ...(REDUCED_MOTION ? { animation: false } : {}) },
      { notMerge: true },
    )
  }, [option])

  return <div ref={containerRef} style={{ height, width: '100%' }} />
}
