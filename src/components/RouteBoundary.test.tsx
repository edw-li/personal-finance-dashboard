import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import RouteBoundary from './RouteBoundary'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// The production trigger is a rejected dynamic import() that React.lazy rethrows during
// render; any render-time throw reaches the boundary by the same path.
function Bomb(): never {
  throw new Error('Failed to fetch dynamically imported module')
}

// React logs EVERY boundary-caught error through console.error. That log is expected here,
// so it is silenced per-test (not globally) — an unexpected error in another file still shows.
function silenceReactErrorLog() {
  return vi.spyOn(console, 'error').mockImplementation(() => {})
}

// no jest-dom matchers in this project — getBy* throws when absent, so it carries the
// presence assertion; absence is asserted with queryBy* + toBeNull.
it('passes children through untouched when nothing throws', () => {
  render(
    <RouteBoundary>
      <p>page content</p>
    </RouteBoundary>
  )
  expect(screen.getByText('page content').tagName).toBe('P')
  expect(screen.queryByRole('alert')).toBeNull()
})

it('swaps in an alert with a Reload affordance when a child throws', () => {
  const errorLog = silenceReactErrorLog()
  render(
    <RouteBoundary>
      <Bomb />
      <p>page content</p>
    </RouteBoundary>
  )
  // role=alert, not a silent <div>: the swap happens after paint, so it must be announced.
  expect(screen.getByRole('alert').textContent).toContain('This page failed to load')
  screen.getByRole('button', { name: 'Reload' })
  expect(screen.queryByText('page content')).toBeNull()
  expect(errorLog).toHaveBeenCalled()
})

// Layout passes key={pathname}; this pins the half of that contract the component owns —
// a failed boundary must not survive its own remount. (React.lazy's memoized rejection is
// what makes the key necessary at all: only a DIFFERENT payload can actually be retried.)
it('clears the failed state when remounted under a new key', () => {
  silenceReactErrorLog()
  const { rerender } = render(
    <RouteBoundary key="/spending">
      <Bomb />
    </RouteBoundary>
  )
  screen.getByRole('alert')
  rerender(
    <RouteBoundary key="/taxes">
      <p>page content</p>
    </RouteBoundary>
  )
  expect(screen.getByText('page content').tagName).toBe('P')
  expect(screen.queryByRole('alert')).toBeNull()
})

it('reloads the document on Reload — the only recovery from stale hashed filenames', () => {
  silenceReactErrorLog()
  const reload = vi.fn()
  // Same idiom client.test.ts uses for fetch: stubGlobal + unstubAllGlobals. The component
  // calls bare `location.reload()`, so this stub IS the object it resolves — no `window.`
  // prefix to route around it. That works because the global `location` binding is
  // configurable, unlike jsdom's own unforgeable window.location: vi.spyOn(window.location,
  // 'reload') throws "Cannot redefine property: reload".
  vi.stubGlobal('location', { ...window.location, reload })
  render(
    <RouteBoundary>
      <Bomb />
    </RouteBoundary>
  )
  fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
  expect(reload).toHaveBeenCalledTimes(1)
})
