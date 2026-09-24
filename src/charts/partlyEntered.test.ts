import { beforeEach, describe, expect, it } from 'vitest'
import { flowsPart } from '../testing/timeFixtures'
import { setServerToday } from '../utils/productToday'
import {
  drawnPartial,
  NO_FLOWS,
  partialFootnote,
  partlyEnteredMonths,
  periodColumnFor,
  periodHeaderFor,
  periodNote,
} from './partlyEntered'

beforeEach(() => setServerToday('2026-10-03'))

// Oct 3 on the real-data copy: September's rent was saved during September (partial), August
// is complete, and a missing month would stay hollow elsewhere — only partial months live here.
const PARTLY = partlyEnteredMonths([
  flowsPart('2026-09-01', { spending: 'partial', overdue_from: '2026-10-16' }),
  flowsPart('2026-07-01', { spending: 'missing' }),
])

describe('partlyEnteredMonths', () => {
  it('keeps the partial months of flows_due, keyed by their 1st', () => {
    expect([...PARTLY.keys()]).toEqual(['2026-09-01'])
    expect(partlyEnteredMonths(undefined).size).toBe(0)
  })
})

describe('drawnPartial — in progress OR partly entered', () => {
  it('marks the partly entered month after it ended, and the month in progress', () => {
    expect(drawnPartial(['2026-08-01', '2026-09-01', '2026-10-01'], '2026-10-03', PARTLY)).toEqual([false, true, true])
  })

  it('reads the old YYYY-MM spelling too', () => {
    expect(drawnPartial(['2026-09'], '2026-10-03', PARTLY)).toEqual([true])
  })

  it('without flows it is exactly the in-progress rule', () => {
    expect(drawnPartial(['2026-09-01', '2026-10-01'], '2026-10-03', NO_FLOWS)).toEqual([false, true])
    expect(drawnPartial(['2026-10-01'], null, NO_FLOWS)).toEqual([false])
  })
})

describe('periodNote — the tooltip head', () => {
  it('names the due date of a partly entered month', () => {
    expect(periodNote('2026-09-01', '2026-10-03', PARTLY)).toBe('spending partly entered (due by Oct 15)')
  })

  it('keeps the in-progress words for the running month, and nothing for a whole one', () => {
    expect(periodNote('2026-10-01', '2026-10-03', PARTLY)).toBe('month to date (in progress)')
    expect(periodNote('2026-08-01', '2026-10-03', PARTLY)).toBeNull()
  })
})

describe('the table twin and the footnote', () => {
  it('names the partly entered month in the Period column', () => {
    expect(periodColumnFor(['2026-08-01', '2026-09-01'], '2026-10-03', PARTLY)).toEqual([
      'Whole month',
      'Spending partly entered (due by Oct 15)',
    ])
    expect(periodColumnFor(['2026-08-01'], '2026-10-03', PARTLY)).toBeNull()
  })

  it('marks its column header', () => {
    expect(periodHeaderFor('2026-09-01', '2026-10-03', PARTLY)).toBe('2026-09-01 (partly entered)')
    expect(periodHeaderFor('2026-10-01', '2026-10-03', PARTLY)).toBe('2026-10-01 (in progress)')
    expect(periodHeaderFor('2026-08-01', '2026-10-03', PARTLY)).toBe('2026-08-01')
  })

  // charts/partial's periodColumn/periodHeader had no production caller and are gone (review
  // minor 8): their month-in-progress cases are proved here, on the one implementation, with
  // nothing partly entered.
  it('covers the month in progress alone, as the retired periodColumn/periodHeader did', () => {
    const none = new Map()
    expect(periodColumnFor(['2026-07-01', '2026-08-01'], '2026-08-12', none)).toEqual(['Whole month', 'Month to date (in progress)'])
    expect(periodColumnFor(['2026-08-01', '2026-09-01'], '2026-08-12', none)).toEqual([
      'Month to date (in progress)',
      'Future month (in progress)',
    ])
    expect(periodColumnFor(['2026-07-01', '2026-08-01'], '2026-08-31', none)).toBeNull()
    expect(periodColumnFor(['2026-08-01'], undefined, none)).toBeNull()
    expect(periodHeaderFor('2026-08-01', '2026-08-12', none)).toBe('2026-08-01 (in progress)')
    expect(periodHeaderFor('2026-07-01', '2026-08-12', none)).toBe('2026-07-01')
    expect(periodHeaderFor('2026-08-01', null, none)).toBe('2026-08-01')
  })

  it('explains the axis mark in words, whichever months carry it', () => {
    expect(partialFootnote(['2026-08-01', '2026-09-01'], '2026-10-03', PARTLY)).toBe('* Spending partly entered')
    expect(partialFootnote(['2026-09-01', '2026-10-01'], '2026-10-03', PARTLY)).toBe(
      '* Month in progress · spending partly entered',
    )
    expect(partialFootnote(['2026-10-01'], '2026-10-03', PARTLY)).toBe('* Month in progress')
    expect(partialFootnote(['2026-08-01'], '2026-10-03', PARTLY)).toBeNull()
  })
})
