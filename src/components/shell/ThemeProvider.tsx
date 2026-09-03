import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'

// The shell's appearance state (2026-09-03 shell spec §11). Browser-local by decision:
// localStorage now, the Data-lifecycle spec's server prefs later. `version` is the chart
// bridge's signal — EChart re-initializes with a versioned theme whenever the RESOLVED
// palette changes, and only then (density and a same-palette choice do not redraw charts).
// How it is used: mount <ThemeProvider> once around the app, then `useTheme()` anywhere for
// the current values plus `setTheme(system|dark|light)` and `setDensity(comfortable|compact)`.
export type ThemeChoice = 'system' | 'dark' | 'light'
export type ResolvedTheme = 'dark' | 'light'
export type Density = 'comfortable' | 'compact'

// index.html's inline script repeats these literally; ThemeProvider.test pins them.
export const THEME_KEY = 'finance.theme'
export const DENSITY_KEY = 'finance.density'
export const LIGHT_QUERY = '(prefers-color-scheme: light)'

export interface ThemeState {
  theme: ThemeChoice
  resolved: ResolvedTheme
  density: Density
  version: number
  setTheme: (next: ThemeChoice) => void
  setDensity: (next: Density) => void
}

// One instance (ToastProvider's NOOP precedent): bare-rendered consumers that key effects on
// `setTheme` or on the object itself must not re-run every render.
const BARE: ThemeState = {
  theme: 'dark',
  resolved: 'dark',
  density: 'comfortable',
  version: 0,
  setTheme: () => {},
  setDensity: () => {},
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
  // Resolves the choice already read above — one storage read, not two.
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(theme))
  const [version, setVersion] = useState(0)

  // Stamp the document. Effects, not render: the DOM outside React's tree is a side effect.
  useEffect(() => {
    document.documentElement.dataset.theme = resolved
  }, [resolved])
  useEffect(() => {
    document.documentElement.dataset.density = density
  }, [density])

  // The comparison happens OUTSIDE the updater on purpose. Nesting setVersion inside a
  // setResolved updater double-bumps the version under StrictMode (updaters are invoked
  // twice in dev, and main.tsx mounts the app in StrictMode), so the current palette is
  // tracked in a ref that only this function writes — one guard, two plain setState calls.
  const resolvedRef = useRef(resolved)
  const applyResolved = useCallback((next: ResolvedTheme) => {
    if (resolvedRef.current === next) return
    resolvedRef.current = next
    setResolved(next)
    setVersion((v) => v + 1)
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

/** Safe outside a provider (tests render pages bare): dark, comfortable, version 0 — and
 *  always the same BARE object, so identity-keyed effects stay put. */
export function useTheme(): ThemeState {
  return useContext(ThemeContext) ?? BARE
}
