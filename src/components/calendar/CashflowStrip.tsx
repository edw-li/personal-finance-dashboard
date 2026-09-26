import type { CalendarEvent, CalendarEventType, CalendarLiving } from '../../types/api'
import type { MetricEvidence } from '../../types/metrics'
import { formatCurrency, formatDate, formatMonth } from '../../utils/format'
import StatTile from '../StatTile'
import { metricReceipt } from '../../utils/metricReceipt'
import { addDays, addMonths } from '../../utils/months'
import { formatWholeDollars, fromCents, livingFor, monthSummary, toCents } from './cashflow'

const SCHEDULED_ONLY =
  'Scheduled figures count dated events only; day-to-day spending is the Living costs estimate.'
const DIVIDEND_DATES =
  'Automatic dividends use ex-date estimates; their date does not confirm payment.'
const NO_ESTIMATE = 'No budgets or complete months yet'

/** The Living tile's second line: where the estimate came from, in the reader's words. */
function livingBasisLabel(estimate: CalendarLiving): string {
  if (estimate.basis === 'budget') return 'from your budgets'
  return estimate.months_in_average === null
    ? 'average of complete months'
    : `${estimate.months_in_average}-month average`
}

function livingDefinition(estimate: CalendarLiving | null): string {
  if (estimate === null) {
    return 'No living budget is in force this month and no complete month is available to average. Add budgets on Spending › Budgets.'
  }
  const why = 'Dated events never include day-to-day spending, so Net subtracts this estimate.'
  if (estimate.basis === 'budget') {
    return `The living categories' budgets in force this month, summed (the Spending page's own budgets). ${why}`
  }
  const months = estimate.months_in_average ?? 'the'
  return `Mean living spending of ${months} eligible months among the twelve calendar months before this month (before the current month, for a month still ahead) — the Spending page's Previous 12 months figure. ${why}`
}

/** What a scheduled leg counts, in the reader's nouns (singular, plural). */
const LEG_NOUNS: Partial<Record<CalendarEventType, [string, string]>> = {
  payday: ['payday', 'paydays'],
  ex_dividend: ['dividend', 'dividends'],
  card_credit: ['card credit', 'card credits'],
  card_fee: ['card fee', 'card fees'],
  tax_deadline: ['tax payment', 'tax payments'],
  custom: ['custom event', 'custom events'],
}

/** A scheduled leg's second line (2026-09-25 polish spec §4.4): the events it sums, by kind — "2
 *  paydays", "2 card fees · 1 tax payment · 1 more" (the two most frequent kinds, then the rest) — or
 *  that there is nothing. Hidden events and vests are left out, as the leg's own sum leaves them. */
function legWords(events: CalendarEvent[], month: string, direction: 'in' | 'out'): string {
  const prefix = month.slice(0, 7)
  const counts = new Map<CalendarEventType, number>()
  for (const event of events) {
    if (event.hidden || event.source === 'rsu' || event.direction !== direction || event.date.slice(0, 7) !== prefix) continue
    counts.set(event.type, (counts.get(event.type) ?? 0) + 1)
  }
  if (counts.size === 0) return direction === 'in' ? 'Nothing scheduled' : 'Nothing due'
  const ranked = [...counts].sort((a, b) => b[1] - a[1])
  const named = ranked.slice(0, 2).map(([type, n]) => {
    const [one, many] = LEG_NOUNS[type] ?? ['event', 'events']
    return `${n} ${n === 1 ? one : many}`
  })
  const rest = ranked.slice(2).reduce((sum, [, n]) => sum + n, 0)
  return [...named, ...(rest > 0 ? [`${rest} more`] : [])].join(' · ')
}

// Five tiles for the VISIBLE month (2026-09-03 calendar spec §10; 2026-09-23 spec §B2), integer
// cents from the 2dp strings. The two dated legs say "Scheduled" in their LABELS, so the caveat
// that used to hide in a receipt is on the tile; Living costs is the day-to-day spending those
// events never include (the server's estimate: budgets in force, else the 12-month average), and
// Net subtracts it — always an estimate then, so always the tilde, its tone on the sub-line. With
// no estimate the tile says so and the net is the scheduled one, labelled as such. A tile whose
// inputs include an estimate wears the tilde; the quote the vest estimates ride is on the Vesting
// tile's own line. Hidden events are excluded; done deadlines are included (the money still moved).
// Each labelled group is a slot of the row's four lines (2026-09-25 polish spec §4.1), and the two
// scheduled legs say what they count (§4.4).
export default function CashflowStrip({
  events,
  month,
  quoteAsOf,
  living,
}: {
  events: CalendarEvent[]
  month: string
  quoteAsOf: string | null
  living: readonly CalendarLiving[]
}) {
  const s = monthSummary(events, month)
  const estimate = livingFor(living, month)
  const livingCents = estimate === null ? null : toCents(estimate.amount)
  const net = livingCents === null ? s.net : s.net - livingCents
  const netLabel = livingCents === null ? 'Scheduled net' : 'Net'
  const netTone = net < 0 ? 'negative' : net > 0 ? 'positive' : 'neutral'
  const asOf = quoteAsOf === null ? '' : ` (quote as of ${formatDate(quoteAsOf)})`
  const estimateHint = `Includes estimates${asOf}`
  // The tilde marks a leg that includes an estimate — unless the leg is nothing (spec §14).
  const money = (cents: number, estimated: boolean) =>
    `${estimated && cents !== 0 ? '~' : ''}${cents < 0 ? '−' : ''}${formatCurrency(fromCents(Math.abs(cents)))}`
  const window = { from: month, to: addDays(addMonths(month, 1), -1), included: [], excluded: [] }
  const warnings = [
    SCHEDULED_ONLY,
    DIVIDEND_DATES,
    ...(s.unknown ? [`${s.unknown} events have no known amount and are excluded from the sum.`] : []),
  ]
  const receipt = (
    id: string,
    label: string,
    definition: string,
    cents: number | null,
    extra: Partial<MetricEvidence> = {},
  ) =>
    metricReceipt({
      id: `calendar_${id}`,
      label,
      definition,
      value: cents === null ? null : fromCents(cents),
      completeness: s.unknown ? 'partial_estimate' : 'scheduled_events',
      source_link: `/calendar?month=${month}`,
      as_of: null,
      window,
      warnings,
      ...extra,
    })
  return (
    <div className="kpi-row kpi-row-5 cal-strip" aria-label={`Cash flow for ${formatMonth(month)}`}>
      <div className="stat-tile-slot" role="group" aria-label="Scheduled in">
        <StatTile
          label="Scheduled in"
          value={money(s.cashIn, s.estimated.cashIn)}
          delta={legWords(events, month, 'in')}
          tone="neutral"
          evidence={receipt(
            'cashIn',
            'Scheduled in',
            'Sum of visible scheduled inflows dated in the displayed month: paydays, dividend entries and custom inflows. Gross RSU vests are separate.',
            s.cashIn,
          )}
          hint={
            s.estimated.cashIn
              ? estimateHint
              : 'Paydays, dividends and your own inflows dated this month — vests are counted separately.'
          }
        />
      </div>
      <div className="stat-tile-slot" role="group" aria-label="Scheduled out">
        <StatTile
          label="Scheduled out"
          value={money(s.cashOut, s.estimated.cashOut)}
          delta={legWords(events, month, 'out')}
          tone="neutral"
          evidence={receipt(
            'cashOut',
            'Scheduled out',
            'Sum of visible scheduled outflows dated in the displayed month: fees, estimated tax deadlines and custom outflows. Day-to-day spending is estimated separately under Living costs.',
            s.cashOut,
          )}
          hint={
            s.estimated.cashOut
              ? estimateHint
              : 'Fees, estimated tax payments and your own outflows dated this month.'
          }
        />
      </div>
      <div className="stat-tile-slot" role="group" aria-label="Living costs">
        <StatTile
          label="Living costs"
          value={livingCents === null ? '—' : `≈ ${formatWholeDollars(livingCents)}`}
          delta={estimate === null ? NO_ESTIMATE : livingBasisLabel(estimate)}
          evidence={receipt('living', 'Living costs', livingDefinition(estimate), livingCents, {
            completeness: livingCents === null ? 'unavailable' : 'estimate',
            source_link:
              estimate?.basis === 'budget' ? `/spending?section=budgets&month=${month}` : '/spending',
            warnings: [],
          })}
          hint={livingDefinition(estimate)}
        />
      </div>
      <div className="stat-tile-slot" role="group" aria-label={netLabel}>
        <StatTile
          label={netLabel}
          value={money(net, livingCents !== null || s.estimated.cashIn || s.estimated.cashOut)}
          delta={livingCents === null ? 'before day-to-day spending' : 'after living costs'}
          tone={netTone}
          evidence={receipt(
            'net',
            netLabel,
            livingCents === null
              ? 'Scheduled cash in minus scheduled cash out for this month. No living-cost estimate exists yet, so day-to-day spending is not subtracted.'
              : 'Scheduled cash in minus scheduled cash out minus the living-cost estimate for this month. Hidden events are excluded and completed events remain in their original period.',
            net,
            {
              completeness:
                livingCents !== null ? 'estimate' : s.unknown ? 'partial_estimate' : 'scheduled_events',
              components: [
                { label: 'Scheduled cash in', value: fromCents(s.cashIn), unit: 'USD' },
                { label: 'Scheduled cash out', value: fromCents(s.cashOut), unit: 'USD' },
                ...(estimate === null || livingCents === null
                  ? []
                  : [
                      {
                        label: `Living costs (${livingBasisLabel(estimate)})`,
                        value: fromCents(livingCents),
                        unit: 'USD',
                      },
                    ]),
              ],
            },
          )}
          hint={
            livingCents === null
              ? 'Scheduled in minus scheduled out.'
              : 'Scheduled in − scheduled out − living costs.'
          }
        />
      </div>
      <div className="stat-tile-slot" role="group" aria-label="Vesting">
        <StatTile
          label="Vesting"
          value={money(s.vesting, s.estimated.vesting)}
          // The quote the estimates ride, on the tile itself (spec §10): a footnote row in the grid
          // took a whole track and left the right third of the strip empty at 1920 (audit C-7).
          delta={quoteAsOf === null ? undefined : `quote as of ${formatDate(quoteAsOf)}`}
          evidence={receipt(
            'vesting',
            'Vesting',
            'Gross value of scheduled RSU vests using the employer quote shown. Withholding and sell-to-cover reduce the amount available to you; vest value is not cash in.',
            s.vesting,
            { as_of: quoteAsOf },
          )}
          hint={`Gross value of the month's RSU vests at the latest employer quote${asOf}; sell-to-cover is taken before it reaches you.`}
        />
      </div>
    </div>
  )
}

/** The strip's two footnotes, rendered by the PAGE inside the calendar card's footer (after the
 *  source-health list) rather than between the tiles and the card: prose belongs inside a section
 *  boundary (spec §10), and the audit's orphan check on this page must find nothing. Renders
 *  nothing when there is nothing to say. */
export function CashflowNotes({
  events,
  month,
  quoteAsOf,
}: {
  events: CalendarEvent[]
  month: string
  quoteAsOf: string | null
}) {
  const s = monthSummary(events, month)
  return (
    <>
      {quoteAsOf !== null && (
        <p className="drill-hint cal-note">
          Vest estimates ride the employer quote as of {formatDate(quoteAsOf)}.
        </p>
      )}
      {s.unknown > 0 && (
        <p className="drill-hint cal-note">
          {s.unknown} {s.unknown === 1 ? 'event has' : 'events have'} no knowable amount.
        </p>
      )}
    </>
  )
}
