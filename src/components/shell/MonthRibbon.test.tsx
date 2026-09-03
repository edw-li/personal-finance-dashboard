import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import MonthRibbon from './MonthRibbon'

afterEach(cleanup)

const coverage = {
  balances: new Set(['2026-09-01', '2026-08-01', '2026-07-01', '2025-01-01']),
  spending: new Set(['2026-07-01', '2026-06-01', '2025-01-01']),
}

function mount(over: Partial<Parameters<typeof MonthRibbon>[0]> = {}) {
  const onSelect = vi.fn()
  render(
    <MemoryRouter>
      <MonthRibbon
        anchor="2026-09-01"
        earliest="2025-01-01"
        coverage={coverage}
        mode="view"
        onSelect={onSelect}
        {...over}
      />
    </MemoryRouter>,
  )
  return onSelect
}

describe('MonthRibbon 2.0', () => {
  it('shows twelve chips ending at the anchor, with two-tone coverage and a today ring', () => {
    mount()
    const chips = screen.getAllByRole('button', { name: /^[A-Z][a-z]{2} \d{4}/ })
    expect(chips).toHaveLength(12)
    expect(chips[0].getAttribute('aria-label')).toMatch(/^Oct 2025/)
    expect(chips[11].getAttribute('aria-label')).toMatch(/^Sep 2026/)
    expect(chips[11].classList.contains('is-today')).toBe(true)
    // September: balances only. July: both. June: spending only. May: neither.
    expect(chips[11].classList.contains('has-balances')).toBe(true)
    expect(chips[11].classList.contains('has-spending')).toBe(false)
    expect(chips[9].classList.contains('has-balances')).toBe(true)
    expect(chips[9].classList.contains('has-spending')).toBe(true)
    expect(chips[8].classList.contains('has-spending')).toBe(true)
    expect(chips[8].classList.contains('has-balances')).toBe(false)
    expect(chips[11].getAttribute('aria-label')).toBe('Sep 2026 — balances entered, spending missing')
  })

  it('labels the year where it changes inside the window', () => {
    mount()
    const years = document.querySelectorAll('.ribbon-year')
    expect([...years].map((el) => el.textContent)).toEqual(['2025', '2026'])
  })

  it('pages back to the earliest covered month and forward to the anchor, no further', () => {
    mount()
    const prev = screen.getByRole('button', { name: 'Earlier months' })
    const next = screen.getByRole('button', { name: 'Later months' })
    expect((next as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(prev)
    expect(screen.getAllByRole('button', { name: /^[A-Z][a-z]{2} \d{4}/ })[0].getAttribute('aria-label')).toMatch(/^Oct 2024/)
    expect((prev as HTMLButtonElement).disabled).toBe(true) // Oct 2024 window already contains Jan 2025
    fireEvent.click(next)
    expect((next as HTMLButtonElement).disabled).toBe(true)
  })

  it('opens on the window that contains the selected month', () => {
    mount({ selected: '2025-01-01' })
    const chips = screen.getAllByRole('button', { name: /^[A-Z][a-z]{2} \d{4}/ })
    expect(chips.some((c) => c.classList.contains('selected') && /^Jan 2025/.test(c.getAttribute('aria-label') ?? ''))).toBe(true)
  })

  it('view mode: click selects; the Edit link points at the wizard for the selected month', () => {
    const onSelect = mount({ selected: '2026-07-01', editHref: (m) => `/update?month=${m}` })
    fireEvent.click(screen.getByRole('button', { name: /^Jun 2026/ }))
    expect(onSelect).toHaveBeenCalledWith('2026-06-01')
    const edit = screen.getByRole('link', { name: 'Edit Jul 2026 in the wizard' })
    expect(edit.getAttribute('href')).toBe('/update?month=2026-07-01')
  })

  it('prints a figure in the label when one is known', () => {
    mount({ figures: { '2026-09-01': '$806,667.88' } })
    expect(screen.getByRole('button', { name: /^Sep 2026/ }).getAttribute('aria-label')).toBe(
      'Sep 2026 — $806,667.88 — balances entered, spending missing',
    )
  })

  it('renders hollow chips and no dividers while coverage is unknown', () => {
    mount({ coverage: null, earliest: null })
    const chips = screen.getAllByRole('button', { name: /^[A-Z][a-z]{2} \d{4}/ })
    expect(chips.every((c) => !c.classList.contains('has-balances'))).toBe(true)
    expect((screen.getByRole('button', { name: 'Earlier months' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
