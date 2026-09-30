import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MOTION_MS } from '../../theme/motion'
import RewardCondition from './RewardCondition'

beforeEach(() => vi.useFakeTimers())
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })
const condition = <RewardCondition text="Book through the travel portal. Bonus capped at $500/mo." card="Travel card" category="Hotels" />

it('opens outside the table, supports Escape and restores focus while its exit finishes', () => {
  const { container } = render(<table><tbody><tr><td>{condition}</td></tr></tbody></table>)
  const trigger = screen.getByRole('button', { name: 'Reward condition for Travel card — Hotels' })
  fireEvent.click(trigger)
  const bubble = screen.getByRole('dialog')
  expect(container.contains(bubble)).toBe(false)
  expect(bubble.textContent).toContain('Bonus capped at $500/mo.')
  expect(document.activeElement).toBe(bubble)
  fireEvent.keyDown(bubble, { key: 'Escape' })
  expect(document.activeElement).toBe(trigger)
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(bubble.isConnected).toBe(true)
  act(() => vi.advanceTimersByTime(MOTION_MS.xfade))
  expect(bubble.isConnected).toBe(false)
})

it('ignores inside clicks, dismisses outside, and survives a rapid reopen during its exit', () => {
  render(condition)
  const trigger = screen.getByRole('button', { name: /Reward condition for/ })
  fireEvent.click(trigger)
  fireEvent.pointerDown(screen.getByRole('dialog'))
  expect(screen.getByRole('dialog')).toBeTruthy()
  fireEvent.pointerDown(document.body)
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.click(trigger)
  act(() => vi.advanceTimersByTime(MOTION_MS.xfade + 1))
  expect(screen.getByRole('dialog')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss reward condition' }))
  expect(document.activeElement).toBe(trigger)
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
})

it('removes immediately for reduced motion and cleans up when its card leaves the filter', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  const view = render(condition)
  const trigger = screen.getByRole('button', { name: /Reward condition for/ })
  fireEvent.click(trigger)
  const bubble = screen.getByRole('dialog')
  fireEvent.click(trigger)
  expect(bubble.isConnected).toBe(false)
  fireEvent.click(trigger)
  view.unmount()
  expect(screen.queryByRole('dialog')).toBeNull()
  act(() => vi.runOnlyPendingTimers())
  expect(screen.queryByRole('dialog')).toBeNull()
})
