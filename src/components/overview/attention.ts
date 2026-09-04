// Pure "needs attention" math for the overview strip — no React, no fetching (the
// overviewChartOptions.ts posture). Everything here is derived from feeds the page
// already holds; `todayIso` is a parameter so the rules are clock-injectable in tests.
import type {
  CoverageOut,
  EsppLotsResponse,
  HoldingsResponse,
  SystemStatus,
  TaxYearOut,
} from '../../types/api'
import { insideBalancesWindow } from './freshness'
import { formatDate, formatMonth } from '../../utils/format'
import { addMonths } from '../../utils/months'
import { backupAge, isStaleQuote } from '../../utils/staleness'

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
  /** GET /system/status — the last refresh outcome, backup marker and environment. */
  system: SystemStatus
  /** GET /coverage — which months each hand-entered feed actually has (spec §3). */
  coverage: CoverageOut
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

  // Coverage honesty (spec §3). Two conditions the balances nudge above cannot see: a month
  // inside the window that spending never got, and a month somebody saved with nothing in
  // it. Both are the same repair — open that month's spending step — so both link straight
  // there. ONE line per class, naming the newest month (the one still in living memory) and
  // counting the rest, so a long backlog never turns the strip into a list.
  const wizardStep = (month: string) => `/update?month=${month}&step=spending`
  const older = (count: number) =>
    count > 0 ? ` (+${count} earlier ${plural(count, 'month', 'months')})` : ''

  const missing = [...(data.coverage.spending_missing ?? [])].sort()
  if (missing.length > 0) {
    const newest = missing[missing.length - 1]
    items.push({
      key: 'spending-missing',
      text: `${formatMonth(newest)} spending was never entered${older(missing.length - 1)}`,
      to: wizardStep(newest),
    })
  }

  // Windowed here, not on the wire: the server lists every zero-filled month on file, and
  // one saved outside the balances window was never part of the book to begin with.
  const empty = (data.coverage.spending_empty ?? [])
    .filter(insideBalancesWindow(data.coverage))
    .sort()
  if (empty.length > 0) {
    const newest = empty[empty.length - 1]
    items.push({
      key: 'spending-empty',
      text: `${formatMonth(newest)} was saved with no spending${older(empty.length - 1)}`,
      to: wizardStep(newest),
    })
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

  // The last refresh run's failures — persisted whichever way it ran (the scheduled
  // job's outcome used to be log-only). The Portfolio header carries the per-ticker
  // detail and the one-click deactivate.
  const failedTickers =
    data.system.prices.last === null ? [] : Object.keys(data.system.prices.last.failed)
  if (failedTickers.length > 0) {
    const shown = failedTickers.slice(0, 3).join(', ')
    const more = failedTickers.length - Math.min(3, failedTickers.length)
    items.push({
      key: 'refresh-failed',
      text:
        `${failedTickers.length} ${plural(failedTickers.length, 'ticker', 'tickers')} failed ` +
        `the last price refresh (${shown}${more > 0 ? `, +${more} more` : ''})`,
      to: '/portfolio',
    })
  }

  // Nightly backup — PROD only (spec §3): dev boxes never back up and must not nag.
  // "Missing or older than 48h" shares backupAge with the Settings card's amber tone,
  // evaluated at today's midnight UTC exactly as prices-stale above. The verify phase
  // (2026-09-03 data-lifecycle spec §8) adds its verdict: a stale nag says both; a fresh
  // dump that did not restore gets its own line. `verified` absent = an older marker, silent.
  if (data.system.environment === 'prod') {
    const { backup } = data.system
    const stale =
      backup === null ||
      backupAge(backup.last_success_at, new Date(`${todayIso}T00:00:00Z`)) !== 'fresh'
    const unverified = backup !== null && backup.verified === false
    if (stale) {
      items.push({
        key: 'backup-stale',
        text: `Nightly backup hasn't run recently${unverified ? " and last night's was not verified" : ''}`,
        to: '/settings#backups',
      })
    } else if (unverified) {
      items.push({
        key: 'backup-unverified',
        text: "Last night's backup was not verified",
        to: '/settings#backups',
      })
    }
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
