import { NEGATIVE, POSITIVE } from '../../charts/theme'
import type { PricePoint } from '../../types/api'

// Pure-SVG sparkline: 25 chart instances per table render is why this is NOT echarts
// (cost + the jsdom canvas limit). Trend-only — no axes, no tooltip (dataviz: sparklines
// are sanctioned axis-free).
export default function Sparkline({
  points,
  width = 110,
  height = 30,
}: {
  points: PricePoint[]
  width?: number
  height?: number
}) {
  if (points.length < 2) return <span className="sparkline-empty">—</span>
  const values = points.map((p) => Number(p.c))
  const min = Math.min(...values)
  const span = Math.max(...values) - min || 1
  const step = width / (values.length - 1)
  const coords = values
    .map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`)
    .join(' ')
  const rising = values[values.length - 1] >= values[0]
  return (
    <svg
      className="sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      focusable="false"
    >
      <polyline points={coords} fill="none" stroke={rising ? POSITIVE : NEGATIVE} strokeWidth="1.5" />
    </svg>
  )
}
