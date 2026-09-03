import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import DeltaChip, { formatDelta, inverted } from './DeltaChip'

afterEach(cleanup)

describe('DeltaChip', () => {
  it('formats money, points and plain deltas with an explicit sign', () => {
    expect(formatDelta('50.00', 'money')).toBe('+$50.00')
    expect(formatDelta('-4321.00', 'money')).toBe('-$4,321.00')
    expect(formatDelta('0.00', 'money')).toBe('$0.00')
    expect(formatDelta('2', 'points')).toBe('+2.0 pp')
    expect(formatDelta('-0.05', 'points')).toBe('-0.05 pp')
    expect(formatDelta('3', 'plain')).toBe('+3')
    expect(formatDelta('-3', 'plain')).toBe('-3')
  })

  it('tones follow the sign; invert flips them for cost lines; null is an em dash', () => {
    const { container, rerender } = render(<DeltaChip value="4321.00" kind="money" />)
    expect(container.firstElementChild?.className).toBe('delta-chip delta-chip-positive')
    rerender(<DeltaChip value="4321.00" kind="money" invert />)
    expect(container.firstElementChild?.className).toBe('delta-chip delta-chip-negative')
    rerender(<DeltaChip value="0" kind="money" invert />)
    expect(container.firstElementChild?.className).toBe('delta-chip delta-chip-neutral')
    rerender(<DeltaChip value={null} kind="money" />)
    expect(container.textContent).toBe('—')
    expect(inverted('positive')).toBe('negative')
    expect(inverted('neutral')).toBe('neutral')
  })
})
