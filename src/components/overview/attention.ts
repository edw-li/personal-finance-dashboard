// Pure "needs attention" math for the overview strip — no React, no fetching (the
// overviewChartOptions.ts posture). Everything here is derived from feeds the page
// already holds; `todayIso` is a parameter so the rules are clock-injectable in tests.
//
// Deliberately NOT here (needs the scheduler-persistence backend work): "last scheduled
// refresh failed" and per-ticker failure noise — the cron run's outcome is log-only today.
import type { EsppLotsResponse, HoldingsResponse, TaxYearOut } from '../../types/api'
import { formatDate, formatMonth } from '../../utils/format'
import { addMonths } from '../../utils/months'
import { isStaleQuote } from '../../utils/staleness'

export interface AttentionItem {
  key: string
  text: string
  to: string
}

export interface AttentionInputs {
  /** Net-worth coverage (the wizard writes it) — the canonical "which months exist". */
  months: string[]
  holdings: HoldingsResponse
  lots: EsppLotsResponse
  taxYears: TaxYearOut[]
}

// The ritual runs in the month's first days (recorded_on evidence), so the nudge waits a
// week before calling the current month late; a missing PREVIOUS month is overdue on any
// day of the calendar.
const UPDATE_NUDGE_DAY = 7
const ESPP_WINDOW_DAYS = 30

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many
}

export function attentionItems(data: AttentionInputs, todayIso: string): AttentionItem[] {
  const items: AttentionItem[] = []
  const currentMonth = `${todayIso.slice(0, 7)}-01`
  const dayOfMonth = Number(todayIso.slice(8, 10))

  // Monthly update — only once a first month exists: a fresh database's empty states
  // already say "enter your first month", and a reminder on top would double-message.
  if (data.months.length > 0) {
    const prevMonth = addMonths(currentMonth, -1)
    const haveCurrent = data.months.includes(currentMonth)
    const havePrev = data.months.includes(prevMonth)
    if (!havePrev && !haveCurrent) {
      items.push({
        key: 'update-overdue',
        text:
          `Monthly updates for ${formatMonth(prevMonth)} and ${formatMonth(currentMonth)} ` +
          "haven't been entered",
        to: '/update',
      })
    } else if (!haveCurrent && dayOfMonth >= UPDATE_NUDGE_DAY) {
      items.push({
        key: 'update-due',
        text: `${formatMonth(currentMonth)}'s monthly update hasn't been entered yet`,
        to: '/update',
      })
    }
    // A hole with the current month present is history repair, not a ritual reminder.
  }

  const { as_of, totals, holdings } = data.holdings
  if (as_of === null && holdings.length > 0) {
    items.push({
      key: 'prices-never',
      text: 'Prices have never been refreshed',
      to: '/portfolio',
    })
  } else if (isStaleQuote(as_of, new Date(`${todayIso}T00:00:00Z`))) {
    // Injected midnight-UTC "today" keeps this as date-vs-date as isStaleQuote itself.
    items.push({
      key: 'prices-stale',
      text: `Quotes are stale — the oldest is from ${formatDate(as_of)}`,
      to: '/portfolio',
    })
  }
  if (totals.unpriced_count > 0) {
    items.push({
      key: 'unpriced',
      text:
        `${totals.unpriced_count} ${plural(totals.unpriced_count, 'holding has', 'holdings have')} ` +
        'no price yet',
      to: '/portfolio',
    })
  }
  const warned = holdings.filter((h) => h.warnings.length > 0).length
  if (warned > 0) {
    items.push({
      key: 'holding-warnings',
      text: `${warned} ${plural(warned, 'holding carries', 'holdings carry')} data warnings`,
      to: '/portfolio',
    })
  }

  // ESPP — days_until_qualified is the SERVER's countdown (null on sold rows), so there
  // is no date math to get wrong here; `qualified` rows are already through the window.
  const qualifying = data.lots.lots
    .filter(
      (lot) =>
        !lot.is_sold &&
        !lot.qualified &&
        lot.days_until_qualified !== null &&
        lot.days_until_qualified >= 0 &&
        lot.days_until_qualified <= ESPP_WINDOW_DAYS,
    )
    .sort((a, b) => (a.days_until_qualified ?? 0) - (b.days_until_qualified ?? 0))
  if (qualifying.length > 0) {
    const next = qualifying[0]
    const days = next.days_until_qualified ?? 0
    const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`
    items.push({
      key: 'espp-qualifying',
      text:
        qualifying.length === 1
          ? `An ESPP lot qualifies ${when} (${formatDate(next.qualifying_date)})`
          : `${qualifying.length} ESPP lots qualify within ${ESPP_WINDOW_DAYS} days — next ${when}`,
      to: '/espp',
    })
  }

  // Taxes — the current year should exist (brackets clone in one click) and have inputs.
  const year = Number(todayIso.slice(0, 4))
  const taxYear = data.taxYears.find((y) => y.year === year)
  if (taxYear === undefined) {
    items.push({ key: 'tax-year-missing', text: `No ${year} tax year set up yet`, to: '/taxes' })
  } else if (taxYear.input_count === 0) {
    items.push({
      key: 'tax-inputs-empty',
      text: `${year}'s tax inputs are empty`,
      to: '/taxes',
    })
  }

  return items
}
