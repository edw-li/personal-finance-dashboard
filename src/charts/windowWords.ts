// The words a chart card uses for a window of months (2026-09-23 spec §C1). The Overview money
// flow and the Spending "Where … went" year both cover only the months with take-home AND
// spending entered, and each says which months those are and what it leaves out, in one
// vocabulary. Pure: no React, no fetching. Months arrive as the wire's ISO strings, "YYYY-MM-DD"
// or "YYYY-MM"; only the year and month digits are read.
import { formatCurrency } from '../utils/format'

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** A month's position on one continuous count, so runs can be found across a year's turn. */
export const monthOrdinal = (iso: string) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1
const shortMonth = (iso: string) => SHORT[Number(iso.slice(5, 7)) - 1]

/** Contiguous runs of ISO months, ascending. */
export function monthRuns(months: readonly string[]): string[][] {
  const runs: string[][] = []
  for (const month of [...months].sort()) {
    const run = runs[runs.length - 1]
    if (run !== undefined && monthOrdinal(month) === monthOrdinal(run[run.length - 1]) + 1) run.push(month)
    else runs.push([month])
  }
  return runs
}

/** One run in words inside one calendar year: "Sep–Dec", "Sep". */
export function runWords(run: readonly string[]): string {
  return run.length === 1 ? shortMonth(run[0]) : `${shortMonth(run[0])}–${shortMonth(run[run.length - 1])}`
}

/** Runs in words, comma-separated: "Jan–May, Jul–Aug". */
export function monthWords(months: readonly string[]): string {
  return monthRuns(months).map(runWords).join(', ')
}

/** Spending with no take-home beside it, left out of a window and said out loud, so a rent-only
 *  September is never silently missing: "Sep 2026 spending ($2,072.23) is shown once its
 *  take-home is entered." Null when nothing is left out. */
export function spendingLeftOut(months: readonly string[], year: number, total: string | number): string | null {
  if (months.length === 0) return null
  const whose = months.length === 1 ? 'its' : 'their'
  return `${monthWords(months)} ${year} spending (${formatCurrency(total)}) is shown once ${whose} take-home is entered.`
}

/** Take-home with no spending beside it, left out the same way: "Apr 2026 take-home ($6,100.00)
 *  is shown once its spending is entered." Null when nothing is left out. */
export function takeHomeLeftOut(months: readonly string[], year: number, total: string | number): string | null {
  if (months.length === 0) return null
  const whose = months.length === 1 ? 'its' : 'their'
  return `${monthWords(months)} ${year} take-home (${formatCurrency(total)}) is shown once ${whose} spending is entered.`
}
