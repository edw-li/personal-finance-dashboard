import { formatMonth } from '../utils/format'
import { lastNMonths } from '../utils/months'
import './panels.css'

// The app's signature device: a last-N-months coverage strip. Filled chip = the month
// has data, hollow = missing, ring = selected. Heads both module pages (read-only
// navigation into the wizard) and the wizard itself (month picker).
export default function MonthRibbon({
  anchor,
  count = 12,
  filledMonths,
  selected,
  onSelect,
}: {
  anchor: string
  count?: number
  filledMonths: Set<string>
  selected?: string
  onSelect: (monthIso: string) => void
}) {
  return (
    <div className="month-ribbon" role="group" aria-label="Month coverage">
      {lastNMonths(anchor, count).map((month) => {
        const filled = filledMonths.has(month)
        const classes = [
          'month-chip',
          filled ? 'filled' : '',
          month === selected ? 'selected' : '',
        ]
          .filter(Boolean)
          .join(' ')
        const label = `${formatMonth(month)}${filled ? '' : ' — no data'}`
        return (
          <button
            key={month}
            type="button"
            className={classes}
            title={label}
            aria-label={label}
            aria-pressed={month === selected}
            onClick={() => onSelect(month)}
          >
            <span className="month-chip-dot" aria-hidden="true" />
            <span className="month-chip-label">{formatMonth(month).slice(0, 3)}</span>
          </button>
        )
      })}
    </div>
  )
}
