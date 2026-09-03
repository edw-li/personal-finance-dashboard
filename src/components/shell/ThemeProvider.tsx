import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

// LANE STAND-IN — Plan 1a owns this file (its Task 4) along with the Appearance card, the
// anti-flash script and the chart bridge; this copy exists only so Plan 1c's SidebarFooter
// has a `useTheme` to toggle. At merge, take 1a's version wholesale.
//
// The shell's appearance state (2026-09-03 shell spec §11). Browser-local by decision:
// localStorage now, the Data-lifecycle spec's server prefs later. `version` is the chart
// bridge's signal — EChart re-initializes with a versioned theme whenever the RESOLVED
// palette changes, and only then (density and a same-palette choice do not redraw charts).
export type ThemeChoice = 'system' | 'dark' | 'light'
export type ResolvedTheme = 'dark' | 'light'
export type Density = 'comfortable' | 'compact'

export const THEME_KEY = 'finance.theme'
export const DENSITY_KEY = 'finance.density'
const LIGHT_QUERY = '(prefers-color-scheme: light)'

interface ThemeState {
  theme: ThemeChoice
  resolved: ResolvedTheme
  density: Density
  version: number
  setTheme: (next: ThemeChoice) => void
  setDensity: (next: Density) => void
}

const ThemeContext = createContext<ThemeState | null>(null)

function readChoice(): ThemeChoice {
  try {
    const raw = localStorage.getItem(THEME_KEY)
    return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'dark'
  } catch {
    return 'dark'
  }
}

function readDensity(): Density {
  try {
    return localStorage.getItem(DENSITY_KEY) === 'compact' ? 'compact' : 'comfortable'
  } catch {
    return 'comfortable'
  }
}

function osPrefersLight(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(LIGHT_QUERY).matches
}

/** The palette a choice lands on right now — also what index.html's inline script mirrors. */
export function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  if (choice === 'system') return osPrefersLight() ? 'light' : 'dark'
  return choice
}

function persist(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // A blocked localStorage costs persistence, never the switch itself.
  }
}

export default function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeChoice>(readChoice)
  const [density, setDensityState] = useState<Density>(readDensity)
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(readChoice()))
  const [version, setVersion] = useState(0)

  // Stamp the document. Effects, not render: the DOM outside React's tree is a side effect.
  useEffect(() => {
    document.documentElement.dataset.theme = resolved
  }, [resolved])
  useEffect(() => {
    document.documentElement.dataset.density = density
  }, [density])

  const applyResolved = useCallback((next: ResolvedTheme) => {
    setResolved((current) => {
      if (current === next) return current
      setVersion((v) => v + 1)
      return next
    })
  }, [])

  // Follow the OS only while the choice is System; the listener is torn down otherwise.
  useEffect(() => {
    if (theme !== 'system' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(LIGHT_QUERY)
    const onChange = (event: { matches: boolean }) =>
      applyResolved(event.matches ? 'light' : 'dark')
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [theme, applyResolved])

  const setTheme = useCallback(
    (next: ThemeChoice) => {
      setThemeState(next)
      persist(THEME_KEY, next)
      applyResolved(resolveTheme(next))
    },
    [applyResolved],
  )

  const setDensity = useCallback((next: Density) => {
    setDensityState(next)
    persist(DENSITY_KEY, next)
  }, [])

  const value = useMemo<ThemeState>(
    () => ({ theme, resolved, density, version, setTheme, setDensity }),
    [theme, resolved, density, version, setTheme, setDensity],
  )
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

/** Safe outside a provider (tests render pages bare): dark, comfortable, version 0. */
export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext)
  return (
    ctx ?? {
      theme: 'dark',
      resolved: 'dark',
      density: 'comfortable',
      version: 0,
      setTheme: () => {},
      setDensity: () => {},
    }
  )
}
