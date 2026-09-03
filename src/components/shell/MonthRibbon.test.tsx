import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import MonthRibbon, { pageContaining, windowFor } from './MonthRibbon'

afterEach(cleanup)

const coverage = {
  balances: new Set(['2026-09-01', '2026-08-01', '2026-07-01', '2025-01-01']),
  spending: new Set(['2026-07-01', '2026-06-01', '2025-01-01']),
}

type Props = Partial<Parameters<typeof MonthRibbon>[0]>

function mount(over: Props = {}) {
  const onSelect = vi.fn()
  const tree = (props: Props) => (
    <MemoryRouter>
      <MonthRibbon
        anchor="2026-09-01"
        earliest="2025-01-01"
        coverage={coverage}
        mode="view"
        onSelect={onSelect}
        {...props}
      />
    </MemoryRouter>
  )
  const { rerender } = render(tree(over))
  // Re-renders the SAME ribbon instance with new props — how a parent hands down a selection
  // that came from somewhere else (a deep link, the back button, the wizard's reset).
  return { onSelect, rerender: (props: Props) => rerender(tree(props)) }
}

const chips = () => screen.getAllByRole('button', { name: /^[A-Z][a-z]{2} \d{4}/ })
const firstChip = () => chips()[0].getAttribute('aria-label')
const chipVisible = (name: RegExp) => chips().some((c) => name.test(c.getAttribute('aria-label') ?? ''))
const years = () => [...document.querySelectorAll('.ribbon-year')].map((el) => el.textContent)

describe('MonthRibbon 2.0', () => {
  it('shows twelve chips ending at the anchor, with two-tone coverage and a today ring', () => {
    mount()
    const all = chips()
    expect(all).toHaveLength(12)
    expect(all[0].getAttribute('aria-label')).toMatch(/^Oct 2025/)
    expect(all[11].getAttribute('aria-label')).toMatch(/^Sep 2026/)
    expect(all[11].classList.contains('is-today')).toBe(true)
    // September: balances only. July: both. June: spending only. May: neither.
    expect(all[11].classList.contains('has-balances')).toBe(true)
    expect(all[11].classList.contains('has-spending')).toBe(false)
    expect(all[9].classList.contains('has-balances')).toBe(true)
    expect(all[9].classList.contains('has-spending')).toBe(true)
    expect(all[8].classList.contains('has-spending')).toBe(true)
    expect(all[8].classList.contains('has-balances')).toBe(false)
    expect(all[11].getAttribute('aria-label')).toBe('Sep 2026 — balances entered, spending missing')
  })

  it('rings the current month, not the anchor — the wizard anchors ahead of today', () => {
    mount({ anchor: '2026-10-01', today: '2026-09-01' })
    expect(screen.getByRole('button', { name: /^Sep 2026/ }).classList.contains('is-today')).toBe(true)
    expect(screen.getByRole('button', { name: /^Oct 2026/ }).classList.contains('is-today')).toBe(false)
  })

  it('labels the year where it changes inside the window', () => {
    mount()
    expect(years()).toEqual(['2025', '2026'])
  })

  it('pages back to the earliest covered month and forward to the anchor, no further', () => {
    mount()
    const prev = screen.getByRole('button', { name: 'Earlier months' })
    const next = screen.getByRole('button', { name: 'Later months' })
    expect(next.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(prev)
    expect(firstChip()).toMatch(/^Oct 2024/)
    expect(prev.getAttribute('aria-disabled')).toBe('true') // Oct 2024 window already contains Jan 2025
    fireEvent.click(next)
    expect(next.getAttribute('aria-disabled')).toBe('true')
  })

  it('keeps a boundary pager focused — keyboard paging must not drop focus to the document', () => {
    mount()
    const prev = screen.getByRole('button', { name: 'Earlier months' })
    prev.focus()
    fireEvent.click(prev) // lands on the window holding the Jan 2025 wall
    fireEvent.click(prev) // a guarded no-op, not a button that sheds focus by going `disabled`
    // jsdom leaves focus on a natively-disabled button, so the assertion that actually bites is
    // the tab order: `disabled` would drop the pager out of it, taking focus with it in a browser.
    expect((prev as HTMLButtonElement).disabled).toBe(false)
    expect(prev.getAttribute('aria-disabled')).toBe('true')
    expect(document.activeElement).toBe(prev)
    expect(firstChip()).toMatch(/^Oct 2024/)
  })

  it('opens on the window that contains the selected month', () => {
    mount({ selected: '2025-01-01' })
    const selected = chips().filter((c) => c.classList.contains('selected'))
    expect(selected.map((c) => c.getAttribute('aria-label'))).toEqual([expect.stringMatching(/^Jan 2025/)])
  })

  it('marks the selection with aria-pressed, and omits the attribute when nothing is selected', () => {
    const { rerender } = mount({ selected: '2026-08-01' })
    expect(screen.getByRole('button', { name: /^Aug 2026/ }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: /^Jul 2026/ }).getAttribute('aria-pressed')).toBe('false')
    rerender({}) // nothing selected: the chips are navigation, not a toggle group
    expect(screen.getByRole('button', { name: /^Aug 2026/ }).getAttribute('aria-pressed')).toBeNull()
  })

  it('view mode: click selects; the Edit link points at the wizard for the selected month', () => {
    const { onSelect } = mount({ selected: '2026-07-01', editHref: (m) => `/update?month=${m}` })
    fireEvent.click(screen.getByRole('button', { name: /^Jun 2026/ }))
    expect(onSelect).toHaveBeenCalledWith('2026-06-01')
    const edit = screen.getByRole('link', { name: 'Edit Jul 2026 in the wizard' })
    expect(edit.getAttribute('href')).toBe('/update?month=2026-07-01')
  })

  it('view mode with nothing selected: Edit falls back to the anchor month', () => {
    mount({ editHref: (m) => `/update?month=${m}` })
    const edit = screen.getByRole('link', { name: 'Edit Sep 2026 in the wizard' })
    expect(edit.getAttribute('href')).toBe('/update?month=2026-09-01')
  })

  it('edit mode has no Edit link — the wizard already is the editor', () => {
    mount({ mode: 'edit', selected: '2026-07-01', editHref: (m) => `/update?month=${m}` })
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('prints a figure in the label when one is known', () => {
    mount({ figures: { '2026-09-01': '$806,667.88' } })
    expect(screen.getByRole('button', { name: /^Sep 2026/ }).getAttribute('aria-label')).toBe(
      'Sep 2026 — $806,667.88 — balances entered, spending missing',
    )
  })

  it('renders hollow chips while coverage is unknown — the year labels are calendar fact and stay', () => {
    mount({ coverage: null, earliest: null })
    expect(chips().every((c) => !c.classList.contains('has-balances'))).toBe(true)
    expect(screen.getByRole('button', { name: 'Earlier months' }).getAttribute('aria-disabled')).toBe('true')
    // Printed either way, so the sticky row does not grow when /coverage finally resolves.
    expect(years()).toEqual(['2025', '2026'])
  })

  it('maps every month of a window back to that window, so an in-window click never jumps it', () => {
    for (const anchor of ['2026-09-01', '2025-12-01', '2024-03-01'])
      for (let page = 0; page < 4; page += 1)
        expect(windowFor(anchor, page).map((m) => pageContaining(anchor, m))).toEqual(Array(12).fill(page))
  })

  it('a later anchor (the calendar month turns over) resets the paged window', () => {
    const { rerender } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Earlier months' }))
    expect(firstChip()).toMatch(/^Oct 2024/)
    rerender({ anchor: '2026-10-01' })
    expect(firstChip()).toMatch(/^Nov 2025/)
  })

  // The window is paging state, not a memory keyed by a value that can come back around.
  // `earliest` is pushed back to 2023 where a scenario needs to page beyond the Jan 2025 wall.
  // Legend: S1 = the selection is cleared, S2 = it changes from outside (deep link, Back), S4 = a chip inside the paged window is clicked.
  it('S4: clicking a chip inside the paged window does not jump the window', () => {
    const { onSelect, rerender } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Earlier months' }))
    expect(firstChip()).toMatch(/^Oct 2024/)
    fireEvent.click(screen.getByRole('button', { name: /^Jun 2025/ }))
    expect(onSelect).toHaveBeenCalledWith('2025-06-01')
    rerender({ selected: '2025-06-01' }) // the parent hands the selection back down
    expect(firstChip()).toMatch(/^Oct 2024/)
  })

  it('S2: re-selecting an earlier deep link recenters instead of reviving the paged window', () => {
    const { rerender } = mount({ selected: '2025-01-01', earliest: '2023-01-01' })
    expect(chipVisible(/^Jan 2025/)).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Earlier months' }))
    expect(firstChip()).toMatch(/^Oct 2023/)
    rerender({ selected: '2024-06-01', earliest: '2023-01-01' })
    expect(chipVisible(/^Jun 2024/)).toBe(true)
    rerender({ selected: '2025-01-01', earliest: '2023-01-01' }) // browser Back
    expect(chipVisible(/^Jan 2025/)).toBe(true)
  })

  it('S1: clearing the selection returns to the anchor window even after paging', () => {
    const { rerender } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Earlier months' }))
    expect(firstChip()).toMatch(/^Oct 2024/)
    rerender({ selected: '2025-01-01' })
    expect(chipVisible(/^Jan 2025/)).toBe(true)
    rerender({ selected: undefined }) // "Back to latest"
    expect(firstChip()).toMatch(/^Oct 2025/)
  })
})
