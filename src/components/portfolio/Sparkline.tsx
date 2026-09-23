import type { PricePoint } from '../../types/api'
import { formatPct } from '../../utils/format'

// Pure-SVG sparkline: 25 chart instances per table render is why this is NOT echarts
// (cost + the jsdom canvas limit). Trend-only — no axes, no tooltip (dataviz: sparklines
// are sanctioned axis-free).
// The stroke is a CSS custom property, not a token constant (2026-09-03 shell spec §11):
// SVG presentation attributes accept var(), so the line follows the theme for free —
// baked hexes would keep the dark green/red on a white card.
//
// The cell tells the truth about its line (2026-09-23 spec §C9; wealth PF-11, charts F26).
// Per-row scaling stays — it is a sparkline — but a per-row min–max scale drew SGOV's 0.4 %
// year as the same full-height saw as a stock's 40 %, and its colour flipped on cent moves.
// So the cell PRINTS the year's change beside the line, draws a faint baseline at the
// year's first close, gives no red/green verdict to a move under 1 %, and is named for
// assistive tech instead of being aria-hidden.

/** A printed change under this many percent reads as flat: neutral ink, never a red or green
 *  verdict. Judged on the PRINTED figure (formatPct's one decimal), not the raw ratio, so the
 *  tone can never contradict what the cell says: −0.98 % prints "-1.0%" and takes the 1 %
 *  verdict with it. */
const FLAT_BELOW_PCT = 1

/** The change the line draws, first close to last — a display ratio of the two ends the
 *  line already shows (price only: no dividends, no flows), never a return figure. Null
 *  when there is no honest ratio: fewer than two points, or a start at or below zero. */
function sparklineChange(points: PricePoint[]): number | null {
  if (points.length < 2) return null
  const first = Number(points[0].c)
  const last = Number(points[points.length - 1].c)
  return first > 0 && Number.isFinite(last) ? last / first - 1 : null
}

const STROKE = { flat: 'var(--muted)', pos: 'var(--positive)', neg: 'var(--negative)' } as const

export default function Sparkline({
  points,
  label,
  width = 60,
  height = 30,
}: {
  points: PricePoint[]
  /** Who the line belongs to (the ticker) — the start of the cell's accessible name. */
  label?: string
  width?: number
  height?: number
}) {
  const name = label === undefined ? '1-year change' : `${label} 1-year change`
  if (points.length < 2) {
    return (
      <span className="sparkline-empty" role="img" aria-label={`${name} unavailable`}>
        —
      </span>
    )
  }
  const values = points.map((p) => Number(p.c))
  const min = Math.min(...values)
  const span = Math.max(...values) - min
  const step = width / (values.length - 1)
  // A flat series pins to mid-height — bottom-edge would read "at its 52-week low".
  const y = (v: number) => (span === 0 ? height / 2 : height - 2 - ((v - min) / span) * (height - 4))
  const coords = values.map((v, i) => `${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const change = sparklineChange(points)
  // formatPct's own rounding (|value × 100| to one decimal), so the verdict matches the print.
  const shownPct = change === null ? 0 : Number(Math.abs(change * 100).toFixed(1))
  const tone =
    change === null || shownPct < FLAT_BELOW_PCT ? 'flat' : change > 0 ? 'pos' : 'neg'
  const printed = change === null ? '—' : formatPct(change)
  const baseline = y(values[0]).toFixed(1)
  return (
    <span
      className="sparkline-cell"
      role="img"
      aria-label={change === null ? `${name} unavailable` : `${name} ${printed}`}
    >
      <svg
        className="sparkline"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden="true"
        focusable="false"
      >
        {/* Where the year began: the line reads as above or below it, not as a swing. */}
        <line className="sparkline-baseline" x1="0" x2={width} y1={baseline} y2={baseline} />
        <polyline points={coords} fill="none" stroke={STROKE[tone]} strokeWidth="1.5" />
      </svg>
      <span
        className={tone === 'flat' ? 'sparkline-change' : `sparkline-change ${tone}`}
        aria-hidden="true"
      >
        {printed}
      </span>
    </span>
  )
}
