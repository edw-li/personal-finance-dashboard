import { readFileSync } from 'node:fs'
import path from 'node:path'
import { StrictMode } from 'react'
import { act, cleanup, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ThemeProvider, { DENSITY_KEY, LIGHT_QUERY, THEME_KEY, useTheme } from './ThemeProvider'

// The store PATCHes on every change and GETs once per session; no test here wants a network.
vi.mock('../../api/prefs', () => ({ fetchPrefs: vi.fn(), patchPrefs: vi.fn(), deletePref: vi.fn() }))

function Probe() {
  const { theme, resolved, density, version, setTheme, setDensity } = useTheme()
  return (
    <div>
      <span data-testid="state">{`${theme}|${resolved}|${density}|${version}`}</span>
      <button onClick={() => setTheme('light')}>light</button>
      <button onClick={() => setTheme('system')}>system</button>
      <button onClick={() => setTheme('dark')}>dark</button>
      <button onClick={() => setDensity('compact')}>compact</button>
    </div>
  )
}

type Listener = (e: { matches: boolean }) => void
let prefersLight = false
let listeners: Listener[] = []

beforeEach(() => {
  localStorage.clear()
  prefersLight = false
  listeners = []
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-density')
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('light') ? prefersLight : !prefersLight,
      media: query,
      addEventListener: (_: string, cb: Listener) => listeners.push(cb),
      removeEventListener: (_: string, cb: Listener) => {
        listeners = listeners.filter((l) => l !== cb)
      },
    })),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const state = () => screen.getByTestId('state').textContent

describe('ThemeProvider', () => {
  it('defaults to dark, comfortable, and stamps the html element', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>)
    expect(state()).toBe('dark|dark|comfortable|0')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.dataset.density).toBe('comfortable')
  })

  it('setTheme(light) resolves light, bumps the version and persists', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>)
    act(() => screen.getByText('light').click())
    expect(state()).toBe('light|light|comfortable|1')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(localStorage.getItem('finance.theme')).toBe('light')
  })

  it('bumps the version exactly once under StrictMode (updater double-invocation guard)', () => {
    render(<StrictMode><ThemeProvider><Probe /></ThemeProvider></StrictMode>)
    act(() => screen.getByText('light').click())
    expect(state()).toBe('light|light|comfortable|1')
  })

  it('reads a stored choice on mount', () => {
    localStorage.setItem('finance.theme', 'light')
    localStorage.setItem('finance.density', 'compact')
    render(<ThemeProvider><Probe /></ThemeProvider>)
    expect(state()).toBe('light|light|compact|0')
    expect(document.documentElement.dataset.density).toBe('compact')
  })

  it('system follows the OS live and only bumps the version when the resolved theme changes', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>)
    act(() => screen.getByText('system').click())
    expect(state()).toBe('system|dark|comfortable|0') // OS is dark: nothing resolved changed
    prefersLight = true
    act(() => listeners.forEach((l) => l({ matches: true })))
    expect(state()).toBe('system|light|comfortable|1')
    act(() => screen.getByText('dark').click())
    expect(state()).toBe('dark|dark|comfortable|2')
  })

  it('switching to system while the OS prefers light resolves light straight away', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>)
    prefersLight = true
    act(() => screen.getByText('system').click())
    expect(state()).toBe('system|light|comfortable|1')
  })

  it('drops the OS listener when the choice leaves system', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>)
    act(() => screen.getByText('system').click())
    expect(listeners).toHaveLength(1)
    act(() => screen.getByText('dark').click())
    expect(listeners).toHaveLength(0)
  })

  it('density persists and does not touch the chart version', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>)
    act(() => screen.getByText('compact').click())
    expect(state()).toBe('dark|dark|compact|0')
    expect(localStorage.getItem('finance.density')).toBe('compact')
  })

  it('ignores garbage in storage', () => {
    localStorage.setItem('finance.theme', 'neon')
    localStorage.setItem('finance.density', 'huge')
    render(<ThemeProvider><Probe /></ThemeProvider>)
    expect(state()).toBe('dark|dark|comfortable|0')
  })

  it('falls back to one stable object outside a provider', () => {
    render(<Probe />)
    expect(state()).toBe('dark|dark|comfortable|0')

    // Identity matters: a consumer keying an effect on the object or on `setTheme` would
    // re-run every render if the hook allocated a fresh fallback.
    const { result, rerender } = renderHook(() => useTheme())
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
    expect(result.current.setTheme).toBe(first.setTheme)
  })

  it('index.html anti-flash script uses the same keys, query and attributes (no drift)', () => {
    const html = readFileSync(path.resolve(__dirname, '../../../index.html'), 'utf8')
    expect(html).toContain(`'${THEME_KEY}'`)
    expect(html).toContain(`'${DENSITY_KEY}'`)
    expect(html).toContain(LIGHT_QUERY)
    expect(html).toContain('dataset.theme')
    expect(html).toContain('dataset.density')
  })

  // A server value that lands after first paint (2026-09-03 data-lifecycle spec §10) moves the
  // live state, not only storage — the shell re-renders for the signed-in state anyway.
  it('adopts a theme and density synced from the server', async () => {
    const { fetchPrefs } = await import('../../api/prefs')
    const { resetPrefsStoreForTests, syncFromServer } = await import('../../prefs/prefsStore')
    resetPrefsStoreForTests()
    vi.mocked(fetchPrefs).mockResolvedValue({
      prefs: {
        theme: { value: 'light', updated_at: '2026-09-04T09:00:00+00:00' },
        density: { value: 'compact', updated_at: '2026-09-04T09:00:00+00:00' },
      },
    })
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )
    expect(document.documentElement.dataset.theme).toBe('dark')
    await act(async () => {
      await syncFromServer()
    })
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.dataset.density).toBe('compact')
    expect(state()).toBe('light|light|compact|1')
    expect(localStorage.getItem('finance.theme')).toBe('light')
  })
})
