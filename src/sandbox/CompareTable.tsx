import { quantize } from '../utils/amount'
import { formatCurrency, formatMonth, formatPct } from '../utils/format'
import { shiftPoint } from '../utils/percent'
import DeltaChip from './DeltaChip'
import type { PinResult } from './useSandbox'
import './sandbox.css'

// Rows × (Baseline · Scenario · Δ · pinned…) (2026-09-03 planning-sandboxes spec §8.3). The
// page declares the rows and how to read a value out of its payload; the Δ column indexes
// the SERVER's delta object by key — nothing here subtracts. Pinned columns show values
// only; null is the em dash; a pin that would not compute renders the server's sentence.
export type CompareKind = 'money' | 'percent' | 'plain' | 'month'

export interface CompareRow {
  key: string
  label: string
  kind: CompareKind
  /** Cost lines: a rise reads red. */
  invert?: boolean
}

export interface ComparePin<R> {
  id: string
  label: string
  result: PinResult<R>
}

export interface CompareTableProps<R> {
  rows: CompareRow[]
  baseline: R | null
  scenario: R | null
  valueOf: (result: R, key: string) => string | null
  /** The server's delta for a row key; omit the prop and the Δ column is omitted too. */
  delta?: (key: string) => string | null
  pins: ComparePin<R>[]
  onUnpin: (id: string) => void
  caption?: string
}

function cell(value: string | null, kind: CompareKind): string {
  if (value === null) return '—'
  if (kind === 'money') return formatCurrency(value)
  if (kind === 'percent') return formatPct(value, { signed: false })
  if (kind === 'month') return formatMonth(value)
  return value
}

/** A fraction delta as percentage POINTS, rounded to the one decimal the two columns above
 *  it already show (formatPct's default): a chip reading "+3.43 pp" under "24.7% → 28.1%"
 *  would look like a third, disagreeing number. Rounding is HALF_UP, the server's rule. */
function points(value: string | null): string | null {
  return value === null ? null : quantize(shiftPoint(value, 2), 1)
}

export default function CompareTable<R>({
  rows,
  baseline,
  scenario,
  valueOf,
  delta,
  pins,
  onUnpin,
  caption,
}: CompareTableProps<R>) {
  const read = (result: R | null, key: string) => (result === null ? null : valueOf(result, key))
  return (
    <table className="data-table compare-table">
      {caption !== undefined && <caption>{caption}</caption>}
      <thead>
        <tr>
          <th />
          <th className="num">Baseline</th>
          <th className="num">Scenario</th>
          {delta !== undefined && <th className="num">Δ</th>}
          {pins.map((pin) => (
            <th key={pin.id} className="num">
              <span className="compare-pin-head">
                {pin.label}
                <button
                  type="button"
                  className="button"
                  aria-label={`Unpin ${pin.label}`}
                  onClick={() => onUnpin(pin.id)}
                >
                  Unpin
                </button>
              </span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={row.key}>
            <td>{row.label}</td>
            <td className="num">{cell(read(baseline, row.key), row.kind)}</td>
            <td className="num">{cell(read(scenario, row.key), row.kind)}</td>
            {delta !== undefined && (
              <td className="num">
                {row.kind === 'month' ? (
                  '—'
                ) : (
                  <DeltaChip
                    value={row.kind === 'percent' ? points(delta(row.key)) : delta(row.key)}
                    kind={row.kind === 'money' ? 'money' : row.kind === 'percent' ? 'points' : 'plain'}
                    invert={row.invert}
                  />
                )}
              </td>
            )}
            {pins.map((pin) => {
              // A column with no figures in it — still running, or refused — says so ONCE,
              // spanning its own column; later rows skip the cell entirely.
              if (pin.result === 'pending') {
                return index === 0 ? (
                  <td key={pin.id} className="num" rowSpan={rows.length}>
                    …
                  </td>
                ) : null
              }
              if (typeof pin.result === 'object' && pin.result !== null && 'error' in pin.result) {
                return index === 0 ? (
                  <td key={pin.id} className="compare-pin-error" rowSpan={rows.length}>
                    {(pin.result as { error: string }).error}
                  </td>
                ) : null
              }
              return (
                <td key={pin.id} className="num">
                  {cell(valueOf(pin.result as R, row.key), row.kind)}
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
