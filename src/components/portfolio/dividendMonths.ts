// The dividend ledger as months (2026-09-24 table-scroll spec §4.1) — pure, no React. Production's
// ledger held 378 entries over 14 months; grouped, the card is one line a month.
import type { DividendOut } from '../../types/api'
import { formatMonth } from '../../utils/format'

/** One month of the ledger. */
export interface DividendMonth {
  /** 'YYYY-MM' of the entries' pay_date — the Recorded date column, which is also
   *  monthlyIncomeSums' basis, so a month's total is its bar in the chart above the ledger. */
  key: string
  /** 'Sep 2026'. */
  label: string
  /** The month's entries in the order given (the API's pay_date desc, id desc). */
  rows: DividendOut[]
  /** Σ round(amount × 100): integer cents, so ten $0.10 entries total exactly $1.00. */
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
    month.totalCents += Math.round(Number(d.amount) * 100)
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
