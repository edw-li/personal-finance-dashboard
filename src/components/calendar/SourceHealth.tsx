import type { SourceHealth as SourceHealthRow } from '../../types/api'
import { SOURCE_COLORS, SOURCE_LABELS, SOURCE_ORDER } from './calendarView'

// The legend AND the health footer in one list (spec §3 "source-health footer replaces the
// caveat prose"): every family the server reported, in the fixed palette order, with its
// dot, its status when it is not plainly on, and the server's own note.
export default function SourceHealth({ sources }: { sources: SourceHealthRow[] }) {
  const rows = SOURCE_ORDER.flatMap((source) => sources.filter((row) => row.source === source))
  return (
    <ul className="cal-health" aria-label="Sources">
      {rows.map((row) => (
        <li key={row.source} className={`cal-health-${row.status}`}>
          <span
            className="cal-legend-dot"
            style={{ backgroundColor: SOURCE_COLORS[row.source] }}
            aria-hidden="true"
          />
          {SOURCE_LABELS[row.source]}
          {row.status !== 'ok' && (
            <>
              {/* An explicit space: JSX drops the newline between two expressions, and
                  "Paydayspartial" is not a sentence. */}
              {' '}
              <span className="badge cal-health-badge">{row.status}</span>
            </>
          )}
          {row.note !== null && <span className="cal-health-note"> — {row.note}</span>}
        </li>
      ))}
    </ul>
  )
}
