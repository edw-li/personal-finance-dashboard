import type { CalendarEvent } from '../../types/api'
import { formatCurrency, formatDate, formatMonth } from '../../utils/format'
import StatTile from '../StatTile'
import { metricReceipt } from '../../utils/metricReceipt'
import { addDays, addMonths } from '../../utils/months'
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
  const receipt = (id: 'cashIn' | 'cashOut' | 'net' | 'vesting', label: string, definition: string) => metricReceipt({
    id: `calendar_${id}`, label, definition, value: fromCents(s[id]), completeness: s.unknown ? 'partial_estimate' : 'scheduled_events',
    source_link: `/calendar?month=${month}`, as_of: id === 'vesting' ? quoteAsOf : null,
    window: { from: month, to: addDays(addMonths(month, 1), -1), included: [], excluded: [] },
    warnings: ['Scheduled events only. This calendar does not contain all household spending or a complete cash forecast.', 'Automatic dividends use ex-date estimates; their date does not confirm payment.', ...(s.unknown ? [`${s.unknown} events have no known amount and are excluded from the sum.`] : [])],
    components: id === 'net' ? [{ label: 'Scheduled cash in', value: fromCents(s.cashIn), unit: 'USD' }, { label: 'Scheduled cash out', value: fromCents(s.cashOut), unit: 'USD' }] : [],
  })
  return (
    <div className="kpi-row cal-strip" aria-label={`Cash flow for ${formatMonth(month)}`}>
      <div role="group" aria-label="Cash in">
        <StatTile
          label="Cash in"
          value={money(s.cashIn, s.estimated.cashIn)}
          evidence={receipt('cashIn', 'Cash in', 'Sum of visible scheduled inflows during the displayed month, including paydays, dividend entries and custom inflows. Gross RSU vests are separate.')}
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
          evidence={receipt('cashOut', 'Cash out', 'Sum of visible scheduled outflows during the displayed month, such as fees, estimated tax deadlines and custom outflows. Monthly spending totals are not included.')}
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
          evidence={receipt('net', 'Net scheduled cash flow', 'Scheduled cash in minus scheduled cash out for this month. Hidden events are excluded and completed events remain in their original period.')}
          tone={s.net < 0 ? 'negative' : s.net > 0 ? 'positive' : 'neutral'}
          hint="Cash in minus cash out."
        />
      </div>
      <div role="group" aria-label="Vesting">
        <StatTile
          label="Vesting"
          value={money(s.vesting, s.estimated.vesting)}
          evidence={receipt('vesting', 'Vesting', 'Gross value of scheduled RSU vests using the employer quote shown. Withholding and sell-to-cover reduce the amount available to you; vest value is not cash in.')}
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
