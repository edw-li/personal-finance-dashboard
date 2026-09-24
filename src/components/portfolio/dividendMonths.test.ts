import { describe, expect, it } from 'vitest'
import type { DividendOut } from '../../types/api'
import { monthlyIncomeSums } from './dividendChartOptions'
import { entriesLabel, groupDividendsByMonth, monthKeyOf, monthsLabel } from './dividendMonths'

function entry(id: number, pay_date: string, amount: string): DividendOut {
  return {
    id, security_id: 1, account: null, pay_date, amount, source: 'manual',
    ex_date: null, per_share: null, shares_held: null, notes: null,
  }
}

// The API's order: pay_date desc, id desc.
const LEDGER = [
  entry(6, '2026-09-21', '0.44'),
  entry(5, '2026-09-02', '0.48'),
  entry(4, '2026-06-19', '8.20'),
  entry(3, '2025-12-31', '0.10'),
  entry(2, '2025-12-15', '0.20'),
  entry(1, '2025-12-01', '100.00'),
]

// A fixed "today" for the chart's trailing window (Oct 2024 … Sep 2026) — never new Date() in a
// test (the injectable-todayIso house law).
const TODAY = '2026-09-24'

describe('groupDividendsByMonth', () => {
  it("groups by the Recorded date's month, newest month first, keeping each month's row order", () => {
    const months = groupDividendsByMonth(LEDGER)
    expect(months.map((m) => m.key)).toEqual(['2026-09', '2026-06', '2025-12'])
    // The chart above zero-fills Jul and Aug 2026 as $0 bars; the ledger lists no month it has no
    // entries for — absent, never a $0 line.
    expect(months.some((m) => m.key === '2026-07' || m.key === '2026-08')).toBe(false)
    expect(months.map((m) => m.label)).toEqual(['Sep 2026', 'Jun 2026', 'Dec 2025'])
    expect(months[2].rows.map((d) => d.id)).toEqual([3, 2, 1])
  })

  it('orders the months newest first even when the rows arrive unordered', () => {
    const months = groupDividendsByMonth([LEDGER[5], LEDGER[0], LEDGER[3]])
    expect(months.map((m) => m.key)).toEqual(['2026-09', '2025-12'])
    expect(months[1].rows.map((d) => d.id)).toEqual([1, 3])
  })

  it("lists a future-dated entry's month first — the helper never hides or re-dates a stored entry", () => {
    // The form's date input has no max and the API takes dates to 2100, so a manual entry can lie
    // past today's month. Appended last, it still sorts first: its own month, the newest. Which
    // month the panel opens by itself is the panel's call, not this helper's.
    const ledger = [...LEDGER, entry(7, '2026-11-03', '5.00')]
    const months = groupDividendsByMonth(ledger)
    expect(months.map((m) => m.key)).toEqual(['2026-11', '2026-09', '2026-06', '2025-12'])
    // Compared with a fresh copy, so re-dating the stored row in place could not pass.
    expect(months[0].rows).toEqual([entry(7, '2026-11-03', '5.00')])
    expect(months[0].totalCents).toBe(500)
    // The chart's window ends at today's month: this month is listed without a bar.
    expect(monthlyIncomeSums(ledger, TODAY)!.some((b) => b.month === '2026-11-01')).toBe(false)
  })

  it('totals each month in integer cents — no float drift', () => {
    // 0.1 + 0.2 is 0.30000000000000004 in floats; the ledger says exactly $0.30.
    expect(groupDividendsByMonth([entry(1, '2026-01-05', '0.10'), entry(2, '2026-01-06', '0.20')])[0].totalCents).toBe(30)
    expect(groupDividendsByMonth(LEDGER).map((m) => m.totalCents)).toEqual([92, 820, 10030])
  })

  it('lists nothing for an empty ledger — a month with no entries is absent, never a $0 line', () => {
    expect(groupDividendsByMonth([])).toEqual([])
  })

  it("totals every month the chart above draws to the cent of its bar (monthlyIncomeSums' basis)", () => {
    const bars = monthlyIncomeSums(LEDGER, TODAY)!
    for (const month of groupDividendsByMonth(LEDGER)) {
      // Only months inside the chart's window have a bar: a fixture month outside it fails here,
      // by name, rather than as a TypeError on the next line.
      const bar = bars.find((b) => b.month === `${month.key}-01`)
      expect(bar, month.key).toBeDefined()
      expect(month.totalCents / 100, month.key).toBe(bar!.amount)
    }
  })
})

describe('the words around the months', () => {
  it('keys a date by its month', () => {
    expect(monthKeyOf('2026-09-21')).toBe('2026-09')
  })

  it('counts entries and months', () => {
    expect(entriesLabel(1)).toBe('1 entry')
    expect(entriesLabel(40)).toBe('40 entries')
    expect(monthsLabel(1)).toBe('1 month')
    expect(monthsLabel(14)).toBe('14 months')
  })
})
