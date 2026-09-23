import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { calendarEvent } from '../../testing/calendarFixtures'
import type { CalendarLiving } from '../../types/api'
import CashflowStrip, { CashflowNotes } from './CashflowStrip'

afterEach(cleanup)

const events = [
  calendarEvent({ date: '2026-09-15', type: 'payday', label: 'Payday', amount: '6812.44', direction: 'in' }),
  calendarEvent({ date: '2026-09-30', type: 'payday', label: 'Payday', amount: '6812.44', direction: 'in' }),
  calendarEvent({ date: '2026-09-15', type: 'tax_deadline', label: 'Q3', amount: '395.00', direction: 'out', basis: 'estimated' }),
  calendarEvent({ date: '2026-09-16', type: 'rsu_vest', label: 'RSU vest — 4 grants', amount: '41200.00', direction: 'in', basis: 'estimated' }),
  calendarEvent({ date: '2026-09-20', type: 'card_fee', label: 'Fee', amount: '95.00', direction: 'out', basis: 'confirmed', hidden: true }),
  calendarEvent({ date: '2026-10-15', type: 'payday', label: 'Payday', amount: '6812.44', direction: 'in' }),
]

// The 13 living budgets in force from Sep 2026 on finance_realdata total exactly this.
const BUDGET: CalendarLiving[] = [
  { month: '2026-09-01', amount: '5478.00', basis: 'budget', months_in_average: null },
]

const tile = (name: string) => screen.getByRole('group', { name }).textContent ?? ''

describe('CashflowStrip', () => {
  it('shows five tiles: scheduled in and out, living costs, net after living, vesting', () => {
    render(<CashflowStrip events={events} month="2026-09-01" quoteAsOf="2026-09-02T20:00:00Z" living={BUDGET} />)
    expect(screen.getAllByRole('group').map((group) => group.getAttribute('aria-label'))).toEqual([
      'Scheduled in',
      'Scheduled out',
      'Living costs',
      'Net',
      'Vesting',
    ])
    expect(tile('Scheduled in')).toContain('$13,624.88')
    expect(tile('Scheduled out')).toContain('~$395.00')
    expect(tile('Living costs')).toContain('≈ $5,478')
    expect(tile('Living costs')).toContain('from your budgets')
    // 13,624.88 − 395.00 − 5,478.00: always an estimate now, so always the tilde.
    expect(tile('Net')).toContain('~$7,751.88')
    expect(tile('Net')).toContain('after living costs')
    expect(screen.getByRole('group', { name: 'Net' }).querySelector('.stat-delta-positive')).not.toBeNull()
    expect(tile('Vesting')).toContain('~$41,200.00')
    // The quote date rides the Vesting tile's own delta line (spec §10) — not a footnote row that
    // occupied a whole track of the tile grid and left the right third empty at 1920 (audit C-7).
    expect(tile('Vesting')).toContain('quote as of Sep 2, 2026')
    expect(document.querySelector('.cal-strip')?.classList.contains('kpi-row-5')).toBe(true)
    expect(document.querySelector('.cal-strip p')).toBeNull()
  })

  it('names an average by the months it read, and a negative net in the negative tone', () => {
    const average: CalendarLiving[] = [
      { month: '2026-09-01', amount: '5417.48', basis: 'average', months_in_average: 7 },
    ]
    render(<CashflowStrip events={[events[2]]} month="2026-09-01" quoteAsOf={null} living={average} />)
    expect(tile('Living costs')).toContain('≈ $5,417')
    expect(tile('Living costs')).toContain('7-month average')
    expect(tile('Net')).toContain('~−$5,812.48') // −395.00 − 5,417.48
    expect(screen.getByRole('group', { name: 'Net' }).querySelector('.stat-delta-negative')).not.toBeNull()
  })

  it('says so when there is no estimate, and calls the net what it is', () => {
    render(<CashflowStrip events={events} month="2026-09-01" quoteAsOf={null} living={[]} />)
    expect(tile('Living costs')).toContain('—')
    expect(tile('Living costs')).toContain('No budgets or complete months yet')
    expect(screen.queryByRole('group', { name: 'Net' })).toBeNull()
    expect(tile('Scheduled net')).toContain('~$13,229.88')
    expect(tile('Scheduled net')).toContain('before day-to-day spending')
    cleanup()
    // Another month's estimate is not this month's.
    render(
      <CashflowStrip
        events={events}
        month="2026-09-01"
        quoteAsOf={null}
        living={[{ ...BUDGET[0], month: '2026-10-01' }]}
      />,
    )
    expect(tile('Living costs')).toContain('No budgets or complete months yet')
  })

  it('reads an empty month honestly', () => {
    render(<CashflowStrip events={[]} month="2026-09-01" quoteAsOf={null} living={[]} />)
    expect(tile('Scheduled in')).toContain('$0.00')
    // Nothing to say about a quote when there is none.
    expect(screen.queryByText(/quote as of/)).toBeNull()
  })

  it('CashflowNotes counts the events whose money cannot be known and names the quote', () => {
    const unknowable = calendarEvent({ date: '2026-09-04', type: 'ex_dividend', label: 'Ex-dividend — NVDA', direction: 'in' })
    render(<CashflowNotes events={[events[0], unknowable]} month="2026-09-01" quoteAsOf="2026-09-02T20:00:00Z" />)
    expect(screen.getByText(/1 event has no knowable amount/)).toBeTruthy()
    expect(screen.getByText('Vest estimates ride the employer quote as of Sep 2, 2026.')).toBeTruthy()
    cleanup()
    render(<CashflowNotes events={[events[0]]} month="2026-09-01" quoteAsOf={null} />)
    expect(document.body.textContent).toBe('')
  })

  it('prints a zero estimated leg as $0.00 without the tilde', () => {
    const nothingOwed = calendarEvent({ date: '2026-09-15', type: 'tax_deadline', label: 'Q3', amount: '0.00', direction: 'out', basis: 'estimated' })
    render(<CashflowStrip events={[nothingOwed]} month="2026-09-01" quoteAsOf={null} living={[]} />)
    const cashOut = tile('Scheduled out')
    expect(cashOut).toContain('$0.00')
    expect(cashOut).not.toContain('~')
  })
})
