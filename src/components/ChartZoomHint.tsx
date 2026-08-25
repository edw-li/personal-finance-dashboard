import './panels.css'

/**
 * The inside-zoom charts have no visible affordance — the slider flavour is deliberately
 * unregistered (charts/echarts.ts) — so every card that registers one wears this caption
 * (2026-08-25 spec §2f). One component: the gesture must never be worded two ways.
 */
export default function ChartZoomHint() {
  return <p className="chart-zoom-hint">ctrl+scroll to zoom · drag to pan</p>
}
