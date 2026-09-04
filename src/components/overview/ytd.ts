// Pure year-to-date math for the overview card — no React, no fetching (attention.ts's
// posture; `todayIso` injectable for tests). The spending figures are the SERVER's own
// yearly rollup, verbatim; only the two aggregates no endpoint computes — the net-worth
// delta over snapshots and the year's dividend sum — are display-only client floats
// (spendStats' sanctioned class). Every figure also carries the WINDOW it was computed
// over (2026-09-04 honest-numbers spec §3): a savings rate over seven matched months
// beside a net-worth delta over nine is two different years under one heading.
import type {
  CoverageOut,
  DividendOut,
  NetWorthTimeseries,
  SpendingYearly,
} from '../../types/api'
import { formatMonth } from '../../utils/format'

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
  /** Latest in-year net worth minus the anchor's; null without two points to span. */
  netWorthDelta: number | null
  netWorthPct: number | null
  /** ISO month the delta is measured FROM — the card says "since {anchor}" out loud. */
  anchorMonth: string | null
  /** ISO month the delta is measured TO — "(through Sep)". */
  throughMonth: string | null
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

export function ytdStats(
  ts: Pick<NetWorthTimeseries, 'months' | 'net_worth'>,
  yearly: SpendingYearly,
  dividends: DividendOut[],
  coverage: CoverageOut,
  todayIso: string,
): YtdStats {
  const year = Number(todayIso.slice(0, 4))
  const jan = `${year}-01-01`
  const prefix = `${year}-`

  // Anchor = the LAST snapshot before January 1 (the classic YTD base — usually the
  // prior December, honestly some earlier month across a gap). A series that starts
  // mid-year anchors on its own first in-year month instead.
  let anchorIdx = -1
  let latestIdx = -1
  let firstInYearIdx = -1
  ts.months.forEach((month, i) => {
    if (month < jan) anchorIdx = i
    if (month.startsWith(prefix)) {
      latestIdx = i
      if (firstInYearIdx === -1) firstInYearIdx = i
    }
  })

  let netWorthDelta: number | null = null
  let netWorthPct: number | null = null
  let anchorMonth: string | null = null
  const baseIdx = anchorIdx >= 0 ? anchorIdx : firstInYearIdx
  if (latestIdx >= 0 && baseIdx >= 0 && baseIdx !== latestIdx) {
    const from = Number(ts.net_worth[baseIdx])
    const to = Number(ts.net_worth[latestIdx])
    netWorthDelta = to - from
    netWorthPct = from === 0 ? null : (to - from) / Math.abs(from)
    anchorMonth = ts.months[baseIdx]
  }

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
  const matched = enteredSpend.filter((month) => paySet.has(month))
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
    netWorthDelta,
    netWorthPct,
    anchorMonth,
    throughMonth: latestIdx >= 0 ? ts.months[latestIdx] : null,
    // living_total is the honest spend; `total` is what a pre-kinds backend sends, and it
    // is what this card printed until today — so the fallback changes nothing for it.
    spend: row?.living_total ?? row?.total ?? null,
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
