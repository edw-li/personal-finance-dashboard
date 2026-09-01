import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/prices', () => ({
  refreshPrices: vi.fn().mockResolvedValue({}),
}))
import { refreshPrices } from '../api/prices'
import CommandPalette from './CommandPalette'

function LocationProbe() {
  const { pathname, search } = useLocation()
  return (
    <>
      <div data-testid="pathname">{pathname}</div>
      <div data-testid="search">{search}</div>
    </>
  )
}

function renderPalette() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <CommandPalette />
      <LocationProbe />
      <button>outside button</button>
    </MemoryRouter>,
  )
}

const openPalette = () => fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
const combo = () => screen.getByRole('combobox')

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

afterEach(cleanup)

describe('CommandPalette', () => {
  it('Ctrl+K opens focused (preventDefault-ing the browser), Escape closes and restores focus', () => {
    renderPalette()
    expect(document.querySelector('.palette-overlay')).toBeNull()
    const outside = screen.getByRole('button', { name: 'outside button' })
    outside.focus()
    // fireEvent returns false when preventDefault ran — the browser's own ^K stays out.
    expect(fireEvent.keyDown(window, { key: 'k', ctrlKey: true })).toBe(false)
    expect(document.activeElement).toBe(combo())
    fireEvent.keyDown(combo(), { key: 'Escape' })
    expect(document.querySelector('.palette-overlay')).toBeNull()
    expect(document.activeElement).toBe(outside)
  })

  it('leaves Ctrl+Shift+K and Ctrl+Alt+K (AltGr) to the browser and the layout', () => {
    renderPalette()
    // fireEvent returns true when nothing called preventDefault — the key rides on.
    expect(fireEvent.keyDown(window, { key: 'k', ctrlKey: true, shiftKey: true })).toBe(true)
    expect(document.querySelector('.palette-overlay')).toBeNull()
    expect(fireEvent.keyDown(window, { key: 'k', ctrlKey: true, altKey: true })).toBe(true)
    expect(document.querySelector('.palette-overlay')).toBeNull()
  })

  it('keeps focus on the input when its own chrome is pressed', () => {
    renderPalette()
    openPalette()
    const palette = document.querySelector('.palette') as HTMLElement
    // preventDefault-ed, so the press never blurs the input: Escape keeps closing and Tab
    // cannot walk out into the page behind the overlay.
    expect(fireEvent.mouseDown(palette)).toBe(false)
    expect(document.activeElement).toBe(combo())
    fireEvent.keyDown(combo(), { key: 'Escape' })
    expect(document.querySelector('.palette-overlay')).toBeNull()
  })

  it('Cmd+K toggles: a second press closes', () => {
    renderPalette()
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    expect(document.querySelector('.palette-overlay')).not.toBeNull()
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    expect(document.querySelector('.palette-overlay')).toBeNull()
  })

  it('wears the combobox pattern: expanded, controls the listbox, tracks the active option', () => {
    renderPalette()
    openPalette()
    expect(combo().getAttribute('aria-expanded')).toBe('true')
    expect(combo().getAttribute('aria-controls')).toBe('palette-listbox')
    const first = screen.getAllByRole('option')[0]
    expect(first.getAttribute('aria-selected')).toBe('true')
    expect(combo().getAttribute('aria-activedescendant')).toBe(first.id)
  })

  it('filters by subsequence and Enter navigates', () => {
    renderPalette()
    openPalette()
    fireEvent.change(combo(), { target: { value: 'spen' } })
    expect(screen.getAllByRole('option')[0].textContent).toContain('Spending')
    fireEvent.keyDown(combo(), { key: 'Enter' })
    expect(screen.getByTestId('pathname').textContent).toBe('/spending')
    expect(document.querySelector('.palette-overlay')).toBeNull()
  })

  it('arrows move the selection and wrap', () => {
    renderPalette()
    openPalette()
    fireEvent.keyDown(combo(), { key: 'ArrowDown' })
    expect(screen.getAllByRole('option')[1].getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(combo(), { key: 'ArrowUp' })
    fireEvent.keyDown(combo(), { key: 'ArrowUp' })
    const options = screen.getAllByRole('option')
    expect(options[options.length - 1].getAttribute('aria-selected')).toBe('true')
  })

  it('traps Tab on the input — the palette is a one-stop focus zone', () => {
    renderPalette()
    openPalette()
    expect(fireEvent.keyDown(combo(), { key: 'Tab' })).toBe(false)
    expect(document.activeElement).toBe(combo())
  })

  it('"Refresh prices" launches the POST and lands on /portfolio', () => {
    renderPalette()
    openPalette()
    fireEvent.change(combo(), { target: { value: 'refresh' } })
    fireEvent.keyDown(combo(), { key: 'Enter' })
    expect(refreshPrices).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('pathname').textContent).toBe('/portfolio')
  })

  it('"Add dividend" lands on the dividends tab via the arrival-only ?tab= link', () => {
    renderPalette()
    openPalette()
    fireEvent.change(combo(), { target: { value: 'add div' } })
    fireEvent.keyDown(combo(), { key: 'Enter' })
    expect(screen.getByTestId('pathname').textContent).toBe('/portfolio')
    expect(screen.getByTestId('search').textContent).toBe('?tab=dividends')
  })

  // The palette is the keyboard route into the assistant: it must not reach into the
  // drawer directly (Layout owns the mount), only ask through the open-event bus.
  it('runs the Ask assistant action through the open-event bus', () => {
    const spy = vi.fn()
    window.addEventListener('assistant:open', spy)
    renderPalette()
    openPalette()
    fireEvent.change(combo(), { target: { value: 'assistant' } })
    expect(screen.getAllByRole('option')[0].textContent).toContain('Ask assistant')
    fireEvent.keyDown(combo(), { key: 'Enter' })
    expect(spy).toHaveBeenCalledTimes(1)
    // execute()'s contract: the overlay is gone before the drawer takes focus.
    expect(document.querySelector('.palette-overlay')).toBeNull()
    window.removeEventListener('assistant:open', spy)
  })

  it('floats recently-used entries to the top of the unfiltered list, via localStorage', () => {
    renderPalette()
    openPalette()
    fireEvent.change(combo(), { target: { value: 'calen' } })
    fireEvent.keyDown(combo(), { key: 'Enter' }) // → /calendar, recorded
    expect(JSON.parse(localStorage.getItem('commandPalette.recent') ?? '[]')).toEqual([
      'nav:/calendar',
    ])
    openPalette()
    expect(screen.getAllByRole('option')[0].textContent).toContain('Calendar')
  })
})
