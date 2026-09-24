// Pure "needs attention" math for the overview strip — no React, no fetching (the
// overviewChartOptions.ts posture). Everything here is derived from feeds the page
// already holds; `todayIso` is a parameter so the rules are clock-injectable in tests.
import type {
  CoverageOut,
  EsppLotsResponse,
  FlowsPartOut,
  HoldingsResponse,
  SystemStatus,
  TaxYearOut,
  TimeStatusOut,
} from '../../types/api'
import { insideBalancesWindow } from './freshness'
import type { MonthReview } from '../../api/monthReview'
import { formatDate, formatMonth } from '../../utils/format'
import { dayName, dueByName, monthName } from '../../utils/timeWords'
import { backupAge, isStaleQuote } from '../../utils/staleness'

export interface AttentionItem {
  key: string
  text: string
  to: string
  /** 'todo' — a part of the monthly update that is due and not late: neutral, the same link
   *  (2026-09-23 spec §T3). 'warn' (the default when absent) — late, or something wrong. */
  tone?: 'todo' | 'warn'
}

export interface AttentionInputs {
  /** Net-worth coverage (the wizard writes it) — the canonical "which months exist". Kept for
   *  the empty-book guard; what is DUE is `coverage.time`'s to say. */
  months?: string[]
  holdings?: HoldingsResponse
  lots?: EsppLotsResponse
  taxYears?: TaxYearOut[]
  /** GET /system/status — the last refresh outcome, backup marker and environment. */
  system?: SystemStatus
  /** GET /coverage — which months each hand-entered feed actually has (spec §3). */
  coverage?: CoverageOut
}

const ESPP_WINDOW_DAYS = 30

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many
}

const wizardStep = (month: string, step: 'balances' | 'spending') => `/update?month=${month}&step=${step}`
const older = (count: number) => (count > 0 ? ` (+${count} earlier ${plural(count, 'month', 'months')})` : '')

/** The flows line's words for the newest month listed in `flows_due` (spec §T3, K3's copy). */
function flowsText(flows: FlowsPartOut): string {
  const name = monthName(flows.month)
  if (flows.overdue) {
    if (flows.spending === 'partial') {
      return flows.take_home_entered
        ? `${name} spending is still partial — was due ${dueByName(flows)}`
        : `${name} spending is still partial and its take-home is missing — was due ${dueByName(flows)}`
    }
    if (flows.spending === 'missing') {
      return flows.take_home_entered ? `${name} spending is overdue` : `${name} spending & take-home are overdue`
    }
    return `${name} take-home is overdue`
  }
  if (flows.spending === 'partial') {
    return flows.take_home_entered
      ? `Finish ${name} spending — entered during ${name}; add what has posted since`
      : `Finish ${name} spending and enter take-home`
  }
  if (flows.spending === 'missing') {
    return flows.take_home_entered ? `Enter ${name} spending` : `Enter ${name} spending & take-home`
  }
  return `Enter ${name} take-home`
}

/**
 * The monthly update as its two INDEPENDENT parts (2026-09-23 spec §T3, from `GET /coverage`
 * `time`): the current month's balances, due on its 1st; each ended month's spending and
 * take-home, due once it is over and entered whenever its charges have posted. A part that is
 * due is a to-do (neutral); only a late one warns — balances from the 7th, the flows from the
 * 16th by default — and nothing is asked for before it is due: not the month in progress, not an
 * early next-month snapshot. ONE line per part, naming the newest month and counting the rest.
 */
function timeItems(time: TimeStatusOut): AttentionItem[] {
  const items: AttentionItem[] = []
  const balances = time.balances
  if (balances.status !== 'final') {
    const first = dayName(balances.month)
    const recorded = balances.snapshot?.recorded_on ?? null
    const text =
      balances.status === 'missing'
        ? balances.overdue
          ? `${first} balances are overdue — due ${dayName(balances.due_on)}`
          : `Record ${first} balances`
        : balances.overdue
          ? `${first} balances are still provisional${recorded === null ? '' : ` (recorded ${dayName(recorded)})`}`
          : `Update ${first} balances — recorded early${recorded === null ? '' : `, on ${dayName(recorded)}`}`
    items.push({
      key: 'update-balances',
      text,
      to: wizardStep(balances.month, 'balances'),
      tone: balances.overdue ? 'warn' : 'todo',
    })
  }
  const flows = time.flows_due
  if (flows.length > 0) {
    const newest = flows[0] // newest first, as the wire sends it
    items.push({
      key: 'update-flows',
      text: `${flowsText(newest)}${older(flows.length - 1)}`,
      to: wizardStep(newest.month, 'spending'),
      tone: flows.some((part) => part.overdue) ? 'warn' : 'todo',
    })
  }
  // A month whose early snapshot was never saved again on or after its 1st (legacy months are
  // left out server-side): its change stays "since Sep 22" until it is confirmed or updated.
  const past = time.provisional_past
  if (past.length > 0) {
    const newest = past[0]
    const recorded = newest.recorded_on === null ? '' : ` (recorded ${dayName(newest.recorded_on)})`
    items.push({
      key: 'update-provisional',
      text:
        `${dayName(newest.month)} balances are still provisional${recorded} — confirm or update them` +
        (past.length > 1 ? ` (+${past.length - 1} earlier)` : ''),
      to: wizardStep(newest.month, 'balances'),
      tone: 'warn',
    })
  }
  return items
}

export function attentionItems(data: AttentionInputs, todayIso: string): AttentionItem[] {
  const items: AttentionItem[] = []

  // The monthly update (2026-09-23 spec §T3) — `time` is null on an empty book, which is the
  // Overview's own "Start here" card (2026-09-14 guide spec §7.1); a nudge on top of it would
  // double-message. The old day-7 "update not entered", "updates for M−1 and M" and "never
  // entered" lines are gone: they fired for the month in progress and for an early next-month
  // snapshot every month of the user's routine.
  const time = data.coverage?.time
  if (time != null && (data.months === undefined || data.months.length > 0)) items.push(...timeItems(time))

  // Coverage honesty (honest-numbers spec §3): a month somebody saved with nothing in it — its
  // repair is that month's spending step. ONE line naming the newest month and counting the
  // rest, so a long backlog never turns the strip into a list.

  // Windowed here, not on the wire: the server lists every zero-filled month on file, and
  // one saved outside the balances window was never part of the book to begin with.
  const empty = data.coverage ? (data.coverage.spending_empty ?? [])
    .filter(insideBalancesWindow(data.coverage))
    .filter(month => !data.coverage?.review_months?.some(review => review.month === month && review.state === 'closed'))
    .sort() : []
  if (empty.length > 0) {
    const newest = empty[empty.length - 1]
    items.push({
      key: 'spending-empty',
      text: `${formatMonth(newest)} was saved with no spending${older(empty.length - 1)}`,
      to: wizardStep(newest, 'spending'),
    })
  }

  if (data.holdings) {
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

  }

  // The last refresh run's failures — persisted whichever way it ran (the scheduled
  // job's outcome used to be log-only). The Portfolio header carries the per-ticker
  // detail and the one-click deactivate.
  const failedTickers =
    Object.keys(data.system?.prices.last?.failed ?? {})
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
  if (data.system?.environment === 'prod') {
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
  const qualifying = (data.lots?.lots ?? [])
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
  const taxYear = data.taxYears?.find((y) => y.year === year)
  if (data.taxYears && taxYear === undefined) {
    items.push({ key: 'tax-year-missing', text: `No ${year} tax year set up yet`, to: '/taxes' })
  } else if (taxYear?.input_count === 0) {
    items.push({
      key: 'tax-inputs-empty',
      text: `${year}'s tax inputs are empty`,
      to: '/taxes',
    })
  }

  return items
}

/**
 * The month-review rows of the Needs attention card (2026-09-13 polish spec §14). PAST months
 * only, on every day (2026-09-23 spec §T3): the current month is in progress by definition
 * (design §3.2), and the old day-7 rule put it in the card every month of the routine. A month
 * listed in `time.flows_due` is left to the flows line, which already asks for exactly what it
 * lacks — "ready to close" appears once its spending is entered and its take-home is in. Each
 * row is phrased as the action it asks for and links to that month's Review step; newest first,
 * at most two, so a backlog never turns the card into a list.
 */
export function reviewAttentionItems(
  reviews: Pick<MonthReview, 'month' | 'state'>[] | undefined,
  todayIso: string,
  flowsDue: readonly Pick<FlowsPartOut, 'month'>[] = [],
): AttentionItem[] {
  const currentMonth = `${todayIso.slice(0, 7)}-01`
  const due = new Set(flowsDue.map((flows) => flows.month))
  return (reviews ?? [])
    .filter((review) => review.month < currentMonth && !due.has(review.month))
    .flatMap((review) => {
      const name = formatMonth(review.month)
      const text =
        review.state === 'in_progress'
          ? `Finish ${name}'s update`
          : review.state === 'needs_review'
            ? `${name} changed since review — reopen`
            : review.state === 'ready_to_review'
              ? `${name} is ready to close`
              : null
      return text === null
        ? []
        : [{ key: `review-${review.month}`, text, to: `/update?month=${review.month}&step=review` }]
    })
    .sort((a, b) => b.key.localeCompare(a.key))
    .slice(0, 2)
}
