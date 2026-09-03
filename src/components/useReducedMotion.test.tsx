import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { prefersReducedMotion, useReducedMotion } from './useReducedMotion'

function fakeMedia(initial: boolean) {
  let listeners: (() => void)[] = []
  const query = {
    matches: initial,
    addEventListener: (_: string, cb: () => void) => { listeners.push(cb) },
    removeEventListener: (_: string, cb: () => void) => { listeners = listeners.filter((l) => l !== cb) },
  }
  return {
    query,
    set(next: boolean) { query.matches = next; listeners.forEach((l) => l()) },
    count: () => listeners.length,
  }
}

function Probe() {
  const reduced = useReducedMotion()
  return <span data-testid="probe">{String(reduced)}</span>
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('useReducedMotion', () => {
  it('reads the media query and follows a LIVE change', () => {
    const media = fakeMedia(false)
    vi.stubGlobal('matchMedia', () => media.query)
    render(<Probe />)
    expect(screen.getByTestId('probe').textContent).toBe('false')
    act(() => media.set(true))
    expect(screen.getByTestId('probe').textContent).toBe('true')
    expect(media.count()).toBe(1)
  })
  it('unsubscribes on unmount and tolerates a matchMedia stub without addEventListener', () => {
    const media = fakeMedia(true)
    vi.stubGlobal('matchMedia', () => media.query)
    const { unmount } = render(<Probe />)
    unmount()
    expect(media.count()).toBe(0)
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    render(<Probe />)
    expect(screen.getByTestId('probe').textContent).toBe('true')
    expect(prefersReducedMotion()).toBe(true)
  })
  it('is false where matchMedia does not exist', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(prefersReducedMotion()).toBe(false)
  })
})
