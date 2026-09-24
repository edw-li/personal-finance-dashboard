// Pure year-to-date math for the overview card — no React, no fetching (attention.ts's
// posture; `todayIso` injectable for tests). The spending figures are the SERVER's own
// yearly rollup, verbatim; only the two aggregates no endpoint computes — the net-worth
// delta from the Jan 1 balances and the year's dividend sum — are display-only client floats
// (spendStats' sanctioned class). Every figure also carries the WINDOW it was computed
// over (2026-09-04 honest-numbers spec §3): a savings rate over seven matched months
// beside a net-worth delta over nine is two different years under one heading.
import type {
  CoverageOut,
  DividendOut,
  NetWorthTimeseries,
  SpendingYearly,
} from '../../types/api'
import { dayPhrase, formatAsOf } from '../../utils/asOf'
import { formatMonth } from '../../utils/format'
import { dayName } from '../../utils/timeWords'
import { currentColumn, currentSnapshotMonth, snapshotAt, type Dated } from '../networth/snapshotStates'

/** A span of months the card names out loud. The edges say where it starts and ends;
 *  `months` is how many months actually carried data — on the saved window that is the
 *  server's own `months_matched`. */
export interface YtdWindow {
  from: string
  to: string
  months: number
}

export interface YtdStats {
  year: number
  /** The current snapshot's net worth minus the Jan 1 balances' (2026-09-23 spec §T2); 0 while
   *  the Jan 1 balances ARE the current snapshot; null without a snapshot in the year. */
  netWorthDelta: number | null
  netWorthPct: number | null
  /** 'delta' — a change to show; 'zero' — "$0 so far", the change starts from the Jan 1 balances;
   *  'none' — no snapshot keyed in the year yet. */
  netWorthState: 'delta' | 'zero' | 'none'
  /** The words under the figure: "since Jan 1 (to Sep 22 · provisional)", "since Mar 1 — no Jan
   *  1 balances (to Aug 1)", "the change starts from your Jan 1 balances", "Jan 1 balances not
   *  recorded yet". */
  netWorthWords: string
  /** LIVING spend for the year (the server's string), falling back to the plain total on a
   *  backend older than the category kinds. */
  spend: string | null
  /** The window `spend` was measured over — the MATCHED one, because `living_total` is
   *  summed over matched months (services/savings.py's `rollup`); the wider entered-spending
   *  window on the pre-kinds fallback, whose `total` really does cover every entered month. */
  spendWindow: YtdWindow | null
  netPay: string | null
  netPayWindow: YtdWindow | null
  /** Cash + payroll deductions, and cash alone — both over the matched window. */
  totalSaved: string | null
  cashSaved: string | null
  totalRate: string | null
  cashRate: string | null
  savedWindow: YtdWindow | null
  /** Sum of this year's dividend payments; null while the log has no rows at all. */
  dividends: number | null
}

/** "Jan–Jul" inside one year, "Aug 2025–Jul 2026" across a boundary, "Mar" for a single
 *  month — the words the card prints beside a figure. */
export function windowWords(window: YtdWindow): string {
  const short = (iso: string) => formatMonth(iso).slice(0, 3)
  if (window.from.slice(0, 4) !== window.to.slice(0, 4)) {
    return `${formatMonth(window.from)}–${formatMonth(window.to)}`
  }
  return window.from === window.to
    ? short(window.from)
    : `${short(window.from)}–${short(window.to)}`
}

/** "(to Sep 22 · provisional)" — the through-date and its standing (asOf.ts's dayPhrase). */
const toWords = (state: Dated) => `(to ${dayPhrase(state)})`

/** The net-worth row (2026-09-23 spec §T2): from the Jan 1 balances — the snapshot keyed
 *  {year}-01-01, whatever its state — to the CURRENT snapshot, the server's answer (§0.4(b):
 *  coverage.time.current_snapshot), which may be keyed next year: an early Jan 1 snapshot typed on
 *  Dec 28 describes Dec 28 of THIS year. December no longer counts as the new year. Without Jan 1
 *  balances the base is the year's first snapshot, said out loud. */
function netWorthYtd(
  ts: Pick<NetWorthTimeseries, 'months' | 'net_worth'> & Partial<Pick<NetWorthTimeseries, 'as_of' | 'provisional'>>,
  year: number,
  current: string | null | undefined,
): Pick<YtdStats, 'netWorthDelta' | 'netWorthPct' | 'netWorthState' | 'netWorthWords'> {
  const jan = `${year}-01-01`
  const janIdx = ts.months.indexOf(jan)
  const baseIdx = janIdx >= 0 ? janIdx : ts.months.findIndex((month) => month.startsWith(`${year}-`))
  const currentIdx = currentColumn(ts.months, current)
  // No snapshot keyed in the year yet — or only balances filed further ahead than the current
  // snapshot reaches (only an API client or an import can store those).
  if (baseIdx < 0 || currentIdx < baseIdx) {
    return { netWorthDelta: null, netWorthPct: null, netWorthState: 'none', netWorthWords: 'Jan 1 balances not recorded yet' }
  }
  const base = snapshotAt(ts, baseIdx)
  if (currentIdx === baseIdx) {
    return {
      netWorthDelta: 0,
      netWorthPct: null,
      netWorthState: 'zero',
      netWorthWords: `the change starts from your ${dayName(base.month)} balances`,
    }
  }
  const from = Number(ts.net_worth[baseIdx])
  const to = Number(ts.net_worth[currentIdx])
  const since = `since ${formatAsOf(base)}${base.provisional ? ' (provisional)' : ''}`
  const noJan = janIdx >= 0 ? '' : ' — no Jan 1 balances'
  return {
    netWorthDelta: to - from,
    netWorthPct: from === 0 ? null : (to - from) / Math.abs(from),
    netWorthState: 'delta',
    netWorthWords: `${since}${noJan} ${toWords(snapshotAt(ts, currentIdx))}`,
  }
}

export function ytdStats(
  ts: Pick<NetWorthTimeseries, 'months' | 'net_worth'> & Partial<Pick<NetWorthTimeseries, 'as_of' | 'provisional'>>,
  yearly: SpendingYearly,
  dividends: DividendOut[],
  coverage: CoverageOut,
  todayIso: string,
): YtdStats {
  // The server's year: the page passes utils/months todayIso(), the product day (spec §K1).
  const year = Number(todayIso.slice(0, 4))
  const prefix = `${year}-`

  const row = yearly.years.find((y) => y.year === year)
  const dividendSum = dividends.reduce(
    (acc, d) => (d.pay_date.startsWith(prefix) ? acc + Number(d.amount) : acc),
    0,
  )

  // The windows come from /coverage — the only feed that knows which months were ENTERED.
  // Sorted defensively: the wire is ascending, and a window drawn from an unsorted list
  // would name the wrong edges.
  const inYear = (months: string[] | undefined): string[] =>
    (months ?? []).filter((month) => month.startsWith(prefix)).sort()
  const enteredSpend = inYear(coverage.spending)
  const enteredPay = inYear(coverage.net_pay)
  const paySet = new Set(enteredPay)
  const matched = coverage.eligible_savings === undefined
    ? enteredSpend.filter((month) => paySet.has(month))
    : inYear(coverage.eligible_savings)
  const spanOf = (months: string[], count?: number): YtdWindow | null =>
    months.length === 0
      ? null
      : { from: months[0], to: months[months.length - 1], months: count ?? months.length }

  // `months_matched` is the SERVER's count for the figures below, so it wins wherever it
  // disagrees with this intersection — which months matched is the service's call (spec
  // §2), not the shell's. Coverage still names the edges.
  const matchedCount = row?.months_matched ?? matched.length
  const hasMatch = matchedCount > 0

  return {
    year,
    ...netWorthYtd(ts, year, currentSnapshotMonth(coverage)),
    // living_total is the honest spend; `total` is what a pre-kinds backend sends, and it
    // is what this card printed until today — so the fallback changes nothing for it.
    spend: row?.living_total === undefined ? row?.total ?? null : hasMatch ? row.living_total : null,
    // The label follows the FIGURE, never the feed: `living_total` is summed over matched
    // months only, so a month entered without a paycheck beside it is in neither. The
    // fallback `total` does cover every entered month, and says so.
    spendWindow:
      row?.living_total === undefined ? spanOf(enteredSpend) : spanOf(matched, matchedCount),
    netPay: row?.net_pay_total ?? null,
    netPayWindow: spanOf(enteredPay),
    // A year with no matched month has NO savings figure — not a zero one.
    totalSaved: hasMatch ? (row?.total_savings ?? null) : null,
    cashSaved: hasMatch ? (row?.cash_savings ?? null) : null,
    totalRate: hasMatch ? (row?.total_savings_rate ?? null) : null,
    cashRate: hasMatch ? (row?.savings_rate ?? null) : null,
    savedWindow: spanOf(matched, matchedCount),
    // null = the log is unused (a dash), 0 = it is used and nothing paid this year yet.
    dividends: dividends.length === 0 ? null : dividendSum,
  }
}
