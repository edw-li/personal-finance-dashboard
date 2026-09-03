import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/prices', () => ({ refreshPrices: vi.fn() }))
// The four entity lists the palette loads on its first open — no shell test may reach fetch.
vi.mock('../api/portfolio', () => ({ fetchSecurities: vi.fn() }))
vi.mock('../api/netWorth', () => ({ fetchAccounts: vi.fn() }))
vi.mock('../api/spending', () => ({ fetchCategories: vi.fn() }))
vi.mock('../api/creditCards', () => ({ fetchCreditCards: vi.fn() }))

import { fetchCreditCards } from '../api/creditCards'
import { fetchAccounts } from '../api/netWorth'
import { fetchSecurities } from '../api/portfolio'
import { refreshPrices } from '../api/prices'
import { fetchCategories } from '../api/spending'
import type { SecurityOut } from '../types/api'
import CommandPalette from './CommandPalette'
import { requestPaletteOpen } from './paletteBus'
import ToastProvider from './ToastProvider'

function LocationProbe() {
  const { pathname, search, hash } = useLocation()
  return (
    <>
      <div data-testid="pathname">{pathname}</div>
      <div data-testid="search">{search}</div>
      <div data-testid="hash">{hash}</div>
    </>
  )
}

// ToastProvider, as in App.tsx: the finished actions report through toasts, and useToast()
// silently no-ops without a provider — a test rendered bare would prove nothing.
function renderPalette() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <ToastProvider>
        <CommandPalette />
        <LocationProbe />
        <button>outside button</button>
      </ToastProvider>
    </MemoryRouter>,
  )
}

const openPalette = () => fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
const combo = () => screen.getByRole('combobox')
const type = (value: string) => fireEvent.change(combo(), { target: { value } })
const group = (title: string) => screen.getByRole('group', { name: title })

const NVDA: SecurityOut = {
  id: 1,
  ticker: 'NVDA',
  name: 'NVIDIA',
  industry: 'Semiconductors',
  holding_type: 'stock',
  is_manual_priced: false,
  is_active: true,
  annual_dividend: null,
  ex_div_date: null,
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  vi.mocked(refreshPrices).mockResolvedValue({
    updated: [],
    failed: {},
    skipped_manual: [],
    duration_ms: 0,
    dividends_ingested: 0,
  })
  vi.mocked(fetchSecurities).mockResolvedValue([])
  vi.mocked(fetchAccounts).mockResolvedValue([])
  vi.mocked(fetchCategories).mockResolvedValue([])
  vi.mocked(fetchCreditCards).mockResolvedValue([])
})

afterEach(async () => {
  // Let the entity fetches settle before unmount, so their setState lands inside act().
  await act(async () => {})
  cleanup()
})

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
    type('spen')
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

  it('"Refresh prices" launches the POST, toasts both ends of the run, and lands on /portfolio', async () => {
    vi.mocked(refreshPrices).mockResolvedValue({
      updated: ['NVDA'],
      failed: { ZI: 'delisted' },
      skipped_manual: [],
      duration_ms: 1200,
      dividends_ingested: 0,
    })
    renderPalette()
    openPalette()
    type('refresh')
    fireEvent.keyDown(combo(), { key: 'Enter' })
    expect(refreshPrices).toHaveBeenCalledTimes(1)
    // The action no longer ends in silence: lift-off is announced immediately…
    expect(screen.getByText('Refreshing prices…')).toBeTruthy()
    expect(screen.getByTestId('pathname').textContent).toBe('/portfolio')
    // …and the run's own outcome lands whenever the POST finishes.
    expect(await screen.findByText('Prices refreshed — 1 updated, 1 failed')).toBeTruthy()
  })

  it('"Add dividend" lands on the dividends tab via the arrival-only ?tab= link', () => {
    renderPalette()
    openPalette()
    type('add div')
    fireEvent.keyDown(combo(), { key: 'Enter' })
    expect(screen.getByTestId('pathname').textContent).toBe('/portfolio')
    expect(screen.getByTestId('search').textContent).toBe('?tab=dividends')
  })

  it('"Add custom event" asks the calendar to open its add form', () => {
    renderPalette()
    openPalette()
    type('add custom')
    fireEvent.keyDown(combo(), { key: 'Enter' })
    expect(screen.getByTestId('pathname').textContent).toBe('/calendar')
    expect(screen.getByTestId('search').textContent).toBe('?add=1')
  })

  // The palette is the keyboard route into the assistant: it must not reach into the
  // drawer directly (Layout owns the mount), only ask through the open-event bus.
  it('runs the Ask assistant action through the open-event bus', () => {
    const spy = vi.fn()
    window.addEventListener('assistant:open', spy)
    renderPalette()
    openPalette()
    type('ask assist')
    expect(screen.getAllByRole('option')[0].textContent).toContain('Ask assistant')
    fireEvent.keyDown(combo(), { key: 'Enter' })
    expect(spy).toHaveBeenCalledTimes(1)
    // execute()'s contract: the overlay is gone before the drawer takes focus.
    expect(document.querySelector('.palette-overlay')).toBeNull()
    window.removeEventListener('assistant:open', spy)
  })

  it('reaches Comp through the "rsu" alias and Settings sections through anchors', () => {
    renderPalette()
    openPalette()
    type('rsu')
    // Kind headers come in the house order (spec §9), so a page hit heads the Pages group
    // rather than the whole list; the alias is what makes Comp reachable at all.
    expect(within(group('Pages')).getAllByRole('option')[0].textContent).toContain('Comp')
    type('password')
    fireEvent.keyDown(combo(), { key: 'Enter' })
    expect(screen.getByTestId('pathname').textContent).toBe('/settings')
    expect(screen.getByTestId('hash').textContent).toBe('#password')
  })

  it('lists holdings once they load and opens the drill deep link', async () => {
    vi.mocked(fetchSecurities).mockResolvedValue([NVDA])
    renderPalette()
    openPalette()
    // The group's own landmark, not its title text: the option's kind badge says
    // 'Holdings' too, and findByText would find both.
    await screen.findByRole('group', { name: 'Holdings' })
    type('nvda')
    // Picked by name, not by position: Settings sorts above Holdings, and the Assistant
    // card's "nvidia" alias also answers this query.
    fireEvent.mouseDown(screen.getByRole('option', { name: /NVDA/ }))
    expect(screen.getByTestId('pathname').textContent).toBe('/portfolio')
    expect(screen.getByTestId('search').textContent).toBe('?ticker=NVDA')
  })

  it('opens from the sidebar bus', () => {
    renderPalette()
    act(() => requestPaletteOpen())
    expect(screen.getByRole('combobox')).toBeTruthy()
  })

  it('floats recently-used entries to the top of their group, via localStorage', () => {
    renderPalette()
    openPalette()
    type('calen')
    // "Add custom event" (alias: calendar) is an Action, so it sorts above the page.
    fireEvent.mouseDown(within(group('Pages')).getAllByRole('option')[0])
    expect(screen.getByTestId('pathname').textContent).toBe('/calendar')
    expect(JSON.parse(localStorage.getItem('commandPalette.recent') ?? '[]')).toEqual([
      'nav:/calendar',
    ])
    openPalette()
    // Empty query: recents float to the front of the full list, and the grouping then cuts
    // each kind to six — so Calendar heads Pages instead of Overview.
    expect(within(group('Pages')).getAllByRole('option')[0].textContent).toContain('Calendar')
  })
})
