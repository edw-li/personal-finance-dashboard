import InfoHint from '../InfoHint'
import type { RealizedResponse } from '../../types/api'
import { formatCurrency } from '../../utils/format'
import './portfolio.css'

// Same three-liner as HoldingsTable's private tone() — the tone-rule copies are a known,
// tracked cleanup (Plan 6 residuals); this file joins the family rather than forking it.
function tone(value: string): string {
  const n = Number(value)
  return n > 0 ? 'pos' : n < 0 ? 'neg' : ''
}

/**
 * The first consumer of GET /portfolio/realized: lifetime realized G/L per security with
 * the server's own total. Zero rows are held-never-sold positions — noise here, so they
 * are filtered from the VIEW (the total is the server's and includes everything).
 */
export default function RealizedPanel({ realized }: { realized: RealizedResponse }) {
  // Winners first — a display order over the server's rows (HoldingsTable's client-sort
  // license), inverting the feed's ascending order; no figure is re-derived.
  const rows = [...realized.rows]
    .filter((r) => Number(r.realized_gl) !== 0)
    .sort((a, b) => Number(b.realized_gl) - Number(a.realized_gl))
  return (
    <section className="panel">
      <h2 className="panel-title">
        Realized gains
        <InfoHint text="Lifetime realized gain or loss per security from sells, average-cost method." />
      </h2>
      <p className="hint">
        Lifetime realized G/L by the average-cost method, booked when shares are sold.
        Per-year splits need dated transactions — most imported rows carry none.
      </p>
      {rows.length === 0 ? (
        <p className="empty-note">Nothing realized yet — sells land here when they book a gain or loss.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Ticker</th>
              <th>Name</th>
              <th className="num">Realized G/L</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.security_id}>
                <td>{r.ticker}</td>
                <td>{r.name}</td>
                <td className={`num ${tone(r.realized_gl)}`}>{formatCurrency(r.realized_gl)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td style={{ fontWeight: 600 }}>Total</td>
              <td />
              <td className={`num ${tone(realized.total)}`} style={{ fontWeight: 600 }}>
                {formatCurrency(realized.total)}
              </td>
            </tr>
          </tfoot>
        </table>
      )}
    </section>
  )
}
