import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ThemeProvider from '../shell/ThemeProvider'
import AppearanceCard from './AppearanceCard'

// The store PATCHes every change and GETs once per session; no test here wants a network.
vi.mock('../../api/prefs', () => ({ fetchPrefs: vi.fn(), patchPrefs: vi.fn(), deletePref: vi.fn() }))

beforeEach(() => localStorage.clear())
afterEach(cleanup)

describe('AppearanceCard', () => {
  it('shows the current choices and writes them through the provider', () => {
    render(
      <ThemeProvider>
        <AppearanceCard />
      </ThemeProvider>,
    )
    expect(screen.getByRole('region', { name: 'Appearance' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Dark' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Light' }))
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(localStorage.getItem('finance.theme')).toBe('light')
    fireEvent.click(screen.getByRole('button', { name: 'Compact' }))
    expect(document.documentElement.dataset.density).toBe('compact')
    expect(localStorage.getItem('finance.density')).toBe('compact')
    // The card must READ BACK from the provider, not just write to it: a hard-coded
    // `value` would still flip the html attributes above while leaving the pressed state
    // stuck on the defaults.
    expect(screen.getByRole('button', { name: 'Light' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Dark' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: 'Compact' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
    fireEvent.click(screen.getByRole('button', { name: 'On' }))
    expect(localStorage.getItem('finance.chartDecals')).toBe('on')
    expect(screen.getByRole('button', { name: 'On' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Off' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('carries the anchor id the palette jumps to', () => {
    render(
      <ThemeProvider>
        <AppearanceCard />
      </ThemeProvider>,
    )
    expect(document.getElementById('appearance')).toBeTruthy()
  })
  it('offers the landing page over the nav and remembers it through the store', () => {
    render(
      <ThemeProvider>
        <AppearanceCard />
      </ThemeProvider>,
    )
    const select = screen.getByLabelText('Landing page') as HTMLSelectElement
    expect(select.value).toBe('/')
    expect([...select.options].map((o) => o.textContent)).toContain('Net worth')
    fireEvent.change(select, { target: { value: '/net-worth' } })
    expect(localStorage.getItem('finance.landingPage')).toBe('/net-worth')
    expect(
      screen.getByText('Remembered in this browser; synced to your account once signed in.'),
    ).toBeTruthy()
  })

  it('says so once the server has answered', async () => {
    const { fetchPrefs } = await import('../../api/prefs')
    const { resetPrefsStoreForTests, syncFromServer } = await import('../../prefs/prefsStore')
    resetPrefsStoreForTests()
    vi.mocked(fetchPrefs).mockResolvedValue({ prefs: {} })
    render(
      <ThemeProvider>
        <AppearanceCard />
      </ThemeProvider>,
    )
    await syncFromServer()
    await waitFor(() => expect(screen.getByText('Synced to your account.')).toBeTruthy())
  })
})
