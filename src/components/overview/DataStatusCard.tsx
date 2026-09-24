import type { CoverageOut } from '../../types/api'
import { formatDate, formatMonth } from '../../utils/format'
import { isStaleQuote } from '../../utils/staleness'
import { freshnessClauses } from './freshness'

/**
 * The agenda column's third card (2026-09-13 polish spec §10). Four clocks: quotes move daily,
 * while balances, spending and net pay are hand-entered and each stands on its OWN month
 * (honest-numbers spec §3). They used to be a bare row of clauses at the page floor and a
 * one-line orphan between two card groups; here they are `dl` rows inside a card, and the
 * sentence about the Living spending comparison sits beneath them. Balances are named by the day
 * they describe, the flows by the newest complete month and what is still to come (2026-09-23 spec
 * §T4); a feed wears the same amber a stale quote does only once one of its parts is overdue —
 * one language for "older than it should be", never for the routine's own lag. Capitalised labels
 * on purpose: these are peer rows, not a footnote.
 */
export default function DataStatusCard({
  asOf,
  coverage,
  comparison,
}: {
  asOf: string | null
  coverage?: CoverageOut
  /** The month the Living spending tile compares, and how many eligible months it is compared with. */
  comparison?: { month: string; included: number } | null
}) {
  const clauses = coverage ? freshnessClauses(coverage) : []
  return (
    <section className="card overview-data-status">
      <h2 className="eyebrow">Data status</h2>
      <dl className="data-status-list">
        <div className="data-status-row">
          <dt>{asOf ? 'Prices as of' : 'Prices'}</dt>
          <dd className={isStaleQuote(asOf) ? 'stale' : undefined}>{asOf ? formatDate(asOf) : 'never refreshed'}</dd>
        </div>
        {clauses.map((clause) => (
          <div className="data-status-row" key={clause.key}>
            <dt>{clause.label}</dt>
            <dd className={clause.lagging ? 'stale' : undefined}>{clause.detail}</dd>
          </div>
        ))}
      </dl>
      {comparison && (
        <p className="drill-hint data-status-note">
          Living spending compares {formatMonth(comparison.month)} with {comparison.included} eligible{' '}
          {comparison.included === 1 ? 'month' : 'months'}.
        </p>
      )}
    </section>
  )
}
