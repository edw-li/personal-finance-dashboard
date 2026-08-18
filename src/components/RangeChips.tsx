import type { RangePreset } from '../charts/timeZoom'
import './panels.css'

const PRESETS: { preset: RangePreset; label: string }[] = [
  { preset: 'all', label: 'All' },
  { preset: '1y', label: '1Y' },
  { preset: 'ytd', label: 'YTD' },
]

/**
 * The time-window control for the long category-axis charts. onChange hands back a FRESH
 * `{preset}` object on every press — including a press on the already-active chip — so the
 * page's option memo recomputes and the chart snaps back to the preset's window after a
 * ctrl+wheel wander (TaxesPage's `selection` identity idiom, inverted: there a re-click
 * must NOT refetch; here a re-click deliberately re-asserts the window, and what it costs
 * is a redraw rather than a request).
 */
export default function RangeChips({
  value,
  onChange,
}: {
  value: RangePreset
  onChange: (next: { preset: RangePreset }) => void
}) {
  return (
    <div className="segmented" role="group" aria-label="Time range">
      {PRESETS.map(({ preset, label }) => (
        <button
          key={preset}
          type="button"
          className={value === preset ? 'active' : ''}
          aria-pressed={value === preset}
          onClick={() => onChange({ preset })}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
