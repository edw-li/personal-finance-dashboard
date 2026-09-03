import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { calendarEvent } from '../../testing/calendarFixtures'
import DayDrawer from './DayDrawer'

afterEach(cleanup)

const events = [
  calendarEvent({ date: '2026-09-15', type: 'custom', label: 'Zoo membership', id: 3, amount: '120.00', direction: 'out', basis: 'confirmed' }),
  calendarEvent({ date: '2026-09-15', type: 'payday', label: 'Payday', amount: '6812.44', direction: 'in' }),
  calendarEvent({ date: '2026-09-15', type: 'tax_deadline', label: 'Tax deadline — Q3 estimated payment', amount: '395.00', direction: 'out', basis: 'estimated' }),
]

function mount() {
  const handlers = { onClose: vi.fn(), onAddOnDay: vi.fn() }
  render(
    <DayDrawer
      day="2026-09-15"
      events={events}
      renderDetails={(e) => <span>details: {e.label}</span>}
      {...handlers}
    />,
  )
  return handlers
}

describe('DayDrawer', () => {
  it('is a dialog on the assistant drawer shell with the date, the cash line and one row per event', () => {
    mount()
    const dialog = screen.getByRole('dialog', { name: 'Sep 15, 2026 — 3 events' })
    expect(dialog.classList.contains('assistant-drawer')).toBe(true)
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Sep 15, 2026' }))
    expect(screen.getByText('+$6.8k in · ~−$515 out')).toBeTruthy()
    const rows = screen.getAllByRole('button', { expanded: false })
    expect(rows.map((r) => r.textContent)).toEqual([
      'Zoo membership−$120',
      'Payday+$6.8k',
      'Tax deadline — Q3 estimated payment~−$395est.',
    ])
  })

  it('a row expands to the details; Escape closes; the footer adds on the day', () => {
    const handlers = mount()
    fireEvent.click(screen.getByRole('button', { name: /^Payday/ }))
    expect(screen.getByText('details: Payday')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add event on Sep 15, 2026' }))
    expect(handlers.onAddOnDay).toHaveBeenCalledWith('2026-09-15')
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(handlers.onClose).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Close the day' }))
    expect(handlers.onClose).toHaveBeenCalledTimes(2)
  })
})
