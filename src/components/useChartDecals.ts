// Appearance › Chart patterns (chart spec §14): opt-in 45°/135° textures on stacks and pies
// through echarts' aria decal. Browser-local like theme/density (the Data-lifecycle spec's
// server prefs later). An external store, not a context: EChart lives in the lazy chart chunk
// and must read this without a provider wrapped around the app.
import { useSyncExternalStore } from 'react'

export const DECALS_KEY = 'finance.chartDecals'
const CHANGE_EVENT = 'finance:decals'

export function readChartDecals(): boolean {
  try {
    return localStorage.getItem(DECALS_KEY) === 'on'
  } catch {
    return false
  }
}

export function setChartDecals(on: boolean): void {
  try {
    localStorage.setItem(DECALS_KEY, on ? 'on' : 'off')
  } catch {
    // A blocked localStorage costs persistence, never the switch itself.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange)
  // Another tab's Settings page flips it → `storage` fires here.
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}

export function useChartDecals(): boolean {
  return useSyncExternalStore(subscribe, readChartDecals, () => false)
}
