import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useLatest } from './useLatest'

afterEach(cleanup)

interface Readers {
  captured: () => string
  latest: () => string
}

/** A click hands out two readers made in the render it was clicked in — the way a save's answer
 *  handler is made at drop time: one closes over the prop, one reads it through `useLatest`. */
function Probe({ value, onCapture }: { value: string; onCapture: (readers: Readers) => void }) {
  const latestRef = useLatest(value)
  return (
    <button
      type="button"
      onClick={() => onCapture({ captured: () => value, latest: () => latestRef.current })}
    >
      capture
    </button>
  )
}

describe('useLatest', () => {
  it('a callback made in an earlier render reads the value of the latest one', () => {
    const made: Readers[] = []
    const capture = (readers: Readers) => {
      made.push(readers)
    }
    const { rerender } = render(<Probe value="A" onCapture={capture} />)
    fireEvent.click(screen.getByRole('button', { name: 'capture' }))
    expect(made).toHaveLength(1)
    const [{ captured, latest }] = made
    expect(latest()).toBe('A')
    rerender(<Probe value="B" onCapture={capture} />)
    // The closure still sees the render it was made in; the ref sees the render that came after.
    expect(captured()).toBe('A')
    expect(latest()).toBe('B')
  })
})
