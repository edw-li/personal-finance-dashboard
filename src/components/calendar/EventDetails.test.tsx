import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { calendarEvent } from '../../testing/calendarFixtures'
import type { CalendarEvent } from '../../types/api'
import EventDetails from './EventDetails'

afterEach(cleanup)

function mount(event: CalendarEvent) {
  const handlers = { onEdit: vi.fn(), onDelete: vi.fn(), onOverride: vi.fn() }
  render(
    <MemoryRouter>
      <EventDetails event={event} deleting={false} saving={false} {...handlers} />
    </MemoryRouter>,
  )
  return handlers
}

const q3 = calendarEvent({
  date: '2026-09-15',
  type: 'tax_deadline',
  label: 'Tax deadline — Q3 estimated payment',
  detail: 'Shortfall $2,400.00 to the prior-year leg',
  amount: '1200.00',
  direction: 'out',
  basis: 'estimated',
})

describe('EventDetails', () => {
  it('shows the amount with its basis badge, the detail and the Open link', () => {
    mount(q3)
    expect(screen.getByText('Tax deadline · Sep 15, 2026')).toBeTruthy()
    expect(screen.getByText('$1,200.00 out')).toBeTruthy()
    expect(screen.getByText('estimated')).toBeTruthy()
    expect(screen.getByText('Shortfall $2,400.00 to the prior-year leg')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open Taxes →' }).getAttribute('href')).toBe('/taxes')
  })

  it('Mark done and Hide PUT the full override body', () => {
    const handlers = mount(q3)
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }))
    expect(handlers.onOverride).toHaveBeenCalledWith(q3, {
      done: true,
      hidden: false,
      note: null,
      amount: null,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }))
    expect(handlers.onOverride).toHaveBeenCalledWith(q3, {
      done: false,
      hidden: true,
      note: null,
      amount: null,
    })
  })

  it('a done deadline offers Reopen; a hidden event offers Unhide', () => {
    mount({ ...q3, done: true, hidden: true })
    expect(screen.getByRole('button', { name: 'Reopen' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Unhide' })).toBeTruthy()
  })

  it('Your figure saves an amount and a note, and "Use the estimate" clears it', () => {
    const handlers = mount(q3)
    fireEvent.click(screen.getByRole('button', { name: 'Your figure' }))
    fireEvent.change(screen.getByLabelText('Amount you paid'), { target: { value: '1250' } })
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: ' paid via EFTPS ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save figure' }))
    expect(handlers.onOverride).toHaveBeenCalledWith(q3, {
      done: false,
      hidden: false,
      note: 'paid via EFTPS',
      amount: '1250',
    })
    cleanup()
    const overridden = {
      ...q3,
      amount: '1250.00',
      basis: 'confirmed' as const,
      amount_overridden: true,
      note: 'paid via EFTPS',
    }
    const again = mount(overridden)
    expect(screen.getByText('your figure')).toBeTruthy()
    expect(screen.getByText('Note: paid via EFTPS')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Use the estimate' }))
    expect(again.onOverride).toHaveBeenCalledWith(overridden, {
      done: false,
      hidden: false,
      note: 'paid via EFTPS',
      amount: null,
    })
  })

  it('a folded vest lists its items', () => {
    mount(
      calendarEvent({
        date: '2026-09-16',
        type: 'rsu_vest',
        label: 'RSU vest — 2 grants',
        amount: '17500.00',
        direction: 'in',
        basis: 'estimated',
        items: [
          { label: '2025 offer', amount: '12500.00', person_id: null, detail: '25 sh' },
          { label: '2026 refresh', amount: '5000.00', person_id: null, detail: '10 sh' },
        ],
      }),
    )
    const items = screen.getAllByRole('listitem').map((li) => li.textContent)
    expect(items).toEqual(['2025 offer$12,500.00 · 25 sh', '2026 refresh$5,000.00 · 10 sh'])
    expect(screen.queryByRole('button', { name: 'Mark done' })).toBeNull() // not a deadline
    expect(screen.getByRole('button', { name: 'Hide' })).toBeTruthy()
  })

  it('a custom event offers Edit/Delete and says how it repeats; no override buttons', () => {
    const handlers = mount(
      calendarEvent({
        date: '2026-08-12',
        type: 'custom',
        label: 'Piano lesson',
        id: 8,
        recurrence: 'weekly',
        until: '2026-08-19',
        series_start: '2026-08-05',
        amount: '60.00',
        direction: 'out',
        basis: 'confirmed',
      }),
    )
    expect(screen.getByText('Repeats weekly until Aug 19, 2026')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Hide' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(handlers.onEdit).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(handlers.onDelete).toHaveBeenCalled()
  })

  it('a one-off custom row says nothing about repeating', () => {
    // 'none' is a real wire value, not an absence — "Repeats none" would be nonsense.
    mount(calendarEvent({ date: '2026-08-12', type: 'custom', label: 'Zoo', id: 9, recurrence: 'none' }))
    expect(screen.queryByText(/^Repeats/)).toBeNull()
  })
})
