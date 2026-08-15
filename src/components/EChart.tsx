import { useEffect, useRef } from 'react'
import { echarts } from '../charts/echarts'
import type { EChartsOption } from '../charts/echarts'

type EChartsInstance = ReturnType<typeof echarts.init>

const REDUCED_MOTION =
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

export default function EChart({
  option,
  height = 320,
  onClick,
}: {
  option: EChartsOption
  height?: number
  onClick?: (params: { seriesName?: string; name?: string }) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<EChartsInstance | null>(null)
  const onClickRef = useRef(onClick)

  // Latest-handler ref, refreshed after each render so the chart's click listener never
  // has to be rebound. Assigning during render trips react-hooks/refs ("Cannot update ref
  // during render"); an unkeyed effect is the sanctioned form. Safe on mount: useRef seeds
  // the first handler, and clicks can only arrive after effects have run.
  useEffect(() => {
    onClickRef.current = onClick
  })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const chart = echarts.init(el, 'finance')
    chart.on('click', (params) => onClickRef.current?.(params as { seriesName?: string }))
    chartRef.current = chart
    const observer = new ResizeObserver(() => chart.resize())
    observer.observe(el)
    return () => {
      observer.disconnect()
      chart.dispose()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    // notMerge: pages always send complete options; merging stale series causes ghosts.
    // Reduced-motion is forced AFTER the spread — a page option must never re-enable
    // animation against the user's OS preference (Global rules a11y promise).
    chartRef.current?.setOption(
      { ...option, ...(REDUCED_MOTION ? { animation: false } : {}) },
      { notMerge: true },
    )
  }, [option])

  return <div ref={containerRef} style={{ height, width: '100%' }} />
}
