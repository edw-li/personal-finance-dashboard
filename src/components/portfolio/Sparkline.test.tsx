import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import Sparkline from './Sparkline'

afterEach(cleanup)

const pt = (d: string, c: string) => ({ d, c })

describe('Sparkline', () => {
  it('renders an em-dash placeholder with fewer than 2 points', () => {
    const { container } = render(<Sparkline points={[pt('2026-01-01', '10')]} />)
    expect(container.textContent).toBe('—')
    expect(container.querySelector('svg')).toBeNull()
  })

  // The stroke is the THEME VARIABLE, never a baked hex — that is what lets the line
  // follow a light/dark switch (2026-09-03 shell spec §11).
  it('draws a rising line in the positive color', () => {
    const { container } = render(
      <Sparkline points={[pt('2026-01-01', '10'), pt('2026-06-01', '15')]} />,
    )
    const line = container.querySelector('polyline')
    expect(line).not.toBeNull()
    expect(line!.getAttribute('stroke')).toBe('var(--positive)')
    // Geometry pin (default 110x30): the low sits at y=28, the high at y=2.
    expect(line!.getAttribute('points')).toBe('0.0,28.0 110.0,2.0')
  })

  it('draws a falling line in the negative color and survives a flat series', () => {
    const { container } = render(
      <Sparkline points={[pt('2026-01-01', '15'), pt('2026-06-01', '10')]} />,
    )
    expect(container.querySelector('polyline')!.getAttribute('stroke')).toBe('var(--negative)')
    const flat = render(
      <Sparkline points={[pt('2026-01-01', '10'), pt('2026-06-01', '10')]} />,
    )
    const flatLine = flat.container.querySelector('polyline')
    expect(flatLine).not.toBeNull() // no NaN coords
    // A flat series pins to MID-height — the bottom edge would read "at its 52-week low".
    expect(flatLine!.getAttribute('points')).toBe('0.0,15.0 110.0,15.0')
  })
})
