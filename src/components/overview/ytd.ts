// Pure year-to-date math for the overview card — no React, no fetching (attention.ts's
// posture; `todayIso` injectable for tests). The spending figures are the SERVER's own
// yearly rollup, verbatim; only the two aggregates no endpoint computes — the net-worth
// delta over snapshots and the year's dividend sum — are display-only client floats
// (spendStats' sanctioned class).
import type { DividendOut, NetWorthTimeseries, SpendingYearly } from '../../types/api'

export interface YtdStats {
  year: number
  /** Latest in-year net worth minus the anchor's; null without two points to span. */
  netWorthDelta: number | null
  netWorthPct: number | null
  /** ISO month the delta is measured FROM — the card says "since {anchor}" out loud. */
  anchorMonth: string | null
  /** The server's yearly-rollup strings, untouched. */
  spend: string | null
  netPay: string | null
  savingsRate: string | null
  /** Sum of this year's dividend payments; null while the log has no rows at all. */
  dividends: number | null
}

export function ytdStats(
  ts: Pick<NetWorthTimeseries, 'months' | 'net_worth'>,
  yearly: SpendingYearly,
  dividends: DividendOut[],
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

  return {
    year,
    netWorthDelta,
    netWorthPct,
    anchorMonth,
    spend: row?.total ?? null,
    netPay: row?.net_pay_total ?? null,
    savingsRate: row?.savings_rate ?? null,
    // null = the log is unused (a dash), 0 = it is used and nothing paid this year yet.
    dividends: dividends.length === 0 ? null : dividendSum,
  }
}
