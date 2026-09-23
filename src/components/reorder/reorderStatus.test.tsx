import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DragHandle from './DragHandle'
import { ReorderInstructions, ReorderLiveRegion } from './ReorderStatus'
import type { ReorderHandleProps } from './reorderTypes'

// vitest runs without globals here, so RTL never registers its own afterEach cleanup.
afterEach(cleanup)

function handle(overrides: Partial<ReorderHandleProps> = {}): ReorderHandleProps {
  return {
    ref: () => {},
    disabled: false,
    'aria-disabled': undefined,
    'aria-describedby': 'how',
    'aria-pressed': undefined,
    onPointerDown: vi.fn(),
    onPointerMove: vi.fn(),
    onPointerUp: vi.fn(),
    onPointerCancel: vi.fn(),
    onLostPointerCapture: vi.fn(),
    onKeyDown: vi.fn(),
    onBlur: vi.fn(),
    ...overrides,
  }
}

describe('ReorderInstructions / ReorderLiveRegion', () => {
  it('are visually hidden and speak the spec §8.2 copy', () => {
    render(
      <>
        <ReorderInstructions id="how" />
        <ReorderLiveRegion text="Dropped Housing at position 3 of 19." />
      </>,
    )
    const instructions = document.getElementById('how')
    expect(instructions?.textContent).toBe(
      'Press Space or Enter to pick up. Use the arrow keys to move, Home or End to jump, Space or Enter to drop, Escape to cancel.',
    )
    expect(instructions?.className).toBe('visually-hidden')
    const region = document.querySelector('[aria-live="assertive"]')
    expect(region?.getAttribute('aria-atomic')).toBe('true')
    expect(region?.className).toBe('visually-hidden')
    expect(region?.textContent).toBe('Dropped Housing at position 3 of 19.')
  })
})

describe('DragHandle', () => {
  it('is a real button named for its row and described by the instructions', () => {
    render(<DragHandle name="Housing" {...handle()} />)
    const grip = screen.getByRole('button', { name: 'Reorder Housing' })
    expect(grip.getAttribute('type')).toBe('button')
    expect(grip.className).toBe('reorder-grip')
    expect(grip.getAttribute('aria-describedby')).toBe('how')
    expect(grip.getAttribute('aria-pressed')).toBeNull()
    expect(grip.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('says when it is lifted, busy, or has nowhere to go', () => {
    const { rerender } = render(<DragHandle name="Housing" {...handle({ 'aria-pressed': true })} />)
    expect(screen.getByRole('button', { name: 'Reorder Housing' }).getAttribute('aria-pressed')).toBe('true')
    rerender(<DragHandle name="Housing" {...handle({ 'aria-disabled': true })} />)
    expect(screen.getByRole('button', { name: 'Reorder Housing' }).getAttribute('aria-disabled')).toBe('true')
    rerender(<DragHandle name="Housing" {...handle({ disabled: true })} />)
    expect((screen.getByRole('button', { name: 'Reorder Housing' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
