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
    // Geometry pin (default 60x30 since 2026-09-23 §C9): the low sits at y=28, the high at y=2.
    expect(line!.getAttribute('points')).toBe('0.0,28.0 60.0,2.0')
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
    expect(flatLine!.getAttribute('points')).toBe('0.0,15.0 60.0,15.0')
    // 0 % is under the 1 % floor: no verdict at all.
    expect(flatLine!.getAttribute('stroke')).toBe('var(--muted)')
  })

  // 2026-09-23 spec §C9 (wealth PF-11, charts F26): the cell says what the line means.
  it('prints the 1-year change beside the line and names the cell for assistive tech', () => {
    const { container } = render(
      <Sparkline label="NVDA" points={[pt('2025-09-26', '100'), pt('2026-09-21', '128.4')]} />,
    )
    const cell = container.querySelector('.sparkline-cell')!
    expect(cell.getAttribute('role')).toBe('img')
    expect(cell.getAttribute('aria-label')).toBe('NVDA 1-year change +28.4%')
    // The drawing and the printed figure are the label's content, not two more readings.
    expect(container.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true')
    const change = container.querySelector('.sparkline-change')!
    expect(change.textContent).toBe('+28.4%')
    expect(change.getAttribute('aria-hidden')).toBe('true')
    expect(change.className).toBe('sparkline-change pos')
  })

  it('reads a move under 1% as flat — neutral ink, never a red or green verdict', () => {
    // SGOV's year on finance_realdata: a cent-level saw that used to draw full-height red.
    const flat = render(
      <Sparkline
        label="SGOV"
        points={[pt('2025-09-26', '100.28'), pt('2026-03-01', '100.10'), pt('2026-09-21', '100.72')]}
      />,
    )
    expect(flat.container.querySelector('polyline')!.getAttribute('stroke')).toBe('var(--muted)')
    const change = flat.container.querySelector('.sparkline-change')!
    expect(change.textContent).toBe('+0.4%')
    expect(change.className).toBe('sparkline-change')
    cleanup()
    // Exactly −1 % is ON the floor, so it is a verdict.
    const down = render(<Sparkline points={[pt('2025-09-26', '100'), pt('2026-09-21', '99')]} />)
    expect(down.container.querySelector('polyline')!.getAttribute('stroke')).toBe('var(--negative)')
    expect(down.container.querySelector('.sparkline-change')!.className).toBe('sparkline-change neg')
    // No label given: the name still says what the figure is.
    expect(down.container.querySelector('.sparkline-cell')!.getAttribute('aria-label')).toBe(
      '1-year change -1.0%',
    )
    cleanup()
    // The tone follows the figure the reader SEES: −0.98 % prints as "-1.0%", so it takes the
    // verdict a printed 1.0 % carries (META's year on finance_realdata read "-1.0%" in grey).
    const printed = render(<Sparkline points={[pt('2025-09-26', '100'), pt('2026-09-21', '99.02')]} />)
    expect(printed.container.querySelector('.sparkline-change')!.textContent).toBe('-1.0%')
    expect(printed.container.querySelector('polyline')!.getAttribute('stroke')).toBe('var(--negative)')
    cleanup()
    const under = render(<Sparkline points={[pt('2025-09-26', '100'), pt('2026-09-21', '99.06')]} />)
    expect(under.container.querySelector('.sparkline-change')!.textContent).toBe('-0.9%')
    expect(under.container.querySelector('polyline')!.getAttribute('stroke')).toBe('var(--muted)')
  })

  it('draws a faint baseline at the starting value', () => {
    const { container } = render(
      <Sparkline points={[pt('2025-09-26', '10'), pt('2026-03-01', '5'), pt('2026-09-21', '15')]} />,
    )
    const base = container.querySelector('line.sparkline-baseline')!
    // 10 on a 5..15 span sits halfway: y = 30 − 2 − 0.5 × 26 = 15.
    expect([base.getAttribute('x1'), base.getAttribute('x2')]).toEqual(['0', '60'])
    expect([base.getAttribute('y1'), base.getAttribute('y2')]).toEqual(['15.0', '15.0'])
  })

  it('says a missing year is missing, not flat', () => {
    const { container } = render(<Sparkline label="FIGR" points={[pt('2026-09-21', '37.11')]} />)
    const dash = container.querySelector('.sparkline-empty')!
    expect(dash.textContent).toBe('—')
    expect(dash.getAttribute('role')).toBe('img')
    expect(dash.getAttribute('aria-label')).toBe('FIGR 1-year change unavailable')
  })

  it('prints no ratio off a zero start, and still draws the line', () => {
    const { container } = render(<Sparkline label="X" points={[pt('2025-09-26', '0'), pt('2026-09-21', '5')]} />)
    expect(container.querySelector('polyline')!.getAttribute('stroke')).toBe('var(--muted)')
    expect(container.querySelector('.sparkline-change')!.textContent).toBe('—')
    expect(container.querySelector('.sparkline-cell')!.getAttribute('aria-label')).toBe(
      'X 1-year change unavailable',
    )
  })
})
