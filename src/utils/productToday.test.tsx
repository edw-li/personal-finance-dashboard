import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getServerToday,
  productTodayIso,
  resetServerTodayForTests,
  setServerToday,
  useProductToday,
} from './productToday'

afterEach(() => {
  cleanup()
  resetServerTodayForTests()
  vi.useRealTimers()
})

describe('the server-day store (2026-09-23 spec §K1)', () => {
  it('keeps a YYYY-MM-DD and ignores anything else', () => {
    expect(getServerToday()).toBeNull()
    for (const junk of [null, undefined, '', 'Oct 1', '2026-10-1', '2026-10-01T00:00:00Z']) setServerToday(junk)
    expect(getServerToday()).toBeNull()
    setServerToday(' 2026-10-01 ')
    expect(getServerToday()).toBe('2026-10-01')
  })

  it('answers the browser day until the server names its own', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 30, 23, 30)) // local Sep 30, 23:30
    expect(productTodayIso()).toBe('2026-09-30')
    setServerToday('2026-10-01')
    expect(productTodayIso()).toBe('2026-10-01')
  })

  it('useProductToday re-renders on a new day, and not for the same one', () => {
    setServerToday('2026-09-30')
    let renders = 0
    function Day() {
      renders += 1
      return <p>{useProductToday()}</p>
    }
    render(<Day />)
    expect(screen.getByText('2026-09-30')).toBeTruthy()
    const settled = renders
    act(() => setServerToday('2026-09-30'))
    expect(renders).toBe(settled)
    act(() => setServerToday('2026-10-01'))
    expect(screen.getByText('2026-10-01')).toBeTruthy()
  })
})
