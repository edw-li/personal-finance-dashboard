// THE reduced-motion read (chart spec §11). One media query, subscribed to its `change` event
// through useSyncExternalStore, so a live OS toggle re-applies `animation: false` in EChart
// without a reload. `prefersReducedMotion()` is the synchronous read for initializers
// (StatTile decides its zero-frame during the first render). Guards: no matchMedia (SSR,
// old jsdom) reads as "motion allowed"; a matchMedia stub without addEventListener (the
// tests' `() => ({ matches })`) subscribes to nothing rather than throwing.
import { useSyncExternalStore } from 'react'

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function query(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(REDUCED_MOTION_QUERY)
    : null
}

export function prefersReducedMotion(): boolean {
  return query()?.matches === true
}

function subscribe(onChange: () => void): () => void {
  const q = query()
  if (q === null || typeof q.addEventListener !== 'function') return () => {}
  q.addEventListener('change', onChange)
  return () => q.removeEventListener('change', onChange)
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, () => false)
}
