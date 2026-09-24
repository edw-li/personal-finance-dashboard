// The dividend ledger as months (2026-09-24 table-scroll spec §4.1) — pure, no React. Production's
// ledger held 378 entries over 14 months; grouped, the card is one line a month.
import type { DividendOut } from '../../types/api'
import { toCents } from '../../utils/cents'
import { formatMonth } from '../../utils/format'

/** One month of the ledger. */
export interface DividendMonth {
  /** 'YYYY-MM' of the entries' pay_date — the Recorded date column, which is also
   *  monthlyIncomeSums' basis, so for every month the chart's trailing window draws
   *  (INCOME_WINDOW_MONTHS, ending at today's month) the month's total is its bar; a
   *  future-dated entry's month, or one older than the window, is listed without one. */
  key: string
  /** 'Sep 2026'. */
  label: string
  /** The month's entries in the order given (the API's pay_date desc, id desc). */
  rows: DividendOut[]
  /** Σ toCents(amount): integer cents through the shared reader (utils/cents.ts) behind the
   *  Spending and money-flow sums, so ten $0.10 entries total exactly $1.00. The dividend chart
   *  above sums floats and rounds once per month instead — the two agree to the cent for the
   *  ledger's two-decimal amounts (Numeric(12, 2)), which the parity test pins. */
  totalCents: number
}

/** The ledger's months, newest first. A month with no entries is absent — never a $0 line. */
export function groupDividendsByMonth(dividends: readonly DividendOut[]): DividendMonth[] {
  const months = new Map<string, DividendMonth>()
  for (const d of dividends) {
    const key = monthKeyOf(d.pay_date)
    let month = months.get(key)
    if (month === undefined) {
      month = { key, label: formatMonth(`${key}-01`), rows: [], totalCents: 0 }
      months.set(key, month)
    }
    month.rows.push(d)
    month.totalCents += toCents(d.amount)
  }
  // 'YYYY-MM' sorts as text.
  return [...months.values()].sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0))
}

/** 'YYYY-MM' of an ISO date: the grouping key, and the month a saved entry lands in. */
export function monthKeyOf(isoDate: string): string {
  return isoDate.slice(0, 7)
}

/** "1 entry", "40 entries" — the ledger's own word for a row (the chart says "dividend entries"). */
export function entriesLabel(count: number): string {
  return `${count} ${count === 1 ? 'entry' : 'entries'}`
}

/** "1 month", "14 months". */
export function monthsLabel(count: number): string {
  return `${count} ${count === 1 ? 'month' : 'months'}`
}
