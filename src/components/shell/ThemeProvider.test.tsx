import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ThemeProvider, { useTheme } from './ThemeProvider'

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
})
