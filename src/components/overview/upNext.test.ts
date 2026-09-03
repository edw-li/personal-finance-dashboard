import { describe, expect, it } from 'vitest'
import { calendarEvent } from '../../testing/calendarFixtures'
import { UP_NEXT_LIMIT, UP_NEXT_WINDOW_DAYS, rankUpNext, upNextLine } from './upNext'

const TODAY = '2026-08-24'
const payday = (date: string) =>
  calendarEvent({ date, type: 'payday', label: 'Payday', amount: '6812.44', direction: 'in' })

describe('rankUpNext', () => {
  it('puts deadlines due within 14 days first, then dates ascending, at most one payday, five total', () => {
    const events = [
      payday('2026-08-31'),
      payday('2026-09-15'),
      calendarEvent({ date: '2026-08-25', type: 'ex_dividend', label: 'Ex-dividend — NVDA' }),
      calendarEvent({ date: '2026-09-15', type: 'tax_deadline', label: 'Tax deadline — Q3', amount: '1200.00', direction: 'out', basis: 'estimated' }), // 22 days out: not "soon"
      calendarEvent({ date: '2026-09-01', type: 'update_due', label: 'Monthly update — enter August 2026' }), // 8 days out: soon
      calendarEvent({ date: '2026-09-16', type: 'rsu_vest', label: 'RSU vest — 4 grants', amount: '41200.00', direction: 'in', basis: 'estimated' }),
      calendarEvent({ date: '2026-09-03', type: 'espp_qualify', label: 'ESPP lot qualifies' }),
    ]
    const picked = rankUpNext(events, TODAY)
    expect(picked.map((e) => e.label)).toEqual([
      'Monthly update — enter August 2026', // the only deadline due within 14 days
      'Ex-dividend — NVDA',
      'Payday', // Aug 31 — the ONE payday
      'ESPP lot qualifies',
      'Tax deadline — Q3',
    ])
    expect(picked).toHaveLength(UP_NEXT_LIMIT)
  })

  it('drops hidden and done events and anything before today', () => {
    const picked = rankUpNext(
      [
        { ...payday('2026-08-20') },
        { ...payday('2026-08-31'), hidden: true },
        {
          ...calendarEvent({ date: '2026-08-26', type: 'tax_deadline', label: 'Done deadline' }),
          done: true,
        },
        payday('2026-09-15'),
      ],
      TODAY,
    )
    expect(picked.map((e) => e.date)).toEqual(['2026-09-15'])
  })

  it('upNextLine sums the next 45 days from today in cents — every payday, not just the listed one', () => {
    const line = upNextLine(
      [
        payday('2026-08-31'),
        payday('2026-09-15'),
        calendarEvent({ date: '2026-09-15', type: 'tax_deadline', label: 'Q3', amount: '1200.00', direction: 'out', basis: 'estimated' }),
        payday('2026-10-15'), // day 52: outside the window
      ],
      TODAY,
    )
    expect(line).toBe('Next 45 days: +$13.6k in · ~−$1.2k out')
    expect(upNextLine([], TODAY)).toBe('Next 45 days: nothing due')
    expect(UP_NEXT_WINDOW_DAYS).toBe(45)
  })

  it('leaves vesting out of the cash line — a vest is not money in the bank', () => {
    const line = upNextLine(
      [
        calendarEvent({ date: '2026-08-30', type: 'rsu_vest', label: 'RSU vest', amount: '41200.00', direction: 'in', basis: 'estimated' }),
        payday('2026-08-31'),
      ],
      TODAY,
    )
    expect(line).toBe('Next 45 days: +$6.8k in')
  })
})
