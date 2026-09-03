import type { CalendarEvent } from '../../types/api'
import { formatCurrency, formatDate, formatMonth } from '../../utils/format'
import StatTile from '../StatTile'
import { fromCents, monthSummary } from './cashflow'

// Four tiles for the VISIBLE month (2026-09-03 calendar spec §10), integer cents from the
// 2dp strings. A tile whose inputs include an estimate wears the tilde; the quote the vest
// estimates ride is named in a visible line under the row, not only in a hint — a caveat
// nobody can read without hovering is not a caveat. Hidden events are excluded; done
// deadlines are included (the money still moved).
export default function CashflowStrip({
  events,
  month,
  quoteAsOf,
}: {
  events: CalendarEvent[]
  month: string
  quoteAsOf: string | null
}) {
  const s = monthSummary(events, month)
  const asOf = quoteAsOf === null ? '' : ` (quote as of ${formatDate(quoteAsOf)})`
  const estimateHint = `Includes estimates${asOf}`
  const money = (cents: number, estimated: boolean) =>
    `${estimated ? '~' : ''}${cents < 0 ? '−' : ''}${formatCurrency(fromCents(Math.abs(cents)))}`
  const netEstimated = s.estimated.cashIn || s.estimated.cashOut
  return (
    <div className="kpi-row cal-strip" aria-label={`Cash flow for ${formatMonth(month)}`}>
      <div role="group" aria-label="Cash in">
        <StatTile
          label="Cash in"
          value={money(s.cashIn, s.estimated.cashIn)}
          hint={
            s.estimated.cashIn
              ? estimateHint
              : 'Paydays, dividends and your own inflows this month — vests are counted separately.'
          }
        />
      </div>
      <div role="group" aria-label="Cash out">
        <StatTile
          label="Cash out"
          value={money(s.cashOut, s.estimated.cashOut)}
          hint={
            s.estimated.cashOut
              ? estimateHint
              : 'Fees, estimated tax payments and your own outflows this month.'
          }
        />
      </div>
      <div role="group" aria-label="Net">
        <StatTile
          label="Net"
          value={money(s.net, netEstimated)}
          tone={s.net < 0 ? 'negative' : s.net > 0 ? 'positive' : 'neutral'}
          hint="Cash in minus cash out."
        />
      </div>
      <div role="group" aria-label="Vesting">
        <StatTile
          label="Vesting"
          value={money(s.vesting, s.estimated.vesting)}
          hint={`Gross value of the month's RSU vests at the latest employer quote${asOf}; sell-to-cover is taken before it reaches you.`}
        />
      </div>
      {quoteAsOf !== null && (
        <p className="drill-hint cal-strip-asof">
          Vest estimates ride the employer quote as of {formatDate(quoteAsOf)}.
        </p>
      )}
      {s.unknown > 0 && (
        <p className="drill-hint cal-strip-unknown">
          {s.unknown} {s.unknown === 1 ? 'event has' : 'events have'} no knowable amount.
        </p>
      )}
    </div>
  )
}
