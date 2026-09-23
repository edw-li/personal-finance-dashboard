import { describe, expect, it } from 'vitest'
import {
  budgetCountAt,
  budgetSinceIndex,
  budgetedIndexes,
  budgetsElsewhere,
  budgetsOpeningIndex,
  isMonthInProgress,
} from './budgetMonth'

// The Budgets view's month rules (2026-09-23 spec §B5), over the matrix's RESOLVED budget
// column — the only budget truth the page holds.

const MONTHS = ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01']

function book(budgets: (string | null)[][]) {
  return {
    months: MONTHS,
    series: budgets.map((column, i) => ({
      category_id: i + 1,
      values: MONTHS.map(() => null),
      budgets: column,
    })),
  }
}

describe('budgetsOpeningIndex — where the Budgets view opens when the URL names no month', () => {
  it("opens on today's month when a budget is in force there", () => {
    expect(budgetsOpeningIndex(book([[null, null, null, '501.00']]), '2026-09-01')).toBe(3)
  })

  it("falls back to the latest earlier month with a budget when today's month is not entered", () => {
    expect(budgetsOpeningIndex(book([[null, '10.00', '10.00', '10.00']]), '2026-10-01')).toBe(3)
  })

  it("falls back to the latest earlier month with a budget when today's budgets ended", () => {
    expect(budgetsOpeningIndex(book([['10.00', '10.00', null, null]]), '2026-09-01')).toBe(1)
  })

  it('never opens on a future month while a current or past month has budgets', () => {
    // Budgets ended in Jul and restart in Sep; today is Aug: Jul is where they last applied.
    expect(budgetsOpeningIndex(book([['1.00', '1.00', null, '1.00']]), '2026-08-01')).toBe(1)
  })

  it('opens on the earliest future month when only future months carry budgets', () => {
    expect(budgetsOpeningIndex(book([[null, null, '5.00', '5.00']]), '2026-07-01')).toBe(2)
  })

  it('answers null when no month has a budget — the page default applies', () => {
    expect(budgetsOpeningIndex(book([[null, null, null, null]]), '2026-09-01')).toBeNull()
  })

  it('reads the old YYYY-MM month spelling too', () => {
    const short = {
      months: ['2026-08', '2026-09'],
      series: [{ category_id: 1, values: [null, null], budgets: [null, '1.00'] }],
    }
    expect(budgetsOpeningIndex(short, '2026-09-01')).toBe(1)
  })
})

describe('budgetSinceIndex — the month a budget took effect', () => {
  it('walks back over the unbroken run of the same amount', () => {
    expect(budgetSinceIndex([null, '10.00', '10.00', '10.00'], 3)).toBe(1)
  })

  it('starts a new run where the amount changed', () => {
    expect(budgetSinceIndex(['10.00', '10.00', '12.00', '12.00'], 3)).toBe(2)
  })

  it('compares amounts, not spellings', () => {
    expect(budgetSinceIndex(['10', '10.00'], 1)).toBe(0)
  })

  it('reaches the first month of the matrix when the budget is older than the matrix', () => {
    expect(budgetSinceIndex(['7.00', '7.00'], 1)).toBe(0)
  })

  it('answers null when no budget is in force that month', () => {
    expect(budgetSinceIndex(['10.00', null], 1)).toBeNull()
  })
})

describe('budgetsElsewhere — where the budgets are when the viewed month has none', () => {
  it('before the first budgeted month: they START there, with the count in force then', () => {
    const b = book([
      [null, null, null, '1.00'],
      [null, null, null, '2.00'],
    ])
    expect(budgetsElsewhere(b, 2)).toEqual({
      targetIndex: 3,
      relation: 'start',
      count: 2,
      everyBudget: true,
    })
  })

  it('says when the budgets in force at the start are not all of them', () => {
    const b = book([
      [null, '1.00', '1.00', '1.00'],
      [null, null, null, '2.00'],
    ])
    expect(budgetsElsewhere(b, 0)).toEqual({
      targetIndex: 1,
      relation: 'start',
      count: 1,
      everyBudget: false,
    })
  })

  it('after every budget ended: the last month they were in force', () => {
    expect(budgetsElsewhere(book([['1.00', '1.00', null, null]]), 3)).toEqual({
      targetIndex: 1,
      relation: 'ended',
      count: 1,
      everyBudget: true,
    })
  })

  it('in a gap between budgeted months: where they resume', () => {
    expect(budgetsElsewhere(book([['1.00', null, null, '1.00']]), 1)).toMatchObject({
      targetIndex: 3,
      relation: 'resume',
    })
  })

  it('is null when the viewed month has budgets, or when the book has none at all', () => {
    expect(budgetsElsewhere(book([['1.00', '1.00', '1.00', '1.00']]), 2)).toBeNull()
    expect(budgetsElsewhere(book([[null, null, null, null]]), 2)).toBeNull()
  })
})

describe('isMonthInProgress — "a month whose last day is after today" (spec §0)', () => {
  it('the current month before its last day is in progress', () => {
    expect(isMonthInProgress('2026-09-01', '2026-09-23')).toBe(true)
  })

  it('on its last day it is not — the objective rule, verbatim', () => {
    expect(isMonthInProgress('2026-09-01', '2026-09-30')).toBe(false)
  })

  it('a past month never is; a future month always is', () => {
    expect(isMonthInProgress('2026-08-01', '2026-09-23')).toBe(false)
    expect(isMonthInProgress('2026-10-01', '2026-09-23')).toBe(true)
  })

  it('knows a leap-year February and the old YYYY-MM spelling', () => {
    expect(isMonthInProgress('2028-02-01', '2028-02-28')).toBe(true)
    expect(isMonthInProgress('2028-02', '2028-02-29')).toBe(false)
  })
})

describe('budgetedIndexes / budgetCountAt', () => {
  it('lists the months with any budget, and counts the budgets in force in one', () => {
    const b = book([
      [null, '1.00', null, '1.00'],
      [null, null, null, '2.00'],
    ])
    expect(budgetedIndexes(b)).toEqual([1, 3])
    expect(budgetCountAt(b, 3)).toBe(2)
    expect(budgetCountAt(b, 0)).toBe(0)
  })
})
