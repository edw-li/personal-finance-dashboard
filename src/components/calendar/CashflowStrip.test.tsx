import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { calendarEvent } from '../../testing/calendarFixtures'
import CashflowStrip from './CashflowStrip'

afterEach(cleanup)

const events = [
  calendarEvent({ date: '2026-09-15', type: 'payday', label: 'Payday', amount: '6812.44', direction: 'in' }),
  calendarEvent({ date: '2026-09-30', type: 'payday', label: 'Payday', amount: '6812.44', direction: 'in' }),
  calendarEvent({ date: '2026-09-15', type: 'tax_deadline', label: 'Q3', amount: '395.00', direction: 'out', basis: 'estimated' }),
  calendarEvent({ date: '2026-09-16', type: 'rsu_vest', label: 'RSU vest — 4 grants', amount: '41200.00', direction: 'in', basis: 'estimated' }),
  calendarEvent({ date: '2026-09-20', type: 'card_fee', label: 'Fee', amount: '95.00', direction: 'out', basis: 'confirmed', hidden: true }),
  calendarEvent({ date: '2026-10-15', type: 'payday', label: 'Payday', amount: '6812.44', direction: 'in' }),
]

describe('CashflowStrip', () => {
  it('shows four tiles for the visible month, tildes on estimated legs, hidden excluded', () => {
    render(<CashflowStrip events={events} month="2026-09-01" quoteAsOf="2026-09-02T20:00:00Z" />)
    const tiles = screen.getAllByRole('group').map((tile) => tile.textContent)
    expect(tiles[0]).toContain('Cash in')
    expect(tiles[0]).toContain('$13,624.88')
    expect(tiles[1]).toContain('Cash out')
    expect(tiles[1]).toContain('~$395.00')
    expect(tiles[2]).toContain('Net')
    expect(tiles[2]).toContain('$13,229.88')
    expect(tiles[3]).toContain('Vesting')
    expect(tiles[3]).toContain('~$41,200.00')
    expect(screen.getByText(/quote as of Sep 2, 2026/)).toBeTruthy()
  })

  it('reads a negative net and an empty month honestly', () => {
    render(<CashflowStrip events={[events[2]]} month="2026-09-01" quoteAsOf={null} />)
    expect(screen.getAllByRole('group')[2].textContent).toContain('−$395.00')
    // Nothing to say about a quote when there is none.
    expect(screen.queryByText(/quote as of/)).toBeNull()
    cleanup()
    render(<CashflowStrip events={[]} month="2026-09-01" quoteAsOf={null} />)
    expect(screen.getAllByRole('group')[0].textContent).toContain('$0.00')
  })

  it('counts the events whose money cannot be known', () => {
    const unknowable = calendarEvent({ date: '2026-09-04', type: 'ex_dividend', label: 'Ex-dividend — NVDA', direction: 'in' })
    render(<CashflowStrip events={[events[0], unknowable]} month="2026-09-01" quoteAsOf={null} />)
    expect(screen.getByText(/1 event has no knowable amount/)).toBeTruthy()
  })
})
