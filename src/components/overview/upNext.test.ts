import { describe, expect, it } from 'vitest'
import { calendarEvent } from '../../testing/calendarFixtures'
import type { CalendarLiving } from '../../types/api'
import {
  UP_NEXT_LIMIT,
  UP_NEXT_WINDOW_DAYS,
  type UpNextMoney,
  rankUpNext,
  upNextMoney,
  upNextWindow,
} from './upNext'

const TODAY = '2026-08-24'
const payday = (date: string) =>
  calendarEvent({ date, type: 'payday', label: 'Payday', amount: '6812.44', direction: 'in' })

/** The line as one plain sentence — what a reader sees, clause by clause. */
const sentence = (money: UpNextMoney) => `${money.lead} ${money.clauses.join(' · ')}`

const budgets = (months: string[], amount = '5478.00'): CalendarLiving[] =>
  months.map((month) => ({ month, amount, basis: 'budget', months_in_average: null }))

// Controller decision (b) on lane T's code review: every pending month is its own reminder,
// re-dated to today while its update is due, so a backlog took one of the five rows each — four of
// five on 2027-01-05. The strip shows ONE reminder row: the newest pending month, "+N earlier"
// when older ones are pending too; with none pending, the next one ahead.
describe('rankUpNext — one monthly-reminder row', () => {
  const reminder = (date: string, month: string, nominal: string, label: string) =>
    calendarEvent({ date, type: 'update_due', label, entity_ref: month, key: `ritual:${month}:${nominal}` })

  // The real copy's calendar on 2027-01-05 (lane T's walk): four months pending on today, the
  // February reminder ahead, and the rest of the month's dates.
  const JAN_5 = '2027-01-05'
  const jan5 = [
    reminder(JAN_5, '2026-09', '2026-10-01', 'Monthly update — Oct 1, 2026 balances · September 2026 spending & take-home'),
    reminder(JAN_5, '2026-10', '2026-11-01', 'Monthly update — October 2026 spending & take-home'),
    reminder(JAN_5, '2026-11', '2026-12-01', 'Monthly update — November 2026 spending & take-home'),
    reminder(JAN_5, '2026-12', '2027-01-01', 'Monthly update — Jan 1 balances · December 2026 spending & take-home'),
    calendarEvent({ date: '2027-01-09', type: 'card_fee', label: 'Capital One Venture X annual fee', amount: '395.00', direction: 'out' }),
    calendarEvent({ date: '2027-01-10', type: 'card_anniversary', label: 'Wells Fargo Active Cash anniversary' }),
    calendarEvent({ date: '2027-01-15', type: 'tax_deadline', label: 'Tax deadline — Q4 2026 estimated payment' }),
    payday('2027-01-15'),
    payday('2027-01-29'),
    reminder('2027-02-01', '2027-01', '2027-02-01', 'Monthly update — Feb 1 balances · January spending & take-home'),
  ]

  it('shows the newest pending month once, with "+3 earlier", and leaves the other rows to the rest', () => {
    const picked = rankUpNext(jan5, JAN_5)
    expect(picked.map((e) => [e.date, e.label])).toEqual([
      [JAN_5, 'Monthly update — Jan 1 balances · December 2026 spending & take-home (+3 earlier)'],
      ['2027-01-09', 'Capital One Venture X annual fee'],
      ['2027-01-15', 'Tax deadline — Q4 2026 estimated payment'],
      ['2027-01-10', 'Wells Fargo Active Cash anniversary'],
      ['2027-01-15', 'Payday'],
    ])
    // The row is the newest month's own reminder: its key, its link into the wizard.
    expect([picked[0].key, picked[0].href]).toEqual(['ritual:2026-12:2027-01-01', '/update'])
    expect(picked.filter((e) => e.type === 'update_due')).toHaveLength(1)
  })

  it('keeps a lone pending reminder as it is, and never lists the next one beside it', () => {
    const today = '2026-10-03'
    const picked = rankUpNext(
      [
        reminder(today, '2026-09', '2026-10-01', 'Monthly update — Oct 1 balances · September spending & take-home'),
        reminder('2026-11-01', '2026-10', '2026-11-01', 'Monthly update — Nov 1 balances · October spending & take-home'),
        payday('2026-10-15'),
      ],
      today,
    )
    expect(picked.map((e) => e.label)).toEqual([
      'Monthly update — Oct 1 balances · September spending & take-home',
      'Payday',
    ])
  })

  it('with nothing pending, shows the next reminder ahead — one, however many the window holds', () => {
    const picked = rankUpNext(
      [
        reminder('2026-12-01', '2026-11', '2026-12-01', 'Monthly update — Dec 1 balances · November spending & take-home'),
        reminder('2026-11-01', '2026-10', '2026-11-01', 'Monthly update — Nov 1 balances · October spending & take-home'),
      ],
      '2026-10-20',
    )
    expect(picked.map((e) => e.date)).toEqual(['2026-11-01'])
  })

  it('counts only the reminders still open — a done or hidden one is not "earlier"', () => {
    const [oct, nov, dec, jan] = jan5
    const picked = rankUpNext([{ ...oct, done: true }, { ...nov, hidden: true }, dec, jan], JAN_5)
    expect(picked.map((e) => e.label)).toEqual([
      'Monthly update — Jan 1 balances · December 2026 spending & take-home (+1 earlier)',
    ])
  })
})

describe('rankUpNext', () => {
  it('puts deadlines due within 14 days first, then dates ascending, at most one payday, five total', () => {
    const events = [
      payday('2026-08-31'),
      payday('2026-09-15'),
      calendarEvent({ date: '2026-08-25', type: 'ex_dividend', label: 'Ex-dividend — NVDA' }),
      calendarEvent({ date: '2026-09-15', type: 'tax_deadline', label: 'Tax deadline — Q3', amount: '1200.00', direction: 'out', basis: 'estimated' }), // 22 days out: not "soon"
      calendarEvent({ date: '2026-09-01', type: 'update_due', label: 'Monthly update — Sep 1 balances · August spending & take-home' }), // 8 days out: soon
      calendarEvent({ date: '2026-09-16', type: 'rsu_vest', label: 'RSU vest — 4 grants', amount: '41200.00', direction: 'in', basis: 'estimated' }),
      calendarEvent({ date: '2026-09-03', type: 'espp_qualify', label: 'ESPP lot qualifies' }),
    ]
    const picked = rankUpNext(events, TODAY)
    expect(picked.map((e) => e.label)).toEqual([
      'Monthly update — Sep 1 balances · August spending & take-home', // the only deadline due within 14 days
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
})

describe('upNextWindow', () => {
  it('is exactly 45 days: today and the 44 after it, inclusive', () => {
    // 2026-09-23 lane B1 review, M5: "Next 45 days" used to run to today + 45 — 46 days.
    expect(UP_NEXT_WINDOW_DAYS).toBe(45)
    expect(upNextWindow('2026-09-23')).toEqual({ start: '2026-09-23', end: '2026-11-06' })
    expect(upNextWindow('2026-08-24')).toEqual({ start: '2026-08-24', end: '2026-10-07' })
  })
})

describe('upNextMoney', () => {
  it('sums the window from today in cents — every payday, not just the listed one', () => {
    const money = upNextMoney(
      [
        payday('2026-08-31'),
        payday('2026-09-15'),
        calendarEvent({ date: '2026-09-15', type: 'tax_deadline', label: 'Q3', amount: '1200.00', direction: 'out', basis: 'estimated' }),
        payday('2026-10-15'), // day 53: outside the window
      ],
      [],
      TODAY,
    )
    // "Scheduled" on both dated legs (2026-09-23 spec §B2): neither is a forecast of spending.
    expect(sentence(money)).toBe('Next 45 days: +$13.6k scheduled in · ~−$1.2k scheduled out')
    expect(money.living).toBe(false)
    expect(sentence(upNextMoney([], [], TODAY))).toBe('Next 45 days: nothing due')
  })

  it('counts an event on the 45th day and not one on the 46th', () => {
    // Aug 24 + 44 = Oct 7, the window's last day; Oct 8 is the first day after it.
    expect(sentence(upNextMoney([payday('2026-10-07')], [], TODAY))).toBe(
      'Next 45 days: +$6.8k scheduled in',
    )
    expect(sentence(upNextMoney([payday('2026-10-08')], [], TODAY))).toBe(
      'Next 45 days: nothing due',
    )
  })

  it('adds the living costs the window spends, pro-rated by day in integer cents', () => {
    const living = budgets(['2026-09-01', '2026-10-01', '2026-11-01'])
    const today = '2026-09-23'
    // Sep 23–30 is 8 of 30 days, October all 31, Nov 1–6 is 6 of 30 — 45 days in all:
    // 1,460.80 + 5,478.00 + 1,095.60 = 8,034.40.
    const money = upNextMoney([payday('2026-09-30')], living, today)
    expect(sentence(money)).toBe('Next 45 days: +$6.8k scheduled in · ≈ −$8.0k living costs')
    expect(money.living).toBe(true)
    // A month the window touches without an estimate: the leg is left out, not understated.
    const partial = upNextMoney([payday('2026-09-30')], living.slice(0, 2), today)
    expect(sentence(partial)).toBe('Next 45 days: +$6.8k scheduled in')
    expect(partial.living).toBe(false)
    expect(sentence(upNextMoney([], living, today))).toBe('Next 45 days: ≈ −$8.0k living costs')
  })

  it('needs no estimate for a month the window only would have touched on a 46th day', () => {
    // Sep 17 + 44 = Oct 31: September and October are the whole window, so their two estimates
    // price it — the old today + 45 reached November 1 and dropped the leg for want of a third.
    const money = upNextMoney([], budgets(['2026-09-01', '2026-10-01']), '2026-09-17')
    // Sep 17–30 is 14 of 30 days (2,556.40) and October all of it (5,478.00).
    expect(sentence(money)).toBe('Next 45 days: ≈ −$8.0k living costs')
    expect(money.living).toBe(true)
  })

  it('hands the card the pieces it keeps whole: the lead, then each clause', () => {
    const living = budgets(['2026-09-01', '2026-10-01', '2026-11-01'])
    expect(upNextMoney([payday('2026-09-30')], living, '2026-09-23')).toEqual({
      lead: 'Next 45 days:',
      clauses: ['+$6.8k scheduled in', '≈ −$8.0k living costs'],
      living: true,
    })
    expect(upNextMoney([], [], TODAY)).toEqual({
      lead: 'Next 45 days:',
      clauses: ['nothing due'],
      living: false,
    })
  })

  it('leaves vesting out of the cash line — a vest is not money in the bank', () => {
    const money = upNextMoney(
      [
        calendarEvent({ date: '2026-08-30', type: 'rsu_vest', label: 'RSU vest', amount: '41200.00', direction: 'in', basis: 'estimated' }),
        payday('2026-08-31'),
      ],
      [],
      TODAY,
    )
    expect(sentence(money)).toBe('Next 45 days: +$6.8k scheduled in')
  })
})
