import { useSyncExternalStore } from 'react'

// ONE "today" for the whole app (2026-09-23 spec §K1, §0.4(a)). The server keeps the product
// clock (Pacific time, backend/app/services/clock.py) and names its day on every /api response in
// `X-Product-Today`; api/client.ts hands each one to setServerToday(). Every rule that asks "has
// the 1st arrived / has the month ended / which year is it" reads the day through utils/months.ts
// — todayIso(), currentMonthIso(), currentYear() — which answer the SERVER's day once any response
// has carried it, and the browser's own day only before that (the login page). Around midnight,
// and anywhere off Pacific time, the two clocks disagree; this store is why the app does not.
//
// Deliberate exceptions — browser-clock reads that are not a product rule and stay so (the fence
// in clockFence.test.ts lists them):
//   - quote staleness, utils/staleness.ts: UTC by design, like the backend's health check;
//   - instants: components/details/explainSelection.ts (capturedAt) and sandbox/pins.ts
//     (createdAt) — when something happened, not which day it is.

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

let serverToday: string | null = null
const listeners = new Set<() => void>()

/** The browser's own calendar day, 'YYYY-MM-DD' from LOCAL getters — the fallback until the
 *  server has named its day, and the one sanctioned browser-clock read for a product rule. */
export function browserTodayIso(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`
}

/** The day the server last named, or null before any response has carried one. */
export function getServerToday(): string | null {
  return serverToday
}

/** Record the server's day (api/client.ts, from `X-Product-Today`). Anything that is not a
 *  'YYYY-MM-DD' — a missing header, an old test stub — is ignored, and an unchanged day notifies
 *  nobody, so the per-response call costs no re-render. */
export function setServerToday(day: string | null | undefined): void {
  if (typeof day !== 'string') return
  const trimmed = day.trim()
  if (!ISO_DAY.test(trimmed) || trimmed === serverToday) return
  serverToday = trimmed
  listeners.forEach((listener) => listener())
}

export function subscribeProductToday(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The product day, 'YYYY-MM-DD': the server's once known, else the browser's. */
export function productTodayIso(): string {
  return serverToday ?? browserTodayIso()
}

/** The product day for a component that must re-render when it changes — a tab left open across
 *  midnight moves with the next response. */
export function useProductToday(): string {
  return useSyncExternalStore(subscribeProductToday, productTodayIso)
}

/** Tests only: forget the server's day (src/testing/setup.ts calls it after every test). */
export function resetServerTodayForTests(): void {
  serverToday = null
}
